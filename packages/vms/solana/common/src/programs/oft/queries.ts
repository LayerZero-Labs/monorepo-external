import type { AccountInfo } from '@solana/web3.js';
import { PublicKey } from '@solana/web3.js';

import { NonRetryableError } from '@layerzerolabs/common-error-utils';
import {
    BlockedMessageLibProgram,
    EndpointPDADeriver,
    EndpointProgram,
    MessageLibPDADeriver,
    UlnPDADeriver,
    UlnProgram,
} from '@layerzerolabs/lz-solana-sdk-v2';
import * as oft302 from '@layerzerolabs/oft-v2-solana-sdk';

import type { SolanaProvider } from '../../provider';
import { OftPDA } from './pda';

// The endpoint stores the library's `MessageLib` PDA; resolve it to the owning program.
async function resolveMessageLibProgram(
    provider: SolanaProvider,
    messageLib: PublicKey,
): Promise<Uint8Array | null> {
    if (messageLib.equals(PublicKey.default)) {
        return PublicKey.default.toBytes();
    }
    // The blocked messagelib never initializes its `MessageLib` PDA, so its owner can't be read.
    // Derived per call rather than at module load, so importing this module doesn't touch the SDK
    // (consumers that partially mock `lz-solana-sdk-v2` would otherwise fail on import).
    const [blockedMessageLibPda] = new MessageLibPDADeriver(
        BlockedMessageLibProgram.PROGRAM_ID,
    ).messageLib();
    if (messageLib.equals(blockedMessageLibPda)) {
        return BlockedMessageLibProgram.PROGRAM_ID.toBytes();
    }

    const messageLibAccountInfo = await provider.connection.getAccountInfo(messageLib);
    if (!messageLibAccountInfo) {
        return null;
    }

    return messageLibAccountInfo.owner.toBytes();
}

export async function getOftProgramId(args: {
    provider: SolanaProvider;
    localOapp: string;
}): Promise<PublicKey | null> {
    const { provider, localOapp } = args;

    // TODO: convert the base58 string inputs across this module to a validated `Base58String`
    // type so malformed input is rejected at the type boundary instead of
    // throwing from `new PublicKey` here.

    // the oapp is the oftStore PDA, the owner of it is the ProgramId
    const accountInfo = await provider.connection.getAccountInfo(new PublicKey(localOapp));
    if (!accountInfo) {
        return null;
    }

    return accountInfo.owner;
}

export async function getPeerAccountData(args: {
    provider: SolanaProvider;
    oftProgramId: string;
    localOapp: string;
    remoteEid: number;
}): Promise<oft302.oft.accounts.PeerConfigAccountData | null> {
    const { provider, oftProgramId, localOapp, remoteEid } = args;

    const oftDeriver = new OftPDA(oftProgramId);
    const peerPda = oftDeriver.peer(localOapp, remoteEid);
    const deserializer = oft302.oft.accounts.getPeerConfigAccountDataSerializer();
    const peerAccountInfo = await provider.connection.getAccountInfo(peerPda);
    if (!peerAccountInfo) {
        return null;
    }

    const [peerAccountData] = deserializer.deserialize(peerAccountInfo.data);

    return peerAccountData;
}

export type PeerAccountByEid = {
    eid: number;
    data: oft302.oft.accounts.PeerConfigAccountData;
};

// `Connection.getMultipleAccountsInfo` caps each RPC call at 100 keys.
export const GET_MULTIPLE_ACCOUNTS_BATCH_SIZE = 100;

