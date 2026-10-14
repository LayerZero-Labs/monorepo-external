/**
 * Vitest Global Setup: prepare the surfpool base snapshot.
 *
 * Two steps, both cached and offline after the first run:
 *  1. extractPrograms: dump the protocol .so from the snapshot:solana Docker image into
 *     target/programs/ (unchanged; the existing .so source).
 *  2. buildBaseSnapshot: boot surfpool, writeProgram those .so, run initInfrastructure once,
 *     and export a state-only base.json into target/. This is what each test file boots from
 *     (surfpool --offline --snapshot), replacing the per-file validator boot + init.
 *
 * Program IDs are derived from @layerzerolabs/lz-solana-sdk-v2. The SDK is the single source
 * of truth for addresses. base.json is generated + cached in target/ (gitignored), not committed.
 */

import { createUmi } from '@metaplex-foundation/umi-bundle-defaults';
import { Connection } from '@solana/web3.js';
import { access, mkdir, readFile, writeFile } from 'fs/promises';
import path from 'path';
import { $, sleep } from 'zx';

import { UMI } from '@layerzerolabs/lz-solana-sdk-v2';

import { endpoint } from './constants';
import { initInfrastructure } from './helpers/lz-infra';
import { createSignerFromSeed } from './helpers/test-keys';
import {
    allocatePorts,
    BASE_SNAPSHOT,
    bootSurfpool,
    closeWebSocket,
    killContainerByPort,
    rpcCall,
    stringifyLosslessJson,
    writeProgram,
} from './helpers/validator';

const SNAPSHOT_IMAGE = 'us-east1-docker.pkg.dev/lz-docker/layerzero/solana-snapshot:manual-3.0.167';
// Bump when buildBaseSnapshot's inputs change in a way the SNAPSHOT_IMAGE tag doesn't capture, the
// surfpool version/rev, the initInfrastructure logic, or the prune set. The .base-version marker
// includes this so such a change invalidates a cached base.json; without it a stale base would be
// reused silently.
const BASE_SCHEMA_VERSION = 2;
const CONTAINER_NAME = 'lz-artifact-extract';
const RPC_PORT = 19899;

const exists = (p: string) =>
    access(p).then(
        () => true,
        () => false,
    );

/** LayerZero protocol programs, IDs sourced from lz-solana-sdk-v2 */
export const LZ_PROGRAMS = [
    { name: 'endpoint', id: UMI.EndpointProgram.ENDPOINT_PROGRAM_ID },
    { name: 'simple_messagelib', id: UMI.SimpleMessageLibProgram.SIMPLE_MESSAGELIB_PROGRAM_ID },
    { name: 'uln', id: UMI.UlnProgram.ULN_PROGRAM_ID },
    { name: 'executor', id: UMI.ExecutorProgram.EXECUTOR_PROGRAM_ID },
    { name: 'dvn', id: UMI.DVNProgram.DVN_PROGRAM_ID },
    { name: 'pricefeed', id: UMI.PriceFeedProgram.PRICEFEED_PROGRAM_ID },
    { name: 'blocked_messagelib', id: UMI.BlockedMessageLibProgram.BLOCKED_MESSAGELIB_PROGRAM_ID },
];

