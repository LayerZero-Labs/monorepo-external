import { uniq } from 'es-toolkit';
import { access, mkdir, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import {
    type DockerCommandRunner,
    type DockerEngine,
    dockerImageNotAvailableError,
    type DockerPlatform,
    isDockerRegistryAuthError,
    readDockerApiVersion,
    readRegistryImagePlatforms,
    type RegistryImagePlatform,
    supportsDockerPlatformInspect,
    toDigestReference,
    toPlatformTag,
} from '../utils/docker';
import { stringifyError } from '../utils/error';
import { parseDockerPlatform } from '../utils/platform';

const toProbeStampToken = (value: string): string => value.replace(/[/:]/g, '_');

export const dockerPlatformProbeStampPath = (imageUri: string, platformValue: string): string =>
    path.join(
        os.homedir(),
        '.cache',
        'vm-tooling',
        'probe',
        `${toProbeStampToken(imageUri)}_${toProbeStampToken(platformValue)}`,
    );

const hasDockerPlatformProbeStamp = async (stampPath: string): Promise<boolean> => {
    try {
        await access(stampPath);
        return true;
    } catch {
        return false;
    }
};

const writeDockerPlatformProbeStamp = async (stampPath: string): Promise<void> => {
    try {
        await mkdir(path.dirname(stampPath), { recursive: true });
        await writeFile(stampPath, '');
    } catch (error) {
        console.warn(
            `⚠️  Failed to write Docker platform probe stamp ${stampPath}: ${stringifyError(error)}`,
        );
    }
};

const clearDockerPlatformProbeStamp = async (stampPath: string): Promise<void> => {
    try {
        await rm(stampPath, { force: true });
    } catch (error) {
        console.warn(
            `⚠️  Failed to clear Docker platform probe stamp ${stampPath}: ${stringifyError(error)}`,
        );
    }
};

const removeProbeContainer = async (
    containerId: string,
    docker: DockerCommandRunner,
): Promise<void> => {
    const removal = await docker(['container', 'rm', containerId]);
    if (removal.exitCode !== 0) {
        console.warn(
            `⚠️  Failed to remove the Docker platform probe container ${containerId}: ${removal.stderr.trim()}. Run: docker container rm ${containerId}`,
        );
    }
};

const MINIMAL_LOCAL_IMAGE_INSPECT_FORMAT = '{{.Architecture}}';

const LOCAL_IMAGE_PLATFORM_FORMAT = '{{.Os}}/{{.Architecture}}{{if .Variant}}/{{.Variant}}{{end}}';

type LocalDockerImage =
    | { isPresent: false }
    | { isPresent: true; platform?: string; probeError?: string; hasPassedPlatformProbe?: boolean };

type LocalDockerImageReader = (ref: string) => Promise<LocalDockerImage>;

const readTaggedDockerImage = async (
    ref: string,
    docker: DockerCommandRunner,
): Promise<LocalDockerImage> => {
    const tagged = await docker(['image', 'inspect', '--format', LOCAL_IMAGE_PLATFORM_FORMAT, ref]);

    return tagged.exitCode === 0
        ? { isPresent: true, platform: parseDockerPlatform(tagged.stdout.trim()) }
        : { isPresent: false };
};

const readLocalDockerImage = async ({
    ref,
    platform,
    docker,
    canInspectPlatform,
}: {
    ref: string;
    platform: DockerPlatform;
    docker: DockerCommandRunner;
    canInspectPlatform: boolean;
}): Promise<LocalDockerImage> => {
    if (canInspectPlatform) {
        const selected = await docker([
            'image',
            'inspect',
            '--platform',
            platform.value,
            '--format',
            LOCAL_IMAGE_PLATFORM_FORMAT,
            ref,
        ]);
        const selectedPlatform =
            selected.exitCode === 0 ? parseDockerPlatform(selected.stdout.trim()) : undefined;
        if (selectedPlatform) {
            return { isPresent: true, platform: selectedPlatform };
        }
        return readTaggedDockerImage(ref, docker);
    }

    let stampedTagImage: LocalDockerImage | undefined;
    if (await hasDockerPlatformProbeStamp(dockerPlatformProbeStampPath(ref, platform.value))) {
        stampedTagImage = await readTaggedDockerImage(ref, docker);
        if (!stampedTagImage.isPresent || stampedTagImage.platform === platform.value) {
            return stampedTagImage;
        }
    }

    const container = await docker([
        'container',
        'create',
        '--pull',
        'never',
        '--platform',
        platform.value,
        ref,
        'true',
    ]);
    if (container.exitCode === 0) {
        const containerId = container.stdout.trim();
        if (containerId) {
            await removeProbeContainer(containerId, docker);
        }
        return {
            isPresent: true,
            platform: platform.value,
            hasPassedPlatformProbe: containerId !== '',
        };
    }

    const taggedImage = stampedTagImage ?? (await readTaggedDockerImage(ref, docker));

    if (!taggedImage.isPresent || taggedImage.platform !== platform.value) {
        return taggedImage;
    }

    return { isPresent: true, probeError: container.stderr.trim() };
};

const describeLocalImagePlatform = (image: LocalDockerImage): string => {
    if (!image.isPresent) {
        return 'no local image';
    }

    return image.platform ?? 'no local image content';
};

const assertAndReportRunPlatform = ({
    ref,
    platform,
    image,
    mismatchHint,
}: {
    ref: string;
    platform: DockerPlatform;
    image: LocalDockerImage;
    mismatchHint?: string;
}): void => {
    if (!image.isPresent || image.platform !== platform.value) {
        throw new Error(
            [
                'Docker image platform does not match the run platform:',
                `  - Image: ${ref}`,
                `  - Run platform: ${platform.value}`,
                `  - Image platform: ${describeLocalImagePlatform(image)}`,
                ...(image.isPresent && image.probeError ? [`  - Error: ${image.probeError}`] : []),
                ...(mismatchHint ? [mismatchHint] : []),
            ].join('\n'),
        );
    }

    console.info(`✅ Using Docker image ${ref} (${platform.value})`);
};

const noImageForPlatformError = ({
    imageUri,
    platform,
    registryPlatforms,
}: {
    imageUri: string;
    platform: DockerPlatform;
    registryPlatforms: readonly RegistryImagePlatform[];
}): Error =>
    new Error(
        [
            'The registry has no Docker image for the run platform:',
            `  - Image: ${imageUri}`,
            `  - Run platform: ${platform.value}`,
            `  - Registry platforms: ${uniq(registryPlatforms.map((entry) => entry.platform)).join(', ') || 'none'}`,
        ].join('\n'),
    );

const registryTagPullError = async ({
    imageUri,
    platform,
    stderr,
    docker,
}: {
    imageUri: string;
    platform: DockerPlatform;
    stderr: string;
    docker: DockerCommandRunner;
}): Promise<Error> => {
    if (isDockerRegistryAuthError(stderr)) {
        return dockerImageNotAvailableError({ imageUri, failure: 'pull failed', stderr });
    }

    let registryPlatforms: RegistryImagePlatform[];
    try {
        registryPlatforms = await readRegistryImagePlatforms(imageUri, docker);
    } catch (error) {
        return dockerImageNotAvailableError({
            imageUri,
            failure: 'pull failed',
            stderr,
            cause: error,
        });
    }

    return registryPlatforms.some((entry) => entry.platform === platform.value)
        ? dockerImageNotAvailableError({ imageUri, failure: 'pull failed', stderr })
        : noImageForPlatformError({ imageUri, platform, registryPlatforms });
};

const createPlatformTag = async ({
    imageUri,
    platformTag,
    platform,
    docker,
}: {
    imageUri: string;
    platformTag: string;
    platform: DockerPlatform;
    docker: DockerCommandRunner;
}): Promise<void> => {
    console.info(
        `🔎 No local ${platform.value} image for ${imageUri}; reading the registry image index.`,
    );
    const registryPlatforms = await readRegistryImagePlatforms(imageUri, docker);
    const manifest = registryPlatforms.find((entry) => entry.platform === platform.value);

    if (!manifest) {
        throw noImageForPlatformError({ imageUri, platform, registryPlatforms });
    }

    const digestReference = toDigestReference(imageUri, manifest.digest);
    console.info(`📥 Pulling Docker image from: ${digestReference} (platform: ${platform.value})`);
    const pull = await docker(['pull', '--platform', platform.value, digestReference], {
        isQuiet: false,
    });

    if (pull.exitCode !== 0) {
        throw dockerImageNotAvailableError({
            imageUri: digestReference,
            failure: 'pull failed',
            stderr: pull.stderr,
        });
    }

    const tag = await docker(['tag', digestReference, platformTag]);

    if (tag.exitCode !== 0) {
        throw new Error(
            [
                'Failed to create the local platform tag:',
                `  - Image: ${digestReference}`,
                `  - Tag: ${platformTag}`,
                `  - Error: ${tag.stderr.trim()}`,
            ].join('\n'),
        );
    }

    console.info(`🏷️  Tagged ${digestReference} as ${platformTag}`);
};

const ensurePlatformTagImage = async ({
    imageUri,
    platform,
    docker,
    readLocalImage,
}: {
    imageUri: string;
    platform: DockerPlatform;
    docker: DockerCommandRunner;
    readLocalImage: LocalDockerImageReader;
}): Promise<string> => {
    const platformTag = toPlatformTag(imageUri, platform);
    const removeCommand = `docker image rm ${platformTag}`;
    const stampPath = dockerPlatformProbeStampPath(platformTag, platform.value);
    const cachedImage = await readLocalImage(platformTag);

    if (cachedImage.isPresent) {
        assertAndReportRunPlatform({
            ref: platformTag,
            platform,
            image: cachedImage,
            mismatchHint: `  - Remove the platform tag, then run again: ${removeCommand}`,
        });
        if (cachedImage.hasPassedPlatformProbe) {
            await writeDockerPlatformProbeStamp(stampPath);
        }
        return platformTag;
    }

    await createPlatformTag({ imageUri, platformTag, platform, docker });
    await clearDockerPlatformProbeStamp(stampPath);

    try {
        const createdImage = await readLocalImage(platformTag);
        assertAndReportRunPlatform({ ref: platformTag, platform, image: createdImage });
        if (createdImage.isPresent && createdImage.hasPassedPlatformProbe) {
            await writeDockerPlatformProbeStamp(stampPath);
        }
    } catch (error) {
        const removal = await docker(['image', 'rm', platformTag]);
        if (removal.exitCode !== 0) {
            console.warn(
                `⚠️  Failed to remove the platform tag ${platformTag}: ${removal.stderr.trim()}. Run: ${removeCommand}`,
            );
        }
        await clearDockerPlatformProbeStamp(stampPath);
        throw error;
    }

    return platformTag;
};

export interface DockerImageSelectionOptions {
    imageUri: string;
    platform?: DockerPlatform;
    pinnedPlatform?: DockerPlatform;
    docker: DockerCommandRunner;
    engine?: DockerEngine;
}

export const ensureDockerImage = async ({
    imageUri,
    platform,
    pinnedPlatform,
    docker,
    engine,
}: DockerImageSelectionOptions): Promise<string> => {
    const probeDockerPlatformContainerCreation = async (
        expectedPlatform: DockerPlatform,
    ): Promise<void> => {
        const container = await docker([
            'container',
            'create',
            '--platform',
            expectedPlatform.value,
            imageUri,
            'true',
        ]);

        if (container.exitCode !== 0) {
            throw new Error(
                [
                    'Failed to create Docker platform probe container:',
                    `  - Image: ${imageUri}`,
                    `  - Platform: ${expectedPlatform.value}`,
                    `  - Error: ${container.stderr.trim()}`,
                ].join('\n'),
            );
        }

        const containerId = container.stdout.trim();
        if (!containerId) {
            throw new Error(
                [
                    'Docker platform probe did not return a container id:',
                    `  - Image: ${imageUri}`,
                    `  - Platform: ${expectedPlatform.value}`,
                ].join('\n'),
            );
        }

        await removeProbeContainer(containerId, docker);
    };

    const probeAndStampDockerPlatform = async (
        expectedPlatform: DockerPlatform,
        image: LocalDockerImage,
    ): Promise<void> => {
        const stampPath = dockerPlatformProbeStampPath(imageUri, expectedPlatform.value);
        if (await hasDockerPlatformProbeStamp(stampPath)) {
            console.info(
                `✅ Reusing Docker platform probe for ${imageUri} (${expectedPlatform.value})`,
            );
            return;
        }

        if (!image.isPresent || !image.hasPassedPlatformProbe) {
            await probeDockerPlatformContainerCreation(expectedPlatform);
        }
        await writeDockerPlatformProbeStamp(stampPath);
    };

    if (platform) {
        const apiVersion = engine?.apiVersion ?? (await readDockerApiVersion(docker));
        const canInspectPlatform = supportsDockerPlatformInspect(apiVersion);
        const readLocalImage: LocalDockerImageReader = (ref) =>
            readLocalDockerImage({ ref, platform, docker, canInspectPlatform });

        if (pinnedPlatform && pinnedPlatform.value !== platform.value) {
            return ensurePlatformTagImage({ imageUri, platform, docker, readLocalImage });
        }

        const registryImage = await readLocalImage(imageUri);
        const isRegistryImageOnRunPlatform =
            registryImage.isPresent && registryImage.platform === platform.value;

        if (!pinnedPlatform && !isRegistryImageOnRunPlatform) {
            return ensurePlatformTagImage({ imageUri, platform, docker, readLocalImage });
        }

        if (isRegistryImageOnRunPlatform) {
            await probeAndStampDockerPlatform(platform, registryImage);
            assertAndReportRunPlatform({ ref: imageUri, platform, image: registryImage });
            return imageUri;
        }

        if (registryImage.isPresent) {
            console.info(
                `🔄 Cached Docker image does not include the requested platform (${platform.value}); re-pulling.`,
            );
        }

        console.info(`📥 Pulling Docker image from: ${imageUri} (platform: ${platform.value})`);
        const output = await docker(['pull', '--platform', platform.value, imageUri], {
            isQuiet: false,
        });

        if (output.exitCode !== 0) {
            throw await registryTagPullError({ imageUri, platform, stderr: output.stderr, docker });
        }

        await clearDockerPlatformProbeStamp(dockerPlatformProbeStampPath(imageUri, platform.value));
        const pulledImage = await readLocalImage(imageUri);
        assertAndReportRunPlatform({ ref: imageUri, platform, image: pulledImage });
        await probeAndStampDockerPlatform(platform, pulledImage);
        console.info(`✅ Successfully pulled: ${imageUri}`);
        return imageUri;
    }

    const localImage = await docker([
        'image',
        'inspect',
        '--format',
        MINIMAL_LOCAL_IMAGE_INSPECT_FORMAT,
        imageUri,
    ]);
    if (localImage.exitCode === 0) {
        const cachedArch = localImage.stdout.trim();
        console.info(
            `✅ Using cached Docker image: ${imageUri}${cachedArch ? ` (${cachedArch})` : ''}`,
        );
        return imageUri;
    }

    console.info(`📥 Pulling Docker image from: ${imageUri}`);
    const output = await docker(['pull', imageUri], { isQuiet: false });

    if (output.exitCode !== 0) {
        throw dockerImageNotAvailableError({
            imageUri,
            failure: 'pull failed',
            stderr: output.stderr,
        });
    }

    console.info(`✅ Successfully pulled: ${imageUri}`);
    return imageUri;
};
