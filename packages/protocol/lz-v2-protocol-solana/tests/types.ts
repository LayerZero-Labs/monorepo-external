import {
    AddressLookupTableInput,
    Context,
    KeypairSigner,
    PublicKey,
} from '@metaplex-foundation/umi';
import { Connection } from '@solana/web3.js';

import { EndpointProgram } from '../src';

export interface TestContext {
    umi: Context;
    connection: Connection;
    lookupTable?: AddressLookupTableInput;
}

export type PacketSentEvent = ReturnType<
    ReturnType<typeof EndpointProgram.events.getPacketSentEventSerializer>['deserialize']
>[0];

export interface OftKeys {
    escrow: KeypairSigner;
    mint: KeypairSigner;
    tokenMintAuthority: PublicKey;
    tokenWithdrawableAuthority: KeypairSigner;
    transferFeeConfigAuthority: KeypairSigner;
    oappAdmin: KeypairSigner;
    oappAdminTokenAccount?: PublicKey;
    oftStore: PublicKey;
}
