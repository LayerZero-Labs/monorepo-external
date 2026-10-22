import { basename, join } from 'node:path';
import { env } from 'node:process';
import * as semver from 'semver';
import * as z from 'zod';

import type { DockerPlatformOverride, DockerPlatformValue, Image, VolumeMapping } from '../config';
import { DOCKER_PLATFORM_NATIVE, getImageDirectory, getRegistry } from '../config';
import type { ChainContext } from '../context';
import { findToolVersionsForCombination, getImageName } from './finder';
import { normalizeDockerPlatform, parseDockerPlatform } from './platform';

export interface DockerPlatform {
    value: string;
    /** Filesystem-safe token for cache volume names, e.g. `linux-amd64`. */
    namespace: string;
}

export type DockerProcessEnv = Record<string, string | undefined>;

export interface QualifyVolumeNameOptions {
    cacheKey?: string;
    dockerPlatform?: string;
}

interface DockerPlatformFallbacks {
    toolDockerPlatform?: DockerPlatformValue;
    envDockerPlatform?: string;
}

export type DockerPlatformResolutionOptions = DockerPlatformFallbacks &
    (
        | { dockerPlatform: typeof DOCKER_PLATFORM_NATIVE; enginePlatform: DockerPlatform }
        | { dockerPlatform?: DockerPlatformValue }
    );

export interface DockerPlatformExecution {
    platform?: DockerPlatform;
    args: string[];
    processEnv?: DockerProcessEnv;
    volumeNameOptions: QualifyVolumeNameOptions;
    notice?: string;
}

export interface DockerCommandOutput {
    exitCode: number | null;
    stdout: string;
    stderr: string;
}

export interface DockerCommandOptions {
    isQuiet?: boolean;
}

export type DockerCommandRunner = (
    args: readonly string[],
    options?: DockerCommandOptions,
) => Promise<DockerCommandOutput>;

export interface DockerEngine {
    platform: DockerPlatform;
    apiVersion: string;
}

export interface RegistryImagePlatform {
    platform: string;
    digest: string;
}

export const DOCKER_PLATFORM_INSPECT_MIN_API_VERSION = '1.49.0';

export const DOCKER_REGISTRY_AUTH_ERROR_TEXTS = [
    'authorization token has expired',
    'denied:',
    'no basic auth credentials',
    'pull access denied',
    'unauthorized',
] as const;

const ECR_LOGIN_HINT = '  - ECR auth expired. Run: pnpm localnet login';

const dockerApiVersionSchema = z.object({
    ApiVersion: z.string().regex(/^\d+\.\d+$/),
});

const dockerVersionSchema = z.object({
    Client: dockerApiVersionSchema,
    Server: dockerApiVersionSchema,
});

const dockerEngineVersionSchema = dockerVersionSchema.extend({
    Server: dockerApiVersionSchema.extend({
        Os: z.string().min(1),
        Arch: z.string().min(1),
    }),
});

const ociPlatformSchema = z.object({
    os: z.string(),
    architecture: z.string(),
    variant: z.optional(z.string()),
});

const imageIndexSchema = z.object({
    manifests: z.optional(
        z.array(z.object({ digest: z.string(), platform: z.optional(ociPlatformSchema) })),
    ),
});

const registryManifestSchema = imageIndexSchema.extend({
    digest: z.string(),
});

