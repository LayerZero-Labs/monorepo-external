import { unzipSync } from 'fflate';
import { spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync } from 'node:fs';
import {
    copyFile,
    mkdir,
    mkdtemp,
    readdir,
    readFile,
    rename,
    rm,
    writeFile,
} from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { parseArgs } from 'node:util';
import { parse as parseToml } from 'toml';

import { getFullyQualifiedRepoRootPath } from '@layerzerolabs/common-node-utils';

const STELLAR_VERSION = '25.1.0';
const ARTIFACTS_DIR = '.artifacts';
const CHAIN_NAME = 'stellar';
const SOURCE_ARCHIVE_NAME = 'contracts-source.zip';
const WASM_TARGET_DIR = path.join('target', 'wasm32v1-none', 'release');

const ENVIRONMENTS = ['mainnet', 'testnet', 'sandbox'] as const;
type Environment = (typeof ENVIRONMENTS)[number];

/**
 * Protocol + worker cdylib contracts still in this package. Paths are relative to the
 * extracted package-source root (the crate basename folder, e.g. `contracts/`).
 *
 * Non-protocol OApp contracts (oapp, oft, oft-core, sac-manager, counter, …) were
 * moved out of this package and are intentionally omitted.
 */
const CONTRACTS: ReadonlyArray<{ packageName: string; manifestPath: string }> = [
    { packageName: 'endpoint-v2', manifestPath: 'endpoint-v2/Cargo.toml' },
    { packageName: 'uln302', manifestPath: 'message-libs/uln-302/Cargo.toml' },
    { packageName: 'treasury', manifestPath: 'message-libs/treasury/Cargo.toml' },
    {
        packageName: 'simple-message-lib',
        manifestPath: 'message-libs/simple-message-lib/Cargo.toml',
    },
    {
        packageName: 'blocked-message-lib',
        manifestPath: 'message-libs/blocked-message-lib/Cargo.toml',
    },
    { packageName: 'layerzero-views', manifestPath: 'layerzero-views/Cargo.toml' },
    { packageName: 'upgrader', manifestPath: 'upgrader/Cargo.toml' },
    { packageName: 'executor', manifestPath: 'workers/executor/Cargo.toml' },
    {
        packageName: 'executor-helper',
        manifestPath: 'workers/executor-helper/Cargo.toml',
    },
    {
        packageName: 'executor-fee-lib',
        manifestPath: 'workers/executor-fee-lib/Cargo.toml',
    },
    { packageName: 'dvn', manifestPath: 'workers/dvn/Cargo.toml' },
    { packageName: 'dvn-fee-lib', manifestPath: 'workers/dvn-fee-lib/Cargo.toml' },
    { packageName: 'price-feed', manifestPath: 'workers/price-feed/Cargo.toml' },
];

interface ParsedArgs {
    environment: Environment;
}

const defaultArchivePath = (packageRoot: string): string =>
    path.join(ARTIFACTS_DIR, `${path.basename(packageRoot)}-source.zip`);

const verificationInfoDir = (repoRoot: string, environment: Environment): string =>
    path.join(repoRoot, 'deployments', 'layerzero', environment, CHAIN_NAME, 'verificationInfo');

const printUsage = (packageRoot: string): void => {
    console.error(
        'Usage: tsx scripts/build-verifiable.ts --environment <mainnet|testnet|sandbox>\n' +
            '\n' +
            `Requires ${defaultArchivePath(packageRoot)} from \`pnpm package:source\`.\n` +
            `Builds ${CONTRACTS.length} protocol/worker contracts sequentially.\n` +
            'Embeds SEP-58 source_sha256 (content-addressed; source_uri is out of band).\n' +
            'Writes contracts-source.zip + *.wasm to deployments/layerzero/<environment>/stellar/verificationInfo/.',
    );
};

const parseCliArgs = (argv: string[], packageRoot: string): ParsedArgs | null => {
    try {
        const { values } = parseArgs({
            args: argv.filter((arg) => arg !== '--'),
            options: {
                environment: { type: 'string' },
            },
            strict: true,
        });

        const environment = values.environment;
        if (typeof environment !== 'string') {
            printUsage(packageRoot);
            return null;
        }
        if (!(ENVIRONMENTS as readonly string[]).includes(environment)) {
            console.error(
                `Invalid --environment '${environment}'. Expected one of: ${ENVIRONMENTS.join(', ')}`,
            );
            printUsage(packageRoot);
            return null;
        }

        return { environment: environment as Environment };
    } catch (error) {
        console.error(error instanceof Error ? error.message : error);
        printUsage(packageRoot);
        return null;
    }
};

