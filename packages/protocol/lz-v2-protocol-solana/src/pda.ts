import type { Pda, PublicKey } from '@metaplex-foundation/umi';
import { defaultPublicKey, publicKeyBytes } from '@metaplex-foundation/umi';
import { Endian, u8, u16, u32, u64 } from '@metaplex-foundation/umi/serializers';
import { createWeb3JsEddsa } from '@metaplex-foundation/umi-eddsa-web3js';

export const EDDSA = createWeb3JsEddsa();

/**
 * derive address for endpoint program
 */
export class EndpointPDA {
    static ENDPOINT_SEED = 'Endpoint';
    static SEND_LIBRARY_CONFIG_SEED = 'SendLibraryConfig';
    static RECEIVE_LIBRARY_CONFIG_SEED = 'ReceiveLibraryConfig';
    static NONCE_SEED = 'Nonce';
    static PENDING_NONCE_SEED = 'PendingNonce';
    static OAPP_SEED = 'OApp';
    static PAYLOAD_HASH_SEED = 'PayloadHash';
    static COMPOSED_MESSAGE_HASH_SEED = 'ComposedMessageHash';

    program: PublicKey;

    constructor(program: PublicKey) {
        this.program = program;
    }

    setting(): Pda {
        return EDDSA.findPda(this.program, [Buffer.from(EndpointPDA.ENDPOINT_SEED, 'utf8')]);
    }

    defaultSendLibraryConfig(dstEndpointId: number): Pda {
        return EDDSA.findPda(this.program, [
            Buffer.from(EndpointPDA.SEND_LIBRARY_CONFIG_SEED, 'utf8'),
            u32({ endian: Endian.Big }).serialize(dstEndpointId),
            // new BN(dstEndpointId).toArrayLike(Buffer, 'be', 4),
        ]);
    }

    sendLibraryConfig(sender: PublicKey, dstEndpointId: number): Pda {
        return EDDSA.findPda(this.program, [
            Buffer.from(EndpointPDA.SEND_LIBRARY_CONFIG_SEED, 'utf8'),
            publicKeyBytes(sender),
            u32({ endian: Endian.Big }).serialize(dstEndpointId),
            // new BN(dstEndpointId).toArrayLike(Buffer, 'be', 4),
        ]);
    }

    /**
     * @param messageLibrary PDA(derive by message lib program)
     */
    messageLibraryInfo(messageLibrary: PublicKey): Pda {
        return EDDSA.findPda(this.program, [
            Buffer.from(MessageLibPDA.MESSAGE_LIB_SEED, 'utf8'),
            publicKeyBytes(messageLibrary),
        ]);
    }

    defaultReceiveLibraryConfig(srcEndpointId: number): Pda {
        return EDDSA.findPda(this.program, [
            Buffer.from(EndpointPDA.RECEIVE_LIBRARY_CONFIG_SEED, 'utf8'),
            u32({ endian: Endian.Big }).serialize(srcEndpointId),
            // new BN(srcEndpointId).toArrayLike(Buffer, 'be', 4),
        ]);
    }

    receiveLibraryConfig(receiver: PublicKey, srcEndpointId: number): Pda {
        return EDDSA.findPda(this.program, [
            Buffer.from(EndpointPDA.RECEIVE_LIBRARY_CONFIG_SEED, 'utf8'),
            publicKeyBytes(receiver),
            u32({ endian: Endian.Big }).serialize(srcEndpointId),
            // new BN(srcEndpointId).toArrayLike(Buffer, 'be', 4),
        ]);
    }

    receiveLibraryTimeout(_dstEndpointId: number): [PublicKey, number] {
        // TODO-SOLANA: resolve the receive-library timeout config PDA (default vs custom).
        return [this.program, 0];
    }

    defaultMessageLib(): Pda {
        // return this.messageLibraryInfo(PublicKey.default)
        return this.messageLibraryInfo(defaultPublicKey());
    }

    blockMessageLib(blockMsgLib: PublicKey): Pda {
        return EDDSA.findPda(this.program, [
            Buffer.from(MessageLibPDA.MESSAGE_LIB_SEED, 'utf8'),
            publicKeyBytes(blockMsgLib),
        ]);
    }

