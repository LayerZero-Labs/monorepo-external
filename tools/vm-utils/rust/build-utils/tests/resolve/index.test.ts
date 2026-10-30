import {
    chmodSync,
    existsSync,
    lstatSync,
    mkdirSync,
    mkdtempSync,
    readFileSync,
    realpathSync,
    rmSync,
    statSync,
    symlinkSync,
    utimesSync,
    writeFileSync,
} from 'fs';
import os from 'os';
import { join } from 'path';
import { parse } from 'smol-toml';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { resolveDependencies } from '../../src/resolve';
import { fixture } from './fixtures';

// Unique per run so concurrent runs (other checkouts, worktrees) can't delete each other's fixtures.
// realpath'd because resolve/ looks paths up by their real path — macOS /var/folders is a symlink.
const TMP = realpathSync(mkdtempSync(join(os.tmpdir(), 'build-utils-resolve-')));

const createCrate = (path: string, cargoContent: string) => {
    mkdirSync(path, { recursive: true });
    writeFileSync(join(path, 'Cargo.toml'), cargoContent);
    mkdirSync(join(path, 'src'), { recursive: true });
    writeFileSync(join(path, 'src', 'lib.rs'), '// placeholder');
};

const readToml = (path: string) => readFileSync(path, 'utf-8');

beforeEach(() => mkdirSync(TMP, { recursive: true }));
afterEach(() => rmSync(TMP, { recursive: true, force: true }));

describe('resolveDependencies — single crate mode', () => {
    it('copies discovered packages into dependencies/ and rewrites transitive paths', async () => {
        const root = join(TMP, 'single-crate');

        createCrate(root, fixture('program-with-deps.toml'));

        const rbacSource = join(root, 'node_modules', '@layerzerolabs', 'rbac-solana-contracts');
        createCrate(rbacSource, fixture('minimal.toml'));
        writeFileSync(join(rbacSource, 'package.json'), '{}');

        await resolveDependencies({ cwd: root });

        expect(existsSync(join(root, 'dependencies', 'rbac-solana-contracts', 'Cargo.toml'))).toBe(
            true,
        );
        expect(
            existsSync(join(root, 'dependencies', 'rbac-solana-contracts', 'src', 'lib.rs')),
        ).toBe(true);
        // package.json should NOT be copied
        expect(
            existsSync(join(root, 'dependencies', 'rbac-solana-contracts', 'package.json')),
        ).toBe(false);
    });
});

describe('resolveDependencies — workspace mode ([workspace] members)', () => {
    it('places dependencies/ at workspace root when root Cargo.toml has [workspace]', async () => {
        const root = join(TMP, 'workspace');
        // Root is a real Cargo workspace listing its members (Solana `programs/*`).
        createCrate(root, '[workspace]\nresolver = "2"\nmembers = ["programs/*"]');

        const programDir = join(root, 'programs', 'my_program');
        createCrate(programDir, fixture('program-workspace-member.toml'));

        const rbacSource = join(root, 'node_modules', '@layerzerolabs', 'rbac-solana-contracts');
        createCrate(rbacSource, fixture('minimal.toml'));
        writeFileSync(join(rbacSource, 'package.json'), '{}');

        await resolveDependencies({ cwd: root });

        expect(existsSync(join(root, 'dependencies', 'rbac-solana-contracts', 'Cargo.toml'))).toBe(
            true,
        );
        expect(existsSync(join(programDir, 'dependencies'))).toBe(false);
    });
});

