import * as fs from 'fs';
import pLimit from 'p-limit';
import * as path from 'path';

import type { GraphData, PackageJson, PnpmPackageObject } from './types';

const CONCURRENCY_LIMIT = 20;

export interface INode {
    getEdges(): INode[];
    getId(): string;
    getName(): string;
    addEdge(edge: INode): void;
}

export class NODE implements INode {
    private id: string;
    private name: string;
    private edges: INode[];
    constructor(id: string, name: string) {
        this.id = id;
        this.name = name;
        this.edges = [];
    }

    getEdges() {
        return this.edges;
    }

    getId() {
        return this.id;
    }

    getName() {
        return this.name;
    }

    addEdge(edge: INode) {
        this.edges.push(edge);
    }
}

export class Graph {
    private nodes: NODE[];
    private nodeMap: Map<string, NODE>;
    private edges: Map<string, Set<string>>;
    private reachableNodesCache = new Map<string, Set<string>>();

    constructor() {
        this.nodes = [];
        this.nodeMap = new Map();
        this.edges = new Map();
    }

    addNode(node: NODE) {
        this.nodes.push(node);
        this.nodeMap.set(node.getId(), node);
    }

    addEdge(node: NODE, edge: NODE) {
        node.addEdge(edge);
        if (!this.edges.has(node.getId())) {
            this.edges.set(node.getId(), new Set());
        }
        this.edges.get(node.getId())?.add(edge.getId());
    }

    getNode(id: string) {
        return this.nodeMap.get(id);
    }

    getNodes() {
        return this.nodes;
    }

    // pass -1 for maxDepth to traverse all the way
    traverseGraph(
        startNodeIds: string[],
        maxDepth: number,
    ): { nodes: string[]; links: { source: string; target: string }[] } {
        const visitedNodes = new Set<string>();
        const allNodes = new Set<string>();
        const graphData: {
            nodes: string[];
            links: { source: string; target: string }[];
        } = {
            nodes: [],
            links: [],
        };

        const startNodes = startNodeIds.map((id) => this.getNode(id));
        if (startNodes.some((node) => !node)) {
            throw new Error(`Start node with ID ${startNodeIds.join(', ')} not found`);
        }

        const traverseGraph = (node: INode, depth: number) => {
            // Always check for cycles to prevent infinite recursion
            if (visitedNodes.has(node.getId())) {
                return;
            }

            // Check depth limit only if specified (maxDepth !== -1)
            if (maxDepth !== -1 && depth > maxDepth) {
                return;
            }

            visitedNodes.add(node.getId());

            allNodes.add(node.getId());

            for (const edge of node.getEdges()) {
                if (!edge.getId().includes('@layerzerolabs/')) {
                    continue;
                }
                graphData.links.push({
                    source: node.getId(),
                    target: edge.getId(),
                });
                if (!allNodes.has(edge.getId())) {
                    allNodes.add(edge.getId());
                }

                traverseGraph(edge, maxDepth !== -1 ? depth + 1 : -1);
            }
        };

        for (const startNode of startNodes) {
            traverseGraph(startNode!, 1);
        }

        graphData.nodes = Array.from(allNodes);

        return graphData;
    }

    /**
     * Returns a topological order for the subgraph reachable from the provided start nodes.
     * For an edge A -> B (A depends on B), B will appear before A in the resulting list.
     * The optional includeFilter can be used to restrict which node ids are returned in the final list
     * (useful for returning only workspace packages while still traversing their dependencies).
     */
    topologicalSortFrom(startNodeIds: string[], includeFilter?: (id: string) => boolean): string[] {
        const visited = new Set<string>();
        const inStack = new Set<string>();
        const ordered: string[] = [];

        const dfs = (node: INode) => {
            const nodeId = node.getId();
            if (visited.has(nodeId)) {
                return;
            }
            if (inStack.has(nodeId)) {
                throw new Error(`Dependency cycle detected involving ${nodeId}`);
            }

            inStack.add(nodeId);
            for (const dependency of node.getEdges()) {
                // Only consider LayerZero workspace packages for ordering/publishing
                if (!dependency.getId().includes('@layerzerolabs/')) {
                    continue;
                }
                dfs(dependency);
            }
            inStack.delete(nodeId);
            visited.add(nodeId);
            ordered.push(nodeId);
        };

        const startNodes = startNodeIds.map((id) => this.getNode(id));

        // Find the missing nodes and throw an error if any are found with the missing node list
        const missingNodeIds = startNodeIds.filter((_, idx) => !startNodes[idx]);
        if (missingNodeIds.length > 0) {
            throw new Error(`Start node(s) with ID(s) ${missingNodeIds.join(', ')} not found`);
        }

        for (const startNode of startNodes) {
            dfs(startNode!);
        }

        return includeFilter ? ordered.filter((id) => includeFilter(id)) : ordered;
    }

    backtrack(
        node: INode,
        maxDepth: number,
    ): { nodes: string[]; links: { source: string; target: string }[] } {
        const allNodes = new Set<string>();
        const visited = new Set<string>();
        const graphData: {
            nodes: string[];
            links: { source: string; target: string }[];
        } = {
            nodes: [],
            links: [],
        };

        const backtrack = (node: INode, depth: number) => {
            allNodes.add(node.getId());

            if (depth > maxDepth || visited.has(node.getId())) {
                return;
            }

            visited.add(node.getId());

            for (const key of this.edges.keys()) {
                if (this.edges.get(key)?.has(node.getId())) {
                    graphData.links.push({
                        source: key,
                        target: node.getId(),
                    });
                    backtrack(this.getNode(key)!, depth + 1);
                }
            }
        };

        backtrack(node, 1);

        graphData.nodes = Array.from(allNodes);

        return graphData;
    }

