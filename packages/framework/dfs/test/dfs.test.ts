import { describe, expect, test } from 'vitest';

import { Dependencies, DependencyNode } from '@layerzerolabs/dependency-graph';

import { dfs } from '../src';

const SimpleClassA = class<
    Name extends string,
    _Dependencies extends Dependencies,
> extends DependencyNode<Name, _Dependencies> {};

const mySimpleClassA = new SimpleClassA({ name: 'MySimpleClassA' });

const SimpleClassB = class<
    Name extends string,
    _Dependencies extends Dependencies,
> extends DependencyNode<Name, _Dependencies> {};

const mySimpleClassB = new SimpleClassB({
    name: 'MySimpleClassB',
    dependencies: { mySimpleClassA },
});

const SimpleClassC = class<
    Name extends string,
    _Dependencies extends Dependencies,
> extends DependencyNode<Name, _Dependencies> {};

const mySimpleClassC = new SimpleClassC({
    name: 'MySimpleClassC',
    dependencies: { mySimpleClassB },
});

const SimpleClassD = class<
    Name extends string,
    _Dependencies extends Dependencies,
> extends DependencyNode<Name, _Dependencies> {};

const mySimpleClassD = new SimpleClassD({
    name: 'MySimpleClassD',
    dependencies: { mySimpleClassC, mySimpleClassB, mySimpleClassA },
});

describe('DI Depth-first-search', () => {
    test('Initial DFS and resolution should happen separately and return the expected structure', async () => {
        let wasCalled = false;
        const resolve = dfs(mySimpleClassA, async () => {
            wasCalled = true;
            return { key: 'nodeKey', value: 'nodeValue' };
        });

        //when called, dfs should traverse the tree and collect all the nodes,
        //returning a function that will call the handler on each node
        expect(resolve).toBeTypeOf('function');

        //it shouldn't call the handler until the resolve function is called
        expect(wasCalled).toBe(false);
        const res = await resolve();
        //the resolve method should await all of the handlers
        expect(wasCalled).toBe(true);
        //the resolve method should return an object whose keys are the keys defined
        //by each of the handlers, and whose values are objects whose keys are the names
        //of the nodes resolved and whose values are the values defined by the handlers
        expect(res).toStrictEqual({ nodeKey: { MySimpleClassA: 'nodeValue' } });
    });

    test(`The handlers for each of a node's dependencies should be completed before that node`, async () => {
        let order: string[] = [];

        const handler: Parameters<typeof dfs>[1] = async (node) => {
            const handlerRet = { key: '_', value: '_' };
            if (node.name === mySimpleClassA.name) {
                order.push('A');
                await new Promise((res) => setTimeout(res, 50));
                return handlerRet;
            } else if (node.name === mySimpleClassB.name) {
                order.push('B');
                await new Promise((res) => setTimeout(res, 100));
                return handlerRet;
            } else if (node.name === mySimpleClassC.name) {
                order.push('C');
                return handlerRet;
            }
            throw new Error(`Unexpected node ${JSON.stringify(node)}`);
        };

        await dfs(mySimpleClassB, handler)();
        expect(order).toStrictEqual(['A', 'B']);

        order = [];

        await dfs(mySimpleClassC, handler)();
        expect(order).toStrictEqual(['A', 'B', 'C']);
    });

    test('The handler should be called only once for each unique node', async () => {
        let count = 0;

        const handler: Parameters<typeof dfs>[1] = async (_node) => {
            count++;
            return { key: '_', value: '_' };
        };

        await dfs(mySimpleClassB, handler)();
        expect(count).toBe(2);

        count = 0;

        await dfs(mySimpleClassD, handler)();
        expect(count).toBe(4);
    });
});