describe('resolveDependencies — transitive dep rewriting', () => {
    it('rewrites paths inside copied crates to point to flat siblings', async () => {
        const root = join(TMP, 'transitive');

        createCrate(root, fixture('program-with-deps.toml'));

        // oapp depends on rbac (stale dependencies/ path from previous build)
        const oappSource = join(root, 'node_modules', '@layerzerolabs', 'oapp-solana-contracts');
        createCrate(oappSource, fixture('oapp-with-stale-deps.toml'));
        writeFileSync(join(oappSource, 'package.json'), '{}');

        const rbacSource = join(
            oappSource,
            'node_modules',
            '@layerzerolabs',
            'rbac-solana-contracts',
        );
        createCrate(rbacSource, fixture('minimal.toml'));
        writeFileSync(join(rbacSource, 'package.json'), '{}');

        await resolveDependencies({ cwd: root });

        const copiedOappToml = readToml(
            join(root, 'dependencies', 'oapp-solana-contracts', 'Cargo.toml'),
        );
        expect(copiedOappToml).toContain('path = "../rbac-solana-contracts"');
    });

    it('strips root-only Cargo tables from copied dependency manifests', async () => {
        const root = join(TMP, 'root-only-sections');

        createCrate(root, fixture('program-with-deps.toml'));

        const oappSource = join(root, 'node_modules', '@layerzerolabs', 'oapp-solana-contracts');
        createCrate(oappSource, fixture('root-only-sections.toml'));
        writeFileSync(join(oappSource, 'package.json'), '{}');

        await resolveDependencies({ cwd: root });

        const copiedOapp = parse(
            readToml(join(root, 'dependencies', 'oapp-solana-contracts', 'Cargo.toml')),
        );
        expect(copiedOapp.package).toBeDefined();
        expect(copiedOapp.dependencies).toBeDefined();
        expect(copiedOapp.patch).toBeUndefined();
        expect(copiedOapp.profile).toBeUndefined();
    });
});

describe('resolveDependencies — Stellar workspace dependency vendoring', () => {
    // Build a consumer (single crate) that path-deps into sub-crates of a
    // protocol-stellar-v2 workspace dependency living in node_modules.
    const setupStellarConsumer = (root: string) => {
        createCrate(root, fixture('stellar-consumer.toml'));

        const protocol = join(root, 'node_modules', '@layerzerolabs', 'protocol-stellar-v2');
        createCrate(protocol, fixture('stellar-workspace-root.toml'));
        writeFileSync(join(protocol, 'package.json'), '{}');
        // members: endpoint-v2 + message-libs/* — incl. a deep inheriting member
        createCrate(join(protocol, 'endpoint-v2'), fixture('stellar-member-inheriting.toml'));
        createCrate(
            join(protocol, 'message-libs', 'message-lib-common'),
            fixture('stellar-member-inheriting.toml'),
        );
        createCrate(
            join(protocol, 'message-libs', 'simple-message-lib'),
            fixture('stellar-member-inheriting.toml'),
        );
        return protocol;
    };

    it('copies the whole workspace tree, including deeply nested members', async () => {
        const root = join(TMP, 'stellar-consumer');
        setupStellarConsumer(root);

        await resolveDependencies({ cwd: root });

        const vendored = join(root, 'dependencies', 'protocol-stellar-v2');
        expect(existsSync(join(vendored, 'Cargo.toml'))).toBe(true);
        expect(existsSync(join(vendored, 'endpoint-v2', 'Cargo.toml'))).toBe(true);
        // the deep member — the case the old one-level scan missed
        expect(existsSync(join(vendored, 'message-libs', 'simple-message-lib', 'Cargo.toml'))).toBe(
            true,
        );
    });

    it('preserves the [workspace] root manifest so member inheritance still resolves', async () => {
        const root = join(TMP, 'stellar-preserve-ws');
        setupStellarConsumer(root);

        await resolveDependencies({ cwd: root });

        const vendoredRoot = readToml(
            join(root, 'dependencies', 'protocol-stellar-v2', 'Cargo.toml'),
        );
        // The root-only-table strip MUST be skipped for a vendored workspace root.
        expect(vendoredRoot).toContain('[workspace]');
        expect(vendoredRoot).toContain('[workspace.package]');
        expect(vendoredRoot).toContain('[workspace.dependencies]');
    });

    it('leaves the consumer manifest untouched (it already points at dependencies/)', async () => {
        const root = join(TMP, 'stellar-consumer-manifest');
        setupStellarConsumer(root);
        const original = readToml(join(root, 'Cargo.toml'));

        await resolveDependencies({ cwd: root });

        // Like Solana, the resolver only fills dependencies/; the consumer's own
        // Cargo.toml (already pointing at dependencies/...) is the source of truth.
        expect(readToml(join(root, 'Cargo.toml'))).toBe(original);
    });

    it('vendors the deep member the consumer path-deps into', async () => {
        const root = join(TMP, 'stellar-deep-member');
        setupStellarConsumer(root);

        await resolveDependencies({ cwd: root });

        // The consumer's `path = "dependencies/protocol-stellar-v2/message-libs/simple-message-lib"`
        // resolves because that crate was vendored at exactly that location.
        expect(
            existsSync(
                join(
                    root,
                    'dependencies',
                    'protocol-stellar-v2',
                    'message-libs',
                    'simple-message-lib',
                    'Cargo.toml',
                ),
            ),
        ).toBe(true);
    });

    it('rewrites arbitrary-depth paths inside a vendored oft-core crate', async () => {
        const root = join(TMP, 'stellar-oft-core-deep-paths');
        createCrate(root, fixture('program-with-deps.toml'));

        const protocol = join(root, 'node_modules', '@layerzerolabs', 'protocol-stellar-v2');
        createCrate(protocol, fixture('stellar-workspace-root.toml'));
        writeFileSync(join(protocol, 'package.json'), '{}');
        createCrate(join(protocol, 'endpoint-v2'), fixture('minimal.toml'));
        createCrate(join(protocol, 'message-libs', 'simple-message-lib'), fixture('minimal.toml'));
        createCrate(join(protocol, 'message-libs', 'message-lib-common'), fixture('minimal.toml'));

        const oftCore = join(root, 'node_modules', '@layerzerolabs', 'oft-core-stellar-contracts');
        createCrate(oftCore, fixture('oft-core-with-stale-deep-deps.toml'));
        writeFileSync(join(oftCore, 'package.json'), '{}');

        await resolveDependencies({ cwd: root });

        const copiedOftCore = readToml(
            join(root, 'dependencies', 'oft-core-stellar-contracts', 'Cargo.toml'),
        );
        expect(copiedOftCore).toContain(
            'path = "../protocol-stellar-v2/message-libs/simple-message-lib"',
        );
        expect(copiedOftCore).toContain(
            'path = "../protocol-stellar-v2/message-libs/message-lib-common"',
        );
    });
});

