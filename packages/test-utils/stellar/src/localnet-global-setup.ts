import type { StellarTestEnv } from './env.js';
import { startStellarLocalnet, stopStellarLocalnet } from './localnet.js';

/**
 * Vitest globalSetup that only starts/stops Stellar localnet.
 * Use when the suite deploys its own contracts (e.g. protocol SDK upgrader tests).
 */
export function createLocalnetOnlyGlobalSetup(
    env: StellarTestEnv,
): (_ctx?: unknown) => Promise<() => Promise<void>> {
    return async function globalSetup(_ctx?: unknown): Promise<() => Promise<void>> {
        console.log('\n========================================');
        console.log('🌐 GLOBAL SETUP: Starting Stellar Localnet');
        console.log('========================================\n');

        await startStellarLocalnet({ env });

        console.log('\n========================================');
        console.log('✅ GLOBAL SETUP COMPLETE (localnet only)');
        console.log('========================================\n');

        return async () => {
            console.log('\n========================================');
            console.log('🛑 GLOBAL TEARDOWN: Stopping Stellar Localnet');
            console.log('========================================\n');

            await stopStellarLocalnet({ env });
        };
    };
}
