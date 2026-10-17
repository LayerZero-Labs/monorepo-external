import type { PublicKey } from '@metaplex-foundation/umi';
import type { Serializer } from '@metaplex-foundation/umi/serializers';
import {
    bytes,
    publicKey as publicKeySerializer,
    struct,
    u16,
    u32,
    u64,
} from '@metaplex-foundation/umi/serializers';

/**
 * Interface representing the parameters for LzReceive.
 */
export interface LzReceiveParams {
    /**
     * Source EID.
     */
    srcEid: number;
    /**
     * Sender address (size: 32).
     */
    sender: Uint8Array;

    nonce: bigint;

    /**
     * GUID (size: 32).
     */
    guid: Uint8Array;

    /**
     * Message content.
     */
    message: Uint8Array;

    /**
     * Caller parameters.
     */
    callerParams: Uint8Array;
}

export interface LzReceiveParamsArgs {
    srcEid: number;
    sender: Uint8Array;
    nonce: number | bigint;
    guid: Uint8Array;
    message: Uint8Array;
    callerParams: Uint8Array;
}

export function getLzReceiveParamsSerializer(): Serializer<LzReceiveParamsArgs, LzReceiveParams> {
    return struct<LzReceiveParams>(
        [
            ['srcEid', u32()],
            ['sender', bytes({ size: 32 })],
            ['nonce', u64()],
            ['guid', bytes({ size: 32 })],
            ['message', bytes({ size: u32() })],
            ['callerParams', bytes({ size: u32() })],
        ],
        { description: 'LzReceiveParams' },
    ) as Serializer<LzReceiveParamsArgs, LzReceiveParams>;
}

/**
 *
pub from: Pubkey,
pub to: Pubkey,
pub guid: [u8; 32],
pub index: u16,
pub message: Vec<u8>,
pub extra_data: Vec<u8>,
**/

/**
 * Interface representing the parameters for LzCompose.
 */
export interface LzComposeParams {
    /**
     * Sender public key.
     */
    from: PublicKey;

    /**
     * Recipient public key.
     */
    to: PublicKey;

    /**
     * GUID (size: 32).
     */
    guid: Uint8Array;

    /**
     * Index value.
     */
    index: number;

    /**
     * Message content.
     */
    message: Uint8Array;

    /**
     * Extra data.
     */
    extraData: Uint8Array;
}

export function getLzComposeParamsSerializer(): Serializer<LzComposeParams, LzComposeParams> {
    return struct<LzComposeParams>(
        [
            ['from', publicKeySerializer()],
            ['to', publicKeySerializer()],
            ['guid', bytes({ size: 32 })],
            ['index', u16()],
            ['message', bytes({ size: u32() })],
            ['extraData', bytes({ size: u32() })],
        ],
        { description: 'LzComposeParams' },
    );
}