    /**
     * @param oapp
     * @param remoteChainId
     * @param remoteOapp
     */
    nonce(oapp: PublicKey, remoteChainId: number, remoteOapp: Uint8Array): Pda {
        return EDDSA.findPda(this.program, [
            Buffer.from(EndpointPDA.NONCE_SEED, 'utf8'),
            publicKeyBytes(oapp),
            u32({ endian: Endian.Big }).serialize(remoteChainId),
            // new BN(remoteChainId).toArrayLike(Buffer, 'be', 4),
            remoteOapp,
        ]);
    }

    pendingNonce(oapp: PublicKey, remoteChainId: number, remoteOapp: Uint8Array): Pda {
        return EDDSA.findPda(this.program, [
            Buffer.from(EndpointPDA.PENDING_NONCE_SEED, 'utf8'),
            publicKeyBytes(oapp),
            u32({ endian: Endian.Big }).serialize(remoteChainId),
            remoteOapp,
        ]);
    }

    oappRegistry(oapp: PublicKey): Pda {
        return EDDSA.findPda(this.program, [
            Buffer.from(EndpointPDA.OAPP_SEED, 'utf8'),
            publicKeyBytes(oapp),
        ]);
    }

    /***
     * @param receiver
     * @param srcEid
     * @param sender
     * @param nonce
     * @param payloadHash
     * @srcChainId u32 to big endian Uint8Array
     * @sender [u8; 32] sender Address
     * @nonce u64 to big endian Uint8Array
     * @payloadHash [u8; 32]
     */
    payloadHash(
        receiver: PublicKey,
        srcEid: number,
        sender: Uint8Array,
        nonce: number | bigint,
    ): Pda {
        return EDDSA.findPda(this.program, [
            Buffer.from(EndpointPDA.PAYLOAD_HASH_SEED, 'utf8'),
            publicKeyBytes(receiver),
            u32({ endian: Endian.Big }).serialize(srcEid),
            sender,
            u64({ endian: Endian.Big }).serialize(nonce),
        ]);
    }

    composedMessage(
        from: PublicKey,
        guid: Uint8Array,
        index: number,
        to: PublicKey,
        messageHash: Uint8Array,
    ): Pda {
        return EDDSA.findPda(
            this.program,
            [
                Buffer.from(EndpointPDA.COMPOSED_MESSAGE_HASH_SEED, 'utf8'),
                publicKeyBytes(from),
                publicKeyBytes(to),
                guid,
                u16({ endian: Endian.Big }).serialize(index),
                messageHash,
            ],
            // this.program
        );
    }
}

/***
 * derive address by message lib program
 */
export class MessageLibPDA {
    static SEND_CONFIG_SEED = 'SendConfig';
    static RECEIVE_CONFIG_SEED = 'ReceiveConfig';
    static MESSAGE_LIB_SEED = 'MessageLib';

    program: PublicKey;

    constructor(program: PublicKey) {
        this.program = program;
    }

    messageLib(): Pda {
        return EDDSA.findPda(this.program, [Buffer.from(MessageLibPDA.MESSAGE_LIB_SEED, 'utf8')]);
    }

    sendConfig(eid: number, oapp: PublicKey): Pda {
        return EDDSA.findPda(this.program, [
            Buffer.from(MessageLibPDA.SEND_CONFIG_SEED, 'utf8'),
            u32({ endian: Endian.Big }).serialize(eid),
            publicKeyBytes(oapp),
            // oapp.toBuffer(),
        ]);
    }

    receiveConfig(eid: number, oapp: PublicKey): Pda {
        return EDDSA.findPda(this.program, [
            Buffer.from(MessageLibPDA.RECEIVE_CONFIG_SEED, 'utf8'),
            u32({ endian: Endian.Big }).serialize(eid),
            publicKeyBytes(oapp),
        ]);
    }
}

export class UlnPDA extends MessageLibPDA {
    static ULN_SEED = MessageLibPDA.MESSAGE_LIB_SEED;
    static ULN_CONFIG_SEED = 'UlnConfig';
    static OPTIONS_SEED = 'Options';
    static CONFIRMATIONS_SEED = 'Confirmations';
    static WORKER_SEED = 'Worker';

    setting(): Pda {
        return EDDSA.findPda(this.program, [Buffer.from(UlnPDA.ULN_SEED, 'utf8')]);
    }

    config(eid: number): Pda {
        return EDDSA.findPda(this.program, [
            Buffer.from(UlnPDA.ULN_CONFIG_SEED, 'utf8'),
            u32({ endian: Endian.Big }).serialize(eid),
        ]);
    }

