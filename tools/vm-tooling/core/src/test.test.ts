import * as vitest from 'vitest';

import type { Image } from './config';
import { testTools } from './test';

interface SpyContext {
    expect: (actual: unknown) => { toBe: (expected: unknown) => void };
}

interface RegisteredTest {
    name: string;
    fn: (context: SpyContext) => unknown;
}

const images: Record<string, Image> = {
    'example:tool-1.0.0': { name: 'example', versions: { tool: '1.0.0' } },
};

vitest.it(
    'registering the tests and running the image ID test never read expect from the vitest object, and the image ID test asserts with its test context expect',
    async ({ expect }) => {
        const registered: RegisteredTest[] = [];
        const fakeVitest = new Proxy(vitest, {
            get: (target, property, receiver) => {
                switch (property) {
                    case 'expect':
                        throw new Error('testTools read expect from the vitest object');
                    case 'describe':
                        return (_name: string, fn: () => void) => fn();
                    case 'it':
                        return (name: string, fn: RegisteredTest['fn']) =>
                            registered.push({ name, fn });
                    case 'beforeAll':
                        return () => undefined;
                    default:
                        return Reflect.get(target, property, receiver);
                }
            },
        });

        expect(() => testTools(fakeVitest, images, [], {})).not.toThrow();

        const imageIdTest = registered.find(
            ({ name }) => name === 'has an image ID of example:tool-1.0.0',
        );
        if (imageIdTest === undefined) {
            throw new Error(
                "testTools registered no test named 'has an image ID of example:tool-1.0.0'",
            );
        }
        const toBe = vitest.vi.fn();
        const spyExpect = vitest.vi.fn(() => ({ toBe }));

        await imageIdTest.fn({ expect: spyExpect });

        expect(spyExpect).toHaveBeenCalledWith('example:tool-1.0.0');
        expect(toBe).toHaveBeenCalledWith('example:tool-1.0.0');
    },
);
