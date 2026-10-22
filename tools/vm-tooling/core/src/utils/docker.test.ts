import { afterEach, beforeEach, describe, it } from 'vitest';

import type { VolumeMapping } from '../config';
import { isDockerPlatformOverride, parseDockerPlatformOverride } from '../config';
import type {
    DockerCommandOutput,
    DockerCommandRunner,
    DockerPlatform,
    QualifyVolumeNameOptions,
} from './docker';
import {
    dockerImageNotAvailableError,
    isDockerRegistryAuthError,
    parseImageIndexPlatforms,
    qualifyVolumeName,
    readDockerApiVersion,
    readDockerEngine,
    readRegistryImagePlatforms,
    resolveDockerPlatform,
    resolveDockerPlatformExecution,
    resolveEffectiveDockerPlatformValue,
    resolveRunDockerPlatform,
    toPlatformTag,
} from './docker';
import { normalizeDockerPlatform } from './platform';

const TAG = 'agave-2.1.0-anchor-0.31.1';

const LINUX_ARM64: DockerPlatform = {
    value: 'linux/arm64',
    namespace: 'linux-arm64',
};

const dockerVersion = (
    server: Record<string, unknown> | null,
    client: Record<string, unknown> = { ApiVersion: '1.56' },
): string =>
    JSON.stringify({
        Client: {
            Version: '29.8.2',
            DefaultAPIVersion: '1.56',
            Os: 'darwin',
            Arch: 'arm64',
            Context: 'desktop-linux',
            ...client,
        },
        Server: server && {
            Platform: { Name: 'Docker Desktop 4.94.0 (241994)' },
            Version: '29.8.2',
            MinAPIVersion: '1.40',
            KernelVersion: '7.0.14-linuxkit',
            ...server,
        },
    });

const fakeDockerVersion = (
    output: DockerCommandOutput,
): { docker: DockerCommandRunner; calls: string[][] } => {
    const calls: string[][] = [];
    const docker: DockerCommandRunner = async (args) => {
        calls.push([...args]);
        return output;
    };
    return { docker, calls };
};

