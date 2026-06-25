import {
    DockerRegistryMirror,
    type Image,
    type Tool,
    type VersionCombination,
} from '@layerzerolabs/vm-tooling';

export const tools: readonly [Tool, ...Tool[]] = [
    {
        name: 'hardhat',
        // Pin amd64 so compiled artifacts (incl. solc build-info) are byte-identical
        // across host architectures. build-info embeds the compiler AST, whose integer
        // serialization differs between arm64 and amd64 (negative `referencedDeclaration`
        // ids for built-in globals print as signed int32 on amd64 vs unsigned uint32 on
        // arm64), which otherwise breaks the bytecode-integrity snapshot on Apple Silicon.
        // CI runs amd64, so this aligns local builds with CI. See PRO-3759.
        dockerPlatform: 'linux/amd64',
    },
    {
        name: 'forge',
    },
];

export const images = {
    ['evm:forge-1.3.6-hardhat-2.26.3-patch-1']: {
        name: 'evm',
        versions: {
            forge: '1.3.6',
            hardhat: '2.26.3',
        },
        patch: 1,
        mirrorRegistries: [DockerRegistryMirror.PUBLIC_GAR],
    },
    ['evm:forge-1.3.6-hardhat-2.26.3-patch-2']: {
        name: 'evm',
        versions: {
            forge: '1.3.6',
            hardhat: '2.26.3',
        },
        patch: 2,
        mirrorRegistries: [DockerRegistryMirror.PUBLIC_GAR],
    },
    ['evm:forge-1.3.6-hardhat-2.26.3-patch-3']: {
        name: 'evm',
        versions: {
            forge: '1.3.6',
            hardhat: '2.26.3',
        },
        patch: 3,
        mirrorRegistries: [DockerRegistryMirror.PUBLIC_GAR],
    },
} satisfies Record<string, Image>;

export type ImageId = keyof typeof images;

export const versionCombinations: [VersionCombination<ImageId>, ...VersionCombination<ImageId>[]] =
    [
        {
            images: {
                forge: 'evm:forge-1.3.6-hardhat-2.26.3-patch-3',
                hardhat: 'evm:forge-1.3.6-hardhat-2.26.3-patch-3',
            },
            stable: true,
        },
        {
            images: {
                forge: 'evm:forge-1.3.6-hardhat-2.26.3-patch-1',
                hardhat: 'evm:forge-1.3.6-hardhat-2.26.3-patch-1',
            },
            stable: true,
        },
    ];
