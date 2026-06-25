import {
    DockerRegistryMirror,
    type Image,
    type Tool,
    type VersionCombination,
} from '@layerzerolabs/vm-tooling';

import { syncToolchain } from './commands/sync-toolchain';

export const tools: readonly [Tool, ...Tool[]] = [
    {
        name: 'stellar',
        preExecute: syncToolchain,
        dockerPlatform: 'linux/amd64',
        defaultVolumes: [
            // NOTE: for configuration commands, you should never put it in your package.json#build or #test, since the config is locked for parallel builds
            // while common commands like contract build and binding generation are allowed since they are not writing to the config files
            {
                type: 'isolate',
                containerPath: '/cache/stellar',
                name: 'stellar-config',
                shared: true,
            },
            // safe to be unlocked as it is POSIX lock guarded
            {
                type: 'isolate',
                containerPath: '/cache/cargo',
                name: 'stellar-cargo',
                shared: true,
            },
            // shared across packages — toolchain is pre-synced via `sync-toolchain` (locked)
            // so concurrent reads from build/test/lint are safe
            {
                type: 'isolate',
                containerPath: '/cache/rustup',
                name: 'stellar-rustup',
                shared: true,
            },
            // safe as the wort case of corruption is cache miss, since it is key-based cache, concurrent writes will produce identical content
            {
                type: 'host',
                containerPath: '/cache/sccache',
                hostPath: '~/.sccache',
            },
        ],
        defaultEnv: [
            // sccache configuration
            { name: 'RUSTC_WRAPPER', value: '/usr/local/bin/sccache' },
            // mold linker for faster linking
            { name: 'CARGO_TARGET_X86_64_UNKNOWN_LINUX_GNU_LINKER', value: 'clang' },
            { name: 'CARGO_TARGET_AARCH64_UNKNOWN_LINUX_GNU_LINKER', value: 'clang' },
            {
                name: 'CARGO_TARGET_X86_64_UNKNOWN_LINUX_GNU_RUSTFLAGS',
                value: '-C link-arg=-fuse-ld=mold',
            },
            {
                name: 'CARGO_TARGET_AARCH64_UNKNOWN_LINUX_GNU_RUSTFLAGS',
                value: '-C link-arg=-fuse-ld=mold',
            },
        ],
    },
];

export const images = {
    ['stellar:stellar-25.1.0-patch-2']: {
        name: 'stellar',
        versions: {
            stellar: '25.1.0',
        },
        patch: 2,
        mirrorRegistries: [DockerRegistryMirror.PUBLIC_GAR],
    },
    ['stellar:stellar-25.2.0-patch-1']: {
        name: 'stellar',
        versions: {
            stellar: '25.2.0',
        },
        patch: 1,
        dependencies: {
            rust: '1.91.0',
        },
        mirrorRegistries: [DockerRegistryMirror.PUBLIC_GAR],
    },
} satisfies Record<string, Image>;

export type ImageId = keyof typeof images;

export const versionCombinations: [VersionCombination<ImageId>, ...VersionCombination<ImageId>[]] =
    [
        {
            images: {
                stellar: 'stellar:stellar-25.1.0-patch-2',
            },
            description: 'Latest stable release',
            stable: true,
        },
        {
            images: {
                stellar: 'stellar:stellar-25.2.0-patch-1',
            },
            description: 'Stellar 25.2.0',
            stable: true,
        },
    ];