describe('DI Ancestry - inclusion and distance order', () => {
    test('C -> B -> A', async () => {
        const { ancestry } = await dfs<{ ancestry: Record<string, string[]> }>(
            mySimpleClassC,
            async (_node, ancestry) => {
                return { key: 'ancestry', value: ancestry.map((n) => n.name) };
            },
        )();

        expect(ancestry.MySimpleClassC).toStrictEqual([]);
        expect(ancestry.MySimpleClassB).toStrictEqual(['MySimpleClassC']);
        expect(ancestry.MySimpleClassA).toStrictEqual(['MySimpleClassB', 'MySimpleClassC']);
    });

    test('D -> (C, B, A) with C -> B -> A', async () => {
        const { ancestry } = await dfs<{ ancestry: Record<string, string[]> }>(
            mySimpleClassD,
            async (_node, ancestry) => {
                return { key: 'ancestry', value: ancestry.map((n) => n.name) };
            },
        )();

        // D is the root
        expect(ancestry.MySimpleClassD).toStrictEqual([]);

        // C has only D above it
        expect(ancestry.MySimpleClassC).toStrictEqual(['MySimpleClassD']);

        // B has both C and D at distance 1 (order between them is not asserted)
        expect(new Set(ancestry.MySimpleClassB)).toStrictEqual(
            new Set(['MySimpleClassC', 'MySimpleClassD']),
        );
        expect(ancestry.MySimpleClassB.length).toBe(2);

        // A must include B and D (distance 1, order between them not asserted), then C (distance 2)
        expect(new Set(ancestry.MySimpleClassA.slice(0, 2))).toStrictEqual(
            new Set(['MySimpleClassB', 'MySimpleClassD']),
        );
        expect(ancestry.MySimpleClassA[2]).toBe('MySimpleClassC');
    });

    test('ancestry matches expected distance layers', async () => {
        const { ancestry } = await dfs<{ ancestry: Record<string, string[]> }>(
            mySimpleClassD,
            async (_node, ancestry) => {
                return { key: 'ancestry', value: ancestry.map((n) => n.name) };
            },
        )();

        const expectedLayers: Record<string, string[][]> = {
            MySimpleClassD: [],
            MySimpleClassC: [['MySimpleClassD']],
            MySimpleClassB: [['MySimpleClassC', 'MySimpleClassD']],
            MySimpleClassA: [['MySimpleClassB', 'MySimpleClassD'], ['MySimpleClassC']],
        };

        for (const [nodeName, layers] of Object.entries(expectedLayers)) {
            const actual = ancestry[nodeName];
            let idx = 0;
            for (const layer of layers) {
                const segment = actual.slice(idx, idx + layer.length);
                expect(new Set(segment)).toStrictEqual(new Set(layer));
                idx += layer.length;
            }
            expect(idx).toBe(actual.length);
        }
    });
});