describe('resolveDependencies — production npm dependency closure', () => {
    const writePkgJson = (dir: string, deps: Record<string, string>) => {
        writeFileSync(
            join(dir, 'package.json'),
            JSON.stringify({ name: 'fixture', version: '0.0.0', dependencies: deps }),
        );
    };

    const setupOappProductionLayout = (root: string) => {
        createCrate(root, fixture('stellar-consumer.toml'));
        writePkgJson(root, {
            '@layerzerolabs/protocol-stellar-v2': '*',
            '@layerzerolabs/common-utils-stellar-contracts': '*',
            '@layerzerolabs/common-utils-macros-stellar-contracts': '*',
        });

        const protocol = join(root, 'node_modules', '@layerzerolabs', 'protocol-stellar-v2');
        createCrate(protocol, fixture('stellar-workspace-root.toml'));
        writePkgJson(protocol, {
            '@layerzerolabs/common-utils-stellar-contracts': '*',
        });
        createCrate(join(protocol, 'endpoint-v2'), fixture('minimal.toml'));
        createCrate(join(protocol, 'message-libs', 'simple-message-lib'), fixture('minimal.toml'));

        const utils = join(
            root,
            'node_modules',
            '@layerzerolabs',
            'common-utils-stellar-contracts',
        );
        createCrate(utils, fixture('minimal.toml'));
        writePkgJson(utils, {
            '@layerzerolabs/common-utils-macros-stellar-contracts': '*',
        });

        // Sibling proc-macro package (published separately from common-utils).
        const macros = join(
            root,
            'node_modules',
            '@layerzerolabs',
            'common-utils-macros-stellar-contracts',
        );
        createCrate(macros, fixture('minimal.toml'));
        writePkgJson(macros, {});
    };

    it('vendors the full production closure reachable through npm dependencies only', async () => {
        const root = join(TMP, 'production-closure');
        setupOappProductionLayout(root);

        await resolveDependencies({ cwd: root });

        expect(existsSync(join(root, 'dependencies', 'protocol-stellar-v2', 'Cargo.toml'))).toBe(
            true,
        );
        expect(
            existsSync(join(root, 'dependencies', 'common-utils-stellar-contracts', 'Cargo.toml')),
        ).toBe(true);
        expect(
            existsSync(
                join(root, 'dependencies', 'common-utils-macros-stellar-contracts', 'Cargo.toml'),
            ),
        ).toBe(true);
    });

    it('does not vendor crates that exist only as npm devDependencies', async () => {
        const root = join(TMP, 'production-missing-devdep');
        createCrate(root, fixture('stellar-consumer.toml'));
        writeFileSync(
            join(root, 'package.json'),
            JSON.stringify({
                name: 'oapp-stellar-contracts',
                version: '0.0.0',
                dependencies: {
                    '@layerzerolabs/protocol-stellar-v2': '*',
                },
                devDependencies: {
                    '@layerzerolabs/common-utils-stellar-contracts': '*',
                },
            }),
        );

        const protocol = join(root, 'node_modules', '@layerzerolabs', 'protocol-stellar-v2');
        createCrate(protocol, fixture('stellar-workspace-root.toml'));
        writePkgJson(protocol, {});
        createCrate(join(protocol, 'endpoint-v2'), fixture('minimal.toml'));
        createCrate(join(protocol, 'message-libs', 'simple-message-lib'), fixture('minimal.toml'));

        await resolveDependencies({ cwd: root });

        expect(existsSync(join(root, 'dependencies', 'protocol-stellar-v2', 'Cargo.toml'))).toBe(
            true,
        );
        expect(
            existsSync(join(root, 'dependencies', 'common-utils-stellar-contracts', 'Cargo.toml')),
        ).toBe(false);
    });
});

