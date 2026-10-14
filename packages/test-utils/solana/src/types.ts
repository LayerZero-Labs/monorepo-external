/**
 * Base type definitions for Solana test suites.
 *
 * Umi (from @metaplex-foundation/umi) is the primary Solana client framework
 * used by lz-solana-sdk-v2. Connection (from @solana/web3.js) is needed for
 * SPL token operations and event extraction. Most test environments carry both.
 *
 * Consumer packages extend these base types with program-specific fields
 * (e.g. counter-oapp adds `pda: CounterPda`, console-oft adds `program: Program`).
 */

import type {
    AddressLookupTableInput,
    Context,
    KeypairSigner,
    PublicKey,
} from '@metaplex-foundation/umi';
import type { Connection } from '@solana/web3.js';

/** Top-level test environment returned by createInfraEnv(). */
export interface TestEnvironment {
    umi: Context;
    connection: Connection;
    infraExecutor: KeypairSigner;
}

/** Per-suite test context — typically one per describe() block. */
export interface TestContext {
    umi: Context;
    connection: Connection;
    executor: KeypairSigner;
    lookupTable?: AddressLookupTableInput;
}

/** Minimal key set for program admin operations. */
export interface TestKeys {
    admin: KeypairSigner;
}

/** Decoded PacketSent event emitted by the LZ endpoint after a cross-chain send. */
export interface PacketSentEvent {
    encodedPacket: Uint8Array;
    options: Uint8Array;
    sendLibrary: PublicKey;
}
