import { unzipSync } from 'fflate';
import { execFile, spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import {
    chmod,
    copyFile,
    mkdir,
    mkdtemp,
    readdir,
    readFile,
    rename,
    rm,
    stat,
    writeFile,
} from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { promisify } from 'node:util';
import { parse } from 'toml';

import type { ToolCommandExecutionOptions } from '@layerzerolabs/vm-tooling';

const execFileAsync = promisify(execFile);

const SOURCE_ARCHIVE_NAME = 'contracts-source.zip';
const WASM_TARGET_DIR = path.join('target', 'wasm32v1-none', 'release');

// The self-contained source is mounted here and built in place. The official image's WORKDIR is
// already /source; we set it explicitly for clarity.
const SOURCE_MOUNT = '/source';

// Canonical reproducible platform. External verifiers reproduce the amd64 artifact, so we always
// run the amd64 image regardless of the host arch (the daemon emulates it when needed).
const VERIFIABLE_BUILD_PLATFORM = 'linux/amd64';

const OFFICIAL_IMAGE_REPO = 'stellar/stellar-cli';

const META_FLAG = '--meta';

interface RustToolchainToml {
    toolchain?: {
        channel?: string;
    };
}

// The subset of `docker manifest inspect` output (an OCI image index) that we read.
interface ManifestDescriptor {
    digest?: string;
    platform?: { os?: string; architecture?: string };
}
interface ManifestIndex {
    manifests?: ManifestDescriptor[];
}

export interface PackageSpec {
    packageName: string;
    manifestPath: string;
}

export interface VerifiableBuildVersions {
    stellarVersion: string;
    rustVersion: string;
}

export interface ResolvedVerifiableBuildImage {
    imageRef: string;
    bldimg: string;
    tagRef: string;
}

export interface RunVerifiableBuildFromArchiveOptions {
    archive: string;
    packages: PackageSpec[];
    outputDir: string;
    stellarVersion: string;
    rustVersion?: string;
}

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
            timeout: 30_000,
        });
        return parseAmd64Digest(stdout);
    } catch (cause) {
        throw new Error(
            `Failed to resolve the linux/amd64 digest of ${imageTagRef} (\`docker manifest inspect\`)`,
            { cause },
        );
    }
};

/** The `key` of a `key=value` meta entry (the whole string when there is no `=`). */
const metaKey = (entry: string): string => {
    const eq = entry.indexOf('=');
    return eq === -1 ? entry : entry.slice(0, eq);
};

/**
 * Canonicalize `stellar contract build` args so the embedded metadata order is stable.
 *
 * Soroban stores contract metadata as an ORDERED sequence, so the order of `--meta key=value`
 * flags changes the WASM bytes. To keep the build reproducible, every meta entry — the caller's
 * plus the tool-injected ones — is pulled out, merged, and re-emitted in sorted order.
 *
 * Injected keys (e.g. `bldimg`) are tool-controlled and RESERVED: any caller `--meta` reusing an
 * injected key is dropped.
 */
export const canonicalizeMetaArgs = (buildArgs: string[], injectedMeta: string[]): string[] => {
    const reservedKeys = new Set(injectedMeta.map(metaKey));
    const metas = [...injectedMeta];
    const passthrough: string[] = [];

    const addCallerMeta = (value: string): void => {
        if (!reservedKeys.has(metaKey(value))) metas.push(value);
    };

    for (let i = 0; i < buildArgs.length; i++) {
        const arg = buildArgs[i];
        if (arg === undefined) continue;
        if (arg === META_FLAG) {
            const value = buildArgs[i + 1];
            if (value !== undefined && !value.startsWith('--')) {
                addCallerMeta(value);
                i += 1;
            }
        } else if (arg.startsWith(`${META_FLAG}=`)) {
            addCallerMeta(arg.slice(META_FLAG.length + 1));
        } else {
            passthrough.push(arg);
        }
    }

    metas.sort();
    return [...passthrough, ...metas.flatMap((meta) => [META_FLAG, meta])];
};

/**
 * Assemble the `docker run` argv for a verifiable build. Kept pure and synchronous so the mount /
 * workdir layout and the tool-injected `--meta bldimg=…` are unit-testable without Docker.
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
    ...canonicalizeMetaArgs(buildArgs, [`bldimg=${bldimg}`]),
];

/**
 * Resolve the directory to build. An explicit `sourceDir` that is relative resolves against the
 * cwd; an absolute one is used as-is; omitting it falls back to the cwd.
 */
export const resolveBuildDir = (cwd: string, sourceDir?: string): string =>
    path.resolve(cwd, sourceDir ?? '.');

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

/**
 * Reproducible `stellar contract build` inside the official `stellar/stellar-cli` image.
 * Used by the archive orchestrator for each `--package`.
 */
