import {
    DockerRegistryMirror,
    type Image,
    type Tool,
    type VersionCombination,
} from '@layerzerolabs/vm-tooling';

export const tools: readonly [Tool, ...Tool[]] = [
    {
        name: 'scarb',
    },
];

export const images = {
    ['starknet:scarb-2.14.0-patch-2']: {
        name: 'starknet',
        versions: {
            scarb: '2.14.0',
        },
        dependencies: {
            asdf: '0.14.0',
            starknetFoundry: '0.49.0',
        },
        patch: 2,
        mirrorRegistries: [DockerRegistryMirror.PUBLIC_GAR],
    },
    ['starknet:scarb-2.14.0-patch-3']: {
        name: 'starknet',
        versions: {
            scarb: '2.14.0',
        },
        dependencies: {
            asdf: '0.14.0',
            starknetFoundry: '0.49.0',
        },
        patch: 3,
        mirrorRegistries: [DockerRegistryMirror.PUBLIC_GAR],
    },
    ['starknet:scarb-2.13.1-patch-2']: {
        name: 'starknet',
        versions: {
            scarb: '2.13.1',
        },
        patch: 2,
        mirrorRegistries: [DockerRegistryMirror.PUBLIC_GAR],
    },
    ['starknet:scarb-2.12.0-patch-4']: {
        name: 'starknet',
        versions: {
            scarb: '2.12.0',
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
                scarb: 'starknet:scarb-2.14.0-patch-3',
            },
            stable: true,
        },
        {
            images: {
                scarb: 'starknet:scarb-2.13.1-patch-2',
            },
        },
        {
            images: {
                scarb: 'starknet:scarb-2.12.0-patch-4',
            },
        },
    ];
