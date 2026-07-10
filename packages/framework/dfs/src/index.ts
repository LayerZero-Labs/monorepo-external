import type { DependencyNode } from '@layerzerolabs/dependency-graph';

/**
 * <!-- anchor:Registrar -->
 * A registrar is a simple interface for an object that provides the ability to traverse the dependency graph.
 * It is implicit in this definition that the registrar should also *register* values adhering to the schemata
 * of the graph.
 */
export interface Registrar<ReturnType> {
    traverseDependencies: (rootNode: DependencyNode) => Promise<ReturnType>;
}
export type NodeHandlerFunction = (
    node: DependencyNode,
    ancestry: DependencyNode[],
) => Promise<{ key: string; value: any }>;
export type NodePreHandlerFunction = (node: DependencyNode) => DependencyNode;

// Map of ancestor node -> minimal hop distance
type AncestorDistanceByNode = Map<DependencyNode, number>;
// Index from node name -> its ancestor distance map
type AncestryDistanceIndex = Map<string, AncestorDistanceByNode>;

/**
 * In-place merge of minimal ancestry distances.
 *
 * childDistances holds minimal distances from the child to each ancestor (keyed by DependencyNode).
 * For every entry in parentDistances, we update the child's map with (parentDist + 1),
 * keeping the minimal value if the ancestor already exists.
 */
const mergeAncestorDistances = (
    parentDistances: AncestorDistanceByNode,
    childDistances: AncestorDistanceByNode,
) => {
    for (const [ancestor, parentDist] of parentDistances) {
        const candidate = parentDist + 1;
        const current = childDistances.get(ancestor) || Infinity;
        childDistances.set(ancestor, Math.min(current, candidate));
    }
};

/**
 * Builds a minimal ancestry distance index for all nodes reachable from the root.
 *
 * Returns a Map: node.name -> Map<DependencyNode, distance> where distance is the minimal hop count
 * from the node to that ancestor. We perform a Kahn-style BFS over the DAG, and for each edge
 * curNode -> dep we merge curNode's minimal distances into the dependency with +1 hop and take the minimum.
 */
const buildAncestryDistanceIndex = (
    node: DependencyNode,
    prehandler: NodePreHandlerFunction,
): AncestryDistanceIndex => {
    const ancestryDistanceIndex: AncestryDistanceIndex = new Map();
    const inDegreeByNodeName = new Map<string, number>();

    // If A depends on B and C, B depends on C, we initialize with:
    // ancestryDistanceIndex: { A: Map(), B: Map(), C: Map() }
    // inDegreeByNodeName: { B: 1, C: 2 }
    const initializeMaps = (cur: DependencyNode) => {
        ancestryDistanceIndex.set(cur.name, new Map());
        for (const dep of Object.values(cur.dependencies)) {
            const handledDep = prehandler(dep);
            const inDegree = inDegreeByNodeName.get(handledDep.name) || 0;
            inDegreeByNodeName.set(handledDep.name, inDegree + 1);
            if (!ancestryDistanceIndex.has(handledDep.name)) initializeMaps(handledDep);
        }
    };

    const handled = prehandler(node);

    initializeMaps(handled);

    // Kahn-style topological BFS accumulating minimal distance ancestors
    let queue = [handled];
    while (queue.length > 0) {
        const curNode = queue.shift()!;
        // Include self with distance 0, then extend with the already known minimal distances
        const currentMinimalDistances: AncestorDistanceByNode = new Map([
            [curNode, 0],
            ...ancestryDistanceIndex.get(curNode.name)!,
        ]);
        // Add the new processable dependencies to the queue, update their state.
        for (const dep of Object.values(curNode.dependencies)) {
            const handledDep = prehandler(dep);
            const inDegree = inDegreeByNodeName.get(handledDep.name)!;
            // We are the last edge missing in the graph for this dependency -> we can process it after us.
            if (inDegree === 1) {
                queue.push(handledDep);
            }
            // Reduce the in-degree of the dependency -> it basically means that this edge got removed from the graph.
            inDegreeByNodeName.set(handledDep.name, inDegree - 1);

            // Merge curNode's minimal distances (+1 hop) into the dependency's minimal distances
            const childDistances = ancestryDistanceIndex.get(handledDep.name)!;
            mergeAncestorDistances(currentMinimalDistances, childDistances);
        }
    }

    for (const [nodeName, inDegree] of inDegreeByNodeName) {
        if (inDegree !== 0) {
            throw new Error(
                `node ${nodeName} has in-degree ${inDegree}, this indicates a cycle in the graph containing the node`,
            );
        }
    }

    return ancestryDistanceIndex;
};

/**
 * Performs a depth-first-search on a tree of dependency nodes, and returns a function
 * that will call the handler for each node in the tree, ordered s.t. the handler of N
 * will be called only after the handlers of dependencies(N) have been called.
 * The node's ancestors are sorted by non-decreasing minimal distance.
 * The resolver function will only call the handler once for each unique definition node.
 * The resolver function returns an object whose keys are the keys defined
 * by each of the handlers, and whose values are objects whose keys are the names
 * of the nodes resolved and whose values are the values defined by the handlers.
 * @param node the root node of the tree
 * @param handler a function that accepts a node and registers it
 * @param prehandler a function that accepts a node and returns a node. Will be used to pre-process the graph
 * @returns a resolver function
 */
export const dfs = <ReturnTypes>(
    node: DependencyNode,
    handler: NodeHandlerFunction,
    prehandler: NodePreHandlerFunction = (node) => node,
    _returns: ReturnTypes = {} as any,
): (() => Promise<ReturnTypes>) => {
    const ancestryDistanceIndex = buildAncestryDistanceIndex(node, prehandler);

    // Maintains Map<node.name, Promise<void>> -> the promise to resolve the node, for all nodes.
    const nodeResolverPromises = new Map<string, Promise<void>>();
    const resolveNode = async (node: DependencyNode) => {
        const prehandledNode = prehandler(node);
        // first wait for all its children
        const childrenPromises = [];
        for (const dependencyValue of Object.values(prehandledNode.dependencies)) {
            // Grab the cached promise or create it, we want to have only 1 handler promise for each node.
            if (!nodeResolverPromises.has(dependencyValue.name)) {
                nodeResolverPromises.set(dependencyValue.name, resolveNode(dependencyValue));
            }
            childrenPromises.push(nodeResolverPromises.get(dependencyValue.name)!);
        }
        await Promise.all(childrenPromises);

        // Then, you can process yourself. Build ancestry sorted by non-decreasing minimal distance.
        const minimalDistances = ancestryDistanceIndex.get(prehandledNode.name)!;
        const sortedAncestors = Array.from(minimalDistances.entries()).sort((a, b) => a[1] - b[1]);
        const regRes = await handler(
            prehandledNode,
            sortedAncestors.map(([node, _]) => node),
        );
        if (regRes) {
            ((_returns as any)[regRes.key] ??= {})[prehandledNode.name] = regRes.value;
        }
    };

    return async () => {
        await resolveNode(node);
        return _returns;
    };
};
