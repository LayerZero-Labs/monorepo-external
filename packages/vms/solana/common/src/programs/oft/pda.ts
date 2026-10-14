import type { PublicKey } from '@metaplex-foundation/umi';
import { publicKey, publicKeyBytes } from '@metaplex-foundation/umi';
import { Endian, u32 } from '@metaplex-foundation/umi/serializers';
import { createWeb3JsEddsa } from '@metaplex-foundation/umi-eddsa-web3js';
import { toWeb3JsPublicKey } from '@metaplex-foundation/umi-web3js-adapters';
import type { PublicKey as Web3JsPublicKey } from '@solana/web3.js';

import { OFT_SEED, PEER_SEED } from '@layerzerolabs/oft-v2-solana-sdk';

export const LZ_RECEIVE_TYPES_SEED = 'LzReceiveTypes';

export class OftPDA {
    public program: PublicKey;

    constructor(public readonly programId: PublicKey | string) {
        if (typeof programId === 'string') {
            this.program = publicKey(programId);
        }
    }

    config(): Web3JsPublicKey {
        return toWeb3JsPublicKey(
            createWeb3JsEddsa().findPda(this.program, [Buffer.from('OftConfig', 'utf8')])[0],
        );
    }

    peer(oftStore: string, eid: number): Web3JsPublicKey {
        return toWeb3JsPublicKey(
            createWeb3JsEddsa().findPda(this.program, [
                Buffer.from(PEER_SEED, 'utf8'),
                publicKeyBytes(oftStore),
                u32({ endian: Endian.Big }).serialize(eid),
                // new BN(eid).toArrayLike(Buffer, 'be', 4),
            ])[0],
        );
    }

    oftStore(escrow: string): Web3JsPublicKey {
        return toWeb3JsPublicKey(
            createWeb3JsEddsa().findPda(this.program, [
                Buffer.from(OFT_SEED, 'utf8'),
                publicKeyBytes(escrow),
            ])[0],
        );
    }

    lzReceiveTypesAccounts(oftConfig: string): Web3JsPublicKey {
        return toWeb3JsPublicKey(
            createWeb3JsEddsa().findPda(this.program, [
                Buffer.from(LZ_RECEIVE_TYPES_SEED, 'utf8'),
                publicKeyBytes(oftConfig),
            ])[0],
        );
    }
}