describe('resolveDependencies — prune excluded workspace members', () => {
    // A vendored workspace whose root manifest lists a literal member under an
    // excluded dir (tests/mock_vault). The tests/ subtree is never copied, so the
    // dangling member must be pruned from the preserved manifest — else cargo fails
    // loading a missing workspace member.
    const setupConsumerWithTestMember = (root: string) => {
        createCrate(root, fixture('stellar-consumer.toml'));

        const protocol = join(root, 'node_modules', '@layerzerolabs', 'protocol-stellar-v2');
        createCrate(protocol, fixture('stellar-workspace-with-tests.toml'));
        writeFileSync(join(protocol, 'package.json'), '{}');
        createCrate(join(protocol, 'endpoint-v2'), fixture('stellar-member-inheriting.toml'));
        // Consumer also path-deps into message-libs; create a stub so the layout is complete.
        createCrate(join(protocol, 'message-libs', 'simple-message-lib'), fixture('minimal.toml'));

        // The excluded test member + extra files — none of this should be vendored.
        const mock = join(protocol, 'tests', 'mock_vault');
        createCrate(mock, '[package]\nname = "mock_vault"\nversion = "0.0.0"\nedition = "2021"');
        writeFileSync(join(protocol, 'tests', 'integration.rs'), '// must NOT be vendored');
        return protocol;
    };

    it('drops the excluded member from the preserved root manifest, keeps real members', async () => {
        const root = join(TMP, 'prune-member');
        setupConsumerWithTestMember(root);

        await resolveDependencies({ cwd: root });

        const vendoredRoot = readToml(
            join(root, 'dependencies', 'protocol-stellar-v2', 'Cargo.toml'),
        );
        // The dangling test member is gone...
        expect(vendoredRoot).not.toContain('tests/mock_vault');
        // ...but the workspace table and real members/globs remain intact.
        expect(vendoredRoot).toContain('[workspace]');
        expect(vendoredRoot).toContain('endpoint-v2');
    });

    it('does not vendor the excluded subtree at all', async () => {
        const root = join(TMP, 'prune-no-tests');
        setupConsumerWithTestMember(root);

        await resolveDependencies({ cwd: root });

        const vendored = join(root, 'dependencies', 'protocol-stellar-v2');
        expect(existsSync(join(vendored, 'tests'))).toBe(false);
        // real members are still vendored
        expect(existsSync(join(vendored, 'endpoint-v2', 'Cargo.toml'))).toBe(true);
    });
});