export class VerifiableBuildWrapper {
    private readonly imagesByTag = new Map<string, Promise<ResolvedVerifiableBuildImage>>();

    public constructor(
        private readonly resolveDigest: (
            imageTagRef: string,
        ) => Promise<string> = resolveAmd64Digest,
    ) {}

    public resolveImage({
        stellarVersion,
        rustVersion,
    }: VerifiableBuildVersions): Promise<ResolvedVerifiableBuildImage> {
        const tagRef = officialImageTagRef(stellarVersion, rustVersion);
        const existing = this.imagesByTag.get(tagRef);
        if (existing !== undefined) {
            return existing;
        }

        const resolved = this.resolveDigest(tagRef).then((digest) => ({
            imageRef: `${OFFICIAL_IMAGE_REPO}@${digest}`,
            bldimg: `docker.io/${OFFICIAL_IMAGE_REPO}@${digest}`,
            tagRef,
        }));
        this.imagesByTag.set(tagRef, resolved);
        return resolved;
    }

    public async run(
        args: string[],
        versions: VerifiableBuildVersions,
        { cwd }: Pick<ToolCommandExecutionOptions, 'cwd'>,
        sourceDir?: string,
    ): Promise<void> {
        const buildDir = resolveBuildDir(cwd, sourceDir);
        try {
            if (!(await stat(buildDir)).isDirectory()) {
                throw new Error('not a directory');
            }
        } catch (cause) {
            throw new Error(
                `Verifiable build source directory is not an existing directory: ${buildDir}`,
                { cause },
            );
        }

        // The official stellar-cli image runs as a non-host UID and must create cargo target
        // dirs under the bind-mounted source. Do not pass --user (that would diverge from what
        // external verifiers run). Only chmod when a sourceDir is passed (typically a
        // throwaway extract dir); never world-write the process cwd.
        if (sourceDir !== undefined) {
            await chmod(buildDir, 0o777);
        }

        const { imageRef, bldimg, tagRef } = await this.resolveImage(versions);

        const dockerArgs = buildVerifiableBuildDockerArgs({
            imageRef,
            sourceDir: buildDir,
            buildArgs: args,
            bldimg,
        });

        console.info('🔒 Verifiable build (official stellar/stellar-cli image, run from host)');
        console.info(`   source: ${buildDir}`);
        console.info(`   image:  ${imageRef} (${VERIFIABLE_BUILD_PLATFORM}, from tag ${tagRef})`);
        console.info(`   bldimg: ${bldimg}`);
        console.info(`   docker ${dockerArgs.join(' ')}`);

        await runDocker(dockerArgs);
    }
}

/**
 * Parse a `--package <name>:<manifest-path>` pair. Both sides must be non-empty.
 */
export const parsePackageSpec = (spec: string): PackageSpec => {
    const colon = spec.indexOf(':');
    if (colon <= 0 || colon === spec.length - 1) {
        throw new Error(
            `Invalid --package spec ${JSON.stringify(spec)}: expected <name>:<manifest-path>`,
        );
    }

    return {
        packageName: spec.slice(0, colon),
        manifestPath: spec.slice(colon + 1),
    };
};

/** Soroban wasm artifact basename: hyphens in the package name become underscores. */
export const wasmArtifactName = (packageName: string): string =>
    `${packageName.replaceAll('-', '_')}.wasm`;

const validatePackageSpecs = (packages: PackageSpec[]): void => {
    const artifactNames = new Set<string>();
    for (const { packageName } of packages) {
        const artifactName = wasmArtifactName(packageName);
        if (artifactNames.has(artifactName)) {
            throw new Error(`Duplicate WASM artifact ${artifactName} from --package options`);
        }
        artifactNames.add(artifactName);
    }
};

/**
 * Resolve the Rust toolchain version for the verifiable build image tag. An explicit
 * `--rust-version` wins; otherwise read the pinned channel from the supplied source directory.
 */
export const resolveRustVersion = async (
    sourceDir: string,
    rustVersionFlag?: string,
): Promise<string> => {
    if (rustVersionFlag !== undefined) {
        return rustVersionFlag;
    }

    const toolchainPath = path.join(sourceDir, 'rust-toolchain.toml');
    let contents: string;
    try {
        contents = await readFile(toolchainPath, 'utf-8');
    } catch (cause) {
        if ((cause as { code?: string }).code === 'ENOENT') {
            throw new Error(
                `Missing rust-toolchain.toml in ${sourceDir} and no --rust-version was provided`,
                { cause },
            );
        }
        throw cause;
    }

    const parsed = parse(contents) as RustToolchainToml;
    const channel = parsed.toolchain?.channel;
    if (typeof channel !== 'string' || channel.length === 0) {
        throw new Error(`Missing 'toolchain.channel' in ${toolchainPath}`);
    }

    return channel;
};

