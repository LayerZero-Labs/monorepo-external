import type {
    EnvironmentVariable,
    Image,
    Tool,
    VersionCombination,
    VolumeMapping,
} from '@layerzerolabs/vm-tooling';
import {
    CARGO_TARGET_CACHE_PATH,
    createExcludeWorkspaceDependencySourcesPruner,
    DockerRegistryMirror,
} from '@layerzerolabs/vm-tooling';

import { parseAnchorTomlVersion } from './utility';

/**
 * surfpool runtime version the Solana test harnesses run against (passed to
 * `lz-tool --surfpool-version`), and the surfpool image's `versions.surfpool` below. Single source
 * so a bump lands in one place. (The image-id key still embeds the version literally; keep it in
 * step on a bump.)
 */
export const SURFPOOL_VERSION = '1.3.1';

const defaultVolumes: readonly VolumeMapping[] = [
    {
        type: 'isolate',
        containerPath: '/usr/local/cargo',
        name: 'solana-cargo',
        locked: true,
        toolchainKeyed: true,
    },
    {
        type: 'isolate',
        containerPath: '/usr/local/rustup',
        name: 'solana-rustup',
        toolchainKeyed: true,
        // Locked like solana-target: each shared cache guards its own concurrency rather than
        // relying on solana-cargo's lock, which a user --volume override of /usr/local/cargo drops.
        locked: true,
    },
    // Compiled-artifact cache. lz-tool points CARGO_TARGET_DIR here for cache-safe cargo commands
    // (test/check/clippy) but not builds, so build .so still land in the host target/.
    {
        type: 'isolate',
        containerPath: CARGO_TARGET_CACHE_PATH,
        name: 'solana-target',
        toolchainKeyed: true,
        // Locked in its own right: same-toolchain runs already serialize on solana-cargo, but a
        // user `--volume` override of /usr/local/cargo could drop that lock, so don't make this
        // shared target's concurrency safety depend on another volume's lock surviving.
        locked: true,
    },
];

const verifyVolumes: readonly VolumeMapping[] = [
    // Mount host Docker socket instead of using DinD (Docker-in-Docker)
    // This removes ~50% overhead from verifiable builds
    {
        type: 'host',
        containerPath: '/var/run/docker.sock',
        hostPath: '/var/run/docker.sock',
    },
];

// cargo defaults `--jobs` to core count, but turbo already builds crates in
// parallel — uncapped rustc stacks up and OOMs into flaky `E0463: can't find
// crate`. Cap jobs to bound memory; see PRO-3664.
const defaultEnv: readonly EnvironmentVariable[] = [{ name: 'CARGO_BUILD_JOBS', value: '4' }];

// Solana contract builds copy workspace Rust dependencies into the current package's dependencies/
// directory before lz-tool runs. Surfpool only reads package-local artifacts such as
// target/base.json. The current package is bind-mounted for both cases, so no tool needs source
// copies from other workspace packages.
const scopedWorkspacePruner = createExcludeWorkspaceDependencySourcesPruner('solana');

export const tools: readonly [Tool, ...Tool[]] = [
    {
        name: 'anchor',
        dockerPlatform: 'linux/amd64',
        defaultVolumes: defaultVolumes,
        defaultEnv,
        scopedWorkspacePruner,
        getSecondaryVersion: ({ cwd }) => parseAnchorTomlVersion(cwd, 'anchor'),
    },
    {
        name: 'solana',
        // No platform pin: the Solana CLI does not produce build artifacts.
        defaultVolumes: defaultVolumes,
        defaultEnv,
        scopedWorkspacePruner,
        getSecondaryVersion: ({ cwd }) => parseAnchorTomlVersion(cwd, 'solana'),
    },
    {
        // solana-verify compiles in a nested `docker run`; the path-rewriting wrapper in
        // docker/solana/Dockerfile does not forward CARGO_BUILD_JOBS into it, so unlike anchor
        // and solana the cap cannot reach rustc here. See PRO-3664.
        name: 'solana-verify',
        // No platform pin: solana-verify delegates artifact builds to its own verifiable-build image.
        defaultVolumes: [...defaultVolumes, ...verifyVolumes],
        scopedWorkspacePruner,
    },
    {
        // surfpool runtime engine; builds nothing, so no privileged mode / socket / cache volumes.
        name: 'surfpool',
        scopedWorkspacePruner,
    },
];

