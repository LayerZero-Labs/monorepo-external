/**
 * Solana Surfpool - run inside Docker via lz-tool.
 *
 * Constraint: the host has NO Rust/Solana/Anchor installed; everything runs in
 * the container. Tests (vitest/Node.js) connect to the exposed RPC from the host.
 *
 * surfpool boots offline from the generated base snapshot (the protocol programs +
 * initInfrastructure state, produced once at global-setup by buildBaseSnapshot).
 * Consumer programs are written on top via surfnet_writeProgram, so there is no
 * per-test validator boot, no .so reload, and no per-run initInfrastructure.
 *
 * Flow:
 *   1. lz-tool spawns the container: surfpool start --offline --snapshot target/base.json
 *   2. Container exposes RPC + WS ports to the host
 *   3. Consumer programs are writeProgram-ed on top; tests connect via http://localhost:<rpcPort>
 *   4. Cleanup: find container by published port, docker kill
 */

import type { Umi } from '@metaplex-foundation/umi';
import { createUmi } from '@metaplex-foundation/umi-bundle-defaults';
import { Connection } from '@solana/web3.js';
import { readFile } from 'node:fs/promises';
import { $, sleep } from 'zx';

import {
    allocatePorts as allocatePortBlock,
    rpcCall,
    stringifyLosslessJson,
    SURFPOOL_VERSION,
    writeProgram,
} from '@layerzerolabs/vm-tooling-solana';

import { createSignerFromSeed } from './test-keys';

// ── Types ────────────────────────────────────────────────────────────────────

export interface ValidatorConfig {
    /** Base port for auto-allocation (default: 13033). Each package should use
     *  a unique base to avoid cross-package collisions on CI. */
    basePort?: number;
    /** RPC port (default: auto-assigned based on VITEST_POOL_ID) */
    rpcPort?: number;
    /** Upper bound of the published Docker port range rpcPort..portRangeEnd (default: rpcPort + 2).
     *  surfpool has no faucet; this only sizes the published range, which must include the ws port
     *  (rpcPort + 1) or tx confirmation can't reach it. */
    portRangeEnd?: number;
    /** Consumer programs to writeProgram on top of the base snapshot: { id, soPath } */
    programs?: Array<{ id: string; soPath: string }>;
    /** Extra args to pass to surfpool */
    extraArgs?: string[];
    /** Max seconds to wait for validator to start (default: 180) */
    startupTimeoutSeconds?: number;
    /**
     * Snapshot to boot from. Omitted → `target/base.json` (LZ protocol from globalSetup).
     * `false` → empty offline boot (no `--snapshot`; for packages that don't need the protocol).
     * A string path → boot from that snapshot file.
     */
    snapshot?: boolean | string;
}

export interface ValidatorEnv {
    umi: Umi;
    connection: Connection;
    rpc: string;
    rpcPort: number;
    teardown: () => Promise<void>;
}

// ── Port allocation ──────────────────────────────────────────────────────────

const DEFAULT_BASE_PORT = 13033;

/** Allocate a free surfpool port block off this package's base (allocator in vm-tooling-solana). */
export const allocatePorts = (
    basePort = DEFAULT_BASE_PORT,
): Promise<{ rpcPort: number; portRangeEnd: number }> => allocatePortBlock(basePort);

// ── Docker lifecycle ─────────────────────────────────────────────────────────

/** Spawn the surfpool container via lz-tool (fire-and-forget). */
const spawnValidator = (script: string, portMapping: string): void => {
    // Run surfpool via its own lean image, not the anchor toolchain. The integration path runs
    // dumped .so and never builds. --surfpool-version selects it; --no-default-volumes means
    // lz-tool needs no per-package cache volume, so there's no npm_package_name to forward.
    $.spawn(
        'pnpm',
        [
            'exec',
            'lz-tool',
            '--surfpool-version',
            SURFPOOL_VERSION,
            '--no-default-volumes',
            '--script',
            script,
            '-p',
            portMapping,
            'surfpool',
        ],
        {
            stdio: ['ignore', 'ignore', 'inherit'],
            env: process.env,
        },
    );
};

/** Poll the RPC endpoint until it responds or times out. */
const waitForRpc = async (rpc: string, timeoutSeconds: number): Promise<boolean> => {
    for (let i = 0; i < timeoutSeconds; i++) {
        try {
            const response = await fetch(rpc, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'getVersion' }),
                signal: AbortSignal.timeout(5000),
            });
            if (response.ok) return true;
        } catch {
            // Not ready yet
        }
        await sleep(1000);
    }
    return false;
};