const engineDocker = (os: string, arch: string) =>
    fakeDockerVersion({
        exitCode: 0,
        stdout: dockerVersion({ ApiVersion: '1.56', Os: os, Arch: arch }),
        stderr: '',
    });

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
        });
    });

    it.sequential('matches Docker arch parsing for multi-segment platform values', ({ expect }) => {
        expect(resolveDockerPlatform('linux/arm/v7')).toEqual({
            value: 'linux/arm/v7',
            namespace: 'linux-arm-v7',
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

    it.sequential(
        'resolves native to the engine platform, skipping the tool and env platform fallbacks',
        ({ expect }) => {
            expect(
                resolveEffectiveDockerPlatformValue({
                    dockerPlatform: 'native',
                    toolDockerPlatform: 'linux/amd64',
                    envDockerPlatform: 'linux/amd64',
                    enginePlatform: LINUX_ARM64,
                }),
            ).toBe('linux/arm64');
        },
    );

    it.sequential('uses the tool platform before the env fallback', ({ expect }) => {
        expect(
            resolveEffectiveDockerPlatformValue({
                toolDockerPlatform: 'linux/amd64',
                envDockerPlatform: 'linux/arm64',
            }),
        ).toBe('linux/amd64');
    });

    it.sequential(
        'resolves native execution to the engine platform and clears DOCKER_DEFAULT_PLATFORM',
        ({ expect }) => {
            process.env.DOCKER_DEFAULT_PLATFORM = 'linux/amd64';

            const execution = resolveDockerPlatformExecution({
                dockerPlatform: 'native',
                toolDockerPlatform: 'linux/amd64',
                enginePlatform: LINUX_ARM64,
            });

            expect(execution.platform).toEqual(LINUX_ARM64);
            expect(execution.args).toEqual(['--platform', 'linux/arm64']);
            expect(execution.processEnv?.DOCKER_DEFAULT_PLATFORM).toBeUndefined();
            expect(execution.volumeNameOptions).toEqual({ dockerPlatform: 'linux/arm64' });
        },
    );

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

describe('one name per Docker platform', () => {
    it.for(['aarch64', 'arm64', 'linux/arm64', 'linux/aarch64', 'linux/arm64/v8', 'Linux/ARM64'])(
        'normalizes the platform spelling %s to linux/arm64',
        (input, { expect }) => {
            expect(normalizeDockerPlatform(input)).toBe('linux/arm64');
        },
    );

    it.for(['x86_64', 'x86-64', 'x64', 'amd64', 'linux/amd64', 'linux/amd64/v1'])(
        'normalizes the platform spelling %s to linux/amd64',
        (input, { expect }) => {
            expect(normalizeDockerPlatform(input)).toBe('linux/amd64');
        },
    );

    it.for(['linux/arm/v7', 'linux/amd64/v3'])(
        'keeps the variant of the platform %s when it normalizes it',
        (input, { expect }) => {
            expect(normalizeDockerPlatform(input)).toBe(input);
        },
    );

    it.for(['linux/arm64/v8', 'aarch64', 'LINUX/ARM64'])(
        'accepts --docker-platform %s as linux/arm64 with the same tag, volumes, and messages',
        (input, { expect }) => {
            const override = parseDockerPlatformOverride(input);
            const canonical = parseDockerPlatformOverride('linux/arm64');

            expect(override).toBe('linux/arm64');
            expect(override).toBe(canonical);
            const platform = resolveDockerPlatform(override);
            if (!platform) {
                throw new Error('expected a platform');
            }
            expect(toPlatformTag('registry.example/tool:1.0.0', platform)).toBe(
                'registry.example/tool:1.0.0--linux-arm64',
            );
            expect(
                resolveDockerPlatformExecution({
                    dockerPlatform: override === 'native' ? undefined : override,
                    toolDockerPlatform: 'linux/amd64',
                }),
            ).toEqual(
                resolveDockerPlatformExecution({
                    dockerPlatform: 'linux/arm64',
                    toolDockerPlatform: 'linux/amd64',
                }),
            );
        },
    );

    it('accepts --docker-platform native in any letter case', ({ expect }) => {
        expect(parseDockerPlatformOverride('native')).toBe('native');
        expect(parseDockerPlatformOverride('NATIVE')).toBe('native');
    });

    it.for([
        'linux/arm/v7',
        'windows/amd64',
        'linux/riscv64',
        'bogus',
        '',
        'linux//arm64',
        'a/b/c/d',
    ])('rejects --docker-platform "%s" with the invalid-value error', (input, { expect }) => {
        expect(() => parseDockerPlatformOverride(input)).toThrow(
            `Invalid docker platform: ${input}. Expected native, linux/amd64, linux/arm64.`,
        );
    });

    it('rejects a --docker-platform value that is not a string', ({ expect }) => {
        expect(() => parseDockerPlatformOverride(undefined)).toThrow(
            'Invalid docker platform: undefined. Expected native, linux/amd64, linux/arm64.',
        );
    });

    it('treats an inspected Architecture=arm64 Variant=v8 image as linux/arm64', ({ expect }) => {
        expect(normalizeDockerPlatform('linux/arm64/v8')).toBe('linux/arm64');
        expect(resolveDockerPlatform('linux/arm64/v8')).toEqual(LINUX_ARM64);
    });
});

describe('native means the Docker engine platform', () => {
    it('a native run uses the docker version server platform, not the client platform', async ({
        expect,
    }) => {
        const { docker, calls } = engineDocker('linux', 'arm64');

        const { execution, engine } = await resolveRunDockerPlatform({
            dockerPlatform: 'native',
            toolDockerPlatform: 'linux/amd64',
            docker,
        });

        expect(calls).toEqual([['version', '--format', '{{json .}}']]);
        expect(engine).toEqual({ platform: LINUX_ARM64, apiVersion: '1.56' });
        expect(execution.platform).toEqual(LINUX_ARM64);
        expect(execution.args).toEqual(['--platform', 'linux/arm64']);
    });

    it('normalizes the engine architecture that docker version reports', async ({ expect }) => {
        const { docker } = engineDocker('linux', 'aarch64');

        await expect(readDockerEngine(docker)).resolves.toEqual({
            platform: LINUX_ARM64,
            apiVersion: '1.56',
        });
    });

    it('names the ignored DOCKER_DEFAULT_PLATFORM and the engine platform in one line', ({
        expect,
    }) => {
        const execution = resolveDockerPlatformExecution({
            dockerPlatform: 'native',
            toolDockerPlatform: 'linux/amd64',
            envDockerPlatform: 'linux/amd64',
            enginePlatform: LINUX_ARM64,
        });

        expect(execution.platform).toEqual(LINUX_ARM64);
        expect(execution.notice).toBe(
            '⚠️  Ignoring DOCKER_DEFAULT_PLATFORM=linux/amd64 for --docker-platform native; using the Docker engine platform linux/arm64',
        );
    });

    it.for(['linux/arm64', 'linux/arm64/v8', 'aarch64'])(
        'prints no ignored-platform line when DOCKER_DEFAULT_PLATFORM=%s equals engine linux/arm64',
        (dockerDefaultPlatform, { expect }) => {
            const execution = resolveDockerPlatformExecution({
                dockerPlatform: 'native',
                envDockerPlatform: dockerDefaultPlatform,
                enginePlatform: LINUX_ARM64,
            });

            expect(execution.notice).toBeUndefined();
        },
    );

    it('a native run stops with the engine platform message when docker version fails', async ({
        expect,
    }) => {
        const { docker } = fakeDockerVersion({
            exitCode: 1,
            stdout: 'null',
            stderr: 'Cannot connect to the Docker daemon at unix:///var/run/docker.sock. Is the docker daemon running?',
        });

        await expect(
            resolveRunDockerPlatform({ dockerPlatform: 'native', docker }),
        ).rejects.toThrow(
            'Cannot read the Docker engine platform from `docker version`: Cannot connect to the Docker daemon',
        );
    });

    it.for([
        dockerVersion({ ApiVersion: '1.56', Arch: 'arm64' }),
        dockerVersion({ ApiVersion: '1.56', Os: 'linux' }),
        dockerVersion({ ApiVersion: '1.56', Os: '', Arch: '' }),
        dockerVersion(null),
        'not json',
    ])(
        'a native run stops with the engine platform message when docker version prints no server Os or Arch: %s',
        async (stdout, { expect }) => {
            const { docker } = fakeDockerVersion({ exitCode: 0, stdout, stderr: '' });

            await expect(
                resolveRunDockerPlatform({ dockerPlatform: 'native', docker }),
            ).rejects.toThrow('Cannot read the Docker engine platform from `docker version`');
        },
    );

    it('a native run takes the engine platform from the server and the lower of the client and server API versions', async ({
        expect,
    }) => {
        const { docker } = fakeDockerVersion({
            exitCode: 0,
            stdout: dockerVersion(
                { ApiVersion: '1.56', Os: 'linux', Arch: 'arm64' },
                { ApiVersion: '1.48' },
            ),
            stderr: '',
        });

        await expect(readDockerEngine(docker)).resolves.toEqual({
            platform: LINUX_ARM64,
            apiVersion: '1.48',
        });
    });

    it('reads no engine platform for a run that is not native', async ({ expect }) => {
        const { docker, calls } = engineDocker('linux', 'arm64');

        await resolveRunDockerPlatform({ toolDockerPlatform: 'linux/amd64', docker });

        expect(calls).toEqual([]);
    });
});

describe(readDockerApiVersion, () => {
    it('reads the API version from a docker version server that reports no Os or Arch', async ({
        expect,
    }) => {
        const { docker, calls } = fakeDockerVersion({
            exitCode: 0,
            stdout: dockerVersion({ ApiVersion: '1.56' }),
            stderr: '',
        });

        await expect(readDockerApiVersion(docker)).resolves.toBe('1.56');
        expect(calls).toEqual([['version', '--format', '{{json .}}']]);
    });

    it.for([
        ['1.48', '1.56', '1.48'],
        ['1.56', '1.48', '1.48'],
        ['1.9', '1.10', '1.9'],
        ['1.56', '1.56', '1.56'],
    ])(
        'reads client API %s and server API %s as the lower version %s',
        async ([clientApiVersion, serverApiVersion, apiVersion], { expect }) => {
            const { docker } = fakeDockerVersion({
                exitCode: 0,
                stdout: dockerVersion(
                    { ApiVersion: serverApiVersion },
                    { ApiVersion: clientApiVersion },
                ),
                stderr: '',
            });

            await expect(readDockerApiVersion(docker)).resolves.toBe(apiVersion);
        },
    );

    it.for<[string, DockerCommandOutput, string]>([
        [
            'the stderr of a failed docker version',
            {
                exitCode: 1,
                stdout: dockerVersion(null),
                stderr: 'Cannot connect to the Docker daemon at unix:///var/run/docker.sock. Is the docker daemon running?\n',
            },
            'Cannot connect to the Docker daemon at unix:///var/run/docker.sock. Is the docker daemon running?',
        ],
        [
            'the exit code of a failed docker version without stderr',
            { exitCode: 1, stdout: '', stderr: '' },
            'exit code 1',
        ],
    ])(
        'stops with the Docker API version message and %s',
        async ([_case, output, detail], { expect }) => {
            const { docker } = fakeDockerVersion(output);

            await expect(readDockerApiVersion(docker)).rejects.toHaveProperty(
                'message',
                `Cannot read the Docker API version from \`docker version\`: ${detail}`,
            );
        },
    );

    it('stops with the Docker API version message and keeps the cause when docker version prints no JSON', async ({
        expect,
    }) => {
        const { docker } = fakeDockerVersion({ exitCode: 0, stdout: 'not json', stderr: '' });

        const error = await readDockerApiVersion(docker).then(
            () => undefined,
            (reason: unknown) => reason,
        );

        expect(error).toHaveProperty(
            'message',
            'Cannot read the Docker API version from `docker version`: the output is not JSON',
        );
        expect(error).toHaveProperty(
            'cause.message',
            '`docker version` did not print JSON: not json',
        );
    });

    it.for([
        dockerVersion({ Os: 'linux', Arch: 'arm64' }),
        dockerVersion({ ApiVersion: '' }),
        dockerVersion({ ApiVersion: '1.56' }, {}),
        dockerVersion(null),
        'null',
    ])(
        'stops with the Docker API version message and keeps the cause when the output has no client or server ApiVersion: %s',
        async (stdout, { expect }) => {
            const { docker } = fakeDockerVersion({ exitCode: 0, stdout, stderr: '' });

            const error = await readDockerApiVersion(docker).then(
                () => undefined,
                (reason: unknown) => reason,
            );

            expect(error).toHaveProperty(
                'message',
                `Cannot read the Docker API version from \`docker version\`: the output has no Client.ApiVersion or Server.ApiVersion: ${stdout}`,
            );
            expect(error).toHaveProperty('cause.name', 'ZodError');
        },
    );
});

describe('cache volumes per Docker platform', () => {
    const cargoVolume: VolumeMapping = {
        type: 'isolate',
        containerPath: '/usr/local/cargo',
        name: 'solana-cargo',
        toolchainKeyed: true,
    };

    it('suffixes a native run volume with the engine platform, apart from the default run', async ({
        expect,
    }) => {
        const { docker } = engineDocker('linux', 'arm64');
        const native = await resolveRunDockerPlatform({
            dockerPlatform: 'native',
            toolDockerPlatform: 'linux/amd64',
            docker,
        });
        const pinned = await resolveRunDockerPlatform({
            toolDockerPlatform: 'linux/amd64',
            docker,
        });

        const nativeName = qualifiedName(cargoVolume, {
            ...native.execution.volumeNameOptions,
            cacheKey: TAG,
        });
        const pinnedName = qualifiedName(cargoVolume, {
            ...pinned.execution.volumeNameOptions,
            cacheKey: TAG,
        });

        expect(nativeName).toBe(`lz-tooling-cache-solana-cargo-${TAG}-linux-arm64`);
        expect(pinnedName).toBe(`lz-tooling-cache-solana-cargo-${TAG}-linux-amd64`);
    });

    it('uses the same volume names for native on linux/arm64 and --docker-platform linux/arm64/v8', async ({
        expect,
    }) => {
        const { docker } = engineDocker('linux', 'arm64');
        const native = await resolveRunDockerPlatform({
            dockerPlatform: 'native',
            toolDockerPlatform: 'linux/amd64',
            docker,
        });
        const explicit = await resolveRunDockerPlatform({
            dockerPlatform: parseDockerPlatformOverride('linux/arm64/v8'),
            toolDockerPlatform: 'linux/amd64',
            docker,
        });

        expect(explicit.execution.volumeNameOptions).toEqual(native.execution.volumeNameOptions);
        expect(
            qualifiedName(cargoVolume, { ...explicit.execution.volumeNameOptions, cacheKey: TAG }),
        ).toBe(
            qualifiedName(cargoVolume, { ...native.execution.volumeNameOptions, cacheKey: TAG }),
        );
    });
});

describe('registry error messages', () => {
    const IMAGE = `registry.example/layerzerolabs/solana-tooling:${TAG}`;
    const loginHint = '  - ECR auth expired. Run: pnpm localnet login';

    it.for([
        'ERROR: unexpected status from HEAD request to https://438003944538.dkr.ecr.us-east-1.amazonaws.com/v2/layerzerolabs/solana-tooling/manifests/anchor-1.2.1-solana-4.3.0: 403 Forbidden\ndenied: Your authorization token has expired. Reauthenticate and try again.',
        'Error response from daemon: Head "https://438003944538.dkr.ecr.us-east-1.amazonaws.com/v2/layerzerolabs/solana-tooling/manifests/x": no basic auth credentials',
        'Error response from daemon: Head "https://registry.example/v2/x/manifests/y": unauthorized: authentication required',
        "Error response from daemon: pull access denied for layerzerolabs/missing, repository does not exist or may require 'docker login': denied: requested access to the resource is denied",
    ])(
        'gives the pnpm localnet login hint for the registry authorization error %#',
        (stderr, { expect }) => {
            expect(isDockerRegistryAuthError(stderr)).toBe(true);
            expect(
                dockerImageNotAvailableError({ imageUri: IMAGE, failure: 'pull failed', stderr })
                    .message,
            ).toBe(
                [
                    'Docker image not available:',
                    `  - Image: ${IMAGE} (pull failed)`,
                    loginHint,
                ].join('\n'),
            );
        },
    );

    it('treats the buildx 401 Unauthorized registry error as an authorization error', ({
        expect,
    }) => {
        expect(
            isDockerRegistryAuthError(
                'ERROR: unexpected status from HEAD request to https://438003944538.dkr.ecr.us-east-1.amazonaws.com/v2/layerzerolabs/solana-tooling/manifests/anchor-1.2.1-solana-4.3.0: 401 Unauthorized',
            ),
        ).toBe(true);
    });

    it('matches a registry authorization error text written with capitals in any case', ({
        expect,
    }) => {
        const stderr =
            'ERROR: unexpected status from HEAD request to https://registry.example/v2/x/manifests/y: 403 Forbidden';

        expect(isDockerRegistryAuthError(stderr, ['Forbidden'])).toBe(true);
        expect(isDockerRegistryAuthError(stderr.toUpperCase(), ['Forbidden'])).toBe(true);
        expect(isDockerRegistryAuthError(stderr, ['Not Found'])).toBe(false);
    });

    it('gives no login hint when the Docker socket denies permission', ({ expect }) => {
        const stderr =
            'permission denied while trying to connect to the Docker daemon socket at unix:///var/run/docker.sock: Head "http://%2Fvar%2Frun%2Fdocker.sock/_ping": dial unix /var/run/docker.sock: connect: permission denied';

        expect(isDockerRegistryAuthError(stderr)).toBe(false);
        expect(
            dockerImageNotAvailableError({ imageUri: IMAGE, failure: 'pull failed', stderr })
                .message,
        ).not.toContain(loginHint);
    });

    const imagetoolsDocker =
        (outputs: Record<string, string>): DockerCommandRunner =>
        async (args) => ({ exitCode: 0, stdout: outputs[args[4] ?? ''] ?? '', stderr: '' });

    it.for<[string, Record<string, string>]>([
        ['an index without a digest', { '{{json .Manifest}}': '{"manifests":[]}' }],
        [
            'a single manifest whose image has no architecture',
            {
                '{{json .Manifest}}': '{"digest":"sha256:0"}',
                '{{json .Image}}': '{"os":"linux"}',
            },
        ],
    ])(
        'names the image when docker buildx imagetools inspect prints %s',
        async ([_shape, outputs], { expect }) => {
            const error = await readRegistryImagePlatforms(IMAGE, imagetoolsDocker(outputs)).then(
                () => undefined,
                (reason: unknown) => reason,
            );

            expect(error).toBeInstanceOf(Error);
            expect(error).toHaveProperty(
                'message',
                `Unexpected \`docker buildx imagetools inspect\` output for ${IMAGE}`,
            );
            expect(error).toHaveProperty('cause.name', 'ZodError');
        },
    );
});

describe('parseImageIndexPlatforms', () => {
    it('lists the digest and normalized platform of each image and skips attestation entries', ({
        expect,
    }) => {
        expect(
            parseImageIndexPlatforms({
                schemaVersion: 2,
                mediaType: 'application/vnd.oci.image.index.v1+json',
                manifests: [
                    { digest: 'sha256:amd', platform: { os: 'linux', architecture: 'amd64' } },
                    {
                        digest: 'sha256:att',
                        platform: { os: 'unknown', architecture: 'unknown' },
                    },
                    {
                        digest: 'sha256:arm',
                        platform: { os: 'linux', architecture: 'arm64', variant: 'v8' },
                    },
                    { digest: 'sha256:none' },
                ],
            }),
        ).toEqual([
            { digest: 'sha256:amd', platform: 'linux/amd64' },
            { digest: 'sha256:arm', platform: 'linux/arm64' },
        ]);
    });

    it('returns undefined for JSON that is not an image index', ({ expect }) => {
        expect(parseImageIndexPlatforms({ mediaType: 'single' })).toBeUndefined();
    });

    it('throws for an index entry without a digest', ({ expect }) => {
        expect(() =>
            parseImageIndexPlatforms({
                manifests: [{ platform: { os: 'linux', architecture: 'amd64' } }],
            }),
        ).toThrow('Unexpected image index JSON');
    });
});
