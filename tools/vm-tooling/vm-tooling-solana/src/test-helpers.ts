/**
 * Shared helpers for the surfpool-based Solana test harnesses, kept here so the harnesses don't
 * each carry their own copy. This package is the common dependency they can all import. A
 * published harness can't depend on a private test-only package, so the shared code lives here.
 */
import net from 'net';
import { readFile } from 'node:fs/promises';

// ── Port allocation ──────────────────────────────────────────────────────────

const PORT_BLOCK_SIZE = 3; // rpc, ws (rpc+1), and one spare so adjacent blocks don't abut
const MAX_PORT_RETRIES = 10;
// Retry past the whole fork band, not the next block: forks sit PORT_BLOCK_SIZE apart, so a
// one-block bump would land a squatted fork on its neighbour's base. The 10-retry walk stays
// within the ~1000-port per-package window.
const MAX_CONCURRENT_FORKS = 32;
const PORT_RETRY_STRIDE = MAX_CONCURRENT_FORKS * PORT_BLOCK_SIZE;

/** Check if a port is free by attempting to bind to it. */
const isPortFree = (port: number): Promise<boolean> =>
    new Promise((resolve) => {
        const server = net.createServer();
        server.once('error', () => resolve(false));
        server.once('listening', () => server.close(() => resolve(true)));
        server.listen(port, '127.0.0.1');
    });

/**
 * Check the whole published block is free: rpc, ws (rpc+1), and the spare (rpc+2). Checking only
 * rpcPort would accept a block whose ws port is held by a foreign process, the container would
 * then fail its ws bind and surface as an opaque "failed to start" rather than a clean retry.
 */
const isBlockFree = async (rpcPort: number): Promise<boolean> => {
    for (let port = rpcPort; port < rpcPort + PORT_BLOCK_SIZE; port++) {
        if (!(await isPortFree(port))) return false;
    }
    return true;
};

/**
 * Allocate a free 3-port block for a surfpool validator. Each vitest fork derives its base from
 * VITEST_POOL_ID (basePort + poolId * PORT_BLOCK_SIZE); callers pass their package's basePort so
 * the per-package ranges don't overlap. If the computed block is occupied (cross-package collision
 * or a foreign process), advances past the whole fork band (PORT_RETRY_STRIDE) and retries.
 */
export const allocatePorts = async (
    basePort: number,
): Promise<{ rpcPort: number; portRangeEnd: number }> => {
    // eslint-disable-next-line turbo/no-undeclared-env-vars
    const poolId = parseInt(process.env.VITEST_POOL_ID ?? '0', 10);
    let rpcPort = basePort + poolId * PORT_BLOCK_SIZE;

    for (let attempt = 0; attempt < MAX_PORT_RETRIES; attempt++) {
        if (await isBlockFree(rpcPort)) {
            return { rpcPort, portRangeEnd: rpcPort + 2 };
        }
        console.log(`⚠ Port block ${rpcPort}-${rpcPort + 2} in use, trying next band...`);
        rpcPort += PORT_RETRY_STRIDE;
    }

    throw new Error(
        `No free port found after ${MAX_PORT_RETRIES} retries (started at ${basePort})`,
    );
};

// ── surfpool RPC ───────────────────────────────────────────────────────────────

/** Minimal JSON-RPC call to a surfpool container. */
export const rpcCall = async ({
    rpc,
    method,
    params,
}: {
    rpc: string;
    method: string;
    params: unknown[];
}): Promise<unknown> => {
    const res = await fetch(rpc, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ jsonrpc: '2.0', id: 1, method, params }),
    });
    // Surface HTTP-level failures with status + body. Right after the RPC starts answering the
    // container can accept the TCP connect but still 502 with a non-JSON body; without this,
    // res.json() throws an opaque "Unexpected token" SyntaxError instead of the real status.
    if (!res.ok) {
        const body = await res.text().catch(() => '');
        throw new Error(
            `${method}: HTTP ${res.status} ${res.statusText}${body ? `, ${body.slice(0, 200)}` : ''}`,
        );
    }
    const json = (await res.json()) as { result?: unknown; error?: unknown };
    if (json.error) throw new Error(`${method}: ${JSON.stringify(json.error)}`);
    return json.result;
};

/**
 * Load a program's bytecode at its target id via surfnet_writeProgram (raw hex, no 0x prefix).
 * The .so is read on the host and sent over RPC, so no container mount is needed. This replaces
 * solana-test-validator's genesis-only --bpf-program for programs not carried in the snapshot.
 */
export const writeProgram = async ({
    rpc,
    id,
    soPath,
}: {
    rpc: string;
    id: string;
    soPath: string;
}): Promise<void> => {
    const hex = (await readFile(soPath)).toString('hex');
    // surfnet_writeProgram(programId, bytecodeHex, ...optional positionals). The trailing 0/null
    // are surfpool's optional lamports / upgrade-authority args; we take the defaults.
    await rpcCall({ rpc, method: 'surfnet_writeProgram', params: [id, hex, 0, null] });
};
