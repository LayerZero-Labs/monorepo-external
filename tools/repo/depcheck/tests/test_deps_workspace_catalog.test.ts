import { promises as fsPromises } from 'fs';
import os from 'os';
import path from 'path';
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';

import { addMissingDependencies, processDependencies } from '../src/deps';
import type { PackageJson, PnpmPackageObject } from '../src/types';
import * as utils from '../src/utils';

// Mock the utils module
vi.mock('../src/utils', () => ({
    getCatalog: vi.fn(),
    getCachedCatalog: vi.fn(),
    getPnpmLs: vi.fn(),
    execPromise: vi.fn(),
}));

// Mock depcheck
vi.mock('depcheck', () => ({
    default: vi.fn(),
}));

describe('addMissingDependencies - workspace/catalog detection', () => {
    let mockPackageJson: PackageJson;
    let mockCatalog: Record<string, string>;

    beforeEach(() => {
        // Reset mocks
        vi.clearAllMocks();

        mockPackageJson = {
            dependencies: {},
        };

        mockCatalog = {
            '@layerzerolabs/catalog-package': '^1.0.0',
        };

        // Setup default mocks
        vi.mocked(utils.getCatalog).mockResolvedValue(mockCatalog);
        vi.mocked(utils.getCachedCatalog).mockResolvedValue(mockCatalog);
    });

    test('should use workspace:* for @layerzerolabs packages that exist in workspace', async () => {
        const allDeps: { [key: string]: Set<string> } = {};
        const missingDeps = ['@layerzerolabs/existing-package'];

        await addMissingDependencies({
            packageJson: mockPackageJson,
            missingDeps,
            workspacePackages: new Set(missingDeps),
            packageName: 'test-package',
            allDeps,
        });

        expect(allDeps['@layerzerolabs/existing-package']).toEqual(new Set(['workspace:*']));
        expect(mockPackageJson.dependencies!['@layerzerolabs/existing-package']).toBe(
            'workspace:*',
        );
    });

    test('should use catalog version for @layerzerolabs packages not in workspace but in catalog', async () => {
        const allDeps: { [key: string]: Set<string> } = {};
        const missingDeps = ['@layerzerolabs/catalog-package'];

        await addMissingDependencies({
            packageJson: mockPackageJson,
            missingDeps,
            workspacePackages: new Set(),
            packageName: 'test-package',
            allDeps,
        });

        expect(allDeps['@layerzerolabs/catalog-package']).toEqual(new Set(['^1.0.0']));
        expect(mockPackageJson.dependencies!['@layerzerolabs/catalog-package']).toBe('^1.0.0');
    });

    test('should look into npm for @layerzerolabs packages not in workspace or catalog', async () => {
        const allDeps: { [key: string]: Set<string> } = {};
        const missingDeps = ['@layerzerolabs/npm-package'];

        // Mock npm view response
        vi.mocked(utils.execPromise).mockResolvedValue({
            stdout: '2.3.4',
            stderr: '',
        } as any);

        await addMissingDependencies({
            packageJson: mockPackageJson,
            missingDeps,
            workspacePackages: new Set(),
            packageName: 'test-package',
            allDeps,
        });

        expect(allDeps['@layerzerolabs/npm-package']).toEqual(new Set(['^2.3.4']));
        expect(mockPackageJson.dependencies!['@layerzerolabs/npm-package']).toBe('^2.3.4');
        expect(utils.execPromise).toHaveBeenCalledWith(`npm view ${missingDeps[0]} version`);
    });

    test('should skip packages not found in workspace or catalog or npm', async () => {
        const allDeps: { [key: string]: Set<string> } = {};
        const missingDeps = ['@layerzerolabs/missing-package'];

        vi.mocked(utils.execPromise).mockResolvedValue({
            stdout: '',
            stderr: 'Package not found',
        } as any);

        await addMissingDependencies({
            packageJson: mockPackageJson,
            missingDeps,
            workspacePackages: new Set(),
            packageName: 'test-package',
            allDeps,
        });

        expect(allDeps['@layerzerolabs/missing-package']).toBeUndefined();
        expect(mockPackageJson.dependencies!['@layerzerolabs/missing-package']).toBeUndefined();
    });

    test('should fetch from npm for non-@layerzerolabs packages', async () => {
        const allDeps: { [key: string]: Set<string> } = {};
        const missingDeps = ['lodash'];

        // Mock npm view response
        vi.mocked(utils.execPromise).mockResolvedValue({
            stdout: '4.17.21',
            stderr: '',
        } as any);

        await addMissingDependencies({
            packageJson: mockPackageJson,
            missingDeps,
            workspacePackages: new Set(),
            packageName: 'test-package',
            allDeps,
        });

        expect(allDeps['lodash']).toEqual(new Set(['^4.17.21']));
        expect(mockPackageJson.dependencies!['lodash']).toBe('^4.17.21');
    });

    test('should skip self-dependencies', async () => {
        const allDeps: { [key: string]: Set<string> } = {};
        const missingDeps = ['test-package'];

        const log = await addMissingDependencies({
            packageJson: mockPackageJson,
            missingDeps,
            workspacePackages: new Set(),
            packageName: 'test-package',
            allDeps,
        });

        expect(log).toContain('appears to depend on itself');
        expect(allDeps['test-package']).toBeUndefined();
        expect(mockPackageJson.dependencies!['test-package']).toBeUndefined();
    });

    test('should add implicit dependencies', async () => {
        mockPackageJson.implicitDependencies = {
            '@layerzerolabs/implicit': '^3.0.0',
        };

        const allDeps: { [key: string]: Set<string> } = {};

        const log = await addMissingDependencies({
            packageJson: mockPackageJson,
            missingDeps: [],
            packageName: 'test-package',
            workspacePackages: new Set(),
            allDeps,
        });

        expect(log).toContain('Adding implicit dependency');
        expect(mockPackageJson.dependencies!['@layerzerolabs/implicit']).toBe('^3.0.0');
    });

    test('should prioritize catalog over workspace for @layerzerolabs packages', async () => {
        const allDeps: { [key: string]: Set<string> } = {};
        const missingDeps = ['@layerzerolabs/existing-package'];

        // Add to catalog (should be used first)
        mockCatalog['@layerzerolabs/existing-package'] = '^1.0.0';

        await addMissingDependencies({
            packageJson: mockPackageJson,
            missingDeps,
            workspacePackages: new Set(missingDeps),
            packageName: 'test-package',
            allDeps,
        });

        // Should use catalog version, not workspace
        expect(allDeps['@layerzerolabs/existing-package']).toEqual(new Set(['^1.0.0']));
        expect(mockPackageJson.dependencies!['@layerzerolabs/existing-package']).toBe('^1.0.0');
    });
});

