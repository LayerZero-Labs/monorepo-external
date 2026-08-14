import { promises as fs } from 'fs';
import os from 'os';
import path from 'path';
import { afterEach, describe, expect, test, vi } from 'vitest';

import { catalogize, runCatalogizeAll } from '../src/catalog';
import type { DepcheckConfig, PackageJson, PnpmPackageObject } from '../src/types';

// The catalog write-back targets the real pnpm-workspace.yaml of the repository.
vi.mock('../src/utils', async (importOriginal) => ({
    ...(await importOriginal<typeof import('../src/utils')>()),
    writeCatalog: vi.fn(),
}));

const temporaryDirectories: string[] = [];

afterEach(async () => {
    await Promise.all(
        temporaryDirectories.map((dir) => fs.rm(dir, { recursive: true, force: true })),
    );
    temporaryDirectories.length = 0;
    vi.clearAllMocks();
});

const createPackage = async (
    packageJson: PackageJson,
    depcheckConfig?: DepcheckConfig,
): Promise<PnpmPackageObject> => {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'depcheck-catalogize-'));
    temporaryDirectories.push(dir);
    await fs.writeFile(path.join(dir, 'package.json'), JSON.stringify(packageJson, null, 4) + '\n');
    if (depcheckConfig) {
        await fs.writeFile(
            path.join(dir, '.depcheckrc'),
            JSON.stringify(depcheckConfig, null, 4) + '\n',
        );
    }

    return { name: packageJson.name, path: dir };
};

const readPackageJson = async (packageObject: PnpmPackageObject): Promise<PackageJson> =>
    JSON.parse(
        await fs.readFile(path.join(packageObject.path, 'package.json'), 'utf-8'),
    ) as PackageJson;

describe('catalogize', () => {
    test('should move an exact version into the catalog', async () => {
        const catalog = {};

        const { throwError, changed, resultPackageJson } = await catalogize(
            await createPackage({
                name: '@layerzerolabs/test-package',
                dependencies: { turbo: '2.6.1' },
            }),
            catalog,
            [],
        );

        expect(throwError).toBe(false);
        expect(changed).toBe(true);
        expect(catalog).toEqual({ turbo: '2.6.1' });
        expect(resultPackageJson.dependencies).toEqual({ turbo: 'catalog:' });
    });

    test('should report an error when the catalog holds another version', async () => {
        const { throwError } = await catalogize(
            await createPackage({
                name: '@layerzerolabs/test-package',
                dependencies: { turbo: '2.6.1' },
            }),
            { turbo: '2.7.0' },
            [],
        );

        expect(throwError).toBe(true);
    });

    test('should catalogize a package that opts in explicitly', async () => {
        const { changed, resultPackageJson } = await catalogize(
            await createPackage(
                {
                    name: '@layerzerolabs/test-package',
                    dependencies: { turbo: '2.6.1' },
                },
                { catalogize: true },
            ),
            {},
            [],
        );

        expect(changed).toBe(true);
        expect(resultPackageJson.dependencies).toEqual({ turbo: 'catalog:' });
    });

    test('should catalogize a package whose configuration covers other settings only', async () => {
        const { changed, resultPackageJson } = await catalogize(
            await createPackage(
                {
                    name: '@layerzerolabs/test-package',
                    dependencies: { turbo: '2.6.1' },
                },
                { ignores: ['@ui-internal/*'] },
            ),
            {},
            [],
        );

        expect(changed).toBe(true);
        expect(resultPackageJson.dependencies).toEqual({ turbo: 'catalog:' });
    });

    test('should leave every dependency section of a package that opts out', async () => {
        const catalog = {};

        const { throwError, changed, resultPackageJson } = await catalogize(
            await createPackage(
                {
                    name: '@layerzerolabs/test-package',
                    dependencies: { pnpm: '11.17.0' },
                    devDependencies: { turbo: '2.6.1' },
                    implicitDependencies: { pnpm: '11.17.0' },
                },
                { catalogize: false },
            ),
            catalog,
            [],
        );

        expect(throwError).toBe(false);
        expect(changed).toBe(false);
        expect(catalog).toEqual({});
        expect(resultPackageJson.dependencies).toEqual({ pnpm: '11.17.0' });
        expect(resultPackageJson.devDependencies).toEqual({ turbo: '2.6.1' });
        expect(resultPackageJson.implicitDependencies).toEqual({ pnpm: '11.17.0' });
    });
});

describe('runCatalogizeAll', () => {
    test('should write only the packages that do not opt out', async () => {
        const catalogized = await createPackage({
            name: '@layerzerolabs/catalogized-package',
            dependencies: { turbo: '2.6.1' },
        });
        const pinned = await createPackage(
            {
                name: '@layerzerolabs/pinned-package',
                dependencies: { turbo: '2.6.1' },
            },
            { catalogize: false },
        );

        await runCatalogizeAll({
            packages: [catalogized.name, pinned.name],
            pnpmLsObject: { [catalogized.name]: catalogized, [pinned.name]: pinned },
            dependenciesFilter: [],
            customCatalog: {},
        });

        expect((await readPackageJson(catalogized)).dependencies).toEqual({ turbo: 'catalog:' });
        expect((await readPackageJson(pinned)).dependencies).toEqual({ turbo: '2.6.1' });
    });
});