export async function getPeerAccountsByEid(args: {
    provider: SolanaProvider;
    oftProgramId: string;
    oftStore: string;
    eidChunks: { from: number; to: number }[];
}): Promise<PeerAccountByEid[]> {
    const { provider, oftProgramId, oftStore, eidChunks } = args;

    const oftDeriver = new OftPDA(oftProgramId);
    const deserializer = oft302.oft.accounts.getPeerConfigAccountDataSerializer();

    const chunkResults = await Promise.all(
        eidChunks.map(async ({ from, to }) => {
            const eids = Array.from({ length: to - from + 1 }, (_, i) => from + i);
            const pdas = eids.map((eid) => oftDeriver.peer(oftStore, eid));
            const accountInfos = await provider.connection.getMultipleAccountsInfo(pdas);
            return { eids, accountInfos };
        }),
    );

    const peers: PeerAccountByEid[] = [];
    for (const { eids, accountInfos } of chunkResults) {
        accountInfos.forEach((accountInfo, i) => {
            if (!accountInfo) return;
            const [data] = deserializer.deserialize(accountInfo.data);
            peers.push({ eid: eids[i], data });
        });
    }

    return peers;
}

export async function getReceiveLibraryProgram(args: {
    provider: SolanaProvider;
    receiver: string;
    remoteEid: number;
}): Promise<Uint8Array | null> {
    const { provider, receiver, remoteEid } = args;

    const endpointDeriver = new EndpointPDADeriver(new PublicKey(EndpointProgram.PROGRAM_ID));
    const [receiveLibConfigPda] = endpointDeriver.receiveLibraryConfig(
        new PublicKey(receiver),
        remoteEid,
    );

    const receiveLibConfigAccountInfo =
        await provider.connection.getAccountInfo(receiveLibConfigPda);
    if (!receiveLibConfigAccountInfo) {
        return null;
    }

    const [receiveLibConfig] = EndpointProgram.accounts.ReceiveLibraryConfig.fromAccountInfo(
        receiveLibConfigAccountInfo,
    );
    return resolveMessageLibProgram(provider, receiveLibConfig.messageLib);
}

export async function getSendLibraryProgram(args: {
    provider: SolanaProvider;
    sender: string;
    remoteEid: number;
}): Promise<Uint8Array | null> {
    const { provider, sender, remoteEid } = args;

    const endpointDeriver = new EndpointPDADeriver(new PublicKey(EndpointProgram.PROGRAM_ID));
    const [sendLibConfigPda] = endpointDeriver.sendLibraryConfig(new PublicKey(sender), remoteEid);

    const sendLibConfigAccountInfo = await provider.connection.getAccountInfo(sendLibConfigPda);
    if (!sendLibConfigAccountInfo) {
        return null;
    }

    const [sendLibConfig] =
        EndpointProgram.accounts.SendLibraryConfig.fromAccountInfo(sendLibConfigAccountInfo);
    return resolveMessageLibProgram(provider, sendLibConfig.messageLib);
}

export async function getSendConfigAccountInfo(args: {
    provider: SolanaProvider;
    sender: string;
    remoteEid: number;
}): Promise<AccountInfo<Buffer> | null> {
    const { provider, sender, remoteEid } = args;

    const ulnDeriver = new UlnPDADeriver(new PublicKey(UlnProgram.PROGRAM_ID));
    const [sendConfigPda] = ulnDeriver.sendConfig(remoteEid, new PublicKey(sender));

    return await provider.connection.getAccountInfo(sendConfigPda);
}

export async function getReceiveConfigAccountInfo(args: {
    provider: SolanaProvider;
    receiver: string;
    remoteEid: number;
}): Promise<AccountInfo<Buffer> | null> {
    const { provider, receiver, remoteEid } = args;

    const ulnDeriver = new UlnPDADeriver(new PublicKey(UlnProgram.PROGRAM_ID));
    const [receiveConfigPda] = ulnDeriver.receiveConfig(remoteEid, new PublicKey(receiver));

    return await provider.connection.getAccountInfo(receiveConfigPda);
}

/**
 * Reads raw send `UlnConfig` PDA without resolving sentinels or applying default substitutions.
 *
 * Returns null if not initialized.
 */