/** Find and kill the Docker container by its published port range. */
export const killContainerByPort = async (rpcPort: number, portRangeEnd: number): Promise<void> => {
    try {
        const { stdout } = await $`docker ps -q --filter publish=${rpcPort}-${portRangeEnd}`;
        const containerIds = stdout.trim().split('\n').filter(Boolean);
        for (const id of containerIds) {
            await $`docker kill ${id}`.quiet();
            console.log(`  Killed container: ${id}`);
        }
    } catch {
        // Container may already be stopped
    }
};

/**
 * Generated base-snapshot path, relative to the package cwd. lz-tool mounts the repo at
 * /workspace and sets -w /workspace/<pkg>, so this resolves inside the container and rides
 * that mount (nothing is baked into the image). Produced by buildBaseSnapshot (global-setup).
 */
export const BASE_SNAPSHOT = 'target/base.json';

// rpcCall + writeProgram live in vm-tooling-solana (shared with lz-v2-protocol-solana and onesig);
// re-exported so this package's consumers (e.g. global-setup) keep importing them from here.
export { rpcCall, stringifyLosslessJson, writeProgram };

/** Close the WebSocket connection to avoid ECONNRESET on teardown. */
export const closeWebSocket = (connection: Connection): void => {
    try {
        // web3.js Connection has no public close(), reach into the private _rpcWebSocket. Verified
        // against @solana/web3.js 1.x; the try/catch keeps this safe if a future major renames or
        // drops the field, but re-check the field name on a major upgrade.
        const ws = (connection as unknown as { _rpcWebSocket?: { close?: () => void } })
            ._rpcWebSocket;
        ws?.close?.();
    } catch {
        // Best effort
    }
};

// ── Public API ───────────────────────────────────────────────────────────────

/**
 * Spawn surfpool offline on the given ports via lz-tool and block until its RPC answers, killing
 * the container and throwing on timeout. Shared by startValidator (boot from base.json) and
 * global-setup's buildBaseSnapshot (fresh boot to generate it); both bind loopback-only and both
 * must kill-on-timeout so a stuck container doesn't hold the port for the next run.
 */
export const bootSurfpool = async ({
    rpcPort,
    wsPort,
    portRangeEnd,
    snapshot,
    extraArgs = [],
    startupTimeoutSeconds = 180,
}: {
    rpcPort: number;
    wsPort: number;
    portRangeEnd: number;
    snapshot?: string;
    extraArgs?: string[];
    startupTimeoutSeconds?: number;
}): Promise<void> => {
    const surfpoolArgs = [
        'surfpool',
        'start',
        '--offline',
        '--no-deploy',
        ...(snapshot ? ['--snapshot', snapshot] : []),
        // Bind the container's external interface (default is 127.0.0.1, unreachable through the
        // Docker port publish); the host side stays loopback-only via the 127.0.0.1: publish.
        '-o',
        '0.0.0.0',
        '-p',
        rpcPort.toString(),
        '-w',
        wsPort.toString(),
        '--no-tui',
        // Log dir must be container-writable: surfpool writes it relative to CWD, which lz-tool
        // mounts host-owned, and the image runs as a non-root user.
        '--log-path',
        '/tmp/surfpool',
        ...extraArgs,
    ];
    // Bind loopback-only: surfpool's RPC accepts state-mutation methods (surfnet_writeProgram/
    // exportSnapshot), so an all-interfaces publish would let another host on a shared CI runner
    // tamper with test state. The published range must include wsPort (rpcPort+1) or tx
    // confirmation can't reach the WS port.
    spawnValidator(
        surfpoolArgs.join(' '),
        `127.0.0.1:${rpcPort}-${portRangeEnd}:${rpcPort}-${portRangeEnd}`,
    );

    if (!(await waitForRpc(`http://localhost:${rpcPort}`, startupTimeoutSeconds))) {
        await killContainerByPort(rpcPort, portRangeEnd);
        throw new Error(
            `surfpool failed to start within ${startupTimeoutSeconds}s on port ${rpcPort}`,
        );
    }
};

// TODO-SOLANA: reuse a single surfpool across test files instead of one per test.
//       surfnet_resetNetwork between files could replace per-file boots.

/**
 * Boot surfpool inside Docker via lz-tool. By default offline from the generated base snapshot
 * (LZ protocol in base.json); pass `snapshot: false` for an empty boot. Consumer programs
 * (config.programs) are written on top via surfnet_writeProgram. Returns UMI + Connection, plus
 * a teardown.
 */
