import depcheck from 'depcheck';
import { promises as fs } from 'fs';
import os from 'os';
import path from 'path';
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';

import { findDeclarationImports } from '../src/declarationImports';
import { processPackageDependencies } from '../src/deps';
import type { PackageJson } from '../src/types';
import { getDepcheckConfig } from '../src/utils';

vi.mock('../src/utils', () => ({
    getCatalog: vi.fn().mockResolvedValue({}),
    getCachedCatalog: vi.fn().mockResolvedValue({}),
    getPnpmLs: vi.fn(),
    execPromise: vi.fn(),
    getDepcheckConfig: vi.fn().mockResolvedValue({}),
}));

vi.mock('depcheck', () => ({
    default: vi.fn(),
}));

describe('declaration imports', () => {
    let packagePath: string;

    const writePackage = async (packageJson: PackageJson, declaration: string) => {
        await fs.mkdir(path.join(packagePath, 'dist', 'nested'), { recursive: true });
        await fs.writeFile(path.join(packagePath, 'package.json'), JSON.stringify(packageJson));
        await fs.writeFile(path.join(packagePath, 'dist', 'nested', 'index.d.ts'), declaration);
    };

    const runDepcheck = (depcheckResult: { dependencies?: string[] }) => {
        vi.mocked(depcheck).mockResolvedValue({
            dependencies: depcheckResult.dependencies ?? [],
            devDependencies: [],
            missing: {},
            using: {},
            invalidFiles: {},
            invalidDirs: {},
        });
        return processPackageDependencies({
            packageName: '@layerzerolabs/consumer',
            allDeps: {},
            packageInfo: { name: '@layerzerolabs/consumer', path: packagePath },
            workspacePackages: new Set([
                '@layerzerolabs/file-location-node',
                '@layerzerolabs/typescript-utils',
            ]),
        });
    };

    beforeEach(async () => {
        packagePath = await fs.mkdtemp(path.join(os.tmpdir(), 'declaration-imports-'));
    });

    afterEach(async () => {
        await fs.rm(packagePath, { recursive: true, force: true });
    });

    test('collects package names from declaration references only', async () => {
        await writePackage(
            {},
            [
                '/** import { example } from "@layerzerolabs/from-comment"; */',
                'import type { A } from "@layerzerolabs/typed/subpath";',
                'export * from "./local";',
                'export declare const b: import("zod/v4/core").X<import("fs").Stats>;',
                'import type { C } from "node:path";',
            ].join('\n'),
        );

        const imports = await findDeclarationImports(packagePath);

        expect([...imports.keys()].sort()).toEqual(['@layerzerolabs/typed', 'zod']);
    });

    test('keeps a dependency depcheck reports unused when a declaration references it', async () => {
        await writePackage(
            { dependencies: { '@layerzerolabs/file-location-node': 'workspace:*' } },
            'export declare const a: import("@layerzerolabs/file-location-node").Definition;',
        );

        expect(
            await runDepcheck({ dependencies: ['@layerzerolabs/file-location-node'] }),
        ).toBeNull();
    });

    test('adds an undeclared declaration reference to dependencies', async () => {
        await writePackage(
            { dependencies: {} },
            'export declare const a: import("@layerzerolabs/file-location-node").Definition;',
        );

        const [, packageJson] = (await runDepcheck({}))!;

        expect(packageJson.dependencies).toEqual({
            '@layerzerolabs/file-location-node': 'workspace:*',
        });
    });

    test('skips declaration references matched by depcheckrc ignores', async () => {
        vi.mocked(getDepcheckConfig).mockResolvedValueOnce({ ignores: ['@/*'] });
        await writePackage({ dependencies: {} }, 'import type { A } from "@/types";');

        expect(await runDepcheck({})).toBeNull();
    });

    test('requires consumer-visible declaration references outside dev-only packages', async () => {
        await writePackage(
            {
                dependencies: {},
                devDependencies: {
                    '@layerzerolabs/typescript-utils': 'workspace:*',
                    '@types/ms': 'catalog:',
                },
            },
            [
                'import type { StringValue } from "ms";',
                'import type { Merge } from "@layerzerolabs/typescript-utils";',
            ].join('\n'),
        );

        const [, packageJson] = (await runDepcheck({}))!;

        expect(packageJson.dependencies).toEqual({
            '@layerzerolabs/typescript-utils': 'workspace:*',
        });
    });
});