const extractPrograms = async (): Promise<void> => {
    const programsDir = path.join(process.cwd(), 'target/programs');
    await mkdir(programsDir, { recursive: true });

    // Check cache, try to read version file, skip if valid
    const versionFile = path.join(programsDir, '.snapshot-version');
    try {
        const cached = (await readFile(versionFile, 'utf-8')).trim();
        const allExist = await Promise.all(
            LZ_PROGRAMS.map((p) => exists(path.join(programsDir, `${p.name}.so`))),
        );
        if (cached === SNAPSHOT_IMAGE && allExist.every(Boolean)) {
            console.log('  All programs cached');
            return;
        }
    } catch {
        // Version file doesn't exist, first run
    }

    console.log(`  Starting snapshot validator (${SNAPSHOT_IMAGE})...`);
    await $`docker rm -f ${CONTAINER_NAME}`.quiet().catch(() => {});

    // TODO-SOLANA: replace this with contracts/protocol/solana/ to fetch and build the protocol programs (executor, dvn, endpoint, pricefeed, etc)
    // stop-gap solution until protocol solana is migrated in from `monorepo`
    const validatorCmd = `solana-test-validator --rpc-port ${RPC_PORT} -l /app/cache --limit-ledger-size 50000000`;
    await $`docker run -d --name ${CONTAINER_NAME} -p ${RPC_PORT}:${RPC_PORT} ${SNAPSHOT_IMAGE} sh -c ${validatorCmd}`;

    try {
        // Wait for RPC (60s, image pull + validator startup can be slow on first run)
        let started = false;
        for (let i = 0; i < 60; i++) {
            try {
                const resp = await fetch(`http://localhost:${RPC_PORT}`, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'getVersion' }),
                    signal: AbortSignal.timeout(3000),
                });
                if (resp.ok) {
                    started = true;
                    break;
                }
            } catch {
                await sleep(1000);
            }
        }
        if (!started) {
            throw new Error(`Snapshot validator failed to start within 60s on port ${RPC_PORT}`);
        }

        // Dump each program
        for (const program of LZ_PROGRAMS) {
            const dest = path.join(programsDir, `${program.name}.so`);
            console.log(`  Extracting ${program.name}...`);
            await $`docker exec ${CONTAINER_NAME} solana program dump ${program.id} /tmp/${program.name}.so --url http://localhost:${RPC_PORT}`.quiet();
            await $`docker cp ${CONTAINER_NAME}:/tmp/${program.name}.so ${dest}`;
        }

        // Write version marker
        await writeFile(versionFile, SNAPSHOT_IMAGE + '\n');
        console.log(`  Extracted ${LZ_PROGRAMS.length} programs`);
    } finally {
        await $`docker rm -f ${CONTAINER_NAME}`.quiet().catch(() => {});
    }
};

// Accounts surfpool seeds itself; pruned from the exported snapshot so a stale sysvar does not
// fight the fresh boot (and to keep the base small). Owner-based: Feature-gate + Sysvar programs.
const FEATURE_PROGRAM = 'Feature111111111111111111111111111111111111';
const SYSVAR_OWNER = 'Sysvar1111111111111111111111111111111111111';

/**
 * Build the surfpool base snapshot from the extracted protocol .so. Boots surfpool empty via
 * lz-tool, writeProgram-s the 7 programs at their SDK ids, runs initInfrastructure once, and
 * exports a state-only snapshot (feature-gate + sysvar accounts pruned). Cached in target/ keyed
 * on SNAPSHOT_IMAGE, the same idiom as extractPrograms, generated, not committed, sourced from
 * the existing .so (not live mainnet).
 */
