import { afterEach, beforeEach, describe, it } from 'vitest';

import type { VolumeMapping } from '../config';
import { isDockerPlatformOverride } from '../config';
import type { QualifyVolumeNameOptions } from './docker';
import {
    qualifyVolumeName,
    resolveDockerPlatform,
    resolveDockerPlatformExecution,
    resolveEffectiveDockerPlatformValue,
} from './docker';

const TAG = 'agave-2.1.0-anchor-0.31.1';

const qualifiedName = (volume: VolumeMapping, options?: QualifyVolumeNameOptions): string => {
    const result = qualifyVolumeName(volume, options);
    if (result.type !== 'isolate') {
        throw new Error('expected an isolate volume');
    }
    return result.name;
};

describe('Docker platform helpers', () => {
    const originalDockerDefaultPlatform = process.env.DOCKER_DEFAULT_PLATFORM;

    afterEach(() => {
        if (originalDockerDefaultPlatform === undefined) {
            delete process.env.DOCKER_DEFAULT_PLATFORM;
        } else {
            process.env.DOCKER_DEFAULT_PLATFORM = originalDockerDefaultPlatform;
        }
    });

    it.sequential(
        'validates supported Docker platform overrides from one source of truth',
        ({ expect }) => {
            expect(isDockerPlatformOverride('native')).toBe(true);
            expect(isDockerPlatformOverride('linux/amd64')).toBe(true);
            expect(isDockerPlatformOverride('linux/arm64')).toBe(true);
            expect(isDockerPlatformOverride(null)).toBe(false);
            expect(isDockerPlatformOverride(undefined)).toBe(false);
            expect(isDockerPlatformOverride('')).toBe(false);
            expect(isDockerPlatformOverride('linux/arm/v7')).toBe(false);
        },
    );

    it.sequential('resolves a Docker platform into Docker and cache-name forms', ({ expect }) => {
        expect(resolveDockerPlatform('linux/amd64')).toEqual({
            value: 'linux/amd64',
            namespace: 'linux-amd64',
            arch: 'amd64',
        });
    });

    it.sequential('matches Docker arch parsing for multi-segment platform values', ({ expect }) => {
        expect(resolveDockerPlatform('linux/arm/v7')).toEqual({
            value: 'linux/arm/v7',
            namespace: 'linux-arm-v7',
            arch: 'arm',
        });
    });

    it.sequential('resolves the effective platform with CLI override first', ({ expect }) => {
        expect(
            resolveEffectiveDockerPlatformValue({
                dockerPlatform: 'linux/arm64',
                toolDockerPlatform: 'linux/amd64',
                envDockerPlatform: 'linux/amd64',
            }),
        ).toBe('linux/arm64');
    });

    it.sequential('lets native override skip tool and env platform fallbacks', ({ expect }) => {
        expect(
            resolveEffectiveDockerPlatformValue({
                dockerPlatform: 'native',
                toolDockerPlatform: 'linux/amd64',
                envDockerPlatform: 'linux/arm64',
            }),
        ).toBeUndefined();
    });

    it.sequential('uses the tool platform before the env fallback', ({ expect }) => {
        expect(
            resolveEffectiveDockerPlatformValue({
                toolDockerPlatform: 'linux/amd64',
                envDockerPlatform: 'linux/arm64',
            }),
        ).toBe('linux/amd64');
    });

    it.sequential('resolves native execution by clearing Docker default platform', ({ expect }) => {
        process.env.DOCKER_DEFAULT_PLATFORM = 'linux/amd64';

        const execution = resolveDockerPlatformExecution({
            dockerPlatform: 'native',
            toolDockerPlatform: 'linux/amd64',
        });

        expect(execution.platform).toBeUndefined();
        expect(execution.args).toEqual([]);
        expect(execution.processEnv?.DOCKER_DEFAULT_PLATFORM).toBeUndefined();
        expect(execution.volumeNameOptions).toEqual({ dockerPlatform: undefined });
    });

    it.sequential('resolves pinned execution into one platform context', ({ expect }) => {
        expect(
            resolveDockerPlatformExecution({
                dockerPlatform: 'linux/arm64',
                toolDockerPlatform: 'linux/amd64',
            }),
        ).toEqual({
            platform: {
                value: 'linux/arm64',
                namespace: 'linux-arm64',
                arch: 'arm64',
            },
            args: ['--platform', 'linux/arm64'],
            volumeNameOptions: { dockerPlatform: 'linux/arm64' },
        });
    });
});

