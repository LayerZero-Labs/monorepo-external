import type { AccountInfo } from '@solana/web3.js';
import { Keypair, PublicKey } from '@solana/web3.js';
import { describe, expect, it } from 'vitest';

import {
    BlockedMessageLibProgram,
    EndpointPDADeriver,
    EndpointProgram,
    MessageLibPDADeriver,
    UlnProgram,
} from '@layerzerolabs/lz-solana-sdk-v2';

import { getReceiveLibraryProgram, getSendLibraryProgram } from '../src/programs/oft/queries';
import type { SolanaProvider } from '../src/provider';

const REMOTE_EID = 30110;
const OAPP = Keypair.generate().publicKey;

const endpointDeriver = new EndpointPDADeriver(EndpointProgram.PROGRAM_ID);
const [SEND_LIB_CONFIG_PDA] = endpointDeriver.sendLibraryConfig(OAPP, REMOTE_EID);
const [RECEIVE_LIB_CONFIG_PDA] = endpointDeriver.receiveLibraryConfig(OAPP, REMOTE_EID);
const [BLOCKED_MESSAGE_LIB_PDA] = new MessageLibPDADeriver(
    BlockedMessageLibProgram.PROGRAM_ID,
).messageLib();
const [ULN_MESSAGE_LIB_PDA] = new MessageLibPDADeriver(UlnProgram.PROGRAM_ID).messageLib();

const accountInfo = (owner: PublicKey, data = Buffer.alloc(0)): AccountInfo<Buffer> => ({
    owner,
    data,
    executable: false,
    lamports: 1,
    rentEpoch: 0,
});

// The queries only call `connection.getAccountInfo`, so a partial provider is sufficient here.
const makeProvider = (accounts: [PublicKey, AccountInfo<Buffer>][] = []): SolanaProvider => {
    const byAddress = new Map(accounts.map(([address, info]) => [address.toBase58(), info]));
    return {
        connection: {
            getAccountInfo: async (address: PublicKey) => byAddress.get(address.toBase58()) ?? null,
        },
    } as unknown as SolanaProvider;
};

const sendLibConfig = (messageLib: PublicKey): [PublicKey, AccountInfo<Buffer>] => {
    const [data] = EndpointProgram.accounts.SendLibraryConfig.fromArgs({
        messageLib,
        bump: 255,
    }).serialize();
    return [SEND_LIB_CONFIG_PDA, accountInfo(EndpointProgram.PROGRAM_ID, data)];
};

const receiveLibConfig = (messageLib: PublicKey): [PublicKey, AccountInfo<Buffer>] => {
    const [data] = EndpointProgram.accounts.ReceiveLibraryConfig.fromArgs({
        messageLib,
        timeout: null,
        bump: 255,
    }).serialize();
    return [RECEIVE_LIB_CONFIG_PDA, accountInfo(EndpointProgram.PROGRAM_ID, data)];
};

const ulnMessageLib: [PublicKey, AccountInfo<Buffer>] = [
    ULN_MESSAGE_LIB_PDA,
    accountInfo(UlnProgram.PROGRAM_ID),
];

describe('getSendLibraryProgram', () => {
    const query = (provider: SolanaProvider) =>
        getSendLibraryProgram({ provider, sender: OAPP.toBase58(), remoteEid: REMOTE_EID });

    it('returns the blocked messagelib program, whose MessageLib PDA is never created', async () => {
        const provider = makeProvider([sendLibConfig(BLOCKED_MESSAGE_LIB_PDA)]);
        expect(await query(provider)).toEqual(BlockedMessageLibProgram.PROGRAM_ID.toBytes());
    });

    it('returns the default key when the OApp uses the default library', async () => {
        const provider = makeProvider([sendLibConfig(PublicKey.default)]);
        expect(await query(provider)).toEqual(PublicKey.default.toBytes());
    });

    it('returns the owner of an initialized MessageLib PDA', async () => {
        const provider = makeProvider([sendLibConfig(ULN_MESSAGE_LIB_PDA), ulnMessageLib]);
        expect(await query(provider)).toEqual(UlnProgram.PROGRAM_ID.toBytes());
    });

    it('returns null when the MessageLib account does not exist', async () => {
        const provider = makeProvider([sendLibConfig(Keypair.generate().publicKey)]);
        expect(await query(provider)).toBeNull();
    });

    it('returns null when the library config does not exist', async () => {
        expect(await query(makeProvider())).toBeNull();
    });
});

describe('getReceiveLibraryProgram', () => {
    const query = (provider: SolanaProvider) =>
        getReceiveLibraryProgram({ provider, receiver: OAPP.toBase58(), remoteEid: REMOTE_EID });

    it('returns the blocked messagelib program, whose MessageLib PDA is never created', async () => {
        const provider = makeProvider([receiveLibConfig(BLOCKED_MESSAGE_LIB_PDA)]);
        expect(await query(provider)).toEqual(BlockedMessageLibProgram.PROGRAM_ID.toBytes());
    });

    it('returns the default key when the OApp uses the default library', async () => {
        const provider = makeProvider([receiveLibConfig(PublicKey.default)]);
        expect(await query(provider)).toEqual(PublicKey.default.toBytes());
    });

    it('returns the owner of an initialized MessageLib PDA', async () => {
        const provider = makeProvider([receiveLibConfig(ULN_MESSAGE_LIB_PDA), ulnMessageLib]);
        expect(await query(provider)).toEqual(UlnProgram.PROGRAM_ID.toBytes());
    });

    it('returns null when the MessageLib account does not exist', async () => {
        const provider = makeProvider([receiveLibConfig(Keypair.generate().publicKey)]);
        expect(await query(provider)).toBeNull();
    });

    it('returns null when the library config does not exist', async () => {
        expect(await query(makeProvider())).toBeNull();
    });
});