const buildBaseSnapshot = async (): Promise<void> => {
    const programsDir = path.join(process.cwd(), 'target/programs');
    // Same path startValidator boots from (--snapshot); use the shared constant so they can't drift.
    const baseJson = path.join(process.cwd(), BASE_SNAPSHOT);
    const baseVersionFile = path.join(programsDir, '..', '.base-version');
    const baseCacheKey = `${SNAPSHOT_IMAGE}|schema-${BASE_SCHEMA_VERSION}`;

    // Cache, skip if base.json was built for the current snapshot image + schema version
    try {
        const cached = (await readFile(baseVersionFile, 'utf-8')).trim();
        if (cached === baseCacheKey && (await exists(baseJson))) {
            console.log('  base.json cached');
            return;
        }
    } catch {
        // first run
    }

    // Distinct base port from the per-test validators (DEFAULT_BASE_PORT 13033) to avoid collision
    const { rpcPort, portRangeEnd } = await allocatePorts(15033);
    const wsPort = rpcPort + 1;
    const rpc = `http://localhost:${rpcPort}`;
    const ws = `ws://localhost:${wsPort}`;

    console.log(`  Building base.json (surfpool on port ${rpcPort})...`);

    let connection: Connection | undefined;
    try {
        // Fresh boot (no --snapshot): this is the run that generates base.json.
        await bootSurfpool({ rpcPort, wsPort, portRangeEnd, startupTimeoutSeconds: 120 });

        // Load the protocol programs at their SDK ids
        for (const p of LZ_PROGRAMS) {
            await writeProgram({
                rpc,
                id: p.id.toString(),
                soPath: path.join(programsDir, `${p.name}.so`),
            });
        }

        // Initialize the protocol once against the booted surfpool
        connection = new Connection(rpc, { commitment: 'confirmed', wsEndpoint: ws });
        const umi = createUmi(connection);
        umi.payer = createSignerFromSeed('umi-payer');
        await umi.rpc.airdrop(umi.payer.publicKey, {
            basisPoints: 1_000_000_000_000n,
            identifier: 'SOL',
            decimals: 9,
        });
        await initInfrastructure(umi);

        // Export state-only and drop:
        //  - feature-gate + sysvar accounts (surfpool seeds those itself), and
        //  - the umi-payer funding account: startValidator funds it fresh on every boot, so baking
        //    its post-init residual here would give each test a non-deterministic starting balance
        //    (and is why the airdrop amount here can differ from startValidator's without effect).
        const payerPk = umi.payer.publicKey.toString();
        const snap = (await rpcCall({
            rpc,
            method: 'surfnet_exportSnapshot',
            params: [
                {
                    includeParsedAccounts: false,
                    filter: { includeProgramAccounts: true },
                    scope: 'network',
                },
            ],
        })) as { value?: Record<string, { owner?: string }> };
        const all = snap.value ?? (snap as Record<string, { owner?: string }>);
        const accounts = Object.fromEntries(
            Object.entries(all).filter(
                ([k, v]) =>
                    k !== payerPk && v.owner !== FEATURE_PROGRAM && v.owner !== SYSVAR_OWNER,
            ),
        );

        // Guard the untyped surfnet_exportSnapshot response: a wrong/empty shape would otherwise be
        // cached as a useless base.json and surface only as a far-off failure in every consumer
        // (createInfraEnv no longer re-inits per file). Require the 7 protocol program accounts
        // before stamping the cache marker.
        const missing = LZ_PROGRAMS.filter((p) => !(p.id.toString() in accounts));
        if (missing.length > 0) {
            throw new Error(
                `surfnet_exportSnapshot snapshot missing ${missing.length}/${LZ_PROGRAMS.length} ` +
                    `protocol programs (${missing.map((p) => p.name).join(', ')}); ` +
                    `refusing to cache base.json.`,
            );
        }

        // The program check proves the .so survived export; this proves initInfrastructure's state
        // did too. The endpoint setting PDA is the first account it writes (see initEndpoint), so a
        // programs-but-no-init base fails the build here instead of caching clean.
        const settingPda = endpoint.pda.setting()[0].toString();
        if (!(settingPda in accounts)) {
            throw new Error(
                `surfnet_exportSnapshot snapshot has the protocol programs but not the endpoint ` +
                    `setting PDA initInfrastructure writes (${settingPda}); refusing to cache base.json.`,
            );
        }

        await writeFile(baseJson, stringifyLosslessJson(accounts, 2) + '\n');
        await writeFile(baseVersionFile, baseCacheKey + '\n');
        console.log(`  base.json built: ${Object.keys(accounts).length} accounts`);
    } finally {
        if (connection) closeWebSocket(connection);
        await sleep(200);
        await killContainerByPort(rpcPort, portRangeEnd);
    }
};

export const globalSetup = async () => {
    console.log('[global-setup] Preparing LZ program artifacts...');
    await extractPrograms();
    console.log('[global-setup] Building surfpool base snapshot...');
    await buildBaseSnapshot();
    console.log('[global-setup] Done');
};

export default globalSetup;
