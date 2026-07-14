import { unzipSync } from 'fflate';
import { createHash } from 'node:crypto';
import { mkdir, mkdtemp, readFile, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

import { ZipEntryType } from '@layerzerolabs/deterministic-zip';

import { makeSourcePredicate, packageSource } from '../src/commands/package-source';

const ROOT = 'stellar';

// Helpers: evaluate the predicate on a file / directory relPath.
const file = (predicate: ReturnType<typeof makeSourcePredicate>, relPath: string) =>
    predicate({ relPath, type: ZipEntryType.File });
const dir = (predicate: ReturnType<typeof makeSourcePredicate>, relPath: string) =>
    predicate({ relPath, type: ZipEntryType.Directory });

describe('makeSourcePredicate — include-only defaults', () => {
    const predicate = makeSourcePredicate({ rootDirName: ROOT });

    it('keeps the crate root dir and descends ordinary source dirs', () => {
        expect(dir(predicate, ROOT)).toBe(true);
        expect(dir(predicate, `${ROOT}/src`)).toBe(true);
        expect(dir(predicate, `${ROOT}/dependencies`)).toBe(true);
    });

    it('prunes NON_SOURCE_DIRS under the crate root', () => {
        expect(dir(predicate, `${ROOT}/target`)).toBe(false);
        expect(dir(predicate, `${ROOT}/node_modules`)).toBe(false);
        expect(dir(predicate, `${ROOT}/.artifacts`)).toBe(false);
        expect(dir(predicate, `${ROOT}/.claude`)).toBe(false);
    });

    it('drops sibling paths outside the crate root', () => {
        expect(dir(predicate, 'other-crate')).toBe(false);
        expect(file(predicate, 'other-crate/Cargo.toml')).toBe(false);
        expect(file(predicate, 'README.md')).toBe(false);
    });

    it.each([
        `${ROOT}/src/lib.rs`,
        `${ROOT}/Cargo.toml`,
        `${ROOT}/Cargo.lock`,
        `${ROOT}/rust-toolchain.toml`,
        `${ROOT}/rustfmt.toml`,
        `${ROOT}/clippy.toml`,
        `${ROOT}/dependencies/dep-a/Cargo.toml`,
        `${ROOT}/dependencies/dep-a/src/lib.rs`,
    ])('includes source file %s', (relPath) => {
        expect(file(predicate, relPath)).toBe(true);
    });

    it.each([
        `${ROOT}/.env`,
        `${ROOT}/config/.env.local`,
        `${ROOT}/.env.example`,
        `${ROOT}/secrets/key.pem`,
        `${ROOT}/id_ed25519`,
        `${ROOT}/creds/service-account.json`,
        `${ROOT}/application_default_credentials.json`,
        `${ROOT}/README.md`,
        `${ROOT}/package.json`,
        `${ROOT}/turbo.json`,
        `${ROOT}/.npmrc`,
        `${ROOT}/.envrc`,
        `${ROOT}/.gitignore`,
        `${ROOT}/notes.txt`,
        `${ROOT}/ts-bindings-gen.toml`,
        `${ROOT}/secrets.toml`,
        `${ROOT}/dependencies/dep-a/rust-toolchain.toml`,
        `${ROOT}/dependencies/dep-a/rustfmt.toml`,
        `${ROOT}/dependencies/dep-a/clippy.toml`,
    ])('drops non-source file %s (not on the allow-list)', (relPath) => {
        expect(file(predicate, relPath)).toBe(false);
    });
});

describe('makeSourcePredicate — user --include', () => {
    it('matches bare patterns relative to the crate root', () => {
        const predicate = makeSourcePredicate({ rootDirName: ROOT, include: ['app.json'] });
        expect(file(predicate, `${ROOT}/app.json`)).toBe(true);
        expect(file(predicate, `${ROOT}/config/app.json`)).toBe(false);
    });

    it('supports native glob patterns', () => {
        const predicate = makeSourcePredicate({ rootDirName: ROOT, include: ['assets/**'] });
        expect(file(predicate, `${ROOT}/assets/logo.png`)).toBe(true);
        expect(file(predicate, `${ROOT}/a/assets/logo.png`)).toBe(false);
    });

    it('matches exact crate-relative paths', () => {
        const predicate = makeSourcePredicate({ rootDirName: ROOT, include: ['config/app.json'] });
        expect(file(predicate, `${ROOT}/config/app.json`)).toBe(true); // exact match
        expect(file(predicate, `${ROOT}/other/config/app.json`)).toBe(false); // not anchored at root
    });

    it('preserves native trailing-slash semantics', () => {
        const predicate = makeSourcePredicate({ rootDirName: ROOT, include: ['assets/data/'] });
        expect(file(predicate, `${ROOT}/assets/data/x.bin`)).toBe(false);
    });

    it('prefixes patterns with the crate root directory', () => {
        const predicate = makeSourcePredicate({ rootDirName: ROOT, include: ['config/**'] });
        expect(file(predicate, `${ROOT}/config/app.json`)).toBe(true);
        expect(file(predicate, `${ROOT}/nested/config/app.json`)).toBe(false);
    });

    it('does not disturb the default source allow-list', () => {
        const predicate = makeSourcePredicate({ rootDirName: ROOT, include: ['app.json'] });
        expect(file(predicate, `${ROOT}/src/lib.rs`)).toBe(true);
    });
});

describe('makeSourcePredicate — user --exclude', () => {
    it('drops allow-listed files matching a glob subtree', () => {
        const predicate = makeSourcePredicate({ rootDirName: ROOT, exclude: ['tests/**'] });
        // `tests/**` does not match the directory entry itself (Node glob semantics)
        expect(dir(predicate, `${ROOT}/tests`)).toBe(true);
        expect(file(predicate, `${ROOT}/tests/lib.rs`)).toBe(false);
        expect(file(predicate, `${ROOT}/tests/integration/a.rs`)).toBe(false);
        expect(file(predicate, `${ROOT}/src/lib.rs`)).toBe(true);
    });

    it('matches exact crate-relative paths like --include', () => {
        const predicate = makeSourcePredicate({
            rootDirName: ROOT,
            exclude: ['src/lib.rs'],
        });
        expect(file(predicate, `${ROOT}/src/lib.rs`)).toBe(false);
        expect(file(predicate, `${ROOT}/Cargo.toml`)).toBe(true);
    });

    it('always wins over --include', () => {
        const predicate = makeSourcePredicate({
            rootDirName: ROOT,
            include: ['tests/**', 'README.md'],
            exclude: ['tests/**'],
        });
        expect(file(predicate, `${ROOT}/tests/lib.rs`)).toBe(false);
        expect(file(predicate, `${ROOT}/README.md`)).toBe(true);
    });
});

describe('packageSource', () => {
    /**
     * Nest the crate under a controlled parent so DeterministicZip walks a small directory
     * (not the system tmpdir) and the archive top-level folder is a stable name (`stellar`).
     */
    const buildFixture = async (): Promise<string> => {
        const parent = await mkdtemp(path.join(tmpdir(), 'lz-pkgsrc-parent-'));
        const root = path.join(parent, ROOT);
        await mkdir(root, { recursive: true });
        // Sibling must not appear in the archive.
        await writeFile(path.join(parent, 'sibling-Cargo.toml'), '[package]\nname = "nope"\n');

        const write = async (rel: string, content = 'x') => {
            const abs = path.join(root, rel);
            await mkdir(path.dirname(abs), { recursive: true });
            await writeFile(abs, content);
        };
        // Buildable source — kept by the default allow-list.
        await write('Cargo.toml', '[package]\nname = "demo"\n');
        await write('Cargo.lock', '# lock');
        await write('rust-toolchain.toml', '[toolchain]\nchannel = "1.90.0"\n');
        await write('rustfmt.toml', 'max_width = 100');
        await write('clippy.toml', 'cognitive-complexity-threshold = 30');
        await write('src/lib.rs', 'pub fn f() {}');
        await write('dependencies/dep-a/Cargo.toml', '[package]\nname = "dep-a"\n');
        await write('dependencies/dep-a/src/lib.rs', 'pub fn g() {}');
        // non-source files — dropped by the include-only allow-list (unless --include'd)
        await write('README.md', '# demo');
        await write('package.json', '{}');
        await write('config/app.json', '{}');
        await write('config/secrets.toml', 'api_key = "secret"');
        await write('.env', 'API_KEY=secret');
        await write('secrets/key.pem', '-----BEGIN PRIVATE KEY-----');
        // non-source dirs — pruned by the predicate (incl. a generated .rs that must NOT leak)
        await write('target/debug/demo.o', 'binary');
        await write('target/debug/build/x/out/generated.rs', 'pub fn gen() {}');
        await write('node_modules/foo/index.js', 'module');
        await write('.claude/settings.local.json', '{}');
        return root;
    };

    const cleanupFixture = async (root: string) => {
        await rm(path.dirname(root), { recursive: true, force: true });
    };

    // The archive nests everything under a top-level `<basename>/` dir; strip it for content assertions.
    const ROOT_PREFIX = `${ROOT}/`;
    const unzipRawKeys = async (zipPath: string): Promise<string[]> => {
        const bytes = new Uint8Array(await readFile(zipPath));
        return Object.keys(unzipSync(bytes));
    };
    const unzipKeys = async (zipPath: string): Promise<string[]> =>
        (await unzipRawKeys(zipPath))
            .filter((k) => !k.endsWith('/'))
            .map((k) => (k.startsWith(ROOT_PREFIX) ? k.slice(ROOT_PREFIX.length) : k));

    it('packages only source files (allow-list) and keeps dependencies/', async () => {
        const root = await buildFixture();
        try {
            await packageSource({}, { cwd: root });
            const zipPath = path.join(root, '.artifacts', `${ROOT}-source.zip`);
            const keys = await unzipKeys(zipPath);

            expect(keys.sort()).toEqual(
                [
                    'Cargo.lock',
                    'Cargo.toml',
                    'clippy.toml',
                    'dependencies/dep-a/Cargo.toml',
                    'dependencies/dep-a/src/lib.rs',
                    'rust-toolchain.toml',
                    'rustfmt.toml',
                    'src/lib.rs',
                ].sort(),
            );
            // non-source files and dirs are all absent
            expect(keys).not.toContain('README.md');
            expect(keys).not.toContain('package.json');
            expect(keys).not.toContain('config/secrets.toml');
            expect(keys).not.toContain('.env');
            expect(keys).not.toContain('secrets/key.pem');
            expect(keys.some((k) => k.startsWith('node_modules/'))).toBe(false);
            expect(keys.some((k) => k.startsWith('target/'))).toBe(false);
            expect(keys.some((k) => k.startsWith('.claude/'))).toBe(false);
            // sibling outside the crate must not leak in
            expect(keys).not.toContain('sibling-Cargo.toml');
        } finally {
            await cleanupFixture(root);
        }
    });

    it('wraps every entry under a single top-level folder named after the crate basename', async () => {
        const root = await buildFixture();
        try {
            await packageSource({}, { cwd: root });
            const zipPath = path.join(root, '.artifacts', `${ROOT}-source.zip`);
            const raw = await unzipRawKeys(zipPath);

            expect(raw).toContain(`${ROOT}/`);
            expect(
                raw.filter((k) => k !== `${ROOT}/`).every((k) => k.startsWith(ROOT_PREFIX)),
            ).toBe(true);
        } finally {
            await cleanupFixture(root);
        }
    });

    it('is deterministic and idempotent across runs (identical sha256)', async () => {
        const root = await buildFixture();
        const zipPath = path.join(root, '.artifacts', `${ROOT}-source.zip`);
        const sha = async () =>
            createHash('sha256')
                .update(await readFile(zipPath))
                .digest('hex');
        try {
            await packageSource({}, { cwd: root });
            const first = await sha();
            await packageSource({}, { cwd: root });
            expect(await sha()).toBe(first);
        } finally {
            await cleanupFixture(root);
        }
    });

    it('--include opts in extra non-source files', async () => {
        const root = await buildFixture();
        try {
            await packageSource({ include: ['README.md', 'package.json'] }, { cwd: root });
            const zipPath = path.join(root, '.artifacts', `${ROOT}-source.zip`);
            const keys = await unzipKeys(zipPath);
            expect(keys).toContain('README.md');
            expect(keys).toContain('package.json');
            // not opted in → still dropped
            expect(keys).not.toContain('.env');
        } finally {
            await cleanupFixture(root);
        }
    });

    it('--include accepts a crate-relative path with slashes (through the basename wrapper)', async () => {
        const root = await buildFixture();
        try {
            await packageSource({ include: ['config/app.json'] }, { cwd: root });
            const zipPath = path.join(root, '.artifacts', `${ROOT}-source.zip`);
            const keys = await unzipKeys(zipPath);
            expect(keys).toContain('config/app.json');
            // a same-basename file at a different path is NOT re-admitted (pattern is anchored)
            expect(keys).not.toContain('package.json');
        } finally {
            await cleanupFixture(root);
        }
    });

    it('--exclude drops an allow-listed subtree (e.g. tests/) and wins over --include', async () => {
        const root = await buildFixture();
        try {
            await mkdir(path.join(root, 'tests'), { recursive: true });
            await writeFile(path.join(root, 'tests', 'integration.rs'), '#[test] fn t() {}');

            await packageSource(
                { include: ['tests/**'], exclude: ['tests/**'] },
                {
                    cwd: root,
                },
            );
            const zipPath = path.join(root, '.artifacts', `${ROOT}-source.zip`);
            const keys = await unzipKeys(zipPath);
            expect(keys.some((k) => k.startsWith('tests/'))).toBe(false);
            expect(keys).toContain('src/lib.rs');
            // Empty excluded dirs must not leave a directory entry that changes source_sha256.
            const raw = await unzipRawKeys(zipPath);
            expect(raw).not.toContain(`${ROOT}/tests/`);
        } finally {
            await cleanupFixture(root);
        }
    });

    it('omits empty non-source directories (e.g. docs/) from the archive', async () => {
        const root = await buildFixture();
        try {
            await mkdir(path.join(root, 'docs'), { recursive: true });
            await writeFile(path.join(root, 'docs', 'notes.txt'), 'docs only');

            await packageSource({}, { cwd: root });
            const zipPath = path.join(root, '.artifacts', `${ROOT}-source.zip`);
            const raw = await unzipRawKeys(zipPath);
            expect(raw).not.toContain(`${ROOT}/docs/`);
            expect(raw).not.toContain(`${ROOT}/docs/notes.txt`);
        } finally {
            await cleanupFixture(root);
        }
    });

    it('rejects a custom --output nested inside the source tree', async () => {
        const root = await buildFixture();
        try {
            await expect(packageSource({ output: 'out/pkg.zip' }, { cwd: root })).rejects.toThrow(
                /--output must be under \.artifacts\//,
            );
        } finally {
            await cleanupFixture(root);
        }
    });

    it('rejects a custom --output written directly into the source dir', async () => {
        const root = await buildFixture();
        try {
            await expect(packageSource({ output: 'pkg.zip' }, { cwd: root })).rejects.toThrow(
                /--output must be under \.artifacts\//,
            );
        } finally {
            await cleanupFixture(root);
        }
    });

    it('rejects --output .artifacts (would create a file, not a dir under .artifacts/)', async () => {
        const root = await buildFixture();
        try {
            await expect(packageSource({ output: '.artifacts' }, { cwd: root })).rejects.toThrow(
                /--output must be under \.artifacts\//,
            );
        } finally {
            await cleanupFixture(root);
        }
    });

    it('allows a custom --output under .artifacts/', async () => {
        const root = await buildFixture();
        const outPath = path.join(root, '.artifacts', 'custom.zip');
        try {
            await packageSource({ output: '.artifacts/custom.zip' }, { cwd: root });
            const keys = await unzipKeys(outPath);
            expect(keys).toContain('Cargo.toml');
        } finally {
            await cleanupFixture(root);
        }
    });

    it('allows a custom --output outside the source tree', async () => {
        const root = await buildFixture();
        const outDir = await mkdtemp(path.join(tmpdir(), 'lz-pkgsrc-out-'));
        const outPath = path.join(outDir, 'pkg.zip');
        try {
            await packageSource({ output: outPath }, { cwd: root });
            const keys = await unzipKeys(outPath);
            expect(keys).toContain('src/lib.rs');
        } finally {
            await cleanupFixture(root);
            await rm(outDir, { recursive: true, force: true });
        }
    });

    it('throws when Cargo.toml is missing', async () => {
        const parent = await mkdtemp(path.join(tmpdir(), 'lz-pkgsrc-no-toml-'));
        const root = path.join(parent, ROOT);
        await mkdir(path.join(root, 'src'), { recursive: true });
        await writeFile(path.join(root, 'Cargo.lock'), '# lock');
        await writeFile(path.join(root, 'src', 'lib.rs'), 'pub fn f() {}');
        try {
            await expect(packageSource({}, { cwd: root })).rejects.toThrow(
                /Cargo\.toml must exist/,
            );
        } finally {
            await rm(parent, { recursive: true, force: true });
        }
    });

    it('throws when Cargo.lock is missing', async () => {
        const parent = await mkdtemp(path.join(tmpdir(), 'lz-pkgsrc-no-lock-'));
        const root = path.join(parent, ROOT);
        await mkdir(path.join(root, 'src'), { recursive: true });
        await writeFile(path.join(root, 'Cargo.toml'), '[package]\nname = "demo"\n');
        await writeFile(path.join(root, 'src', 'lib.rs'), 'pub fn f() {}');
        try {
            await expect(packageSource({}, { cwd: root })).rejects.toThrow(
                /Cargo\.lock must exist/,
            );
        } finally {
            await rm(parent, { recursive: true, force: true });
        }
    });

    it('throws when no source files match', async () => {
        const parent = await mkdtemp(path.join(tmpdir(), 'lz-pkgsrc-empty-'));
        const root = path.join(parent, ROOT);
        await mkdir(path.join(root, 'docs'), { recursive: true });
        await writeFile(path.join(root, 'Cargo.toml'), '[package]\nname = "demo"\n');
        await writeFile(path.join(root, 'Cargo.lock'), '# lock');
        await writeFile(path.join(root, 'docs', 'notes.txt'), 'no source here');
        try {
            await expect(
                packageSource({ exclude: ['Cargo.toml', 'Cargo.lock'] }, { cwd: root }),
            ).rejects.toThrow('no source files matched');
        } finally {
            await rm(parent, { recursive: true, force: true });
        }
    });

    it('fails when a symlink exists outside NON_SOURCE_DIRS', async () => {
        const root = await buildFixture();
        try {
            await symlink('lib.rs', path.join(root, 'src', 'alias.rs'));
            await expect(packageSource({}, { cwd: root })).rejects.toThrow(
                /Failed to package source/,
            );
        } finally {
            await cleanupFixture(root);
        }
    });
});
