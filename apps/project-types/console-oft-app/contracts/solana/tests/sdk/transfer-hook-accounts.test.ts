import {
    AccountType,
    ExtensionType,
    getExtraAccountMetaAddress,
    MintLayout,
    TOKEN_2022_PROGRAM_ID,
    TransferHookLayout,
} from '@solana/spl-token';
import { type AccountInfo, type Connection, PublicKey } from '@solana/web3.js';
import { describe, expect, it } from 'vitest';

import { getTransferHookAccounts } from '../helpers/transfer-hook-accounts';

const key = (byte: number) => new PublicKey(new Uint8Array(32).fill(byte));
const mint = key(1);
const hook = key(2);
const witness = getExtraAccountMetaAddress(mint, hook);
const account = (data: Buffer, owner: PublicKey): AccountInfo<Buffer> => ({
    data,
    owner,
    lamports: 1,
    executable: false,
    rentEpoch: 0,
});

function connection(manifest: AccountInfo<Buffer> | null, program = hook): Connection {
    const data = Buffer.alloc(170 + TransferHookLayout.span);
    MintLayout.encode(
        {
            mintAuthorityOption: 0,
            mintAuthority: PublicKey.default,
            supply: 0n,
            decimals: 6,
            isInitialized: true,
            freezeAuthorityOption: 0,
            freezeAuthority: PublicKey.default,
        },
        data,
    );
    data[165] = AccountType.Mint;
    data.writeUInt16LE(ExtensionType.TransferHook, 166);
    data.writeUInt16LE(TransferHookLayout.span, 168);
    TransferHookLayout.encode(
        { authority: PublicKey.default, programId: program },
        data.subarray(170),
    );
    return {
        getAccountInfo: async (address: PublicKey) => {
            if (address.equals(mint)) return account(data, TOKEN_2022_PROGRAM_ID);
            if (address.equals(witness)) return manifest;
            throw new Error(`Unexpected RPC read: ${address.toBase58()}`);
        },
    } as unknown as Connection;
}

describe('OFT hook wire groups', () => {
    for (const allocated of [false, true]) {
        it(`includes the canonical absent witness (${allocated ? 'prefunded' : 'missing'})`, async () => {
            const rpc = connection(allocated ? account(Buffer.alloc(0), PublicKey.default) : null);
            const metas = await getTransferHookAccounts(rpc, mint, key(3), key(4), key(5), 10n);
            expect(metas).toEqual(
                [hook, witness].map((pubkey) => ({ pubkey, isSigner: false, isWritable: false })),
            );
        });
    }

    it('keeps an initialized zero-entry manifest in the same wire positions', async () => {
        const data = Buffer.alloc(16);
        data.set([105, 37, 101, 197, 75, 251, 102, 26]);
        data.writeUInt32LE(4, 8); // TLV value is the zero-entry list's u32 count.
        const metas = await getTransferHookAccounts(
            connection(account(data, hook)),
            mint,
            key(3),
            key(4),
            key(5),
            10n,
        );
        expect(metas.map((meta) => meta.pubkey)).toEqual([hook, witness]);
    });

    it('emits no group when the live hook program is unset', async () => {
        expect(
            await getTransferHookAccounts(
                connection(null, PublicKey.default),
                mint,
                key(3),
                key(4),
                key(5),
                10n,
            ),
        ).toEqual([]);
    });
});