interface RustToolchainToml {
    toolchain?: {
        channel?: string;
    };
}

/** Read the pinned Rust channel from rust-toolchain.toml so it cannot drift from the crate. */
const readRustVersion = async (packageRoot: string): Promise<string> => {
    const toolchainPath = path.join(packageRoot, 'rust-toolchain.toml');
    const parsed = parseToml(await readFile(toolchainPath, 'utf8')) as RustToolchainToml;
    const channel = parsed.toolchain?.channel;
    if (typeof channel !== 'string') {
        throw new Error(`Missing 'toolchain.channel' in ${toolchainPath}`);
    }
    return channel;
};

const extractZip = async (bytes: Uint8Array, destDir: string): Promise<void> => {
    const files = unzipSync(bytes);
    const destRoot = path.resolve(destDir);
    for (const [relPath, content] of Object.entries(files)) {
        if (relPath.endsWith('/')) continue;
        const outPath = path.resolve(destRoot, relPath);
        if (outPath !== destRoot && !outPath.startsWith(destRoot + path.sep)) {
            throw new Error(`Zip entry escapes destination: ${relPath}`);
        }
        await mkdir(path.dirname(outPath), { recursive: true });
        await writeFile(outPath, content);
    }
};

const runPnpm = (args: string[], cwd: string): Promise<number> =>
    new Promise((resolve, reject) => {
        const child = spawn('pnpm', args, { cwd, stdio: 'inherit' });
        child.on('error', reject);
        child.on('close', (code) => resolve(code ?? 1));
    });

const wasmArtifactName = (packageName: string): string =>
    `${packageName.replaceAll('-', '_')}.wasm`;

const persistWasm = async (
    buildRoot: string,
    outDir: string,
    packageName: string,
): Promise<string> => {
    const wasmName = wasmArtifactName(packageName);
    const builtPath = path.join(buildRoot, WASM_TARGET_DIR, wasmName);
    if (!existsSync(builtPath)) {
        throw new Error(`Expected WASM not found after build: ${builtPath}`);
    }

    await mkdir(outDir, { recursive: true });
    const outPath = path.join(outDir, wasmName);
    await copyFile(builtPath, outPath);
    console.info(`Staged WASM: ${outPath}`);
    return outPath;
};

const persistSourceArchive = async (archivePath: string, outDir: string): Promise<string> => {
    await mkdir(outDir, { recursive: true });
    const outPath = path.join(outDir, SOURCE_ARCHIVE_NAME);
    await copyFile(archivePath, outPath);
    console.info(`Staged source archive: ${outPath}`);
    return outPath;
};

/**
 * Atomically replace verificationInfo with the staged artifact set.
 * Writes to a sibling temp dir, then renames into place so readers never see a
 * partial update and obsolete .wasm files from prior runs are dropped.
 */
const publishArtifacts = async (stagingDir: string, outDir: string): Promise<void> => {
    const parentDir = path.dirname(outDir);
    const outBase = path.basename(outDir);
    await mkdir(parentDir, { recursive: true });

    const nextDir = await mkdtemp(path.join(parentDir, `${outBase}.next-`));
    const backupDir = path.join(parentDir, `${outBase}.prev`);
    const entries = await readdir(stagingDir);

    try {
        for (const entry of entries) {
            await copyFile(path.join(stagingDir, entry), path.join(nextDir, entry));
        }

        // Recover from a previous interrupted swap before touching .prev.
        // If outDir is gone but .prev remains, that backup is the only good copy.
        if (!existsSync(outDir) && existsSync(backupDir)) {
            await rename(backupDir, outDir);
            console.info(`Restored ${outDir} from leftover ${backupDir}`);
        } else if (existsSync(backupDir)) {
            await rm(backupDir, { recursive: true, force: true });
        }

        if (existsSync(outDir)) {
            await rename(outDir, backupDir);
        }
        await rename(nextDir, outDir);
        await rm(backupDir, { recursive: true, force: true });
    } catch (error) {
        // nextDir is consumed on successful rename(nextDir, outDir); otherwise remove it.
        await rm(nextDir, { recursive: true, force: true }).catch(() => undefined);
        // Restore previous verificationInfo if the swap failed mid-flight.
        if (!existsSync(outDir) && existsSync(backupDir)) {
            await rename(backupDir, outDir).catch(() => undefined);
        }
        throw error;
    }

    for (const entry of entries) {
        console.info(`Published: ${path.join(outDir, entry)}`);
    }
};

