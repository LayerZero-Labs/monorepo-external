import type { Image, Tool, VersionCombination, VolumeMapping } from '@layerzerolabs/vm-tooling';
import { DockerRegistryMirror } from '@layerzerolabs/vm-tooling';

import { parseAnchorTomlVersion } from './utility';

const defaultVolumes: readonly VolumeMapping[] = [
    {
        type: 'isolate',
        containerPath: '/usr/local/cargo',
        name: 'solana-cargo',
    },
    {
        type: 'isolate',
        containerPath: '/usr/local/rustup',
        name: 'solana-rustup',
    },
    // Mount host Docker socket instead of using DinD (Docker-in-Docker)
    // This removes ~50% overhead from verifiable builds
    {
        type: 'host',
        containerPath: '/var/run/docker.sock',
        hostPath: '/var/run/docker.sock',
    },
];

export const tools: readonly [Tool, ...Tool[]] = [
    {
        name: 'anchor',
        // Keep privileged mode for backward compatibility with older images that use DinD
        privileged: true,
        defaultVolumes: defaultVolumes,
        // HOST_CWD and HOST_WORKSPACE_ROOT are injected dynamically by tool-executor
        // when Docker socket is mounted (detected by /var/run/docker.sock volume)
        getSecondaryVersion: ({ cwd }) => parseAnchorTomlVersion(cwd, 'anchor'),
    },
    {
        name: 'solana',
        privileged: true,
        defaultVolumes: defaultVolumes,
        getSecondaryVersion: ({ cwd }) => parseAnchorTomlVersion(cwd, 'solana'),
    },
    {
        name: 'solana-verify',
        privileged: true,
        defaultVolumes: defaultVolumes,
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
                solana: 'solana:anchor-0.29.0-solana-1.17.31-patch-2',
                anchor: 'solana:anchor-0.29.0-solana-1.17.31-patch-2',
            },
            description: 'Stable and well-tested',
            stable: true,
        },
    ];
