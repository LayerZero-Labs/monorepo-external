import {
    getExtraAccountMetaAddress,
    getExtraAccountMetas,
    getTransferHook,
    resolveExtraAccountMeta,
    TOKEN_2022_PROGRAM_ID,
    unpackMint,
} from '@solana/spl-token';
import { type AccountMeta, type Connection, PublicKey } from '@solana/web3.js';

/** SPL transfer-hook `Execute` discriminator. */
const EXECUTE_DISCRIMINATOR = Buffer.from([105, 37, 101, 197, 75, 251, 102, 26]);

/**
 * The Token-2022 transfer-hook group OFT expects for one transfer on the send path:
 * `[hook program, manifest, resolved extras...]`, or nothing when the mint has no hook (including
 * every SPL Token mint). An unallocated or zero-entry manifest still occupies its canonical slot;
 * OFT consumes the slot but omits an empty manifest from the native CPI.
 */
export async function getTransferHookAccounts(
    connection: Connection,
    mint: PublicKey,
    source: PublicKey,
    destination: PublicKey,
    owner: PublicKey,
    amount: bigint,
): Promise<AccountMeta[]> {
    const mintInfo = await connection.getAccountInfo(mint);
    if (!mintInfo || !mintInfo.owner.equals(TOKEN_2022_PROGRAM_ID)) return [];
    const hook = getTransferHook(unpackMint(mint, mintInfo, TOKEN_2022_PROGRAM_ID));
    if (!hook || hook.programId.equals(PublicKey.default)) return [];

    const manifest = getExtraAccountMetaAddress(mint, hook.programId);
    const group: AccountMeta[] = [
        { pubkey: hook.programId, isSigner: false, isWritable: false },
        { pubkey: manifest, isSigner: false, isWritable: false },
    ];
    const manifestInfo = await connection.getAccountInfo(manifest);
    if (!manifestInfo || manifestInfo.data.length === 0) return group;

    const executeData = Buffer.alloc(16);
    EXECUTE_DISCRIMINATOR.copy(executeData, 0);
    executeData.writeBigUInt64LE(amount, 8);
    const fixed: AccountMeta[] = [
        { pubkey: source, isSigner: false, isWritable: true },
        { pubkey: mint, isSigner: false, isWritable: false },
        { pubkey: destination, isSigner: false, isWritable: true },
        { pubkey: owner, isSigner: true, isWritable: false },
        { pubkey: manifest, isSigner: false, isWritable: false },
    ];
    const extras: AccountMeta[] = [];
    for (const meta of getExtraAccountMetas(manifestInfo)) {
        extras.push(
            await resolveExtraAccountMeta(
                connection,
                meta,
                [...fixed, ...extras],
                executeData,
                hook.programId,
            ),
        );
    }
    return [...group, ...extras];
}