export const images = {
    ['solana:anchor-0.29.0-solana-1.17.31-patch-2']: {
        name: 'solana',
        versions: {
            solana: '1.17.31',
            anchor: '0.29.0',
        },
        dependencies: {
            // Anchor 0.29.0 depends on `time` crate which fails to compile with Rust >= 1.80
            rust: '1.79.0',
            // cargo-expand 1.0.100 requires rustc 1.81+; pin to 1.0.95 (MSRV 1.70)
            'cargo-expand': '1.0.95',
            // Pre-populate platform-tools cache for arm64 (no prebuilt binaries for v1.37)
            'platform-tools': '1.37',
            // Rust version for building platform-tools from source (cargo fork has no lockfile,
            // transitive deps require modern Rust). Currently highest MSRV is 1.88 (home, time).
            'platform-tools-rust': '1.88.0',
        },
        patch: 2,
        mirrorRegistries: [DockerRegistryMirror.PUBLIC_GAR],
    },
    ['solana:anchor-0.31.1-solana-2.2.20']: {
        name: 'solana',
        versions: {
            solana: '2.2.20',
            anchor: '0.31.1',
        },
    },
    ['solana:anchor-0.31.1-solana-2.2.20-patch-1']: {
        name: 'solana',
        versions: {
            solana: '2.2.20',
            anchor: '0.31.1',
        },
        patch: 1,
    },
    ['solana:anchor-0.31.1-solana-2.2.20-solana-verify-0.4.11']: {
        name: 'solana',
        versions: {
            anchor: '0.31.1',
            solana: '2.2.20',
            'solana-verify': '0.4.11',
        },
    },
    ['solana:anchor-0.31.1-solana-2.2.20-solana-verify-0.4.11-patch-1']: {
        name: 'solana',
        versions: {
            anchor: '0.31.1',
            solana: '2.2.20',
            'solana-verify': '0.4.11',
        },
        dependencies: {
            rust: '1.84.1',
        },
        patch: 1,
    },
    ['solana:anchor-0.31.1-solana-2.2.20-solana-verify-0.4.11-patch-4']: {
        name: 'solana',
        versions: {
            anchor: '0.31.1',
            solana: '2.2.20',
            'solana-verify': '0.4.11',
        },
        patch: 4,
        mirrorRegistries: [DockerRegistryMirror.PUBLIC_GAR],
    },
    ['solana:anchor-0.32.1-solana-2.3.0']: {
        name: 'solana',
        versions: {
            anchor: '0.32.1',
            solana: '2.3.0',
        },
        dependencies: {
            rust: '1.92.0',
            'rust-nightly': 'nightly-2025-06-01',
        },
        mirrorRegistries: [DockerRegistryMirror.PUBLIC_GAR],
    },
    ['solana:anchor-1.0.2-solana-3.1.10']: {
        name: 'solana',
        versions: {
            anchor: '1.0.2',
            solana: '3.1.10',
        },
        dependencies: {
            rust: '1.89.0',
            'platform-tools': '1.52',
            'platform-tools-rust': '1.89.0',
            'rust-nightly': 'nightly-2025-06-01',
        },
        mirrorRegistries: [DockerRegistryMirror.PUBLIC_GAR],
    },
    // Standalone surfpool runtime image, built from `docker/surfpool/Dockerfile`.
    ['surfpool:surfpool-1.3.1']: {
        name: 'surfpool',
        versions: {
            // What `surfpool --version` reports (asserted by the Tool-versions test), not the rev.
            surfpool: SURFPOOL_VERSION,
        },
        dependencies: {
            // No surfpool release tag carries #686 (finalized-slot) + #687 (snapshot-program-CPI);
            // build from this commit.
            'surfpool-rev': 'c83f9b7104bb205ce0cb6ab1a1eed96183589433',
            // surfpool's rust-toolchain.toml pins 1.89.0.
            rust: '1.89.0',
        },
        mirrorRegistries: [DockerRegistryMirror.PUBLIC_GAR],
    },
} satisfies Record<string, Image>;

export type ImageId = keyof typeof images;

export const versionCombinations: [VersionCombination<ImageId>, ...VersionCombination<ImageId>[]] =
    [
        {
            images: {
                anchor: 'solana:anchor-0.31.1-solana-2.2.20-solana-verify-0.4.11-patch-4',
                solana: 'solana:anchor-0.31.1-solana-2.2.20-solana-verify-0.4.11-patch-4',
                'solana-verify': 'solana:anchor-0.31.1-solana-2.2.20-solana-verify-0.4.11-patch-4',
            },
            description: 'Latest stable release',
            stable: true,
        },
        {
            images: {
                anchor: 'solana:anchor-0.32.1-solana-2.3.0',
                solana: 'solana:anchor-0.32.1-solana-2.3.0',
            },
            description:
                'Console OFT + Token-2022 (Anchor 0.32.1 with pausable support, nightly-2025-06-01 rustfmt)',
            stable: true,
        },
        {
            images: {
                anchor: 'solana:anchor-1.0.2-solana-3.1.10',
                solana: 'solana:anchor-1.0.2-solana-3.1.10',
            },
            description: 'Anchor 1.0.2 on Solana 3.1.10 with Rust 1.89.0 and platform-tools 1.52',
        },
        {
            images: {
                solana: 'solana:anchor-0.29.0-solana-1.17.31-patch-2',
                anchor: 'solana:anchor-0.29.0-solana-1.17.31-patch-2',
            },
            description: 'Stable and well-tested',
            stable: true,
        },
        {
            // Not index 0 (the anchor/solana default); selected via `--surfpool-version`.
            images: {
                surfpool: 'surfpool:surfpool-1.3.1',
            },
            description: 'Surfpool runtime engine (solana-test-validator replacement)',
        },
    ];