describe(qualifyVolumeName, () => {
    const originalPackageName = process.env.npm_package_name;
    const originalDockerDefaultPlatform = process.env.DOCKER_DEFAULT_PLATFORM;

    beforeEach(() => {
        process.env.npm_package_name = '@layerzerolabs/oft-solana';
        delete process.env.DOCKER_DEFAULT_PLATFORM;
    });

    afterEach(() => {
        if (originalPackageName === undefined) {
            delete process.env.npm_package_name;
        } else {
            process.env.npm_package_name = originalPackageName;
        }
        if (originalDockerDefaultPlatform === undefined) {
            delete process.env.DOCKER_DEFAULT_PLATFORM;
        } else {
            process.env.DOCKER_DEFAULT_PLATFORM = originalDockerDefaultPlatform;
        }
    });

    const isolateVolume: VolumeMapping = {
        type: 'isolate',
        containerPath: '/usr/local/cargo',
        name: 'solana-cargo',
    };

    it.sequential(
        'leaves host volumes untouched even when cache and platform options are supplied',
        ({ expect }) => {
            const volume: VolumeMapping = {
                type: 'host',
                containerPath: '/var/run/docker.sock',
                hostPath: '/var/run/docker.sock',
            };
            expect(
                qualifyVolumeName(volume, { cacheKey: TAG, dockerPlatform: 'linux/amd64' }),
            ).toEqual(volume);
        },
    );

    it.sequential('keeps shared volumes package-agnostic and toolchain-agnostic', ({ expect }) => {
        const volume: VolumeMapping = {
            type: 'isolate',
            containerPath: '/home/app/.move',
            name: 'sui',
            shared: true,
        };
        expect(qualifiedName(volume, { cacheKey: TAG })).toBe('lz-tooling-cache-sui');
        expect(qualifiedName({ ...volume, toolchainKeyed: true }, { cacheKey: TAG })).toBe(
            'lz-tooling-cache-sui',
        );
    });

    it.sequential(
        'keys a toolchainKeyed volume by the toolchain tag, not the package',
        ({ expect }) => {
            expect(
                qualifiedName(
                    { ...isolateVolume, locked: true, toolchainKeyed: true },
                    { cacheKey: TAG },
                ),
            ).toBe(`lz-tooling-cache-solana-cargo-${TAG}`);
        },
    );

    it.sequential(
        'keeps a non-opted-in volume package-private even when a cache key is available',
        ({ expect }) => {
            const volume: VolumeMapping = {
                type: 'isolate',
                containerPath: '/root/.move',
                name: 'aptos',
                locked: true,
            };
            expect(qualifiedName(volume, { cacheKey: TAG })).toBe(
                'lz-tooling-cache-aptos-oft-solana',
            );
        },
    );

    it.sequential(
        'falls back to package-private when a toolchainKeyed volume has no cache key',
        ({ expect }) => {
            expect(qualifiedName({ ...isolateVolume, toolchainKeyed: true })).toBe(
                'lz-tooling-cache-solana-cargo-oft-solana',
            );
        },
    );

    it.sequential(
        'throws when no cache key is usable and the package name is absent',
        ({ expect }) => {
            delete process.env.npm_package_name;

            expect(() => qualifyVolumeName(isolateVolume)).toThrow('npm_package_name');
        },
    );

    it.sequential(
        'preserves existing isolate volume names when no platform is pinned',
        ({ expect }) => {
            expect(qualifyVolumeName(isolateVolume)).toMatchObject({
                name: 'lz-tooling-cache-solana-cargo-oft-solana',
            });
        },
    );

    it.sequential('suffixes isolate volume names with the pinned amd64 platform', ({ expect }) => {
        expect(qualifyVolumeName(isolateVolume, { dockerPlatform: 'linux/amd64' })).toMatchObject({
            name: 'lz-tooling-cache-solana-cargo-oft-solana-linux-amd64',
        });
    });

    it.sequential(
        'uses different isolate volume names for different pinned platforms',
        ({ expect }) => {
            const amd64 = qualifyVolumeName(isolateVolume, { dockerPlatform: 'linux/amd64' });
            const arm64 = qualifyVolumeName(isolateVolume, { dockerPlatform: 'linux/arm64' });

            expect(amd64).toMatchObject({
                name: 'lz-tooling-cache-solana-cargo-oft-solana-linux-amd64',
            });
            expect(arm64).toMatchObject({
                name: 'lz-tooling-cache-solana-cargo-oft-solana-linux-arm64',
            });
        },
    );

    it.sequential(
        'uses DOCKER_DEFAULT_PLATFORM when no explicit platform is passed',
        ({ expect }) => {
            process.env.DOCKER_DEFAULT_PLATFORM = 'linux/amd64';

            expect(qualifyVolumeName(isolateVolume)).toMatchObject({
                name: 'lz-tooling-cache-solana-cargo-oft-solana-linux-amd64',
            });
        },
    );

    it.sequential(
        'does not use DOCKER_DEFAULT_PLATFORM when an explicit undefined platform is passed',
        ({ expect }) => {
            process.env.DOCKER_DEFAULT_PLATFORM = 'linux/amd64';

            expect(qualifyVolumeName(isolateVolume, { dockerPlatform: undefined })).toMatchObject({
                name: 'lz-tooling-cache-solana-cargo-oft-solana',
            });
        },
    );

    it.sequential('keeps distinct ARM platform variants in distinct cache names', ({ expect }) => {
        process.env.DOCKER_DEFAULT_PLATFORM = 'linux/arm/v6';
        const v6 = qualifyVolumeName({ ...isolateVolume, shared: true });

        process.env.DOCKER_DEFAULT_PLATFORM = 'linux/arm/v7';
        const v7 = qualifyVolumeName({ ...isolateVolume, shared: true });

        expect(v6).toMatchObject({ name: 'lz-tooling-cache-solana-cargo-linux-arm-v6' });
        expect(v7).toMatchObject({ name: 'lz-tooling-cache-solana-cargo-linux-arm-v7' });
    });

    it.sequential('does not suffix architecture-independent isolate volumes', ({ expect }) => {
        expect(
            qualifyVolumeName(
                {
                    ...isolateVolume,
                    shared: true,
                    architectureIndependent: true,
                },
                { dockerPlatform: 'linux/amd64' },
            ),
        ).toMatchObject({ name: 'lz-tooling-cache-solana-cargo' });
    });

    it.sequential(
        'preserves shared volume naming while still platform-isolating it',
        ({ expect }) => {
            const sharedVolume: VolumeMapping = {
                type: 'isolate',
                containerPath: '/shared',
                name: 'shared-state',
                shared: true,
            };

            expect(qualifyVolumeName(sharedVolume)).toMatchObject({
                name: 'lz-tooling-cache-shared-state',
            });
            expect(
                qualifyVolumeName(sharedVolume, { dockerPlatform: 'linux/amd64' }),
            ).toMatchObject({
                name: 'lz-tooling-cache-shared-state-linux-amd64',
            });
        },
    );
});
