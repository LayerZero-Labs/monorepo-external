import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'fs';
import { join } from 'path';
import { parse } from 'smol-toml';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { resolveDependencies } from '../../src/resolve';
import { fixture } from './fixtures';

const TMP = join(__dirname, '__tmp_resolve__');

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

        const rbacSource = join(root, 'node_modules', '@layerzerolabs', 'utils-solana-rbac');
        createCrate(rbacSource, fixture('minimal.toml'));
        writeFileSync(join(rbacSource, 'package.json'), '{}');

        await resolveDependencies({ cwd: root });

        expect(existsSync(join(root, 'dependencies', 'utils-solana-rbac', 'Cargo.toml'))).toBe(
            true,
        );
        expect(existsSync(join(root, 'dependencies', 'utils-solana-rbac', 'src', 'lib.rs'))).toBe(
            true,
        );
        // package.json should NOT be copied
        expect(existsSync(join(root, 'dependencies', 'utils-solana-rbac', 'package.json'))).toBe(
            false,
        );
    });
});

describe('resolveDependencies — workspace mode ([workspace] members)', () => {
    it('places dependencies/ at workspace root when root Cargo.toml has [workspace]', async () => {
        const root = join(TMP, 'workspace');
        // Root is a real Cargo workspace listing its members (Solana `programs/*`).
        createCrate(root, '[workspace]\nresolver = "2"\nmembers = ["programs/*"]');

        const programDir = join(root, 'programs', 'my_program');
        createCrate(programDir, fixture('program-workspace-member.toml'));

        const rbacSource = join(root, 'node_modules', '@layerzerolabs', 'utils-solana-rbac');
        createCrate(rbacSource, fixture('minimal.toml'));
        writeFileSync(join(rbacSource, 'package.json'), '{}');

        await resolveDependencies({ cwd: root });

        expect(existsSync(join(root, 'dependencies', 'utils-solana-rbac', 'Cargo.toml'))).toBe(
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
        const oappSource = join(root, 'node_modules', '@layerzerolabs', 'oapp-solana-impl');
        createCrate(oappSource, fixture('oapp-with-stale-deps.toml'));
        writeFileSync(join(oappSource, 'package.json'), '{}');

        const rbacSource = join(oappSource, 'node_modules', '@layerzerolabs', 'utils-solana-rbac');
        createCrate(rbacSource, fixture('minimal.toml'));
        writeFileSync(join(rbacSource, 'package.json'), '{}');

        await resolveDependencies({ cwd: root });

        const copiedOappToml = readToml(
            join(root, 'dependencies', 'oapp-solana-impl', 'Cargo.toml'),
        );
        expect(copiedOappToml).toContain('path = "../utils-solana-rbac"');
    });

    it('strips root-only Cargo tables from copied dependency manifests', async () => {
        const root = join(TMP, 'root-only-sections');

        createCrate(root, fixture('program-with-deps.toml'));

        const oappSource = join(root, 'node_modules', '@layerzerolabs', 'oapp-solana-impl');
        createCrate(oappSource, fixture('root-only-sections.toml'));
        writeFileSync(join(oappSource, 'package.json'), '{}');

        await resolveDependencies({ cwd: root });

        const copiedOapp = parse(
            readToml(join(root, 'dependencies', 'oapp-solana-impl', 'Cargo.toml')),
        );
        expect(copiedOapp.package).toBeDefined();
        expect(copiedOapp.dependencies).toBeDefined();
        expect(copiedOapp.patch).toBeUndefined();
        expect(copiedOapp.profile).toBeUndefined();
    });
});

describe('resolveDependencies — Stellar workspace dependency vendoring', () => {
    // Build a consumer (single crate) that path-deps into sub-crates of a
    // protocol-stellar workspace dependency living in node_modules.
    const setupStellarConsumer = (root: string) => {
        createCrate(root, fixture('stellar-consumer.toml'));

        const protocol = join(root, 'node_modules', '@layerzerolabs', 'protocol-stellar');
        createCrate(protocol, fixture('stellar-workspace-root.toml'));
        writeFileSync(join(protocol, 'package.json'), '{}');
        // members: contracts/* and contracts/oapps/* — incl. a deep inheriting member
        createCrate(
            join(protocol, 'contracts', 'utils'),
            fixture('stellar-member-inheriting.toml'),
        );
        createCrate(
            join(protocol, 'contracts', 'common-macros'),
            fixture('stellar-member-inheriting.toml'),
        );
        createCrate(join(protocol, 'contracts', 'oapps'), fixture('minimal.toml')); // grouping crate
        createCrate(
            join(protocol, 'contracts', 'oapps', 'oft-core'),
            fixture('stellar-member-inheriting.toml'),
        );
        return protocol;
    };

    it('copies the whole workspace tree, including deeply nested members', async () => {
        const root = join(TMP, 'stellar-consumer');
        setupStellarConsumer(root);

        await resolveDependencies({ cwd: root });

        const vendored = join(root, 'dependencies', 'protocol-stellar');
        expect(existsSync(join(vendored, 'Cargo.toml'))).toBe(true);
        expect(existsSync(join(vendored, 'contracts', 'utils', 'Cargo.toml'))).toBe(true);
        // the deep member — the case the old one-level scan missed
        expect(existsSync(join(vendored, 'contracts', 'oapps', 'oft-core', 'Cargo.toml'))).toBe(
            true,
        );
    });

    it('preserves the [workspace] root manifest so member inheritance still resolves', async () => {
        const root = join(TMP, 'stellar-preserve-ws');
        setupStellarConsumer(root);

        await resolveDependencies({ cwd: root });

        const vendoredRoot = readToml(join(root, 'dependencies', 'protocol-stellar', 'Cargo.toml'));
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

        // The consumer's `path = "dependencies/protocol-stellar/contracts/oapps/oft-core"`
        // resolves because that crate was vendored at exactly that location.
        expect(
            existsSync(
                join(
                    root,
                    'dependencies',
                    'protocol-stellar',
                    'contracts',
                    'oapps',
                    'oft-core',
                    'Cargo.toml',
                ),
            ),
        ).toBe(true);
    });
});

describe('resolveDependencies — prune excluded workspace members', () => {
    // A vendored workspace whose root manifest lists a literal member under an
    // excluded dir (tests/mock_vault). The tests/ subtree is never copied, so the
    // dangling member must be pruned from the preserved manifest — else cargo fails
    // loading a missing workspace member.
    const setupConsumerWithTestMember = (root: string) => {
        createCrate(root, fixture('stellar-consumer.toml'));

        const protocol = join(root, 'node_modules', '@layerzerolabs', 'protocol-stellar');
        createCrate(protocol, fixture('stellar-workspace-with-tests.toml'));
        writeFileSync(join(protocol, 'package.json'), '{}');
        createCrate(
            join(protocol, 'contracts', 'utils'),
            fixture('stellar-member-inheriting.toml'),
        );

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

        const vendoredRoot = readToml(join(root, 'dependencies', 'protocol-stellar', 'Cargo.toml'));
        // The dangling test member is gone...
        expect(vendoredRoot).not.toContain('tests/mock_vault');
        // ...but the workspace table and real members/globs remain intact.
        expect(vendoredRoot).toContain('[workspace]');
        expect(vendoredRoot).toContain('contracts/*');
    });

    it('does not vendor the excluded subtree at all', async () => {
        const root = join(TMP, 'prune-no-tests');
        setupConsumerWithTestMember(root);

        await resolveDependencies({ cwd: root });

        const vendored = join(root, 'dependencies', 'protocol-stellar');
        expect(existsSync(join(vendored, 'tests'))).toBe(false);
        // real members are still vendored
        expect(existsSync(join(vendored, 'contracts', 'utils', 'Cargo.toml'))).toBe(true);
    });
});

describe('resolveDependencies — single-crate consumer (no [workspace])', () => {
    it('places dependencies/ next to the crate Cargo.toml', async () => {
        const root = join(TMP, 'leaf-consumer');
        createCrate(root, fixture('program-with-deps.toml')); // bare [package], no [workspace]

        const rbacSource = join(root, 'node_modules', '@layerzerolabs', 'utils-solana-rbac');
        createCrate(rbacSource, fixture('minimal.toml'));
        writeFileSync(join(rbacSource, 'package.json'), '{}');

        await resolveDependencies({ cwd: root });

        expect(existsSync(join(root, 'dependencies', 'utils-solana-rbac', 'Cargo.toml'))).toBe(
            true,
        );
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