    defaultSendConfig(eid: number): Pda {
        return EDDSA.findPda(this.program, [
            Buffer.from(MessageLibPDA.SEND_CONFIG_SEED, 'utf8'),
            u32({ endian: Endian.Big }).serialize(eid),
        ]);
    }

    defaultReceiveConfig(eid: number): Pda {
        return EDDSA.findPda(this.program, [
            Buffer.from(MessageLibPDA.RECEIVE_CONFIG_SEED, 'utf8'),
            u32({ endian: Endian.Big }).serialize(eid),
        ]);
    }

    options(eit: number): Pda {
        return EDDSA.findPda(this.program, [
            Buffer.from(UlnPDA.OPTIONS_SEED, 'utf8'),
            u32({ endian: Endian.Big }).serialize(eit),
        ]);
    }

    workerConfig(worker: PublicKey): Pda {
        return EDDSA.findPda(this.program, [
            Buffer.from(UlnPDA.WORKER_SEED, 'utf8'),
            publicKeyBytes(worker),
        ]);
    }

    confirmations(headerHash: Uint8Array, payloadHash: Uint8Array, dvn: PublicKey): Pda {
        return EDDSA.findPda(this.program, [
            Buffer.from(UlnPDA.CONFIRMATIONS_SEED, 'utf8'),
            headerHash,
            payloadHash,
            publicKeyBytes(dvn),
        ]);
    }
}

/**
 * derive address by base oapp program
 */
export class OmniAppPDA {
    static PEER_SEED = 'Peer';
    static LZ_RECEIVE_TYPES_SEED = 'LzReceiveTypes';
    static LZ_COMPOSE_TYPES_SEED = 'LzComposeTypes';

    constructor(public readonly programId: PublicKey) {}

    oapp(): Pda {
        throw new Error('Method not implemented.');
    }

    lzReceiveTypesAccounts(receiver?: PublicKey): Pda {
        return EDDSA.findPda(this.programId, [
            Buffer.from(OmniAppPDA.LZ_RECEIVE_TYPES_SEED, 'utf8'),
            publicKeyBytes(receiver ?? this.oapp()[0]),
        ]);
    }

    lzComposeTypesAccounts(to?: PublicKey): Pda {
        return EDDSA.findPda(this.programId, [
            Buffer.from(OmniAppPDA.LZ_COMPOSE_TYPES_SEED, 'utf8'),
            publicKeyBytes(to ?? this.oapp()[0]),
        ]);
    }
}

export class DvnPDA {
    static DVN_CONFIG_SEED = 'DvnConfig';

    constructor(public program: PublicKey) {}

    authority(): Pda {
        return EDDSA.findPda(this.program, [Buffer.from('dvn', 'utf8')]);
    }

    config(): Pda {
        return EDDSA.findPda(this.program, [Buffer.from(DvnPDA.DVN_CONFIG_SEED, 'utf8')]);
    }

    executeHash(digestHash: Buffer): Pda {
        return EDDSA.findPda(this.program, [Buffer.from('ExecuteHash', 'utf8'), digestHash]);
    }
}

export class EventPDA {
    static EVENT_SEED = '__event_authority';

    constructor(public program: PublicKey) {}

    eventAuthority(): Pda {
        return EDDSA.findPda(this.program, [Buffer.from(EventPDA.EVENT_SEED, 'utf8')]);
    }
}

export class ExecutorPDA {
    static EXECUTOR_CONFIG_SEED = 'ExecutorConfig';
    static EXECUTION_CONTEXT_SEED = 'ExecutionContext';

    constructor(public program: PublicKey) {}

    config(): Pda {
        return EDDSA.findPda(this.program, [Buffer.from(ExecutorPDA.EXECUTOR_CONFIG_SEED, 'utf8')]);
    }

    context(executor: PublicKey, version: number): Pda {
        return EDDSA.findPda(this.program, [
            Buffer.from(ExecutorPDA.EXECUTION_CONTEXT_SEED, 'utf8'),
            publicKeyBytes(executor),
            u8().serialize(version),
        ]);
    }
}

export class PriceFeedPDA {
    static PRICE_FEED_SEED = 'PriceFeed';

    constructor(public program: PublicKey) {}

    priceFeed(): Pda {
        return EDDSA.findPda(this.program, [Buffer.from(PriceFeedPDA.PRICE_FEED_SEED, 'utf8')]);
    }
}