/**
 * Build `stellar contract build` args for one archive package. Embeds SEP-58 `source_sha256`
 * and replays the build flags as `bldopt=` metas so external verifiers can reproduce the build.
 * `bldimg` is injected separately by the official-image runner.
 */
export const buildArchiveContractArgs = (
    { packageName, manifestPath }: PackageSpec,
    sourceSha256: string,
): string[] => [
    '--manifest-path',
    manifestPath,
    '--package',
    packageName,
    '--optimize',
    '--meta',
    `bldopt=--manifest-path=${manifestPath}`,
    '--meta',
    `bldopt=--package=${packageName}`,
    '--meta',
    'bldopt=--optimize',
    '--meta',
    `source_sha256=${sourceSha256}`,
];

const pathExists = async (filePath: string): Promise<boolean> => {
    try {
        await stat(filePath);
        return true;
    } catch (error) {
        if ((error as { code?: string }).code === 'ENOENT') {
            return false;
        }
        throw error;
    }
};

const readArchiveBytes = async (archive: string): Promise<Uint8Array> => {
    let bytes: Uint8Array;
    try {
        bytes = new Uint8Array(await readFile(archive));
    } catch (cause) {
        throw new Error(`Archive not found or unreadable: ${archive}`, { cause });
    }

    if (bytes.length === 0) {
        throw new Error(`Archive is empty: ${archive}`);
    }

    return bytes;
};

const extractZip = async (
    bytes: Uint8Array,
    destDir: string,
    expectedRootDirName: string,
): Promise<void> => {
    const files = unzipSync(bytes);
    const destRoot = path.resolve(destDir);
    const expectedRoot = path.join(destRoot, expectedRootDirName);
    const expectedRootPrefix = `${expectedRootDirName}/`;

    for (const [relPath, content] of Object.entries(files)) {
        const outPath = path.resolve(destRoot, relPath);
        if (outPath !== destRoot && !outPath.startsWith(destRoot + path.sep)) {
            throw new Error(`Zip entry escapes destination: ${relPath}`);
        }
        if (outPath !== expectedRoot && !outPath.startsWith(expectedRoot + path.sep)) {
            throw new Error(
                `Zip entry is outside expected top-level ${expectedRootPrefix}: ${relPath}`,
            );
        }
        if (relPath.endsWith('/')) continue;

        await mkdir(path.dirname(outPath), { recursive: true });
        await writeFile(outPath, content);
    }
};

const persistSourceArchive = async (
    archiveBytes: Uint8Array,
    stagingDir: string,
): Promise<void> => {
    await mkdir(stagingDir, { recursive: true });
    await writeFile(path.join(stagingDir, SOURCE_ARCHIVE_NAME), archiveBytes);
};

export const copyFileWithPermissionRepair = async (
    source: string,
    destination: string,
    repairPermissions: () => Promise<void>,
    copy: (source: string, destination: string) => Promise<void> = copyFile,
): Promise<void> => {
    try {
        await copy(source, destination);
    } catch (error) {
        const code = (error as { code?: string }).code;
        if (code !== 'EACCES' && code !== 'EPERM') {
            throw error;
        }

        await repairPermissions();
        await copy(source, destination);
    }
};

const persistWasm = async (
    buildRoot: string,
    stagingDir: string,
    { packageName }: PackageSpec,
    repairPermissions: () => Promise<void>,
): Promise<void> => {
    const wasmName = wasmArtifactName(packageName);
    const builtPath = path.join(buildRoot, WASM_TARGET_DIR, wasmName);
    if (!(await pathExists(builtPath))) {
        throw new Error(`Expected WASM not found after build: ${builtPath}`);
    }

    await mkdir(stagingDir, { recursive: true });
    await copyFileWithPermissionRepair(
        builtPath,
        path.join(stagingDir, wasmName),
        repairPermissions,
    );
};

/**
 * Atomically replace the output directory with the complete staged artifact set.
 * Mirrors protocol stellar's `.next-` / `.prev` swap so failed builds leave prior output intact.
 */