describe('resolveDependencies — excludes integration test dirs from vendored crates', () => {
    // Mirrors the real oft-core → oft leak: a vendored dependency carries
    // integration-tests/ source that is compiled only under #[cfg(test)] (via a
    // #[path] mod). Left in dependencies/ it would never build but would enter the
    // consumer's snapshot + verifiable source zip, coupling test churn to a deployed
    // contract's source_sha256. It must be pruned like the existing tests/ exclusion.
    it('does not vendor integration-tests/ or integration_tests/ subtrees', async () => {
        const root = join(TMP, 'exclude-integration-tests');
        createCrate(root, fixture('program-with-deps.toml'));

        const dep = join(root, 'node_modules', '@layerzerolabs', 'rbac-solana-contracts');
        createCrate(dep, fixture('minimal.toml'));
        writeFileSync(join(dep, 'package.json'), '{}');
        // Both spellings are used across the stellar contracts (hyphen: oft/oft-core;
        // underscore: omni-counter).
        for (const dir of ['integration-tests', 'integration_tests']) {
            mkdirSync(join(dep, dir), { recursive: true });
            writeFileSync(join(dep, dir, 'mod.rs'), '// must NOT be vendored');
        }

        await resolveDependencies({ cwd: root });

        const vendored = join(root, 'dependencies', 'rbac-solana-contracts');
        expect(existsSync(join(vendored, 'src', 'lib.rs'))).toBe(true);
        expect(existsSync(join(vendored, 'integration-tests'))).toBe(false);
        expect(existsSync(join(vendored, 'integration_tests'))).toBe(false);
    });
});

describe('resolveDependencies — excludes build output dirs from vendored crates', () => {
    it('does not vendor build/ or artifacts/ subtrees', async () => {
        const root = join(TMP, 'exclude-build-output');
        createCrate(root, fixture('program-with-deps.toml'));

        const dep = join(root, 'node_modules', '@layerzerolabs', 'rbac-solana-contracts');
        createCrate(dep, fixture('minimal.toml'));
        writeFileSync(join(dep, 'package.json'), '{}');
        for (const dir of ['build', 'artifacts']) {
            mkdirSync(join(dep, dir), { recursive: true });
            writeFileSync(join(dep, dir, 'y.json'), '{}');
        }

        await resolveDependencies({ cwd: root });

        const vendored = join(root, 'dependencies', 'rbac-solana-contracts');
        expect(existsSync(join(vendored, 'src', 'lib.rs'))).toBe(true);
        expect(existsSync(join(vendored, 'build'))).toBe(false);
        expect(existsSync(join(vendored, 'artifacts'))).toBe(false);
    });
});

describe('resolveDependencies — single-crate consumer (no [workspace])', () => {
    it('places dependencies/ next to the crate Cargo.toml', async () => {
        const root = join(TMP, 'leaf-consumer');
        createCrate(root, fixture('program-with-deps.toml')); // bare [package], no [workspace]

        const rbacSource = join(root, 'node_modules', '@layerzerolabs', 'rbac-solana-contracts');
        createCrate(rbacSource, fixture('minimal.toml'));
        writeFileSync(join(rbacSource, 'package.json'), '{}');

        await resolveDependencies({ cwd: root });

        expect(existsSync(join(root, 'dependencies', 'rbac-solana-contracts', 'Cargo.toml'))).toBe(
            true,
        );
    });
});

