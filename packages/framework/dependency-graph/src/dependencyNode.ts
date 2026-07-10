/**
 * <!-- anchor:DependencyNode -->
 * Dependency nodes are abstract nodes in the dependency graph. They're used to build the graph,
 * but as an abstract class, lacks the required information to actually be resolved to anything.
 * If you want to implement a new dependency node, see ObjectDefinition or FactoryDefinition
 * @param name the name of this node. It should be unique across the entire graph.
 * @param dependencies a map of other nodes that this node depends on. These children will be resolved first.
 * The key of the dependencies map should be some arbitrary name within the context of *this* node. It does
 * not have to be unique.
 */
export abstract class DependencyNode<
    Name extends string = string,
    _Dependencies extends Dependencies = Dependencies,
> {
    public readonly name: Name;
    public readonly dependencies: _Dependencies;
    constructor({
        name,
        dependencies = {} as _Dependencies,
    }: {
        name: Name;
        dependencies?: _Dependencies;
    }) {
        this.name = name;
        this.dependencies = dependencies;
    }
}

export type Dependencies = { [key: string]: DependencyNode<any, any> };

type IndexedDeps<Extra extends readonly DependencyNode[]> = {
    [K in keyof Extra as K extends `${number}` ? `__extra${K}` : never]: Extra[K];
};

export const withDependencies = <
    N extends DependencyNode,
    const Extra extends readonly DependencyNode[],
>(
    node: N,
    extraDeps: Extra,
): N & { dependencies: N['dependencies'] & IndexedDeps<Extra> } => {
    const mergedDeps = {
        ...node.dependencies,
        ...Object.fromEntries(extraDeps.map((dep, i) => [`__extra${i}`, dep])),
    };
    const descriptors: PropertyDescriptorMap = Object.getOwnPropertyDescriptors(node);
    descriptors.dependencies = { ...descriptors.dependencies, value: mergedDeps };
    return Object.create(Object.getPrototypeOf(node), descriptors);
};
