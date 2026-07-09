import { execFile, spawn } from 'node:child_process';
import { promisify } from 'node:util';

import type { ToolCommandExecutionOptions } from '@layerzerolabs/vm-tooling';

const execFileAsync = promisify(execFile);

// The self-contained source is mounted here and built in place. The official image's WORKDIR is
// already /source; we set it explicitly for clarity.
const SOURCE_MOUNT = '/source';

// Canonical reproducible platform. External verifiers reproduce the amd64 artifact, so we always
// run the amd64 image regardless of the host arch (the daemon emulates it when needed).
const VERIFIABLE_BUILD_PLATFORM = 'linux/amd64';

const OFFICIAL_IMAGE_REPO = 'stellar/stellar-cli';

/**
 * The official reproducible image reference for a (Stellar CLI, Rust) version pair, e.g.
 * `stellar/stellar-cli:25.1.0-rust1.90.0-slim-bookworm`. The caller pins both versions; this is the
 * only image the tool builds against.
 */
export const officialImageTagRef = (stellarVersion: string, rustVersion: string): string =>
    `${OFFICIAL_IMAGE_REPO}:${stellarVersion}-rust${rustVersion}-slim-bookworm`;

/**
 * Pick the linux/amd64 manifest digest out of `docker manifest inspect` output. Pure/synchronous so
 * the selection (skip the arm64 and the unknown/unknown attestation entries) is unit-testable.
 */
// The subset of `docker manifest inspect` output (an OCI image index) that we read.
interface ManifestDescriptor {
    digest?: string;
    platform?: { os?: string; architecture?: string };
}
interface ManifestIndex {
    manifests?: ManifestDescriptor[];
}

export const parseAmd64Digest = (manifestInspectJson: string): string => {
    const { manifests } = JSON.parse(manifestInspectJson) as ManifestIndex;

    if (!Array.isArray(manifests)) {
        throw new Error(
            '`docker manifest inspect` did not return a multi-arch index (no `manifests` array)',
        );
    }

    const digest = manifests.find(
        ({ platform }) => platform?.os === 'linux' && platform?.architecture === 'amd64',
    )?.digest;

    if (typeof digest !== 'string' || !digest.startsWith('sha256:')) {
        throw new Error('No linux/amd64 manifest digest found in `docker manifest inspect` output');
    }

    return digest;
};

/**
 * Resolve the immutable linux/amd64 digest of a `stellar/stellar-cli` tag via a daemon-less
 * registry query (`docker manifest inspect`). This is the reproducible reference an external
 * verifier pins to (SEP-58).
 */
const resolveAmd64Digest = async (imageTagRef: string): Promise<string> => {
    try {
        const { stdout } = await execFileAsync('docker', ['manifest', 'inspect', imageTagRef], {
            maxBuffer: 16 * 1024 * 1024,
        });
        return parseAmd64Digest(stdout);
    } catch (cause) {
        throw new Error(
            `Failed to resolve the linux/amd64 digest of ${imageTagRef} (\`docker manifest inspect\`)`,
            { cause },
        );
    }
};

/**
 * Assemble the `docker run` argv for a verifiable build. Kept pure and synchronous so the mount /
 * workdir layout and the tool-injected `--meta bldimg=…` are unit-testable without Docker.
 *
 * The official image's ENTRYPOINT is `stellar`, so the trailing `contract build …` runs under it.
 * The source directory is assumed self-contained, so it is mounted at /source and built in place —
 * no surrounding workspace is required.
 */
export const buildVerifiableBuildDockerArgs = ({
    imageRef,
    sourceDir,
    buildArgs,
    bldimg,
}: {
    imageRef: string;
    sourceDir: string;
    buildArgs: string[];
    bldimg: string;
}): string[] => [
    'run',
    '--rm',
    '--platform',
    VERIFIABLE_BUILD_PLATFORM,
    '-v',
    `${sourceDir}:${SOURCE_MOUNT}`,
    '-w',
    SOURCE_MOUNT,
    imageRef,
    'contract',
    'build',
    ...buildArgs,
    // Embedded by us (not the user): the exact build image, so the WASM records what produced it.
    '--meta',
    `bldimg=${bldimg}`,
];

const runDocker = (dockerArgs: string[]): Promise<void> =>
    new Promise((resolve, reject) => {
        const child = spawn('docker', dockerArgs, { stdio: 'inherit' });
        child.on('error', (error) =>
            reject(new Error('Failed to spawn docker for the verifiable build', { cause: error })),
        );
        child.on('close', (code, signal) => {
            if (code === 0) {
                resolve();
            } else {
                reject(
                    new Error(
                        `Verifiable build failed: docker exited with ${
                            signal ? `signal ${signal}` : `code ${code}`
                        }`,
                    ),
                );
            }
        });
    });

export interface VerifiableBuildVersions {
    stellarVersion: string;
    rustVersion: string;
}

/**
 * Reproducible `stellar contract build` that runs inside the OFFICIAL `stellar/stellar-cli` image —
 * the exact package an external verifier uses — instead of our own dev image (whose sccache/mold
 * layers could change the WASM).
 *
 * The build runs the official image directly from the HOST: our TypeScript CLI already executes on
 * the host runner, so it can `docker run` the official image itself. This is what an external
 * verifier's plain `docker run` does, and it means we never bind-mount the host Docker socket into
 * a container — eliminating the container-escape / secret-leak surface that mounting the socket
 * would create.
 *
 * The image is `stellar/stellar-cli:<stellarVersion>-rust<rustVersion>-slim-bookworm`, pinned by the
 * caller. For a stable reference we resolve it to its linux/amd64 digest and both RUN that digest
 * and embed it as the `bldimg` WASM metadata (`docker.io/stellar/stellar-cli@sha256:…`) — the tool
 * does this automatically so callers never hand-inject `--meta bldimg=…`. The source directory (the
 * cwd, assumed self-contained) is mounted at /source and built in place, and the official image runs
 * as its own user/toolchain.
 */
export class VerifiableBuildWrapper {
    public async run(
        args: string[],
        { stellarVersion, rustVersion }: VerifiableBuildVersions,
        options: ToolCommandExecutionOptions,
    ): Promise<void> {
        const tagRef = officialImageTagRef(stellarVersion, rustVersion);
        const digest = await resolveAmd64Digest(tagRef);
        const imageRef = `${OFFICIAL_IMAGE_REPO}@${digest}`;
        const bldimg = `docker.io/${OFFICIAL_IMAGE_REPO}@${digest}`;

        const dockerArgs = buildVerifiableBuildDockerArgs({
            imageRef,
            sourceDir: options.cwd,
            buildArgs: args,
            bldimg,
        });

        console.info('🔒 Verifiable build (official stellar/stellar-cli image, run from host)');
        console.info(`   image:  ${imageRef} (${VERIFIABLE_BUILD_PLATFORM}, from tag ${tagRef})`);
        console.info(`   bldimg: ${bldimg}`);
        console.info(`   docker ${dockerArgs.join(' ')}`);

        await runDocker(dockerArgs);
    }
}