    extractSubgraph(node: INode): Graph {
        const graph = new Graph();

        const { nodes, links } = this.traverseGraph([node.getId()], -1);

        for (const n of nodes) {
            graph.addNode(new NODE(n, n));
        }

        for (const link of links) {
            graph.addEdge(graph.getNode(link.source)!, graph.getNode(link.target)!);
        }

        return graph;
    }

    /**
     * Returns all node IDs reachable from the given node.
     */
    public getReachableNodes(node: INode): Set<string> {
        const nodeId = node.getId();

        // Check cache first
        if (this.reachableNodesCache.has(nodeId)) {
            return this.reachableNodesCache.get(nodeId)!;
        }

        const reachableNodes = new Set<string>();
        const stack: INode[] = [node];

        // dfs to find all reachable nodes
        while (stack.length > 0) {
            const current = stack.pop()!;
            const currentId = current.getId();

            if (reachableNodes.has(currentId)) {
                continue;
            }

            reachableNodes.add(currentId);

            // Add all edges to the stack for processing
            for (const edge of current.getEdges()) {
                if (!reachableNodes.has(edge.getId())) {
                    stack.push(edge);
                }
            }
        }

        // Cache the result for this node
        this.reachableNodesCache.set(nodeId, reachableNodes);

        return reachableNodes;
    }

    visualizeFrom(startNodeIds: string[], maxDepth: number): GraphData {
        const graphData = this.traverseGraph(startNodeIds, maxDepth);
        const packageName = startNodeIds[0] || 'Dependency Graph';
        return { ...graphData, packageName };
    }

    visualizeTo(endNodeIds: string[], maxDepth: number): GraphData {
        const graphData = this.backtrack(this.getNode(endNodeIds[0])!, maxDepth);
        const packageName = endNodeIds[0] || 'Dependency Graph';
        return { ...graphData, packageName };
    }
}

/**
 * Builds a dependency graph starting from the given packages and traversing their dependencies.
 *
 * The graph is built iteratively: starting packages are processed first, then any newly
 * discovered workspace dependencies are queued for processing. This continues until all
 * transitive workspace dependencies have been discovered.
 *
 * External dependencies (npm packages not in the workspace) are added as nodes but not
 * traversed further.
 *
 * @param packages - Entry point package names to start traversal from. All must exist in pnpmLsObject.
 * @param packageResult - Pre-loaded package.json contents keyed by file path. Used as cache to avoid re-reading.
 * @param pnpmLsObject - Workspace package metadata from `pnpm ls`. Keys are package names.
 *                       This does NOT need to contain all workspace packages - only those relevant to the traversal.
 *                       However, all packages in the `packages` param must exist in this object.
 * @param options.includeDevDependencies - Whether to include devDependencies in traversal. Defaults to true.
 * @param options.workspaceOnly - When true, only traverse dependencies using `workspace:` protocol.
 *                                This filters out `catalog:` and versioned npm dependencies.
 *
 * @throws {Error} If any package in `packages` is not found in `pnpmLsObject`.
 */
export const buildGraph = async (
    packages: string[],
    packageResult: { [key: string]: PackageJson },
    pnpmLsObject: { [key: string]: PnpmPackageObject },
    options?: {
        includeDevDependencies?: boolean;
        workspaceOnly?: boolean;
    },
): Promise<Graph> => {
    const includeDevDeps = options?.includeDevDependencies !== false;
    const workspaceOnly = options?.workspaceOnly ?? false;

    const graph = new Graph();
    const processed = new Set<string>();
    const toProcess = new Set<string>(packages);

    // Validate all initial packages exist in workspace
    const invalidPackages = packages.filter((p) => !pnpmLsObject[p]);
    if (invalidPackages.length > 0) {
        throw new Error(`Packages not found in workspace: ${invalidPackages.join(', ')}`);
    }

    // Initialize nodes for starting packages
    for (const p of packages) {
        graph.addNode(new NODE(p, p));
    }

    const limit = pLimit(CONCURRENCY_LIMIT);

    // Process packages iteratively until no new packages are discovered
    while (toProcess.size > 0) {
        const currentBatch = Array.from(toProcess);
        toProcess.clear();

        await Promise.all(
            currentBatch.map((p) =>
                limit(async () => {
                    if (processed.has(p)) {
                        return;
                    }
                    processed.add(p);

                    const packageJsonPath = path.join(pnpmLsObject[p].path, 'package.json');
                    let packageJson = packageResult[packageJsonPath];

                    if (!packageJson) {
                        packageJson = JSON.parse(
                            await fs.promises.readFile(packageJsonPath, 'utf-8'),
                        );
                    }

                    const from = graph.getNode(p);
                    if (!from) {
                        return;
                    }

                    const allDeps: Record<string, string> = {
                        ...(packageJson.dependencies ?? {}),
                        ...(includeDevDeps ? (packageJson.devDependencies ?? {}) : {}),
                    };

                    for (const [dep, version] of Object.entries(allDeps)) {
                        if (workspaceOnly && !version.startsWith('workspace:')) {
                            continue;
                        }
                        if (!graph.getNode(dep)) {
                            graph.addNode(new NODE(dep, dep));
                        }
                        graph.addEdge(from, graph.getNode(dep)!);

                        // Queue newly discovered workspace dependencies for processing
                        if (!processed.has(dep) && pnpmLsObject[dep]) {
                            toProcess.add(dep);
                        }
                    }
                }),
            ),
        );
    }

    return graph;
};