export const startValidator = async (config: ValidatorConfig = {}): Promise<ValidatorEnv> => {
    const { rpcPort, portRangeEnd } =
        config.rpcPort != null
            ? { rpcPort: config.rpcPort, portRangeEnd: config.portRangeEnd ?? config.rpcPort + 2 }
            : await allocatePorts(config.basePort);
    const wsPort = rpcPort + 1;
    // A custom rpcPort/portRangeEnd that doesn't span the ws port typechecks but never publishes it,
    // and tx confirmation then hangs, fail loudly instead.
    if (portRangeEnd < wsPort) {
        throw new Error(
            `published port range ${rpcPort}-${portRangeEnd} excludes the ws port ${wsPort}; ` +
                `set portRangeEnd >= rpcPort + 1`,
        );
    }
    const startupTimeout = config.startupTimeoutSeconds ?? 180;
    let snapshot: string | undefined = BASE_SNAPSHOT;
    if (config.snapshot === false) {
        snapshot = undefined;
    } else if (typeof config.snapshot === 'string') {
        snapshot = config.snapshot;
    }

    // No feature-gate parity: buildBaseSnapshot prunes the Feature-program accounts, so surfpool
    // boots its own fixed agave-3.1 feature set rather than mainnet's activation state. This differs
    // from solana-test-validator (which activated all gates), so a test near a gate boundary can
    // flip between the two harnesses. Neither harness forwards feature flags today, lz-v2 passes no
    // --disable-feature either, so both just take surfpool's default set.
    console.log(
        snapshot
            ? `🌊 Starting surfpool on port ${rpcPort} (Docker, offline snapshot)...`
            : `🌊 Starting surfpool on port ${rpcPort} (Docker, no snapshot)...`,
    );
    await bootSurfpool({
        rpcPort,
        wsPort,
        portRangeEnd,
        snapshot,
        extraArgs: config.extraArgs,
        startupTimeoutSeconds: startupTimeout,
    });
    console.log(`✅ surfpool running on port ${rpcPort}`);

    const rpc = `http://localhost:${rpcPort}`;
    const ws = `ws://localhost:${wsPort}`;

    // The container is up. Any failure in the post-boot setup below (a missing consumer .so, a
    // rejected writeProgram/airdrop) must kill it before rethrowing, otherwise it leaks and a
    // later run on the same port waits the full startup timeout before reclaiming it.
    let connection: Connection | undefined;
    try {
        // Skip ids the snapshot already carries, rewriting an initialized program over its init
        // state is wasteful and unproven-safe. When booting with a snapshot, surfpool already
        // loaded it; if the host can't read it here, bakedIds stays empty and we write all.
        let bakedIds = new Set<string>();
        if (snapshot) {
            try {
                bakedIds = new Set(Object.keys(JSON.parse(await readFile(snapshot, 'utf-8'))));
            } catch {
                // Host couldn't read the snapshot file; let the writeProgram loop write all.
            }
        }
        for (const prog of config.programs ?? []) {
            if (bakedIds.has(prog.id)) continue;
            await writeProgram({ rpc, id: prog.id, soPath: prog.soPath });
        }

        // Connection first (with wsEndpoint, surfpool tx confirmation needs the WS port reachable),
        // then UMI. lz-solana-sdk-v2 requires the same Connection for simulateWeb3JsTransaction.
        const conn = new Connection(rpc, { commitment: 'confirmed', wsEndpoint: ws });
        connection = conn;
        const umi = createUmi(conn);

        // Fund a deterministic payer
        const payer = createSignerFromSeed('umi-payer');
        umi.payer = payer;
        await umi.rpc.airdrop(payer.publicKey, {
            basisPoints: 10_000_000_000_000n,
            identifier: 'SOL',
            decimals: 9,
        });

        const teardown = async () => {
            console.log(`🧹 Stopping surfpool on port ${rpcPort}...`);
            closeWebSocket(conn);
            await sleep(200); // Let WS close handshake complete
            await killContainerByPort(rpcPort, portRangeEnd);
            console.log(`✅ surfpool stopped`);
        };

        return { umi, connection: conn, rpc, rpcPort, teardown };
    } catch (err) {
        if (connection) closeWebSocket(connection);
        await killContainerByPort(rpcPort, portRangeEnd);
        throw err;
    }
};
