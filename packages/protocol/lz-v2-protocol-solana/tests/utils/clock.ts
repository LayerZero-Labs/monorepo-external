import { Connection, SYSVAR_CLOCK_PUBKEY } from '@solana/web3.js';

// The DVN multisig `invoke` checks `digest.expiration > Clock::get().unix_timestamp` against the
// on-chain Clock. Deriving the expiration from the host wall clock (new Date()) is fragile: under
// load the on-chain clock (which tracks wall time) can advance past a host-computed value before the
// tx lands, so a perfectly valid request fails `Expired`. Reading the on-chain clock here keeps the
// expiration relative to the exact value the program compares against.

/** Byte offset of the i64 LE `unix_timestamp` field in the Clock sysvar layout. */
const CLOCK_UNIX_TIMESTAMP_OFFSET = 32;

/** Read the on-chain Clock sysvar `unix_timestamp` (i64 LE). */
export const onChainUnixTimestamp = async (connection: Connection): Promise<bigint> => {
    const clock = await connection.getAccountInfo(SYSVAR_CLOCK_PUBKEY);
    if (!clock) {
        throw new Error('Clock sysvar account not found');
    }
    return clock.data.readBigInt64LE(CLOCK_UNIX_TIMESTAMP_OFFSET);
};

/** Expiration `offsetSeconds` away from the current on-chain time (negative for an expired one). */
export const onChainExpiration = async (
    connection: Connection,
    offsetSeconds: number,
): Promise<bigint> => (await onChainUnixTimestamp(connection)) + BigInt(offsetSeconds);
