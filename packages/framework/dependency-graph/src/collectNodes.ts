import { type DependencyNode } from './dependencyNode';

export const collectNodes = (root: DependencyNode): Map<string, DependencyNode> => {
    const nodes = new Map<string, DependencyNode>();
    const queue = [root];
    while (queue.length > 0) {
        const node = queue.shift()!;
        if (nodes.has(node.name)) continue;
        nodes.set(node.name, node);
        for (const dep of Object.values(node.dependencies)) queue.push(dep);
    }
    return nodes;
};
