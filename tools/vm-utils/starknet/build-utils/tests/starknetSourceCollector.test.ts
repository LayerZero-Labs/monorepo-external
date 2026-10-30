import { rmSync } from 'node:fs';
import { mkdir, mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, afterEach, describe, expect, it } from 'vitest';

import { collectSourceSnapshot } from '../src/starknetSourceCollector';

const workspaceRoots: string[] = [];
const originalCwd = process.cwd();

afterEach(() => {
    process.chdir(originalCwd);
});

afterAll(() => {
    for (const root of workspaceRoots) {
        rmSync(root, { recursive: true, force: true });
    }
});

/**
 * A Scarb workspace shaped like the contracts package: a member with a path dependency on a sibling
 * lib, and a `tests` directory the snapshot must leave out.
 */
const createWorkspace = async (): Promise<string> => {
    const root = await mkdtemp(join(tmpdir(), 'source-snapshot-'));
    workspaceRoots.push(root);

    await writeFile(join(root, 'Scarb.toml'), '[workspace]\nmembers = ["layerzero", "libs/*"]\n');

    await mkdir(join(root, 'layerzero', 'src', 'tests'), { recursive: true });
    await writeFile(
        join(root, 'layerzero', 'Scarb.toml'),
        '[package]\nname = "layerzero"\n\n[dependencies]\nstarknet = "2.14.0"\nlz_utils = { path = "../libs/lz_utils" }\n',
    );
    await writeFile(join(root, 'layerzero', 'src', 'lib.cairo'), 'mod dvn;\n');
    await writeFile(join(root, 'layerzero', 'src', 'tests', 'helper.cairo'), 'fn helper() {}\n');

    await mkdir(join(root, 'libs', 'lz_utils', 'src'), { recursive: true });
    await writeFile(join(root, 'libs', 'lz_utils', 'Scarb.toml'), '[package]\nname = "lz_utils"\n');
    await writeFile(join(root, 'libs', 'lz_utils', 'src', 'lib.cairo'), 'fn util() {}\n');

    return root;
};

describe(collectSourceSnapshot, () => {
    it('collects a workspace member, its path dependency, and every manifest', async () => {
        const root = await createWorkspace();

        const snapshot = await collectSourceSnapshot({
            scarbPackage: 'layerzero',
            scarbWorkspaceRoot: root,
        });

        expect(Object.keys(snapshot.sources).sort()).toEqual([
            'Scarb.toml',
            'layerzero/Scarb.toml',
            'layerzero/src/lib.cairo',
            'libs/lz_utils/Scarb.toml',
            'libs/lz_utils/src/lib.cairo',
        ]);
        expect(snapshot).toMatchObject({
            compilerVersion: '2.14.0',
            packageName: 'layerzero',
            projectDirPath: '.',
            contractFilePath: 'layerzero/src/lib.cairo',
        });
    });

    it('reads the given workspace root rather than the current directory', async () => {
        const root = await createWorkspace();
        const unrelated = await mkdtemp(join(tmpdir(), 'source-snapshot-cwd-'));
        workspaceRoots.push(unrelated);
        process.chdir(unrelated);

        const snapshot = await collectSourceSnapshot({
            scarbPackage: 'layerzero',
            scarbWorkspaceRoot: root,
        });

        expect(snapshot.sources['layerzero/src/lib.cairo']).toBe('mod dvn;\n');
    });

    it('names the packages it did find when the requested one is absent', async () => {
        const root = await createWorkspace();

        await expect(
            collectSourceSnapshot({ scarbPackage: 'missing', scarbWorkspaceRoot: root }),
        ).rejects.toThrow(/Available: .*layerzero/);
    });

    it('names the manifest it cannot parse', async () => {
        const root = await createWorkspace();
        const malformedManifestPath = join(root, 'libs', 'lz_utils', 'Scarb.toml');
        await writeFile(malformedManifestPath, '[package\n');

        await expect(
            collectSourceSnapshot({ scarbPackage: 'layerzero', scarbWorkspaceRoot: root }),
        ).rejects.toThrow(`Cannot parse Scarb.toml at ${malformedManifestPath}`);
    });
});
