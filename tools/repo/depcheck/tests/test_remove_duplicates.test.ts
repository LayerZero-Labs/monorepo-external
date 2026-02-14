import type * as fs from 'fs';
import os from 'os';
import path from 'path';
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';

import { MOVE_TO_DEV_DEFAULT_PATTERN, removeDuplicates } from '../src/deps';
import type { PackageJson, PnpmPackageObject } from '../src/types';

// Mock fs
vi.mock('fs', async () => {
    const actual = await vi.importActual<typeof fs>('fs');
    return {
        ...actual,
        promises: {
            ...actual.promises,
            readFile: vi.fn(),
        },
    };
});

describe('removeDuplicates', () => {
    let tempDir: string;
    let mockPnpmLsObject: { [key: string]: PnpmPackageObject };

    beforeEach(() => {
        vi.clearAllMocks();
        tempDir = path.join(os.tmpdir(), `removeDuplicates-test-${Date.now()}`);
        mockPnpmLsObject = {};
    });

    afterEach(() => {
        vi.restoreAllMocks();
    });

    const createPackage = (
        name: string,
        deps: Record<string, string>,
        devDeps: Record<string, string>,
    ): {
        packageName: string;
        packagePath: string;
        packageJsonPath: string;
        packageJson: PackageJson;
    } => {
        const packagePath = path.join(tempDir, name);
        const packageJsonPath = path.join(packagePath, 'package.json');
        mockPnpmLsObject[name] = { name, path: packagePath };
        return {
            packageName: name,
            packagePath,
            packageJsonPath,
            packageJson: {
                dependencies: deps,
                devDependencies: devDeps,
            },
        };
    };

    test('should remove duplicate from dependencies when it matches pattern (keep in devDependencies)', async () => {
        const { packageName, packageJsonPath, packageJson } = createPackage(
            'test-package',
            {
                prettier: 'catalog:',
                lodash: 'catalog:',
            },
            {
                prettier: 'catalog:',
                vitest: 'catalog:',
            },
        );

        const packageResult = { [packageJsonPath]: packageJson };

        await removeDuplicates({
            packages: [packageName],
            packageResult,
            pattern: 'prettier',
            pnpmLsObject: mockPnpmLsObject,
            write: true,
        });

        expect(packageJson.dependencies).not.toHaveProperty('prettier');
        expect(packageJson.dependencies).toHaveProperty('lodash');
        expect(packageJson.devDependencies).toHaveProperty('prettier');
        expect(packageJson.devDependencies).toHaveProperty('vitest');
    });

    test('should remove duplicate from devDependencies when it does not match pattern (keep in dependencies)', async () => {
        const { packageName, packageJsonPath, packageJson } = createPackage(
            'test-package',
            {
                lodash: 'catalog:',
                axios: 'catalog:',
            },
            {
                lodash: 'catalog:',
                vitest: 'catalog:',
            },
        );

        const packageResult = { [packageJsonPath]: packageJson };

        await removeDuplicates({
            packages: [packageName],
            packageResult,
            pattern: 'vitest',
            pnpmLsObject: mockPnpmLsObject,
            write: true,
        });

        expect(packageJson.dependencies).toHaveProperty('lodash');
        expect(packageJson.dependencies).toHaveProperty('axios');
        expect(packageJson.devDependencies).not.toHaveProperty('lodash');
        expect(packageJson.devDependencies).toHaveProperty('vitest');
    });

    test('should handle MOVE_TO_DEV_DEFAULT_PATTERN', async () => {
        const { packageName, packageJsonPath, packageJson } = createPackage(
            'test-package',
            {
                '@types/node': 'catalog:',
                prettier: 'catalog:',
                lodash: 'catalog:',
            },
            {
                '@types/node': 'catalog:',
                prettier: 'catalog:',
                vitest: 'catalog:',
            },
        );

        const packageResult = { [packageJsonPath]: packageJson };

        await removeDuplicates({
            packages: [packageName],
            packageResult,
            pattern: MOVE_TO_DEV_DEFAULT_PATTERN,
            pnpmLsObject: mockPnpmLsObject,
            write: true,
        });

        // @types/node and prettier should be removed from dependencies (kept in devDependencies)
        expect(packageJson.dependencies).not.toHaveProperty('@types/node');
        expect(packageJson.dependencies).not.toHaveProperty('prettier');
        expect(packageJson.dependencies).toHaveProperty('lodash');

        // devDependencies should still contain all duplicates
        expect(packageJson.devDependencies).toHaveProperty('@types/node');
        expect(packageJson.devDependencies).toHaveProperty('prettier');
        expect(packageJson.devDependencies).toHaveProperty('vitest');
    });

    test('should not modify package when no duplicates exist', async () => {
        const { packageName, packageJsonPath, packageJson } = createPackage(
            'test-package',
            {
                lodash: 'catalog:',
            },
            {
                vitest: 'catalog:',
            },
        );

        const packageResult = { [packageJsonPath]: packageJson };

        await removeDuplicates({
            packages: [packageName],
            packageResult,
            pattern: 'prettier',
            pnpmLsObject: mockPnpmLsObject,
            write: true,
        });

        expect(packageJson.dependencies).toHaveProperty('lodash');
        expect(packageJson.devDependencies).toHaveProperty('vitest');
    });

    test('should handle packages with undefined dependencies', async () => {
        const { packageName, packageJsonPath, packageJson } = createPackage(
            'test-package',
            {},
            { prettier: 'catalog:' },
        );

        const packageResult = { [packageJsonPath]: packageJson };

        await removeDuplicates({
            packages: [packageName],
            packageResult,
            pattern: 'prettier',
            pnpmLsObject: mockPnpmLsObject,
            write: true,
        });

        // Should not crash, no duplicates to remove
        expect(packageJson.devDependencies).toHaveProperty('prettier');
    });

    test('should handle packages with undefined devDependencies', async () => {
        const { packageName, packageJsonPath, packageJson } = createPackage(
            'test-package',
            { lodash: 'catalog:' },
            {},
        );

        // Explicitly set devDependencies to undefined to test edge case
        packageJson.devDependencies = undefined;

        const packageResult = { [packageJsonPath]: packageJson };

        await removeDuplicates({
            packages: [packageName],
            packageResult,
            pattern: 'prettier',
            pnpmLsObject: mockPnpmLsObject,
            write: true,
        });

        // Should not crash, no duplicates to remove
        expect(packageJson.dependencies).toHaveProperty('lodash');
    });

    test('should add to packageResult in validation mode (write=false)', async () => {
        const { packageName, packageJsonPath, packageJson } = createPackage(
            'test-package',
            {
                prettier: 'catalog:',
            },
            {
                prettier: 'catalog:',
            },
        );

        // Pre-populate packageResult with the original package.json in validation mode
        const packageResult: { [key: string]: PackageJson } = {
            [packageJsonPath]: packageJson,
        };

        await removeDuplicates({
            packages: [packageName],
            packageResult,
            pattern: 'prettier',
            pnpmLsObject: mockPnpmLsObject,
            write: false,
        });

        // packageResult should be populated with modified copy to indicate changes needed
        expect(packageResult).toHaveProperty(packageJsonPath);
        expect(packageResult[packageJsonPath].dependencies).not.toHaveProperty('prettier');
        expect(packageResult[packageJsonPath].devDependencies).toHaveProperty('prettier');
    });

    test('should handle multiple duplicates in single package', async () => {
        const { packageName, packageJsonPath, packageJson } = createPackage(
            'test-package',
            {
                '@types/node': 'catalog:',
                prettier: 'catalog:',
                lodash: 'catalog:',
                axios: 'catalog:',
            },
            {
                '@types/node': 'catalog:',
                prettier: 'catalog:',
                lodash: 'catalog:',
            },
        );

        const packageResult = { [packageJsonPath]: packageJson };

        await removeDuplicates({
            packages: [packageName],
            packageResult,
            pattern: '@types,prettier',
            pnpmLsObject: mockPnpmLsObject,
            write: true,
        });

        // @types/node and prettier removed from dependencies (matched pattern)
        expect(packageJson.dependencies).not.toHaveProperty('@types/node');
        expect(packageJson.dependencies).not.toHaveProperty('prettier');
        // lodash removed from devDependencies (didn't match pattern)
        expect(packageJson.devDependencies).not.toHaveProperty('lodash');
        // Other deps remain
        expect(packageJson.dependencies).toHaveProperty('axios');
        expect(packageJson.devDependencies).toHaveProperty('@types/node');
        expect(packageJson.devDependencies).toHaveProperty('prettier');
    });

    test('should filter packages by only pattern', async () => {
        const pkg1 = createPackage('package-1', { prettier: 'catalog:' }, { prettier: 'catalog:' });
        const pkg2 = createPackage('package-2', { prettier: 'catalog:' }, { prettier: 'catalog:' });

        const packageResult = {
            [pkg1.packageJsonPath]: pkg1.packageJson,
            [pkg2.packageJsonPath]: pkg2.packageJson,
        };

        await removeDuplicates({
            packages: [pkg1.packageName, pkg2.packageName],
            packageResult,
            pattern: 'prettier',
            pnpmLsObject: mockPnpmLsObject,
            only: 'package-1',
            write: true,
        });

        // Only package-1 should be modified
        expect(pkg1.packageJson.dependencies).not.toHaveProperty('prettier');
        expect(pkg1.packageJson.devDependencies).toHaveProperty('prettier');

        // package-2 should remain unchanged
        expect(pkg2.packageJson.dependencies).toHaveProperty('prettier');
        expect(pkg2.packageJson.devDependencies).toHaveProperty('prettier');
    });

    test('should throw error when package not found in pnpmLsObject', async () => {
        await expect(
            removeDuplicates({
                packages: ['missing-package'],
                packageResult: {},
                pattern: 'prettier',
                pnpmLsObject: {},
                write: true,
            }),
        ).rejects.toThrow('Package missing-package not found in pnpmLsObject');
    });

    test('should use exact matching when regex is false', async () => {
        const { packageName, packageJsonPath, packageJson } = createPackage(
            'test-package',
            {
                '@types/node': 'catalog:',
                '@types': 'catalog:',
            },
            {
                '@types/node': 'catalog:',
                '@types': 'catalog:',
            },
        );

        const packageResult = { [packageJsonPath]: packageJson };

        await removeDuplicates({
            packages: [packageName],
            packageResult,
            pattern: '@types',
            pnpmLsObject: mockPnpmLsObject,
            regex: false,
            write: true,
        });

        // Exact match '@types' should be removed from dependencies (kept in devDependencies)
        // Non-matching '@types/node' should be removed from devDependencies (kept in dependencies)
        expect(packageJson.dependencies).toHaveProperty('@types/node');
        expect(packageJson.dependencies).not.toHaveProperty('@types');
        expect(packageJson.devDependencies).not.toHaveProperty('@types/node');
        expect(packageJson.devDependencies).toHaveProperty('@types');
    });
});