const publishArtifacts = async (stagingDir: string, outputDir: string): Promise<void> => {
    const parentDir = path.dirname(outputDir);
    const outputBase = path.basename(outputDir);
    await mkdir(parentDir, { recursive: true });

    const nextDir = await mkdtemp(path.join(parentDir, `${outputBase}.next-`));
    const backupDir = path.join(parentDir, `${outputBase}.prev`);
    const entries = await readdir(stagingDir);

    try {
        for (const entry of entries) {
            await copyFile(path.join(stagingDir, entry), path.join(nextDir, entry));
        }

        if (!(await pathExists(outputDir)) && (await pathExists(backupDir))) {
            await rename(backupDir, outputDir);
        } else if (await pathExists(backupDir)) {
            await rm(backupDir, { recursive: true, force: true });
        }

        if (await pathExists(outputDir)) {
            await rename(outputDir, backupDir);
        }
        await rename(nextDir, outputDir);
        await rm(backupDir, { recursive: true, force: true }).catch((error) => {
            console.warn(`Failed to remove leftover ${backupDir} after publish:`, error);
        });
    } catch (error) {
        await rm(nextDir, { recursive: true, force: true }).catch(() => undefined);
        if (!(await pathExists(outputDir)) && (await pathExists(backupDir))) {
            await rename(backupDir, outputDir).catch(() => undefined);
        }
        throw error;
    }
};

export const buildPermissionRepairDockerArgs = (dir: string, imageRef: string): string[] => [
    'run',
    '--rm',
    '--platform',
    VERIFIABLE_BUILD_PLATFORM,
    '--user',
    '0:0',
    '--entrypoint',
    'chmod',
    '-v',
    `${dir}:/cleanup`,
    imageRef,
    '-R',
    'a+rwX',
    '/cleanup',
];

const relaxDockerOwnedPermissions = (dir: string, imageRef: string): Promise<void> =>
    new Promise((resolve, reject) => {
        const child = spawn('docker', buildPermissionRepairDockerArgs(dir, imageRef), {
            stdio: 'inherit',
        });
        child.on('error', reject);
        child.on('close', (code) => {
            if (code === 0) {
                resolve();
            } else {
                reject(new Error(`Failed to chmod temp dir via docker (exit ${code ?? 1})`));
            }
        });
    });

const removeTempDir = async (
    tempDir: string,
    resolveImage?: () => Promise<ResolvedVerifiableBuildImage>,
): Promise<void> => {
    try {
        await rm(tempDir, { recursive: true, force: true });
    } catch (error) {
        const code = (error as { code?: string }).code;
        if (code !== 'EACCES' && code !== 'EPERM') {
            throw error;
        }
        if (resolveImage === undefined) {
            throw error;
        }

        const { imageRef } = await resolveImage();
        await relaxDockerOwnedPermissions(tempDir, imageRef);
        await rm(tempDir, { recursive: true, force: true });
    }
};

/**
 * Build one or more Stellar contracts from a self-contained source archive.
 *
 * `packages` is intentionally already parsed: the CLI owns string parsing, while this orchestrator
 * deals only in validated package/manifest pairs.
 */
export const runVerifiableBuildFromArchive = async (
    {
        archive,
        packages,
        outputDir,
        stellarVersion,
        rustVersion,
    }: RunVerifiableBuildFromArchiveOptions,
    { cwd }: Pick<ToolCommandExecutionOptions, 'cwd'>,
): Promise<void> => {
    if (packages.length === 0) {
        throw new Error('verifiable-build requires at least one --package <name>:<manifest-path>');
    }
    validatePackageSpecs(packages);

    const archiveBytes = await readArchiveBytes(archive);
    const sourceSha256 = createHash('sha256').update(archiveBytes).digest('hex');
    const tempDir = await mkdtemp(path.join(tmpdir(), 'stellar-verifiable-build-'));
    const extractionDir = path.join(tempDir, 'source');
    const stagingDir = path.join(tempDir, 'staging');
    let versions: VerifiableBuildVersions | undefined;
    const wrapper = new VerifiableBuildWrapper();

    try {
        const rootDirName = path.basename(cwd);
        await extractZip(archiveBytes, extractionDir, rootDirName);

        const buildRoot = path.join(extractionDir, rootDirName);
        if (!(await pathExists(buildRoot)) || !(await stat(buildRoot)).isDirectory()) {
            throw new Error(
                `Expected top-level ${rootDirName}/ directory not found after extraction`,
            );
        }

        versions = {
            stellarVersion,
            rustVersion: await resolveRustVersion(buildRoot, rustVersion),
        };
        await persistSourceArchive(archiveBytes, stagingDir);

        for (const packageSpec of packages) {
            await wrapper.run(
                buildArchiveContractArgs(packageSpec, sourceSha256),
                versions,
                { cwd },
                buildRoot,
            );
            await persistWasm(buildRoot, stagingDir, packageSpec, async () => {
                const { imageRef } = await wrapper.resolveImage(versions!);
                await relaxDockerOwnedPermissions(buildRoot, imageRef);
            });
        }

        await publishArtifacts(stagingDir, outputDir);
    } finally {
        await removeTempDir(
            tempDir,
            versions === undefined ? undefined : () => wrapper.resolveImage(versions!),
        ).catch((error) => {
            console.warn(`Temp dir cleanup failed (build result unchanged): ${tempDir}`, error);
        });
    }
};