export async function getRawSendConfig(args: {
    provider: SolanaProvider;
    oftStore: string;
    remoteEid: number;
}): Promise<UlnProgram.accounts.SendConfig | null> {
    const { provider, oftStore, remoteEid } = args;

    const ulnDeriver = new UlnPDADeriver(new PublicKey(UlnProgram.PROGRAM_ID));
    const [sendConfigPda] = ulnDeriver.sendConfig(remoteEid, new PublicKey(oftStore));

    const sendConfigAccountInfo = await provider.connection.getAccountInfo(sendConfigPda);
    if (!sendConfigAccountInfo) {
        return null;
    }

    const [rawSendConfig] = UlnProgram.accounts.SendConfig.fromAccountInfo(sendConfigAccountInfo);

    return rawSendConfig;
}

/**
 * Reads raw receive `UlnConfig` PDA without resolving sentinels or applying default
 * substitutions.
 *
 * Returns null if not initialized.
 */
export async function getRawReceiveConfig(args: {
    provider: SolanaProvider;
    oftStore: string;
    remoteEid: number;
}): Promise<UlnProgram.accounts.ReceiveConfig | null> {
    const { provider, oftStore, remoteEid } = args;

    const ulnDeriver = new UlnPDADeriver(new PublicKey(UlnProgram.PROGRAM_ID));
    const [receiveConfigPda] = ulnDeriver.receiveConfig(remoteEid, new PublicKey(oftStore));

    const receiveConfigAccountInfo = await provider.connection.getAccountInfo(receiveConfigPda);
    if (!receiveConfigAccountInfo) {
        return null;
    }

    const [rawReceiveConfig] =
        UlnProgram.accounts.ReceiveConfig.fromAccountInfo(receiveConfigAccountInfo);

    return rawReceiveConfig;
}

export async function getOAppNonceAccountInfo(args: {
    provider: SolanaProvider;
    oftStore: string;
    remoteEid: number;
    remoteOAppAddr: Uint8Array;
}): Promise<AccountInfo<Buffer> | null> {
    const { provider, oftStore, remoteEid, remoteOAppAddr } = args;

    const endpointDeriver = new EndpointPDADeriver(new PublicKey(EndpointProgram.PROGRAM_ID));
    const [noncePda] = endpointDeriver.nonce(new PublicKey(oftStore), remoteEid, remoteOAppAddr);

    return await provider.connection.getAccountInfo(noncePda);
}

export async function getDelegate(args: {
    provider: SolanaProvider;
    oftStore: string;
}): Promise<string | null> {
    const { provider, oftStore } = args;

    const endpointDeriver = new EndpointPDADeriver(new PublicKey(EndpointProgram.PROGRAM_ID));
    const [oappRegistryPda] = endpointDeriver.oappRegistry(new PublicKey(oftStore));
    const oappRegistryAccountInfo = await provider.connection.getAccountInfo(oappRegistryPda);
    if (!oappRegistryAccountInfo) {
        return null;
    }

    const [oAppRegistry] =
        EndpointProgram.accounts.OAppRegistry.fromAccountInfo(oappRegistryAccountInfo);

    return oAppRegistry.delegate.toBase58();
}

export async function getOftStore(args: {
    provider: SolanaProvider;
    oftStore: string;
}): Promise<oft302.oft.accounts.OFTStoreAccountData | null> {
    const { provider, oftStore } = args;

    const deserializer = oft302.oft.accounts.getOFTStoreAccountDataSerializer();
    const oftStoreAccountInfo = await provider.connection.getAccountInfo(new PublicKey(oftStore));
    if (!oftStoreAccountInfo) {
        return null;
    }

    const [oftStoreData] = deserializer.deserialize(oftStoreAccountInfo.data);

    return oftStoreData;
}

/**
 * Get the token mint address from an OFT store
 */
export async function getOftTokenMint(args: {
    provider: SolanaProvider;
    oftStore: string;
}): Promise<string> {
    const { provider, oftStore } = args;

    const oftStoreData = await getOftStore({ provider, oftStore });
    if (!oftStoreData) {
        throw new NonRetryableError(`OFT store not found: ${oftStore}`);
    }

    return oftStoreData.tokenMint.toString();
}
