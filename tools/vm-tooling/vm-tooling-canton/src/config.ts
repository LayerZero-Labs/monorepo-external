import {
    DockerRegistryMirror,
    type Image,
    type Tool,
    type VersionCombination,
} from '@layerzerolabs/vm-tooling';

import { getLocalDpmVersion, getLocalOpenapiGeneratorVersion } from './local-version';

export const tools: readonly [Tool, ...Tool[]] = [
    {
        name: 'dpm',
        defaultVolumes: [
            {
                type: 'isolate',
                containerPath: '/opt/dpm/cache',
                name: 'canton-dpm-cache-v3',
                shared: true,
                locked: true,
            },
        ],
        getLocalVersion: getLocalDpmVersion,
    },
    {
        // Used by `lz-tool extra canton generate-openapi`. Backed by the
        // separate canton-openapi image which bakes the OpenAPI generator
        // JAR + the SDK-matched ledger JSON-API spec.
        name: 'openapi-generator',
        getLocalVersion: getLocalOpenapiGeneratorVersion,
    },
];

export const images = {
    'canton:dpm-3.4.8-patch-5': {
        name: 'canton',
        versions: {
            dpm: '3.4.8',
        },
        dependencies: {
            sdk: '3.4.11',
        },
        mirrorRegistries: [DockerRegistryMirror.PUBLIC_GAR],
        patch: 5,
    },
    'canton:dpm-3.4.8-patch-4': {
        name: 'canton',
        versions: {
            dpm: '3.4.8',
        },
        dependencies: {
            sdk: '3.4.11',
        },
        mirrorRegistries: [DockerRegistryMirror.PUBLIC_GAR],
        patch: 4,
    },
    'canton:dpm-3.4.8-patch-3': {
        name: 'canton',
        versions: {
            dpm: '3.4.8',
        },
        dependencies: {
            sdk: '3.4.11',
        },
        mirrorRegistries: [DockerRegistryMirror.PUBLIC_GAR],
        patch: 3,
    },
    'canton-openapi:openapi-generator-7.21.0-patch-3': {
        name: 'canton-openapi',
        versions: {
            'openapi-generator': '7.21.0',
        },
        dependencies: {
            sdk: '3.4.8',
        },
        mirrorRegistries: [DockerRegistryMirror.PUBLIC_GAR],
        patch: 3,
    },
    'canton-openapi:openapi-generator-7.26.0-patch-4': {
        name: 'canton-openapi',
        versions: {
            'openapi-generator': '7.26.0',
        },
        dependencies: {
            sdk: '3.6.1',
        },
        mirrorRegistries: [DockerRegistryMirror.PUBLIC_GAR],
        patch: 4,
    },
    'canton-openapi:openapi-generator-7.21.0-patch-2': {
        name: 'canton-openapi',
        versions: {
            'openapi-generator': '7.21.0',
        },
        dependencies: {
            sdk: '3.4.8',
        },
        mirrorRegistries: [DockerRegistryMirror.PUBLIC_GAR],
        patch: 2,
    },
    'canton-openapi:openapi-generator-7.26.0-patch-3': {
        name: 'canton-openapi',
        versions: {
            'openapi-generator': '7.26.0',
        },
        dependencies: {
            sdk: '3.6.1',
        },
        mirrorRegistries: [DockerRegistryMirror.PUBLIC_GAR],
        patch: 3,
    },
} satisfies Record<string, Image>;

export type ImageId = keyof typeof images;

export const versionCombinations: [VersionCombination<ImageId>, ...VersionCombination<ImageId>[]] =
    [
        {
            images: {
                dpm: 'canton:dpm-3.4.8-patch-5',
                'openapi-generator': 'canton-openapi:openapi-generator-7.26.0-patch-3',
            },
        },
        {
            images: {
                dpm: 'canton:dpm-3.4.8-patch-5',
                'openapi-generator': 'canton-openapi:openapi-generator-7.21.0-patch-2',
            },
        },
        {
            images: {
                dpm: 'canton:dpm-3.4.8-patch-3',
                'openapi-generator': 'canton-openapi:openapi-generator-7.21.0-patch-2',
            },
        },
    ];
