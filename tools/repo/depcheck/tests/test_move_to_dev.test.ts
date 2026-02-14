import type * as fs from 'fs';
import os from 'os';
import path from 'path';
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';

import { MOVE_TO_DEV_DEFAULT_PATTERN, moveToDev } from '../src/deps';
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

describe('moveToDev', () => {
    let tempDir: string;
    let mockPnpmLsObject: { [key: string]: PnpmPackageObject };

    beforeEach(() => {
        vi.clearAllMocks();
        tempDir = path.join(os.tmpdir(), `moveToDev-test-${Date.now()}`);
        mockPnpmLsObject = {};
    });

    afterEach(() => {
        vi.restoreAllMocks();
    });

    const createPackage = (
        name: string,
        deps: Record<string, string>,
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
            packageJson: { dependencies: deps },
        };
    };

    test('should move matching dependencies to devDependencies', async () => {
        const { packageName, packageJsonPath, packageJson } = createPackage('test-package', {
            prettier: 'catalog:',
            lodash: 'catalog:',
        });

        await moveToDev({
            packages: [packageName],
            packageResult: { [packageJsonPath]: packageJson },
            pattern: 'prettier',
            pnpmLsObject: mockPnpmLsObject,
        });

        expect(packageJson.dependencies).not.toHaveProperty('prettier');
        expect(packageJson.dependencies).toHaveProperty('lodash');
        expect(packageJson.devDependencies).toHaveProperty('prettier');
        expect(packageJson.devDependencies!['prettier']).toBe('catalog:');
    });

    test('should support comma-separated patterns', async () => {
        const { packageName, packageJsonPath, packageJson } = createPackage('test-package', {
            prettier: 'catalog:',
            eslint: 'catalog:',
            lodash: 'catalog:',
        });

        await moveToDev({
            packages: [packageName],
            packageResult: { [packageJsonPath]: packageJson },
            pattern: 'prettier,eslint',
            pnpmLsObject: mockPnpmLsObject,
        });

        expect(packageJson.dependencies).not.toHaveProperty('prettier');
        expect(packageJson.dependencies).not.toHaveProperty('eslint');
        expect(packageJson.dependencies).toHaveProperty('lodash');
        expect(packageJson.devDependencies).toHaveProperty('prettier');
        expect(packageJson.devDependencies).toHaveProperty('eslint');
    });

    test('should match @types pattern with @types/* packages using regex', async () => {
        const { packageName, packageJsonPath, packageJson } = createPackage('test-package', {
            '@types/node': 'catalog:',
            '@types/react': 'catalog:',
            lodash: 'catalog:',
        });

        await moveToDev({
            packages: [packageName],
            packageResult: { [packageJsonPath]: packageJson },
            pattern: '@types',
            pnpmLsObject: mockPnpmLsObject,
        });

        expect(packageJson.dependencies).not.toHaveProperty('@types/node');
        expect(packageJson.dependencies).not.toHaveProperty('@types/react');
        expect(packageJson.dependencies).toHaveProperty('lodash');
        expect(packageJson.devDependencies).toHaveProperty('@types/node');
        expect(packageJson.devDependencies).toHaveProperty('@types/react');
    });

    test('should work with MOVE_TO_DEV_DEFAULT_PATTERN', async () => {
        const { packageName, packageJsonPath, packageJson } = createPackage('test-package', {
            '@types/node': 'catalog:',
            prettier: 'catalog:',
            lodash: 'catalog:',
        });

        await moveToDev({
            packages: [packageName],
            packageResult: { [packageJsonPath]: packageJson },
            pattern: MOVE_TO_DEV_DEFAULT_PATTERN,
            pnpmLsObject: mockPnpmLsObject,
        });

        expect(packageJson.dependencies).not.toHaveProperty('@types/node');
        expect(packageJson.dependencies).not.toHaveProperty('prettier');
        expect(packageJson.dependencies).toHaveProperty('lodash');
        expect(packageJson.devDependencies).toHaveProperty('@types/node');
        expect(packageJson.devDependencies).toHaveProperty('prettier');
    });

    test('should use exact matching when regex is false', async () => {
        const { packageName, packageJsonPath, packageJson } = createPackage('test-package', {
            '@types/node': 'catalog:',
            '@types': 'catalog:',
            lodash: 'catalog:',
        });

        await moveToDev({
            packages: [packageName],
            packageResult: { [packageJsonPath]: packageJson },
            pattern: '@types',
            pnpmLsObject: mockPnpmLsObject,
            regex: false,
        });

        expect(packageJson.dependencies).toHaveProperty('@types/node');
        expect(packageJson.dependencies).not.toHaveProperty('@types');
        expect(packageJson.devDependencies).toHaveProperty('@types');
        expect(packageJson.devDependencies).not.toHaveProperty('@types/node');
    });

    test('should filter packages by only pattern', async () => {
        const pkg1 = createPackage('package-1', { prettier: 'catalog:' });
        const pkg2 = createPackage('package-2', { prettier: 'catalog:' });

        await moveToDev({
            packages: [pkg1.packageName, pkg2.packageName],
            packageResult: {
                [pkg1.packageJsonPath]: pkg1.packageJson,
                [pkg2.packageJsonPath]: pkg2.packageJson,
            },
            pattern: 'prettier',
            pnpmLsObject: mockPnpmLsObject,
            only: 'package-1',
        });

        expect(pkg1.packageJson.dependencies).not.toHaveProperty('prettier');
        expect(pkg1.packageJson.devDependencies).toHaveProperty('prettier');
        expect(pkg2.packageJson.dependencies).toHaveProperty('prettier');
        expect(pkg2.packageJson.devDependencies).toBeUndefined();
    });

    test('should throw error when package not found in pnpmLsObject', async () => {
        await expect(
            moveToDev({
                packages: ['missing-package'],
                packageResult: {},
                pattern: 'prettier',
                pnpmLsObject: {},
            }),
        ).rejects.toThrow('Package missing-package not found in pnpmLsObject');
    });
});
