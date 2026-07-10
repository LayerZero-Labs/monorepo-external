import type { Dependencies } from '@layerzerolabs/dependency-graph';
import { DependencyNode } from '@layerzerolabs/dependency-graph';
import type { Registrar } from '@layerzerolabs/dfs';
import { dfs } from '@layerzerolabs/dfs';
export type { Registrar };

type NodeClass = new (...args: any[]) => DependencyNode;
type AbstractNodeClass = abstract new (...args: any[]) => DependencyNode;

/**
 * <!-- anchor:RegistrarBuilder -->
 * A builder class for a {@link Registrar}.
 * Builds a registrar that switches on node class--i.e., enables defining
 * specific registration behaviour for specific node classes.
 * Intelligently handles inheritance, always using the most specific
 * handler defined for any given class.
 * The registrar built shall return an object that maps from a handler ID,
 * to a map from node name to the return of each handler,
 * e.g., { objectNodes: { myObjectNode: 'my handler return' }}.
 * This can be used to extract a specific resolved value after resolving the tree,
 * given that the handlers return the resolved nodes.
 */
export class RegistrarBuilder<_ReturnTypes> {
    protected defaultHandler: (node: DependencyNode, ancestry: DependencyNode[]) => Promise<any>;

    protected nodeHandlers: Record<
        string,
        {
            fn: (node: DependencyNode, ancestry: DependencyNode[]) => Promise<any>;
            identifier: string;
        }
    > = {};

    protected classHandlers: {
        nodeClass: AbstractNodeClass;
        identifier: string;
        fn: (node: DependencyNode, ancestry: DependencyNode[]) => Promise<any>;
    }[] = [];

    protected classAliases: {
        fromNodeClass: AbstractNodeClass;
        getToNode: (from: DependencyNode) => DependencyNode;
    }[] = [];

    protected nodeAliases: Record<string, (node: DependencyNode) => DependencyNode> = {};

    protected getEntrypoints: (
        node: DependencyNode,
    ) => DependencyNode[] | Promise<DependencyNode[]> = (node) => [node];

    constructor() {
        this.defaultHandler = async (node: DependencyNode) => {
            throw new Error(
                `This registrar does not provide a handler for the dependency type used by ${JSON.stringify(node)}`,
            );
        };
    }

    public addNodeHandler<
        Node extends DependencyNode,
        Function extends (node: Node, ancestry: DependencyNode[]) => Promise<any>,
    >(node: DependencyNode, identifier: string, fn: Function) {
        if (this.nodeHandlers[node.name]) {
            throw new Error(
                `Cannot define a node handler for an identifier that already has a handler: ${node.name}`,
            );
        }
        this.nodeHandlers[node.name] = {
            fn: fn as unknown as (node: DependencyNode, ancestry: DependencyNode[]) => Promise<any>,
            identifier,
        };
        return this as RegistrarBuilder<
            _ReturnTypes & {
                ['nodeHandlers']: { [nodeName: string]: Awaited<ReturnType<Function>> };
            }
        >;
    }

    /**
     * Returns the class handler identifier that would be used for a given node,
     * or undefined if no class handler matches.
     */
    public getClassIdentifierForNode(node: DependencyNode): string | undefined {
        for (const { nodeClass, identifier } of this.classHandlers) {
            if (node instanceof nodeClass) {
                return identifier;
            }
        }
        return undefined;
    }

