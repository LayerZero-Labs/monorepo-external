import { zipSync } from 'fflate';
import { createHash } from 'node:crypto';
import { mkdir, mkdtemp, readFile, rm, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';

import {
    buildArchiveContractArgs,
    buildPermissionRepairDockerArgs,
    buildVerifiableBuildDockerArgs,
    canonicalizeMetaArgs,
    copyFileWithPermissionRepair,
    officialImageTagRef,
    parseAmd64Digest,
    parsePackageSpec,
    resolveBuildDir,
    resolveRustVersion,
    runVerifiableBuildFromArchive,
    VerifiableBuildWrapper,
    wasmArtifactName,
} from '../src/commands/verifiable-build';

const AMD64_DIGEST = 'sha256:dd2ec7b637194a357eff45f696ff3e077a5d1070c3bf923fcacd54af5c6d2b4f';

// Shape of `docker manifest inspect <multi-arch tag>`: amd64 + arm64 plus the two unknown/unknown
// attestation entries that must be ignored.
const MANIFEST_INSPECT_JSON = JSON.stringify({
    schemaVersion: 2,
    mediaType: 'application/vnd.oci.image.index.v1+json',
    manifests: [
        { digest: AMD64_DIGEST, platform: { architecture: 'amd64', os: 'linux' } },
        { digest: 'sha256:aaaa', platform: { architecture: 'arm64', os: 'linux' } },
        { digest: 'sha256:bbbb', platform: { architecture: 'unknown', os: 'unknown' } },
        { digest: 'sha256:cccc', platform: { architecture: 'unknown', os: 'unknown' } },
    ],
});

const makeArchive = (entries: Record<string, string>): Uint8Array =>
    zipSync(
        Object.fromEntries(
            Object.entries(entries).map(([name, content]) => [
                name,
                new TextEncoder().encode(content),
            ]),
        ),
    );

const withTempDir = async (fn: (dir: string) => Promise<void>): Promise<void> => {
    const dir = await mkdtemp(path.join(tmpdir(), 'lz-vb-test-'));
    try {
        await fn(dir);
    } finally {
        await rm(dir, { recursive: true, force: true });
    }
};

describe('officialImageTagRef', () => {
    it('builds the <stellar>-rust<rust>-slim-bookworm tag from the pinned versions', () => {
        expect(officialImageTagRef('25.1.0', '1.90.0')).toBe(
            'stellar/stellar-cli:25.1.0-rust1.90.0-slim-bookworm',
        );
    });
});

describe('parseAmd64Digest', () => {
    it('selects the linux/amd64 manifest digest', () => {
        expect(parseAmd64Digest(MANIFEST_INSPECT_JSON)).toBe(AMD64_DIGEST);
    });

    it('throws when there is no linux/amd64 manifest', () => {
        const json = JSON.stringify({
            manifests: [
                { digest: 'sha256:aaaa', platform: { architecture: 'arm64', os: 'linux' } },
            ],
        });
        expect(() => parseAmd64Digest(json)).toThrow(/No linux\/amd64 manifest digest/);
    });

    it('throws when the output is not a multi-arch index', () => {
        expect(() => parseAmd64Digest(JSON.stringify({ mediaType: 'single' }))).toThrow(
            /multi-arch index/,
        );
    });
});

describe('resolveBuildDir', () => {
    it('defaults to the cwd when no source dir is given', () => {
        expect(resolveBuildDir('/work/pkg')).toBe('/work/pkg');
    });

    it('resolves a relative source dir against the cwd', () => {
        expect(resolveBuildDir('/work/pkg', 'extracted')).toBe('/work/pkg/extracted');
        expect(resolveBuildDir('/work/pkg', './build/out')).toBe('/work/pkg/build/out');
    });

    it('uses an absolute source dir as-is', () => {
        expect(resolveBuildDir('/work/pkg', '/tmp/extracted-source')).toBe('/tmp/extracted-source');
    });
});

describe('canonicalizeMetaArgs', () => {
    it('sorts injected + user --meta entries and keeps non-meta args first', () => {
        expect(
            canonicalizeMetaArgs(
                ['--package', 'x', '--meta', 'zzz=1', '--optimize', '--meta', 'aaa=2'],
                ['bldimg=img'],
            ),
        ).toEqual([
            '--package',
            'x',
            '--optimize',
            '--meta',
            'aaa=2',
            '--meta',
            'bldimg=img',
            '--meta',
            'zzz=1',
        ]);
    });

    it('is independent of the order the --meta flags were passed', () => {
        const a = canonicalizeMetaArgs(['--meta', 'b=2', '--meta', 'a=1'], ['bldimg=img']);
        const b = canonicalizeMetaArgs(['--meta', 'a=1', '--meta', 'b=2'], ['bldimg=img']);
        expect(a).toEqual(b);
    });

    it('recognizes the --meta=k=v form', () => {
        expect(canonicalizeMetaArgs(['--meta=source_sha256=abc'], ['bldimg=img'])).toEqual([
            '--meta',
            'bldimg=img',
            '--meta',
            'source_sha256=abc',
        ]);
    });

    it('drops a dangling --meta with no value', () => {
        expect(canonicalizeMetaArgs(['--package', 'x', '--meta'], ['bldimg=img'])).toEqual([
            '--package',
            'x',
            '--meta',
            'bldimg=img',
        ]);
    });

    it('drops a --meta immediately followed by another flag', () => {
        expect(canonicalizeMetaArgs(['--meta', '--optimize'], ['bldimg=img'])).toEqual([
            '--optimize',
            '--meta',
            'bldimg=img',
        ]);
    });

    it('drops a caller --meta that collides with an injected (reserved) key', () => {
        expect(
            canonicalizeMetaArgs(
                ['--meta', 'bldimg=evil', '--meta', 'source_sha256=ok'],
                ['bldimg=real'],
            ),
        ).toEqual(['--meta', 'bldimg=real', '--meta', 'source_sha256=ok']);
    });

    it('drops a reserved-key collision in the --meta=k=v form too', () => {
        expect(canonicalizeMetaArgs(['--meta=bldimg=evil'], ['bldimg=real'])).toEqual([
            '--meta',
            'bldimg=real',
        ]);
    });
});

describe('buildVerifiableBuildDockerArgs', () => {
    const imageRef = `stellar/stellar-cli@${AMD64_DIGEST}`;
    const bldimg = `docker.io/stellar/stellar-cli@${AMD64_DIGEST}`;

    it('mounts the self-contained source at /source and embeds the bldimg meta', () => {
        const args = buildVerifiableBuildDockerArgs({
            imageRef,
            sourceDir: '/tmp/extracted-source',
            buildArgs: ['--package', 'ethena-oft', '--optimize'],
            bldimg,
        });

        expect(args).toEqual([
            'run',
            '--rm',
            '--platform',
            'linux/amd64',
            '-v',
            '/tmp/extracted-source:/source',
            '-w',
            '/source',
            imageRef,
            'contract',
            'build',
            '--package',
            'ethena-oft',
            '--optimize',
            '--meta',
            `bldimg=${bldimg}`,
        ]);
    });

    it('runs the image by digest and always appends the tool-injected bldimg meta', () => {
        const args = buildVerifiableBuildDockerArgs({
            imageRef,
            sourceDir: '/src',
            buildArgs: [],
            bldimg,
        });

        expect(args).toContain(imageRef);
        expect(imageRef).toContain('@sha256:');
        expect(args.slice(-2)).toEqual(['--meta', `bldimg=${bldimg}`]);
    });

    it('sorts the caller --meta flags together with the injected bldimg meta', () => {
        const args = buildVerifiableBuildDockerArgs({
            imageRef,
            sourceDir: '/src',
            buildArgs: ['--package', 'p', '--meta', 'source_sha256=zzz'],
            bldimg,
        });

        expect(args.slice(args.indexOf('build') + 1)).toEqual([
            '--package',
            'p',
            '--meta',
            `bldimg=${bldimg}`,
            '--meta',
            'source_sha256=zzz',
        ]);
    });
});

describe('buildPermissionRepairDockerArgs', () => {
    it('uses the same pinned amd64 image as the verifiable build', () => {
        const imageRef = `stellar/stellar-cli@${AMD64_DIGEST}`;

        expect(buildPermissionRepairDockerArgs('/tmp/source', imageRef)).toEqual([
            'run',
            '--rm',
            '--platform',
            'linux/amd64',
            '--user',
            '0:0',
            '--entrypoint',
            'chmod',
            '-v',
            '/tmp/source:/cleanup',
            imageRef,
            '-R',
            'a+rwX',
            '/cleanup',
        ]);
    });
});

describe('copyFileWithPermissionRepair', () => {
    it('repairs Docker-owned permissions and retries the copy', async () => {
        const permissionError = Object.assign(new Error('permission denied'), { code: 'EACCES' });
        const copy = vi
            .fn()
            .mockRejectedValueOnce(permissionError)
            .mockResolvedValueOnce(undefined);
        const repairPermissions = vi.fn().mockResolvedValue(undefined);

        await copyFileWithPermissionRepair(
            '/tmp/source.wasm',
            '/tmp/staging.wasm',
            repairPermissions,
            copy,
        );

        expect(repairPermissions).toHaveBeenCalledOnce();
        expect(copy).toHaveBeenCalledTimes(2);
    });

    it('does not mask non-permission copy failures', async () => {
        const copyError = Object.assign(new Error('disk failure'), { code: 'EIO' });
        const copy = vi.fn().mockRejectedValue(copyError);
        const repairPermissions = vi.fn().mockResolvedValue(undefined);

        await expect(
            copyFileWithPermissionRepair(
                '/tmp/source.wasm',
                '/tmp/staging.wasm',
                repairPermissions,
                copy,
            ),
        ).rejects.toBe(copyError);
        expect(repairPermissions).not.toHaveBeenCalled();
    });
});

describe('VerifiableBuildWrapper image resolution', () => {
    it('resolves one digest per version pair', async () => {
        const resolveDigest = vi.fn().mockResolvedValue(AMD64_DIGEST);
        const wrapper = new VerifiableBuildWrapper(resolveDigest);
        const versions = { stellarVersion: '25.1.0', rustVersion: '1.90.0' };

        const expectedTagRef = officialImageTagRef('25.1.0', '1.90.0');
        await expect(wrapper.resolveImage(versions)).resolves.toEqual({
            imageRef: `stellar/stellar-cli@${AMD64_DIGEST}`,
            bldimg: `docker.io/stellar/stellar-cli@${AMD64_DIGEST}`,
            tagRef: expectedTagRef,
        });
        await expect(wrapper.resolveImage(versions)).resolves.toEqual({
            imageRef: `stellar/stellar-cli@${AMD64_DIGEST}`,
            bldimg: `docker.io/stellar/stellar-cli@${AMD64_DIGEST}`,
            tagRef: expectedTagRef,
        });
        expect(resolveDigest).toHaveBeenCalledOnce();
    });
});

describe('parsePackageSpec', () => {
    it('parses a root manifest spec', () => {
        expect(parsePackageSpec('onesig:Cargo.toml')).toEqual({
            packageName: 'onesig',
            manifestPath: 'Cargo.toml',
        });
    });

    it('parses a nested manifest spec', () => {
        expect(parsePackageSpec('endpoint-v2:endpoint-v2/Cargo.toml')).toEqual({
            packageName: 'endpoint-v2',
            manifestPath: 'endpoint-v2/Cargo.toml',
        });
    });

    it.each(['onesig', ':Cargo.toml', 'onesig:', ''])('rejects invalid spec %j', (spec) => {
        expect(() => parsePackageSpec(spec)).toThrow();
    });
});

describe('wasmArtifactName', () => {
    it('hyphenates package names into wasm basenames', () => {
        expect(wasmArtifactName('endpoint-v2')).toBe('endpoint_v2.wasm');
        expect(wasmArtifactName('onesig')).toBe('onesig.wasm');
    });
});

describe('resolveRustVersion', () => {
    it('prefers the explicit flag over rust-toolchain.toml', async () => {
        const sourceDir = await mkdtemp(path.join(tmpdir(), 'lz-vb-rust-'));
        try {
            await writeFile(
                path.join(sourceDir, 'rust-toolchain.toml'),
                '[toolchain]\nchannel = "1.90.0"\n',
            );
            await expect(resolveRustVersion(sourceDir, '1.88.0')).resolves.toBe('1.88.0');
        } finally {
            await rm(sourceDir, { recursive: true, force: true });
        }
    });

    it('reads the channel from rust-toolchain.toml when the flag is omitted', async () => {
        const sourceDir = await mkdtemp(path.join(tmpdir(), 'lz-vb-rust-'));
        try {
            await writeFile(
                path.join(sourceDir, 'rust-toolchain.toml'),
                '[toolchain]\nchannel = "1.90.0"\n',
            );
            await expect(resolveRustVersion(sourceDir)).resolves.toBe('1.90.0');
        } finally {
            await rm(sourceDir, { recursive: true, force: true });
        }
    });

    it('throws when neither a flag nor rust-toolchain.toml is available', async () => {
        const sourceDir = await mkdtemp(path.join(tmpdir(), 'lz-vb-rust-'));
        try {
            await mkdir(sourceDir, { recursive: true });
            await expect(resolveRustVersion(sourceDir)).rejects.toThrow(/rust-toolchain\.toml/);
        } finally {
            await rm(sourceDir, { recursive: true, force: true });
        }
    });

    it('throws when toolchain.channel is empty', async () => {
        const sourceDir = await mkdtemp(path.join(tmpdir(), 'lz-vb-rust-'));
        try {
            await writeFile(
                path.join(sourceDir, 'rust-toolchain.toml'),
                '[toolchain]\nchannel = ""\n',
            );
            await expect(resolveRustVersion(sourceDir)).rejects.toThrow(/toolchain\.channel/);
        } finally {
            await rm(sourceDir, { recursive: true, force: true });
        }
    });
});

describe('buildArchiveContractArgs', () => {
    it('builds stellar contract build args with bldopt replay and source_sha256', () => {
        const spec = { packageName: 'endpoint-v2', manifestPath: 'endpoint-v2/Cargo.toml' };
        const sha = 'abc123';

        expect(buildArchiveContractArgs(spec, sha)).toEqual([
            '--manifest-path',
            'endpoint-v2/Cargo.toml',
            '--package',
            'endpoint-v2',
            '--optimize',
            '--meta',
            'bldopt=--manifest-path=endpoint-v2/Cargo.toml',
            '--meta',
            'bldopt=--package=endpoint-v2',
            '--meta',
            'bldopt=--optimize',
            '--meta',
            'source_sha256=abc123',
        ]);
    });
});

describe.sequential('runVerifiableBuildFromArchive', () => {
    afterEach(() => {
        vi.restoreAllMocks();
    });

    it('requires at least one package', async () => {
        await expect(
            runVerifiableBuildFromArchive(
                {
                    archive: '/tmp/missing.zip',
                    packages: [],
                    outputDir: '/tmp/out',
                    stellarVersion: '25.1.0',
                    rustVersion: '1.90.0',
                },
                { cwd: '/tmp/project' },
            ),
        ).rejects.toThrow('verifiable-build requires at least one --package');
    });

    it('rejects package names that map to the same WASM artifact', async () => {
        await expect(
            runVerifiableBuildFromArchive(
                {
                    archive: '/tmp/missing.zip',
                    packages: [
                        { packageName: 'duplicate-name', manifestPath: 'first/Cargo.toml' },
                        { packageName: 'duplicate_name', manifestPath: 'second/Cargo.toml' },
                    ],
                    outputDir: '/tmp/out',
                    stellarVersion: '25.1.0',
                    rustVersion: '1.90.0',
                },
                { cwd: '/tmp/project' },
            ),
        ).rejects.toThrow('Duplicate WASM artifact duplicate_name.wasm');
    });

    it('builds packages from an archive and atomically publishes source plus wasm artifacts', async () => {
        await withTempDir(async (dir) => {
            const cwd = path.join(dir, 'project');
            const outputDir = path.join(dir, 'artifacts');
            const archive = path.join(dir, 'contracts-source.zip');
            const archiveBytes = makeArchive({
                'project/Cargo.toml': '[workspace]\n',
                'project/rust-toolchain.toml': '[toolchain]\nchannel = "1.90.0"\n',
            });
            await mkdir(cwd, { recursive: true });
            await mkdir(outputDir, { recursive: true });
            await writeFile(path.join(outputDir, 'obsolete.wasm'), 'stale');
            await writeFile(archive, archiveBytes);

            const runSpy = vi
                .spyOn(VerifiableBuildWrapper.prototype, 'run')
                .mockImplementation(async (args, versions, options, sourceDir) => {
                    expect(args).toEqual(
                        buildArchiveContractArgs(
                            { packageName: 'onesig-contract', manifestPath: 'Cargo.toml' },
                            createHash('sha256').update(archiveBytes).digest('hex'),
                        ),
                    );
                    expect(versions).toEqual({ stellarVersion: '25.1.0', rustVersion: '1.90.0' });
                    expect(options).toEqual({ cwd });
                    expect(sourceDir).toBeDefined();
                    expect(path.basename(sourceDir!)).toBe('project');

                    const wasmPath = path.join(
                        sourceDir!,
                        'target/wasm32v1-none/release/onesig_contract.wasm',
                    );
                    await mkdir(path.dirname(wasmPath), { recursive: true });
                    await writeFile(wasmPath, 'wasm-bytes');
                });

            await runVerifiableBuildFromArchive(
                {
                    archive,
                    packages: [{ packageName: 'onesig-contract', manifestPath: 'Cargo.toml' }],
                    outputDir,
                    stellarVersion: '25.1.0',
                    rustVersion: '1.90.0',
                },
                { cwd },
            );

            expect(runSpy).toHaveBeenCalledTimes(1);
            await expect(readFile(path.join(outputDir, 'contracts-source.zip'))).resolves.toEqual(
                Buffer.from(archiveBytes),
            );
            await expect(
                readFile(path.join(outputDir, 'onesig_contract.wasm'), 'utf8'),
            ).resolves.toBe('wasm-bytes');
            await expect(readFile(path.join(outputDir, 'obsolete.wasm'))).rejects.toThrow();
        });
    });

    it('leaves existing output untouched when a package build fails', async () => {
        await withTempDir(async (dir) => {
            const cwd = path.join(dir, 'project');
            const outputDir = path.join(dir, 'artifacts');
            const archive = path.join(dir, 'contracts-source.zip');
            await mkdir(cwd, { recursive: true });
            await mkdir(outputDir, { recursive: true });
            await writeFile(path.join(outputDir, 'contracts-source.zip'), 'old-source');
            await writeFile(path.join(outputDir, 'onesig.wasm'), 'old-wasm');
            await writeFile(archive, makeArchive({ 'project/Cargo.toml': '[workspace]\n' }));
            vi.spyOn(VerifiableBuildWrapper.prototype, 'run').mockRejectedValue(
                new Error('docker failed'),
            );

            await expect(
                runVerifiableBuildFromArchive(
                    {
                        archive,
                        packages: [{ packageName: 'onesig', manifestPath: 'Cargo.toml' }],
                        outputDir,
                        stellarVersion: '25.1.0',
                        rustVersion: '1.90.0',
                    },
                    { cwd },
                ),
            ).rejects.toThrow('docker failed');

            await expect(
                readFile(path.join(outputDir, 'contracts-source.zip'), 'utf8'),
            ).resolves.toBe('old-source');
            await expect(readFile(path.join(outputDir, 'onesig.wasm'), 'utf8')).resolves.toBe(
                'old-wasm',
            );
        });
    });

    it('leaves existing output untouched when a later package build fails', async () => {
        await withTempDir(async (dir) => {
            const cwd = path.join(dir, 'project');
            const outputDir = path.join(dir, 'artifacts');
            const archive = path.join(dir, 'contracts-source.zip');
            await mkdir(cwd, { recursive: true });
            await mkdir(outputDir, { recursive: true });
            await writeFile(path.join(outputDir, 'contracts-source.zip'), 'old-source');
            await writeFile(path.join(outputDir, 'old.wasm'), 'old-wasm');
            await writeFile(archive, makeArchive({ 'project/Cargo.toml': '[workspace]\n' }));
            vi.spyOn(VerifiableBuildWrapper.prototype, 'run')
                .mockImplementationOnce(async (_args, _versions, _options, sourceDir) => {
                    const wasmPath = path.join(
                        sourceDir!,
                        'target/wasm32v1-none/release/first.wasm',
                    );
                    await mkdir(path.dirname(wasmPath), { recursive: true });
                    await writeFile(wasmPath, 'first-wasm');
                })
                .mockRejectedValueOnce(new Error('second package failed'));

            await expect(
                runVerifiableBuildFromArchive(
                    {
                        archive,
                        packages: [
                            { packageName: 'first', manifestPath: 'first/Cargo.toml' },
                            { packageName: 'second', manifestPath: 'second/Cargo.toml' },
                        ],
                        outputDir,
                        stellarVersion: '25.1.0',
                        rustVersion: '1.90.0',
                    },
                    { cwd },
                ),
            ).rejects.toThrow('second package failed');

            await expect(
                readFile(path.join(outputDir, 'contracts-source.zip'), 'utf8'),
            ).resolves.toBe('old-source');
            await expect(readFile(path.join(outputDir, 'old.wasm'), 'utf8')).resolves.toBe(
                'old-wasm',
            );
        });
    });

    it('recovers a leftover backup before publishing the new artifact set', async () => {
        await withTempDir(async (dir) => {
            const cwd = path.join(dir, 'project');
            const outputDir = path.join(dir, 'artifacts');
            const backupDir = `${outputDir}.prev`;
            const archive = path.join(dir, 'contracts-source.zip');
            await mkdir(cwd, { recursive: true });
            await mkdir(backupDir, { recursive: true });
            await writeFile(path.join(backupDir, 'old.wasm'), 'old-wasm');
            await writeFile(archive, makeArchive({ 'project/Cargo.toml': '[workspace]\n' }));
            vi.spyOn(VerifiableBuildWrapper.prototype, 'run').mockImplementation(
                async (_args, _versions, _options, sourceDir) => {
                    const wasmPath = path.join(
                        sourceDir!,
                        'target/wasm32v1-none/release/onesig.wasm',
                    );
                    await mkdir(path.dirname(wasmPath), { recursive: true });
                    await writeFile(wasmPath, 'new-wasm');
                },
            );

            await runVerifiableBuildFromArchive(
                {
                    archive,
                    packages: [{ packageName: 'onesig', manifestPath: 'Cargo.toml' }],
                    outputDir,
                    stellarVersion: '25.1.0',
                    rustVersion: '1.90.0',
                },
                { cwd },
            );

            await expect(readFile(path.join(outputDir, 'onesig.wasm'), 'utf8')).resolves.toBe(
                'new-wasm',
            );
            await expect(readFile(path.join(outputDir, 'old.wasm'))).rejects.toThrow();
            await expect(stat(backupDir)).rejects.toThrow();
        });
    });

    it('uses rust-toolchain.toml from the extracted archive when no version is provided', async () => {
        await withTempDir(async (dir) => {
            const cwd = path.join(dir, 'project');
            const outputDir = path.join(dir, 'artifacts');
            const archive = path.join(dir, 'contracts-source.zip');
            await mkdir(cwd, { recursive: true });
            await writeFile(
                archive,
                makeArchive({
                    'project/Cargo.toml': '[workspace]\n',
                    'project/rust-toolchain.toml': '[toolchain]\nchannel = "1.90.0"\n',
                }),
            );
            vi.spyOn(VerifiableBuildWrapper.prototype, 'run').mockImplementation(
                async (_args, versions, _options, sourceDir) => {
                    expect(versions.rustVersion).toBe('1.90.0');
                    const wasmPath = path.join(
                        sourceDir!,
                        'target/wasm32v1-none/release/onesig.wasm',
                    );
                    await mkdir(path.dirname(wasmPath), { recursive: true });
                    await writeFile(wasmPath, 'wasm-bytes');
                },
            );

            await runVerifiableBuildFromArchive(
                {
                    archive,
                    packages: [{ packageName: 'onesig', manifestPath: 'Cargo.toml' }],
                    outputDir,
                    stellarVersion: '25.1.0',
                },
                { cwd },
            );
        });
    });

    it('rejects archive entries outside the expected top-level source directory', async () => {
        await withTempDir(async (dir) => {
            const cwd = path.join(dir, 'project');
            const archive = path.join(dir, 'contracts-source.zip');
            await mkdir(cwd, { recursive: true });
            await writeFile(
                archive,
                makeArchive({
                    'project/Cargo.toml': '[workspace]\n',
                    'staging/injected.txt': 'unexpected artifact',
                }),
            );
            const runSpy = vi
                .spyOn(VerifiableBuildWrapper.prototype, 'run')
                .mockResolvedValue(undefined);

            await expect(
                runVerifiableBuildFromArchive(
                    {
                        archive,
                        packages: [{ packageName: 'onesig', manifestPath: 'Cargo.toml' }],
                        outputDir: path.join(dir, 'artifacts'),
                        stellarVersion: '25.1.0',
                        rustVersion: '1.90.0',
                    },
                    { cwd },
                ),
            ).rejects.toThrow(/outside expected top-level project\//);
            expect(runSpy).not.toHaveBeenCalled();
        });
    });

    it('rejects archive entries that normalize outside the expected source directory', async () => {
        await withTempDir(async (dir) => {
            const cwd = path.join(dir, 'project');
            const archive = path.join(dir, 'contracts-source.zip');
            await mkdir(cwd, { recursive: true });
            await writeFile(
                archive,
                makeArchive({
                    'project/Cargo.toml': '[workspace]\n',
                    'project/../outside.txt': 'unexpected source',
                }),
            );
            const runSpy = vi
                .spyOn(VerifiableBuildWrapper.prototype, 'run')
                .mockResolvedValue(undefined);

            await expect(
                runVerifiableBuildFromArchive(
                    {
                        archive,
                        packages: [{ packageName: 'onesig', manifestPath: 'Cargo.toml' }],
                        outputDir: path.join(dir, 'artifacts'),
                        stellarVersion: '25.1.0',
                        rustVersion: '1.90.0',
                    },
                    { cwd },
                ),
            ).rejects.toThrow(/outside expected top-level project\//);
            expect(runSpy).not.toHaveBeenCalled();
        });
    });

    it('rejects an empty archive before creating output', async () => {
        await withTempDir(async (dir) => {
            const archive = path.join(dir, 'contracts-source.zip');
            await writeFile(archive, new Uint8Array());

            await expect(
                runVerifiableBuildFromArchive(
                    {
                        archive,
                        packages: [{ packageName: 'onesig', manifestPath: 'Cargo.toml' }],
                        outputDir: path.join(dir, 'artifacts'),
                        stellarVersion: '25.1.0',
                        rustVersion: '1.90.0',
                    },
                    { cwd: path.join(dir, 'project') },
                ),
            ).rejects.toThrow('Archive is empty');
            await expect(stat(path.join(dir, 'artifacts'))).rejects.toThrow();
        });
    });

    it('rejects an archive whose expected top-level path is not a directory', async () => {
        await withTempDir(async (dir) => {
            const cwd = path.join(dir, 'project');
            const archive = path.join(dir, 'contracts-source.zip');
            await mkdir(cwd, { recursive: true });
            await writeFile(archive, makeArchive({ project: 'not a directory' }));

            await expect(
                runVerifiableBuildFromArchive(
                    {
                        archive,
                        packages: [{ packageName: 'onesig', manifestPath: 'Cargo.toml' }],
                        outputDir: path.join(dir, 'artifacts'),
                        stellarVersion: '25.1.0',
                        rustVersion: '1.90.0',
                    },
                    { cwd },
                ),
            ).rejects.toThrow('Expected top-level project/ directory');
        });
    });

    it('rejects archives that escape the extraction destination', async () => {
        await withTempDir(async (dir) => {
            const cwd = path.join(dir, 'project');
            const archive = path.join(dir, 'contracts-source.zip');
            await mkdir(cwd, { recursive: true });
            await writeFile(archive, makeArchive({ '../evil.txt': 'nope' }));
            const runSpy = vi
                .spyOn(VerifiableBuildWrapper.prototype, 'run')
                .mockResolvedValue(undefined);

            await expect(
                runVerifiableBuildFromArchive(
                    {
                        archive,
                        packages: [{ packageName: 'onesig', manifestPath: 'Cargo.toml' }],
                        outputDir: path.join(dir, 'artifacts'),
                        stellarVersion: '25.1.0',
                        rustVersion: '1.90.0',
                    },
                    { cwd },
                ),
            ).rejects.toThrow(/escapes destination/);
            await expect(readFile(path.join(dir, 'evil.txt'))).rejects.toThrow();
            expect(runSpy).not.toHaveBeenCalled();
        });
    });
});