describe('resolveDependencies — re-resolving an existing dependencies/', () => {
    // Cargo rebuilds a path crate when a source file's mtime is newer than its last build, so
    // re-resolving must leave unchanged files untouched.
    const OLD = new Date('2000-01-01T00:00:00Z');

    const setup = (name: string) => {
        const root = join(TMP, name);
        createCrate(root, fixture('program-with-deps.toml'));

        const oappSource = join(root, 'node_modules', '@layerzerolabs', 'oapp-solana-contracts');
        createCrate(oappSource, fixture('oapp-with-stale-deps.toml'));
        writeFileSync(join(oappSource, 'package.json'), '{}');

        const rbacSource = join(
            oappSource,
            'node_modules',
            '@layerzerolabs',
            'rbac-solana-contracts',
        );
        createCrate(rbacSource, fixture('minimal.toml'));
        writeFileSync(join(rbacSource, 'package.json'), '{}');

        const deps = join(root, 'dependencies');
        const rbacSrc = join(rbacSource, 'src');
        return { root, deps, rbacSrc, lib: join(deps, 'rbac-solana-contracts', 'src', 'lib.rs') };
    };

    const age = (path: string) => utimesSync(path, OLD, OLD);
    const isOld = (path: string) => statSync(path).mtimeMs === OLD.getTime();

    it('keeps the mtime of unchanged copied and rewritten files', async () => {
        const { root, deps, lib } = setup('reresolve-unchanged');
        await resolveDependencies({ cwd: root });

        const rewritten = join(deps, 'oapp-solana-contracts', 'Cargo.toml');
        age(lib);
        age(rewritten);

        await resolveDependencies({ cwd: root });

        expect(isOld(lib)).toBe(true);
        expect(isOld(rewritten)).toBe(true);
        expect(readToml(rewritten)).toContain('path = "../rbac-solana-contracts"');
    });

    it('replaces a (read-only) copy whose source changed', async () => {
        const { root, rbacSrc, lib } = setup('reresolve-changed');
        await resolveDependencies({ cwd: root });

        age(lib);
        chmodSync(lib, 0o444);
        writeFileSync(join(rbacSrc, 'lib.rs'), '// changed');

        await resolveDependencies({ cwd: root });

        expect(readFileSync(lib, 'utf-8')).toBe('// changed');
        expect(isOld(lib)).toBe(false);
    });

    it('removes files and packages that are no longer vendored', async () => {
        const { root, deps, rbacSrc, lib } = setup('reresolve-stale');
        writeFileSync(join(rbacSrc, 'extra.rs'), '// extra');
        await resolveDependencies({ cwd: root });
        expect(existsSync(join(deps, 'rbac-solana-contracts', 'src', 'extra.rs'))).toBe(true);

        rmSync(join(rbacSrc, 'extra.rs'));
        mkdirSync(join(deps, 'removed-package', 'src'), { recursive: true });
        writeFileSync(join(deps, 'removed-package', 'Cargo.toml'), '[package]\nname = "gone"');
        writeFileSync(join(deps, 'oapp-solana-contracts', 'notes.txt'), 'not vendored');

        await resolveDependencies({ cwd: root });

        expect(existsSync(join(deps, 'rbac-solana-contracts', 'src', 'extra.rs'))).toBe(false);
        expect(existsSync(join(deps, 'removed-package'))).toBe(false);
        expect(existsSync(join(deps, 'oapp-solana-contracts', 'notes.txt'))).toBe(false);
        expect(existsSync(lib)).toBe(true);
    });

    it('replaces a symlink or a type change instead of writing through it', async () => {
        const { root, deps, lib } = setup('reresolve-types');
        await resolveDependencies({ cwd: root });

        const outside = join(TMP, 'reresolve-types-outside.rs');
        writeFileSync(outside, '// outside');
        rmSync(lib);
        symlinkSync(outside, lib);
        const src = join(deps, 'oapp-solana-contracts', 'src');
        rmSync(src, { recursive: true });
        writeFileSync(src, 'a file where a directory belongs');

        await resolveDependencies({ cwd: root });

        expect(lstatSync(lib).isSymbolicLink()).toBe(false);
        expect(readFileSync(lib, 'utf-8')).toBe('// placeholder');
        expect(readFileSync(outside, 'utf-8')).toBe('// outside');
        expect(statSync(src).isDirectory()).toBe(true);
    });

    it('replaces a symlinked dependencies/ without touching the link target', async () => {
        const { root, deps, lib } = setup('reresolve-symlinked-root');
        const outside = join(TMP, 'reresolve-symlinked-root-outside');
        mkdirSync(outside, { recursive: true });
        writeFileSync(join(outside, 'precious.txt'), 'keep me');
        symlinkSync(outside, deps);

        await resolveDependencies({ cwd: root });

        expect(lstatSync(deps).isSymbolicLink()).toBe(false);
        expect(existsSync(lib)).toBe(true);
        expect(readFileSync(join(outside, 'precious.txt'), 'utf-8')).toBe('keep me');
    });
});

describe('resolveDependencies — error handling', () => {
    it('throws when --cargo-dir does not contain Cargo.toml', async () => {
        const root = join(TMP, 'bad-cargo-dir');
        mkdirSync(join(root, 'programs', 'nope'), { recursive: true });

        await expect(resolveDependencies({ cwd: root, cargoDir: 'programs/nope' })).rejects.toThrow(
            'does not contain a Cargo.toml',
        );
    });

    describe('empty node_modules does not change dependencies state', () => {
        const root = join(TMP, 'empty');
        beforeEach(() => {
            createCrate(root, fixture('minimal.toml'));
        });

        it('dependencies does not exist', async () => {
            await resolveDependencies({ cwd: root });
            expect(existsSync(join(root, 'dependencies'))).toBe(false);
        });

        it('dependencies already exists', async () => {
            mkdirSync(join(root, 'dependencies'), { recursive: true });
            await resolveDependencies({ cwd: root });
            expect(existsSync(join(root, 'dependencies'))).toBe(true);
        });
    });
});