describe('processDependencies - error handling', () => {
    const tmpDirs: string[] = [];

    afterEach(async () => {
        await Promise.all(tmpDirs.map((d) => fsPromises.rm(d, { recursive: true, force: true })));
        tmpDirs.length = 0;
    });

    async function createTempPackageJson(contents: object): Promise<string> {
        const dir = await fsPromises.mkdtemp(path.join(os.tmpdir(), 'depcheck-test-'));
        tmpDirs.push(dir);
        await fsPromises.writeFile(
            path.join(dir, 'package.json'),
            JSON.stringify(contents, null, 2),
        );
        return dir;
    }

    test('should throw error when package not found in pnpmLsObject', async () => {
        const mockPnpmLsObject: { [key: string]: PnpmPackageObject } = {};

        await expect(processDependencies(['missing-package'], mockPnpmLsObject)).rejects.toThrow(
            'Package missing-package not found in pnpmLsObject',
        );
    });

    test('should throw error when package.json file cannot be read', async () => {
        const dir = await createTempPackageJson({ name: 'test-package' });
        await fsPromises.unlink(path.join(dir, 'package.json')); // Delete the file

        const mockPnpmLsObject: { [key: string]: PnpmPackageObject } = {
            'test-package': {
                name: 'test-package',
                path: dir,
            },
        };

        await expect(processDependencies(['test-package'], mockPnpmLsObject)).rejects.toThrow(
            'Failed to read package.json',
        );
    });

    test('should throw error when package.json contains invalid JSON', async () => {
        const dir = await createTempPackageJson({ name: 'test-package' });
        await fsPromises.writeFile(path.join(dir, 'package.json'), 'invalid json {');

        const mockPnpmLsObject: { [key: string]: PnpmPackageObject } = {
            'test-package': {
                name: 'test-package',
                path: dir,
            },
        };

        await expect(processDependencies(['test-package'], mockPnpmLsObject)).rejects.toThrow(
            'Failed to read package.json',
        );
    });

    test('should successfully process valid package.json', async () => {
        const dir = await createTempPackageJson({
            name: 'test-package',
            dependencies: {
                lodash: '^4.17.21',
            },
        });

        const mockPnpmLsObject: { [key: string]: PnpmPackageObject } = {
            'test-package': {
                name: 'test-package',
                path: dir,
            },
        };

        const result = await processDependencies(['test-package'], mockPnpmLsObject);

        expect(result['lodash']).toBeDefined();
        expect(result['lodash'].has('^4.17.21')).toBe(true);
    });

    test('should skip missing dependency versions gracefully', async () => {
        const dir = await createTempPackageJson({
            name: 'test-package',
            dependencies: {
                'valid-dep': '^1.0.0',
                // missing-version-dep intentionally omitted
            },
        });

        const mockPnpmLsObject: { [key: string]: PnpmPackageObject } = {
            'test-package': {
                name: 'test-package',
                path: dir,
            },
        };

        const result = await processDependencies(['test-package'], mockPnpmLsObject);

        expect(result['valid-dep']).toBeDefined();
        expect(result['valid-dep'].has('^1.0.0')).toBe(true);
        expect(result['missing-version-dep']).toBeUndefined();
    });
});

