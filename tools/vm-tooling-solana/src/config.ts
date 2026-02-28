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
    ['solana:anchor-0.29.0-solana-1.17.31']: {
        // Built in the old `monorepo` repository.
        name: 'solana',
        versions: {
            solana: '1.17.31',
            anchor: '0.29.0',
        },
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
            // Built in the old `monorepo` repository.
            images: {
                solana: 'solana:anchor-0.29.0-solana-1.17.31',
                anchor: 'solana:anchor-0.29.0-solana-1.17.31',
            },
            description: 'Stable and well-tested',
            stable: true,
        },
    ];