    /**
     * Add a function fn to be called on all nodes of class
     * @param nodeClass
     * @param identifier
     * @param fn
     */
    public addClassHandler<
        Identifier extends string,
        _NodeClass extends NodeClass,
        Function extends (node: InstanceType<_NodeClass>, ancestry: DependencyNode[]) => any,
    >(nodeClass: _NodeClass, identifier: Identifier, fn: Function) {
        if (this.classAliases.find(({ fromNodeClass }) => fromNodeClass === nodeClass)) {
            throw new Error(
                `Cannot define a handler for a class that is aliased to something else. This would be pointless`,
            );
        }

        let i = 0;
        for (const handler of this.classHandlers) {
            //check if we are overriding an existing handler
            if (handler.nodeClass === nodeClass) {
                this.classHandlers[i] = {
                    nodeClass,
                    identifier,
                    fn: fn as unknown as (node: DependencyNode) => Promise<any>,
                };

                return this as RegistrarBuilder<
                    _ReturnTypes & {
                        [_K in Identifier]: { [nodeName: string]: Awaited<ReturnType<Function>> };
                    }
                >;
            }
            //check if the new handler has an ordering requirement against an existing handler
            //(we always want to use more specific handlers if they exist)
            // eslint-disable-next-line no-prototype-builtins
            if (handler.nodeClass.prototype.isPrototypeOf(nodeClass.prototype)) {
                this.classHandlers.splice(i, 0, {
                    nodeClass,
                    identifier,
                    fn: fn as unknown as (node: DependencyNode) => Promise<any>,
                });

                return this as RegistrarBuilder<
                    _ReturnTypes & {
                        [_K in Identifier]: { [nodeName: string]: Awaited<ReturnType<Function>> };
                    }
                >;
            }
            i++;
        }

        this.classHandlers.push({
            nodeClass,
            identifier,
            fn: fn as unknown as (node: DependencyNode) => Promise<any>,
        });

        return this as RegistrarBuilder<
            _ReturnTypes & {
                [_K in Identifier]: { [nodeName: string]: Awaited<ReturnType<Function>> };
            }
        >;
    }

    /**
     * Alias some class *from*, such that any node of that class in the tree will be
     * treated as though it were some other node *to*. The *to* node is given as a
     * function returning a class instance, so that its dependencies, name, etc can be fixed.
     * The registrar will ignore the dependencies of the original node, and follow the alias's
     * dependencies instead.
     *
     * Additionally, this method does not affect the typing of the registrar. The output type
     * of the build() method will not reflect the alias.
     *
     * @param fromNodeClass alias instances of this class
     * @param getToNode method that returns the *to* part of the alias
     */
    public addClassAlias<FromNodeClass extends AbstractNodeClass>(
        fromNodeClass: FromNodeClass,
        getToNode: (fromNodeInstance: InstanceType<FromNodeClass>) => DependencyNode,
    ) {
        if (this.classHandlers.find(({ nodeClass }) => nodeClass === fromNodeClass)) {
            throw new Error(`Cannot define an alias for a class that already has a handler`);
        }

        let i = 0;
        for (const alias of this.classAliases) {
            //check if we are overriding an existing alias
            if (alias.fromNodeClass === fromNodeClass) {
                this.classAliases[i] = {
                    fromNodeClass,
                    getToNode: getToNode as unknown as (from: DependencyNode) => DependencyNode,
                };

                return this;
            }
            //check if the new alias has an ordering requirement against an existing alias
            //(we always want to use more specific handlers if they exist)
            // eslint-disable-next-line no-prototype-builtins
            if (alias.fromNodeClass.prototype.isPrototypeOf(fromNodeClass.prototype)) {
                this.classAliases.splice(i, 0, {
                    fromNodeClass,
                    getToNode: getToNode as unknown as (from: DependencyNode) => DependencyNode,
                });

                return this;
            }
            i++;
        }

        this.classAliases.push({
            fromNodeClass,
            getToNode: getToNode as unknown as (from: DependencyNode) => DependencyNode,
        });

        return this;
    }

    /**
     * Alias a specific named node, such that when encountered in the tree,
     * it will be transformed to a different node before processing.
     * The transformed node's dependencies will be traversed instead.
     * This is useful for short-circuiting dependency traversal for specific nodes.
     *
     * @param nodeName name of the node to alias
     * @param getToNode method that returns the transformed node
     */
    public addNodeAlias(
        node: DependencyNode,
        getToNode: (fromNodeInstance: DependencyNode) => DependencyNode,
    ) {
        this.nodeAliases[node.name] = getToNode;
        return this;
    }

