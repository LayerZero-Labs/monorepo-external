import { Umi } from '@metaplex-foundation/umi';
import { createUmi } from '@metaplex-foundation/umi-bundle-defaults';
import { Connection } from '@solana/web3.js';
import axios from 'axios';
import { $, sleep } from 'zx';

import {
    allocatePorts as allocatePortBlock,
    SURFPOOL_VERSION,
    writeProgram,
} from '@layerzerolabs/vm-tooling-solana';

import { addresses } from '../src/addresses';

// Distinct from test-utils-solana's 13033 base so the two harnesses don't collide when turbo runs
// them in parallel. Each vitest fork stakes out its own 3-port block off this base.
const DEFAULT_BASE_PORT = 14033;

/** Allocate a free surfpool port block off this package's base (allocator in vm-tooling-solana). */
export const allocatePorts = (
    basePort = DEFAULT_BASE_PORT,
): Promise<{ rpcPort: number; portRangeEnd: number }> => allocatePortBlock(basePort);

export class SolanaTestValidator {
    umi: Umi;
    connection: Connection;
    rpc: string;
    // surfpool has no faucet; publish only rpc..rpc+2 (rpc, ws=rpc+1, spare), not a 100-port range.
    private readonly portRangeEnd: string;

    constructor(
        private readonly rpcPort: string,
        private readonly extraOptions: string[] = [],
    ) {
        this.portRangeEnd = (Number(this.rpcPort) + 2).toString();
        this.rpc = `http://localhost:${this.rpcPort}`;
        this.umi = createUmi(this.rpc, 'confirmed');
        this.connection = new Connection(this.umi.rpc.getEndpoint(), 'confirmed');
    }

    async start(): Promise<void> {
        const programsDir = './artifacts';

        // Feature-gate parity is a known gap: surfpool's --disable-feature rejects gates agave-3.1
        // doesn't know, and an unknown gate isn't active in surfpool anyway, so we forward none and
        // take surfpool's default set. Tracked separately.
        console.log('ℹ️  surfpool uses its own agave-3.1 feature set; mainnet gates not forwarded');

        console.log('🚀 Starting surfpool...');
        $.spawn(
            'pnpm',
            [
                'exec',
                'lz-tool',
                '--surfpool-version',
                SURFPOOL_VERSION,
                '--no-default-volumes',
                // The surfpool sub-command lz-tool runs in the container. -o binds the container's
                // external interface so the published port is reachable; --log-path is a
                // container-writable dir (surfpool logs to CWD, which lz-tool mounts host-owned).
                '--script',
                [
                    'surfpool start --offline',
                    '--no-deploy',
                    '-o 0.0.0.0',
                    `-p ${this.rpcPort}`,
                    `-w ${Number(this.rpcPort) + 1}`,
                    '--no-tui',
                    '--log-path /tmp/surfpool',
                    ...this.extraOptions,
                ].join(' '),
                '-p',
                `127.0.0.1:${this.rpcPort}-${this.portRangeEnd}:${this.rpcPort}-${this.portRangeEnd}`,
                'surfpool',
            ],
            {
                stdio: ['ignore', 'ignore', 'inherit'],
            },
        );

        // Wait for surfpool to start. ~1 poll/sec while the port is refused, so ~180s of tolerance
        // for a cold runner pulling the image, matched to test-utils and kept under the 240s
        // hookTimeout (vitest.config.ts), which backstops a boot that never answers.
        let started = false;
        for (let i = 0; i < 180; i++) {
            try {
                await axios.post(
                    this.rpc,
                    { jsonrpc: '2.0', id: 1, method: 'getVersion' },
                    { timeout: 5000 },
                );
                started = true;
                console.log('✅ surfpool started');
                break;
            } catch (_e) {
                await sleep(1000);
                console.log('⏳ Waiting for surfpool to start...');
            }
        }
        if (!started) {
            // Kill the spawned container before bailing so it doesn't squat the port for the next
            // run (matches bootSurfpool's kill-on-timeout; afterAll → stop() is only a backstop).
            await this.stop();
            throw new Error(`surfpool failed to start on port ${this.rpcPort}`);
        }

        // The container is up. Any failure in the post-boot program load must kill it before
        // rethrowing, otherwise it leaks and a later run on the same port waits the full startup
        // timeout before reclaiming it. (afterAll → stop() also reaps it, but don't rely on that.)
        try {
            // Load the protocol programs at their ids (replaces --bpf-program). The .so are read on
            // the host and sent over RPC, so no container mount is needed.
            for (const [name, id] of Object.entries(addresses)) {
                if (name === 'worker_interface') continue;
                await writeProgram({ rpc: this.rpc, id, soPath: `${programsDir}/${name}.so` });
            }
            console.log('✅ protocol programs loaded');
        } catch (err) {
            await this.stop();
            throw err;
        }
    }

    async stop(): Promise<void> {
        console.log('🧹 Cleaning up test environment...');
        await sleep(1000);

        // Find container ID
        const { stdout } =
            await $`docker ps -q --filter "publish=${this.rpcPort}-${this.portRangeEnd}"`;
        const containerIds = stdout.trim().split('\n').filter(Boolean);

        if (containerIds.length === 0) {
            console.log('No containers found');
            return;
        }

        // Kill all matching containers
        for (const id of containerIds) {
            await $`docker kill ${id}`;
            console.log(`Killed container: ${id}`);
        }

        console.log('✅ Cleanup completed!');
    }
}
