/**
 * Test environment facade.
 *
 * Boots surfpool via Docker (lz-tool) offline from the base snapshot, which already carries the
 * LZ infrastructure (endpoint, DVN, executor, ULN, pricefeed, simple-messagelib) baked once at
 * global-setup by buildBaseSnapshot, and returns a ready-to-use UMI + Connection.
 */

import type { Umi } from '@metaplex-foundation/umi';
import type { Connection } from '@solana/web3.js';

import type { ValidatorConfig } from './validator';
import { startValidator } from './validator';

export interface InfraEnv {
    umi: Umi;
    connection: Connection;
    rpc: string;
    teardown: () => Promise<void>;
}

/**
 * Create a complete test environment: boot surfpool offline from the base snapshot (which already
 * has the protocol deployed + initialized) and return a ready-to-use UMI + Connection.
 *
 * No per-file initInfrastructure: it is baked into base.json once at global-setup. Running it again
 * here would be redundant on the snapshot's guard PDAs. Each test file calls this in beforeAll().
 */
export const createInfraEnv = async (config?: ValidatorConfig): Promise<InfraEnv> => {
    const { umi, connection, rpc, teardown } = await startValidator(config);
    return { umi, connection, rpc, teardown };
};