    /**
     * Returns a function that resolves node/class aliases registered on this builder.
     * Useful for external traversals (e.g. CDK nodeExplorer) that need to follow
     * the same alias rules as the DFS built by {@link build}.
     */
    public getPrehandler(): (node: DependencyNode) => DependencyNode {
        return (node) => {
            const nodeAlias = this.nodeAliases[node.name];
            if (nodeAlias) return nodeAlias(node);
            for (const { fromNodeClass, getToNode } of this.classAliases) {
                if (node instanceof fromNodeClass) return getToNode(node);
            }
            return node;
        };
    }

    /**
     * Set a custom entrypoint getter function. By default, the entrypoint getter
     * returns the node passed in as the sole entrypoint.
     */
    public setEntrypointsGetter(
        fn: (node: DependencyNode) => DependencyNode[] | Promise<DependencyNode[]>,
    ) {
        this.getEntrypoints = fn;
        return this;
    }

    /**
     * Add a default function fn to be used on nodes whose types do not have handlers.
     * If this is not set, the default behaviour will be to throw
     * @param fn
     */
    public addDefault(fn: (node: DependencyNode, ancestry: DependencyNode[]) => any) {
        this.defaultHandler = fn;
        return this;
    }

    public build(): Registrar<_ReturnTypes> {
        const mergedNodePrehandler = (node: DependencyNode) => {
            // Check node aliases first (more specific)
            const nodeAlias = this.nodeAliases[node.name];
            if (nodeAlias) {
                return nodeAlias(node);
            }

            // Then check class aliases
            for (const { fromNodeClass, getToNode: toNode } of this.classAliases) {
                if (node instanceof fromNodeClass) {
                    return toNode(node);
                }
            }
            return node;
        };

        const mergedNodeHandler = async (node: DependencyNode, ancestry: DependencyNode[]) => {
            if (node.name === '_virtualEntrypoint') {
                return {
                    key: node.name,
                    value: undefined,
                };
            }

            const nodeHandler = this.nodeHandlers[node.name];
            if (nodeHandler) {
                return {
                    key: nodeHandler.identifier ?? node.name,
                    value: await nodeHandler.fn(node, ancestry),
                };
            }

            for (const { nodeClass, identifier, fn } of this.classHandlers) {
                if (node instanceof nodeClass) {
                    return {
                        key: identifier,
                        value: await fn(node, ancestry),
                    };
                }
            }

            return {
                key: 'default',
                value: await this.defaultHandler(node, ancestry),
            };
        };
        return {
            traverseDependencies: async (node: DependencyNode) => {
                const entrypoints = await this.getEntrypoints(node);
                if (entrypoints.length === 1)
                    return await dfs<_ReturnTypes>(node, mergedNodeHandler, mergedNodePrehandler)();

                const dependencies = entrypoints.reduce((acc, cur) => {
                    acc[cur.name] = cur;
                    return acc;
                }, {} as Dependencies);

                class VirtualNode extends DependencyNode {}

                const virtualEntrypoint = new VirtualNode({
                    name: '_virtualEntrypoint',
                    dependencies,
                });

                return await dfs<_ReturnTypes>(
                    virtualEntrypoint,
                    mergedNodeHandler,
                    mergedNodePrehandler,
                )();
            },
        };
    }
}

export const multiplexOrderedRegistrars = <
    const T extends [name: string, registrar: Registrar<{}>][],
>(
    ...registrars: T
) => {
    const multiplexRegistrar: Registrar<{
        [K in Extract<keyof T, number> as T[K] extends readonly [infer Name extends string, any]
            ? Name
            : never]: T[K] extends readonly [any, Registrar<infer Ret>] ? Ret : never;
    }> = {
        traverseDependencies: async (
            ...params: Parameters<Registrar<any>['traverseDependencies']>
        ) => {
            const acc: Record<string, any> = {};
            for (const [name, registrar] of registrars) {
                const result = await registrar.traverseDependencies(...params);
                acc[name] = result;
            }

            return acc;
        },
    } as any;

    return multiplexRegistrar;
};