describe('DI Ancestry - randomized DAG property', () => {
    const GNode = class<
        Name extends string,
        _Dependencies extends Dependencies,
    > extends DependencyNode<Name, _Dependencies> {};

    const makeRng = (seed: number) => {
        let state = seed >>> 0;
        return () => {
            state = (state * 1664525 + 1013904223) >>> 0; // LCG
            return state / 2 ** 32;
        };
    };

    const buildRandomDag = (
        numNodes: number,
        edgeProbability: number,
        seed: number,
    ): DependencyNode<any, any>[] => {
        const rng = makeRng(seed);
        const nodes: DependencyNode<any, any>[] = [];
        for (let i = 0; i < numNodes; i++) {
            const deps: Record<string, DependencyNode<any, any>> = {};
            for (let j = 0; j < i; j++) {
                if (rng() < edgeProbability) {
                    deps[`d${j}`] = nodes[j];
                }
            }
            if (i > 0 && Object.keys(deps).length === 0) {
                const j = Math.floor(rng() * i);
                deps[`d${j}`] = nodes[j];
            }
            nodes.push(new GNode({ name: `N${i}`, dependencies: deps }));
        }
        return nodes;
    };

    const collectReachable = (root: DependencyNode<any, any>) => {
        const map = new Map<string, DependencyNode<any, any>>();
        const queue: DependencyNode<any, any>[] = [root];
        while (queue.length > 0) {
            const cur = queue.shift()!;
            if (map.has(cur.name)) continue;
            map.set(cur.name, cur);
            for (const dep of Object.values(cur.dependencies) as DependencyNode<any, any>[]) {
                queue.push(dep);
            }
        }
        return map;
    };

    const buildDependentsIndex = (nodes: Map<string, DependencyNode<any, any>>) => {
        const dependentsIndex = new Map<string, Set<string>>();
        for (const node of nodes.values()) dependentsIndex.set(node.name, new Set());
        for (const node of nodes.values()) {
            for (const dep of Object.values(node.dependencies) as DependencyNode<any, any>[]) {
                dependentsIndex.get(dep.name)!.add(node.name);
            }
        }
        return dependentsIndex;
    };

    const computeDependentDistances = (
        start: string,
        dependentsIndex: Map<string, Set<string>>,
    ) => {
        const distances = new Map<string, number>();
        const queue: Array<{ name: string; dist: number }> = [{ name: start, dist: 0 }];
        distances.set(start, 0);
        while (queue.length > 0) {
            const { name, dist } = queue.shift()!;
            for (const next of dependentsIndex.get(name) || [])
                if (!distances.has(next)) {
                    distances.set(next, dist + 1);
                    queue.push({ name: next, dist: dist + 1 });
                }
        }
        distances.delete(start);
        return distances;
    };

    test('random DAGs: ancestry includes all ancestors and distances are non-decreasing', async () => {
        // increase/play with these values if you're making changes :D
        const iterations = 2;
        const numNodes = 200;

        // Edge probability p: node i has E[in-degree(i)] ≈ p*i (edges only to earlier nodes).
        // Average per node ≈ p*(n-1)/2. For n=500 and p=0.25, avg ≈ 62; the last node ≈ 125.
        const edgeProbability = 0.25;

        // Sampling probability: fraction of reachable nodes validated.
        // E[sampled] ≈ reachableCount * sampleProbability (≈100 if ~500 reachable).
        const sampleProbability = 0.2;

        const seeds = Array.from({ length: iterations }, () =>
            Math.floor(Math.random() * 0x7fffffff),
        );

        for (const seed of seeds) {
            try {
                const nodes = buildRandomDag(numNodes, edgeProbability, seed);
                const root = nodes[nodes.length - 1];
                const res = await dfs<{ ancestry: Record<string, string[]> }>(
                    root,
                    async (_node, ancestry) => {
                        return { key: 'ancestry', value: ancestry.map((n) => n.name) };
                    },
                )();
                const reachable = collectReachable(root);
                const dependentsIndex = buildDependentsIndex(reachable);

                // dfs should traverse exactly the reachable set
                expect(new Set(Object.keys(res.ancestry))).toStrictEqual(new Set(reachable.keys()));

                const sample: { nodeName: string; list: string[] }[] = [];
                for (const [nodeName, list] of Object.entries(res.ancestry)) {
                    if (Math.random() < sampleProbability) {
                        sample.push({ nodeName, list });
                    }
                }

                for (const { nodeName, list } of sample) {
                    // No self in ancestry
                    expect(list.includes(nodeName)).toBe(false);
                    // Inclusion: exactly the set of reachable dependents
                    const distMap = computeDependentDistances(nodeName, dependentsIndex);
                    expect(new Set(list)).toStrictEqual(new Set(distMap.keys()));

                    // No duplicates
                    expect(new Set(list).size).toBe(list.length);

                    // Distance non-decreasing
                    for (let i = 1; i < list.length; i++) {
                        const prev = distMap.get(list[i - 1])!;
                        const cur = distMap.get(list[i])!;
                        expect(prev <= cur).toBe(true);
                    }
                }
            } catch (err: any) {
                if (err && typeof err === 'object' && 'message' in err) {
                    err.message = `failed random dag test with seed ${seed}: ${err.message}`;
                    throw err;
                }
                throw new Error(`failed random dag test with seed ${seed}: ${String(err)}`);
            }
        }
    });
});
