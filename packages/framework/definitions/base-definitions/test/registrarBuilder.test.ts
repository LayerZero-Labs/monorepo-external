import { describe, expect, test } from 'vitest';

import { Dependencies, DependencyNode } from '@layerzerolabs/dependency-graph';

import { RegistrarBuilder } from '../src/registrarBuilder';

const SimpleClassA = class<
    Name extends string,
    _Dependencies extends Dependencies,
> extends DependencyNode<Name, _Dependencies> {};

const mySimpleClassA1 = new SimpleClassA({ name: 'MySimpleClassA' });
const mySimpleClassA2 = new SimpleClassA({ name: 'MySimpleClassA' });

const ExtendsClassA = class<
    Name extends string,
    _Dependencies extends Dependencies,
> extends SimpleClassA<Name, _Dependencies> {};

const myExtendsClassA1 = new ExtendsClassA({ name: 'MyExtendsClassA' });

const ExtendsExtendsClassA = class<
    Name extends string,
    _Dependencies extends Dependencies,
> extends ExtendsClassA<Name, _Dependencies> {};

const myExtendsExtendsClassA1 = new ExtendsExtendsClassA({ name: 'MyExtendsExtendsClassA' });

const SimpleClassB = class<
    Name extends string,
    _Dependencies extends Dependencies,
> extends DependencyNode<Name, _Dependencies> {};

const mySimpleClassB1 = new SimpleClassB({ name: 'MySimpleClassB' });
const mySimpleClassB2 = new SimpleClassB({
    name: 'MySimpleClassB',
    dependencies: { mySimpleClassA1 },
});

const SimpleClassC = class<
    Name extends string,
    _Dependencies extends Dependencies,
> extends DependencyNode<Name, _Dependencies> {};

const mySimpleClassC1 = new SimpleClassC({ name: 'MySimpleClassC' });
const mySimpleClassC2 = new SimpleClassC({
    name: 'MySimpleClassC',
    dependencies: { mySimpleClassB2, mySimpleClassA1 },
});

describe('Registrar builder', () => {
    test('The registered callbacks should be called in order, such that dependencies are called before dependants', async () => {
        let order: string[] = [];
        const builder = new RegistrarBuilder()
            .addClassHandler(SimpleClassA, 'handler', () => order.push('A'))
            .addClassHandler(SimpleClassB, 'handler', () => order.push('B'))
            .addDefault(() => {})
            .build();

        await builder.traverseDependencies(mySimpleClassB1);
        expect(order).toStrictEqual(['B']);
        order = [];
        await builder.traverseDependencies(mySimpleClassA1);
        expect(order).toStrictEqual(['A']);
        order = [];
        await builder.traverseDependencies(mySimpleClassB2);
        expect(order).toStrictEqual(['A', 'B']);
    });
    test('The registered callback should be called only once for each unique definition', async () => {
        let calledCount = 0;
        let defaultCount = 0;
        const builder = new RegistrarBuilder()
            .addClassHandler(SimpleClassA, 'handler', () => calledCount++)
            .addDefault(() => defaultCount++)
            .build();

        await builder.traverseDependencies(mySimpleClassC1);
        expect(calledCount).toBe(0);
        await builder.traverseDependencies(mySimpleClassC2);
        expect(calledCount).toBe(1);
        await builder.traverseDependencies(mySimpleClassA1);
        await builder.traverseDependencies(mySimpleClassA2);
        expect(calledCount).toBe(3);
        expect(defaultCount).toBe(3);
        await builder.traverseDependencies(mySimpleClassC1);
        expect(calledCount).toBe(3);
        expect(defaultCount).toBe(4);
    });
    test('The most specific applicable handler should always be called, regardless of definition order', async () => {
        let calledCount: number[] = [0, 0, 0];
        const builder = new RegistrarBuilder()
            .addClassHandler(ExtendsClassA, 'handler', () => calledCount[1]++)
            .addClassHandler(SimpleClassA, 'handler', () => calledCount[0]++)
            .addClassHandler(ExtendsExtendsClassA, 'handler', () => calledCount[2]++)
            .addDefault(() => {})
            .build();

        await builder.traverseDependencies(myExtendsClassA1);
        expect(calledCount).toStrictEqual([0, 1, 0]);
        await builder.traverseDependencies(mySimpleClassA1);
        expect(calledCount).toStrictEqual([1, 1, 0]);
        await builder.traverseDependencies(myExtendsExtendsClassA1);
        await builder.traverseDependencies(myExtendsExtendsClassA1);
        expect(calledCount).toStrictEqual([1, 1, 2]);
    });
    test('The traverseDependencies method should return an object with the keys defined in the handlers, and the returns of those handlers', async () => {
        let inc = 0;
        const builder = new RegistrarBuilder()
            .addClassHandler(SimpleClassA, 'simpleA', () => inc++)
            .addClassHandler(SimpleClassB, 'simpleB', () => inc++)
            .addDefault(() => {})
            .build();

        const ret = await builder.traverseDependencies(mySimpleClassA1);
        expect(ret).toStrictEqual({ simpleA: { MySimpleClassA: 0 } });
        const ret2 = await builder.traverseDependencies(mySimpleClassB2);
        expect(ret2).toStrictEqual({
            simpleA: { MySimpleClassA: 1 },
            simpleB: { MySimpleClassB: 2 },
        });
    });
});

describe('Node handlers', () => {
    test('Should take priority over class handlers', async () => {
        let classHandlerCalled = false;
        let namedHandlerCalled = false;

        const builder = new RegistrarBuilder()
            .addClassHandler(SimpleClassA, 'simpleA', async () => {
                classHandlerCalled = true;
                return 'from-class';
            })
            .addNodeHandler(mySimpleClassA1, 'MySimpleClassA', async () => {
                namedHandlerCalled = true;
                return 'from-named';
            })
            .build();

        await builder.traverseDependencies(mySimpleClassA1);

        expect(namedHandlerCalled).toBe(true);
        expect(classHandlerCalled).toBe(false);
    });

    test('Should be invoked with correct arguments and return values', async () => {
        let receivedNode: DependencyNode | undefined;
        let receivedAncestry: DependencyNode[] | undefined;

        const builder = new RegistrarBuilder()
            .addNodeHandler(mySimpleClassA1, 'MySimpleClassA', async (node, ancestry) => {
                receivedNode = node;
                receivedAncestry = ancestry;
                return 'named-result';
            })
            .build();

        const result = await builder.traverseDependencies(mySimpleClassA1);

        expect(receivedNode).toBe(mySimpleClassA1);
        expect(receivedAncestry).toStrictEqual([]);
        // Result is grouped by handler identifier (node name for named handlers)
        expect(result).toStrictEqual({ MySimpleClassA: { MySimpleClassA: 'named-result' } });
    });

    test('Registering duplicate node handlers should throw', () => {
        expect(() => {
            new RegistrarBuilder()
                .addNodeHandler(mySimpleClassA1, 'MySimpleClassA', async () => 'first')
                .addNodeHandler(mySimpleClassA1, 'MySimpleClassA', async () => 'second');
        }).toThrow(
            'Cannot define a node handler for an identifier that already has a handler: MySimpleClassA',
        );
    });
});