const buildContract = async (
    packageRoot: string,
    buildRoot: string,
    stagingDir: string,
    contract: { packageName: string; manifestPath: string },
    sourceSha256: string,
    rustVersion: string,
): Promise<number> => {
    const verifiableArgs = [
        'exec',
        'lz-tool',
        'extra',
        'stellar',
        'verifiable-build',
        '--stellar-version',
        STELLAR_VERSION,
        '--rust-version',
        rustVersion,
        '--source-dir',
        buildRoot,
        // metadata passthrough to docker run command
        '--',
        // Actual build flags (must match bldopt so verify rebuild is byte-identical).
        '--manifest-path',
        contract.manifestPath,
        '--package',
        contract.packageName,
        '--optimize',
        // SEP-58: record the same flags as bldopt for `contract verify` replay.
        '--meta',
        `bldopt=--manifest-path=${contract.manifestPath}`,
        '--meta',
        `bldopt=--package=${contract.packageName}`,
        '--meta',
        'bldopt=--optimize',
        // SEP-58 content-addressed source pin (source_uri is optional / out of band).
        '--meta',
        `source_sha256=${sourceSha256}`,
    ];

    console.info(`\n=== Building ${contract.packageName} (${contract.manifestPath}) ===`);
    console.info(`Running: pnpm ${verifiableArgs.join(' ')}`);
    const code = await runPnpm(verifiableArgs, packageRoot);
    if (code === 0) {
        await persistWasm(buildRoot, stagingDir, contract.packageName);
    }
    return code;
};

const main = async (): Promise<number> => {
    const packageRoot = process.cwd();
    const parsed = parseCliArgs(process.argv.slice(2), packageRoot);
    if (!parsed) {
        return 1;
    }

    const archiveRelPath = defaultArchivePath(packageRoot);
    const archivePath = path.join(packageRoot, archiveRelPath);

    if (!existsSync(archivePath)) {
        console.error(`Local archive not found: ${archivePath}`);
        console.error('Run `pnpm package:source` first to create the archive.');
        return 1;
    }

    const rustVersion = await readRustVersion(packageRoot);
    const repoRoot = await getFullyQualifiedRepoRootPath();
    const outDir = verificationInfoDir(repoRoot, parsed.environment);

    // Local archive is the SEP-58 source pin (source_sha256); upload/hosting is out of band.
    console.info(`Reading local archive: ${archivePath}`);
    const archiveBytes = new Uint8Array(await readFile(archivePath));
    const sourceSha256 = createHash('sha256').update(archiveBytes).digest('hex');
    console.info(`source_sha256=${sourceSha256}`);
    console.info(`rust_version=${rustVersion} (from rust-toolchain.toml)`);
    console.info(`stellar_version=${STELLAR_VERSION}`);
    console.info(`environment=${parsed.environment}`);
    console.info(`verificationInfo=${outDir}`);
    console.info(`Contracts to build: ${CONTRACTS.length}`);

    const tempDir = await mkdtemp(path.join(tmpdir(), 'stellar-build-verifiable-'));
    const stagingDir = path.join(tempDir, 'staging');
    let exitCode = 0;

    try {
        console.info(`Extracting archive to: ${tempDir}`);
        await extractZip(archiveBytes, tempDir);

        // package-source zips cwd's parent and keeps only `<basename>/…`, so the
        // archive's single top-level folder matches the crate directory name.
        const rootDirName = path.basename(packageRoot);
        const buildRoot = path.join(tempDir, rootDirName);
        if (!existsSync(buildRoot)) {
            console.error(
                `Expected top-level ${rootDirName}/ directory not found after extraction`,
            );
            return 1;
        }
        console.info(`Build root: ${buildRoot}`);
        console.info(`Staging artifacts in: ${stagingDir}`);

        await persistSourceArchive(archivePath, stagingDir);

        for (const contract of CONTRACTS) {
            const code = await buildContract(
                packageRoot,
                buildRoot,
                stagingDir,
                contract,
                sourceSha256,
                rustVersion,
            );
            if (code !== 0) {
                console.error(`Verifiable build failed for ${contract.packageName} (exit ${code})`);
                exitCode = code;
                break;
            }
        }

        if (exitCode === 0) {
            await publishArtifacts(stagingDir, outDir);
        } else {
            console.error(
                'Leaving verificationInfo unchanged; staged artifacts were discarded with the temp dir.',
            );
        }
    } finally {
        await rm(tempDir, { recursive: true, force: true });
    }

    if (exitCode === 0) {
        console.info(`\nAll ${CONTRACTS.length} contracts built successfully.`);
        console.info(`Artifacts written to: ${outDir}`);
    }

    return exitCode;
};

main()
    .then((code) => process.exit(code))
    .catch((error: unknown) => {
        console.error(error);
        process.exit(1);
    });