describe('processPackageDependencies - error handling', () => {
    let mockPnpmLsObject: { [key: string]: PnpmPackageObject };
    let processPackageDependencies: typeof import('../src/deps').processPackageDependencies;

    beforeEach(async () => {
        vi.clearAllMocks();

        // Re-import to get fresh module
        const depsModule = await import('../src/deps');
        processPackageDependencies = depsModule.processPackageDependencies;

        mockPnpmLsObject = {
            'test-package': {
                name: 'test-package',
                path: '/path/to/test',
            },
        };
    });

    test('should throw error when package not found in pnpmLsObject', async () => {
        await expect(
            processPackageDependencies({
                packageName: 'missing-package',
                allDeps: {},
                packageInfo: undefined,
                workspacePackages: new Set(),
            }),
        ).rejects.toThrow('Package missing-package not found in pnpmLsObject');
    });

    test('should throw error when depcheck fails', async () => {
        const depcheck = (await import('depcheck')).default;
        vi.mocked(depcheck).mockRejectedValue(new Error('depcheck failed'));

        vi.spyOn(fsPromises, 'readFile').mockResolvedValue(JSON.stringify({ dependencies: {} }));

        await expect(
            processPackageDependencies({
                packageName: 'test-package',
                allDeps: {},
                packageInfo: mockPnpmLsObject['test-package'],
                workspacePackages: new Set(),
            }),
        ).rejects.toThrow('Failed to run depcheck');
    });

    test('should throw error when package.json cannot be read', async () => {
        const depcheck = (await import('depcheck')).default;
        vi.mocked(depcheck).mockResolvedValue({
            dependencies: [],
            devDependencies: [],
            missing: {},
        } as any);

        vi.spyOn(fsPromises, 'readFile').mockRejectedValue(new Error('ENOENT: no such file'));

        await expect(
            processPackageDependencies({
                packageName: 'test-package',
                allDeps: {},
                packageInfo: mockPnpmLsObject['test-package'],
                workspacePackages: new Set(),
            }),
        ).rejects.toThrow('Failed to read package.json');
    });
});