const toDockerPlatform = (input: string): DockerPlatform => {
    const value = normalizeDockerPlatform(input);

    return {
        value,
        namespace: value.replace(/\//g, '-'),
    };
};

export const resolveDockerPlatform = (dockerPlatform?: string): DockerPlatform | undefined =>
    dockerPlatform ? toDockerPlatform(dockerPlatform) : undefined;

export const isDockerRegistryAuthError = (
    stderr: string,
    authErrorTexts: readonly string[] = DOCKER_REGISTRY_AUTH_ERROR_TEXTS,
): boolean => {
    const lowerCaseStderr = stderr.toLowerCase();

    return authErrorTexts.some((text) => lowerCaseStderr.includes(text.toLowerCase()));
};

export const dockerImageNotAvailableError = ({
    imageUri,
    failure,
    stderr,
    isStderrIncluded = false,
    cause,
}: {
    imageUri: string;
    failure: string;
    stderr: string;
    isStderrIncluded?: boolean;
    cause?: unknown;
}): Error =>
    new Error(
        [
            'Docker image not available:',
            `  - Image: ${imageUri} (${failure})`,
            isDockerRegistryAuthError(stderr)
                ? ECR_LOGIN_HINT
                : '  - Check if the image tag exists in image registry.',
            ...(isStderrIncluded ? [`  - Error: ${stderr.trim()}`] : []),
        ].join('\n'),
        cause === undefined ? undefined : { cause },
    );

const parseJsonOutput = (stdout: string, description: string): unknown => {
    try {
        return JSON.parse(stdout);
    } catch (error) {
        throw new Error(`${description} did not print JSON: ${stdout.trim()}`, { cause: error });
    }
};

const dockerVersionReadError =
    (subject: string) =>
    (detail: string, cause?: unknown): Error =>
        new Error(
            `Cannot read ${subject} from \`docker version\`: ${detail}`,
            cause === undefined ? undefined : { cause },
        );

const toSemverApiVersion = (apiVersion: string): semver.SemVer => {
    const version = semver.coerce(apiVersion);

    if (!version) {
        throw new Error(`Invalid Docker API version: ${apiVersion}`);
    }

    return version;
};

const lowerDockerApiVersion = (left: string, right: string): string =>
    semver.lt(toSemverApiVersion(left), toSemverApiVersion(right)) ? left : right;

const readDockerVersion = async <T extends z.infer<typeof dockerVersionSchema>>({
    docker,
    schema,
    fields,
    readError,
}: {
    docker: DockerCommandRunner;
    schema: z.ZodType<T>;
    fields: string;
    readError: (detail: string, cause?: unknown) => Error;
}): Promise<T & { apiVersion: string }> => {
    const output = await docker(['version', '--format', '{{json .}}']);

    if (output.exitCode !== 0) {
        throw readError(output.stderr.trim() || `exit code ${String(output.exitCode)}`);
    }

    let version: unknown;
    try {
        version = parseJsonOutput(output.stdout, '`docker version`');
    } catch (error) {
        throw readError('the output is not JSON', error);
    }

    const parsed = schema.safeParse(version);
    if (!parsed.success) {
        throw readError(`the output has no ${fields}: ${output.stdout.trim()}`, parsed.error);
    }

    return {
        ...parsed.data,
        apiVersion: lowerDockerApiVersion(
            parsed.data.Client.ApiVersion,
            parsed.data.Server.ApiVersion,
        ),
    };
};

export const readDockerEngine = async (docker: DockerCommandRunner): Promise<DockerEngine> => {
    const { Server: server, apiVersion } = await readDockerVersion({
        docker,
        schema: dockerEngineVersionSchema,
        fields: 'Client.ApiVersion, Server.ApiVersion, Server.Os, or Server.Arch',
        readError: dockerVersionReadError('the Docker engine platform'),
    });

    return {
        platform: toDockerPlatform(`${server.Os}/${server.Arch}`),
        apiVersion,
    };
};

export const readDockerApiVersion = async (docker: DockerCommandRunner): Promise<string> => {
    const { apiVersion } = await readDockerVersion({
        docker,
        schema: dockerVersionSchema,
        fields: 'Client.ApiVersion or Server.ApiVersion',
        readError: dockerVersionReadError('the Docker API version'),
    });

    return apiVersion;
};

export const supportsDockerPlatformInspect = (apiVersion: string): boolean =>
    semver.gte(toSemverApiVersion(apiVersion), DOCKER_PLATFORM_INSPECT_MIN_API_VERSION);

export const toPlatformTag = (imageUri: string, platform: DockerPlatform): string =>
    `${imageUri}--${platform.namespace}`;

export const toDigestReference = (imageUri: string, digest: string): string => {
    const tagSeparator = imageUri.lastIndexOf(':');
    const repository =
        tagSeparator > imageUri.lastIndexOf('/') ? imageUri.slice(0, tagSeparator) : imageUri;

    return `${repository}@${digest}`;
};

const toOciPlatformName = ({ os, architecture, variant }: z.infer<typeof ociPlatformSchema>) =>
    [os, architecture, ...(variant ? [variant] : [])].join('/');

const isAttestationPlatform = ({ os, architecture }: z.infer<typeof ociPlatformSchema>) =>
    os === 'unknown' && architecture === 'unknown';

export const parseImageIndexPlatforms = (index: unknown): RegistryImagePlatform[] | undefined => {
    const parsed = imageIndexSchema.safeParse(index);

    if (!parsed.success) {
        throw new Error('Unexpected image index JSON', { cause: parsed.error });
    }

    return parsed.data.manifests?.flatMap(({ digest, platform }) =>
        platform && !isAttestationPlatform(platform)
            ? [{ digest, platform: normalizeDockerPlatform(toOciPlatformName(platform)) }]
            : [],
    );
};

const registryLookupError = async ({
    imageUri,
    stderr,
    docker,
}: {
    imageUri: string;
    stderr: string;
    docker: DockerCommandRunner;
}): Promise<Error> => {
    if (isDockerRegistryAuthError(stderr)) {
        return dockerImageNotAvailableError({
            imageUri,
            failure: 'registry lookup failed',
            stderr,
            isStderrIncluded: true,
        });
    }

    const buildx = await docker(['buildx', 'version']);
    if (buildx.exitCode !== 0) {
        return new Error(
            [
                'Cannot read the registry image index: `docker buildx` is not available.',
                `  - Image: ${imageUri}`,
                '  - Install Docker buildx (included in Docker Desktop and the Docker Engine packages).',
            ].join('\n'),
        );
    }

    return new Error(
        [
            'Failed to read the registry image index:',
            `  - Image: ${imageUri}`,
            `  - Error: ${stderr.trim()}`,
        ].join('\n'),
    );
};

const inspectRegistryImage = async ({
    imageUri,
    format,
    docker,
}: {
    imageUri: string;
    format: string;
    docker: DockerCommandRunner;
}): Promise<unknown> => {
    const output = await docker(['buildx', 'imagetools', 'inspect', '--format', format, imageUri]);

    if (output.exitCode !== 0) {
        throw await registryLookupError({ imageUri, stderr: output.stderr, docker });
    }

    return parseJsonOutput(output.stdout, '`docker buildx imagetools inspect`');
};

const parseRegistryImageOutput = <T>({
    imageUri,
    schema,
    output,
}: {
    imageUri: string;
    schema: z.ZodType<T>;
    output: unknown;
}): T => {
    const parsed = schema.safeParse(output);

    if (!parsed.success) {
        throw new Error(`Unexpected \`docker buildx imagetools inspect\` output for ${imageUri}`, {
            cause: parsed.error,
        });
    }

    return parsed.data;
};

export const readRegistryImagePlatforms = async (
    imageUri: string,
    docker: DockerCommandRunner,
): Promise<RegistryImagePlatform[]> => {
    const manifest = parseRegistryImageOutput({
        imageUri,
        schema: registryManifestSchema,
        output: await inspectRegistryImage({ imageUri, format: '{{json .Manifest}}', docker }),
    });

    const indexPlatforms = parseImageIndexPlatforms(manifest);
    if (indexPlatforms) {
        return indexPlatforms;
    }

    const image = parseRegistryImageOutput({
        imageUri,
        schema: ociPlatformSchema,
        output: await inspectRegistryImage({ imageUri, format: '{{json .Image}}', docker }),
    });

    return [
        { digest: manifest.digest, platform: normalizeDockerPlatform(toOciPlatformName(image)) },
    ];
};

// Platform precedence is intentional: CLI override > tool default > DOCKER_DEFAULT_PLATFORM.
// A tool default is an explicit choice made by the tool config (for example Anchor's amd64 pin),
// so a user's shell env should not override it by accident. DOCKER_DEFAULT_PLATFORM only applies
// when the tool does not declare a platform.
export const resolveEffectiveDockerPlatformValue = (
    options: DockerPlatformResolutionOptions,
): string | undefined => {
    if (options.dockerPlatform === DOCKER_PLATFORM_NATIVE) {
        return options.enginePlatform.value;
    }

    return (
        options.dockerPlatform ??
        options.toolDockerPlatform ??
        options.envDockerPlatform ??
        env.DOCKER_DEFAULT_PLATFORM
    );
};

const ignoredDockerDefaultPlatformNotice = (
    dockerDefaultPlatform: string | undefined,
    enginePlatform: DockerPlatform,
): string | undefined =>
    dockerDefaultPlatform && parseDockerPlatform(dockerDefaultPlatform) !== enginePlatform.value
        ? `⚠️  Ignoring DOCKER_DEFAULT_PLATFORM=${dockerDefaultPlatform} for --docker-platform native; using the Docker engine platform ${enginePlatform.value}`
        : undefined;

export const resolveDockerPlatformExecution = (
    options: DockerPlatformResolutionOptions,
): DockerPlatformExecution => {
    if (options.dockerPlatform === DOCKER_PLATFORM_NATIVE) {
        const { DOCKER_DEFAULT_PLATFORM: dockerDefaultPlatform, ...processEnv } = env;
        const platform = options.enginePlatform;

        return {
            platform,
            args: ['--platform', platform.value],
            processEnv,
            volumeNameOptions: { dockerPlatform: platform.value },
            notice: ignoredDockerDefaultPlatformNotice(
                options.envDockerPlatform ?? dockerDefaultPlatform,
                platform,
            ),
        };
    }

    const platform = resolveDockerPlatform(resolveEffectiveDockerPlatformValue(options));

    return {
        platform,
        args: platform ? ['--platform', platform.value] : [],
        volumeNameOptions: { dockerPlatform: platform?.value },
    };
};

export const resolveRunDockerPlatform = async ({
    dockerPlatform,
    toolDockerPlatform,
    docker,
}: {
    dockerPlatform?: DockerPlatformOverride;
    toolDockerPlatform?: DockerPlatformValue;
    docker: DockerCommandRunner;
}): Promise<{ execution: DockerPlatformExecution; engine?: DockerEngine }> => {
    if (dockerPlatform === DOCKER_PLATFORM_NATIVE) {
        const engine = await readDockerEngine(docker);

        return {
            engine,
            execution: resolveDockerPlatformExecution({
                dockerPlatform,
                toolDockerPlatform,
                enginePlatform: engine.platform,
            }),
        };
    }

    return { execution: resolveDockerPlatformExecution({ dockerPlatform, toolDockerPlatform }) };
};

export const findImageForTool = <TImageId extends string>(
    context: ChainContext<TImageId>,
    toolName: string,
    version: string,
): Image => {
    const [image] = context.versionCombinations.flatMap((combination) => {
        const imageId = combination.images[toolName];

        if (!imageId) {
            return [];
        }

        const image = context.images[imageId];

        return image && findToolVersionsForCombination(context, combination)[toolName] === version
            ? [image]
            : [];
    });

    if (!image) {
        throw new Error(
            `No version combination found for tool ${toolName} with version ${version}`,
        );
    }

    return image;
};

export const getImageUri = async (image: Image): Promise<string> =>
    join(
        await getRegistry(),
        await getImageDirectory(),
        `${getImageName(image.name)}:${getImageTag(image)}`,
    );

export const getImageTag = ({ versions, patch }: Image): string =>
    [...Object.entries(versions).sort().flat(), ...(patch ? ['patch', patch] : [])].join('-');

export const qualifyVolumeName = (
    volume: VolumeMapping,
    { cacheKey, dockerPlatform }: QualifyVolumeNameOptions = {
        dockerPlatform: env.DOCKER_DEFAULT_PLATFORM,
    },
): VolumeMapping => {
    if (volume.type !== 'isolate') {
        return volume;
    }

    const components = ['lz-tooling-cache', volume.name];

    if (!volume.shared) {
        // Opted-in volumes key on the toolchain (image tag) so same-toolchain packages share one
        // cache; the rest stay package-private. Falls back to package-private without a cacheKey.
        if (volume.toolchainKeyed && cacheKey) {
            components.push(cacheKey);
        } else {
            const packageName = env.npm_package_name;

            if (!packageName) {
                throw new Error('npm_package_name environment variable not defined');
            }

            components.push(basename(packageName));
        }
    }

    const platform = resolveDockerPlatform(dockerPlatform);
    if (platform && !volume.architectureIndependent) {
        components.push(platform.namespace);
    }

    return { ...volume, name: components.join('-') };
};
