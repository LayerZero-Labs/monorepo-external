import { publicKey } from '@metaplex-foundation/umi';
import { expect, it } from 'vitest';

import { hexToBytes } from '@layerzerolabs/common-encoding-utils';
import {
    addressToBytes32,
    PacketSerializer,
    PacketV1Codec,
} from '@layerzerolabs/protocol-codecs-v2';

import {
    EndpointProgram,
    extractEventFromTransactionSignature,
    SimpleMessageLibProgram,
} from '../../../src';
import { accounts, errors } from '../../../src/endpoint';
import { SolanaTestValidator } from '../../setup';
import {
    endpointPDA,
    EOAPP_DELEGATE,
    HACKER,
    hexToNumberArray,
    newNextInPacket,
    NIL_PAYLOAD_HASH,
    sendAndConfirm,
    shouldBeRejected,
    verifyBySimpleMsgLib,
} from '../../utils';

export const testSuite = (validator: SolanaTestValidator): void => {
    const { umi, connection } = validator;
    const wallet = umi.payer;
    const endpointSDK = new EndpointProgram.Endpoint(EndpointProgram.ENDPOINT_PROGRAM_ID);
    const simpleSdk = new SimpleMessageLibProgram.SimpleMessageLib(
        SimpleMessageLibProgram.SIMPLE_MESSAGELIB_PROGRAM_ID,
    );

    it('revert if not authorized', async function () {
        const packet = newNextInPacket();
        const nonce = parseInt(packet.nonce);
        const sender = addressToBytes32(packet.sender);
        const receiver = publicKey(addressToBytes32(packet.receiver));
        const codec = PacketV1Codec.from(PacketSerializer.serialize(packet));

        /// 1. verify nonce
        const verifyIxs = await verifyBySimpleMsgLib(umi, endpointSDK, simpleSdk, wallet, packet);

        /// 2. nilify
        const ix = endpointSDK.oAppNilify(HACKER, {
            nonce,
            receiver,
            sender,
            srcEid: packet.srcEid,
            payloadHash: hexToBytes(codec.payloadHash()),
        });
        await shouldBeRejected(
            sendAndConfirm(umi, [...verifyIxs, ix], [wallet, HACKER]),
            new errors.UnauthorizedError(endpointSDK.getProgram()),
        );
    });

    it('revert if nilify wrong hash', async function () {
        const packet = newNextInPacket();
        const nonce = parseInt(packet.nonce);
        const sender = addressToBytes32(packet.sender);
        const receiver = publicKey(addressToBytes32(packet.receiver));

        /// 1. verify nonce
        const verifyIx = await verifyBySimpleMsgLib(umi, endpointSDK, simpleSdk, wallet, packet);

        /// 2. nilify
        const ix = endpointSDK.oAppNilify(EOAPP_DELEGATE, {
            nonce,
            receiver,
            sender,
            srcEid: packet.srcEid,
            payloadHash: hexToBytes(
                '0xffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff',
            ),
        });

        await shouldBeRejected(
            sendAndConfirm(umi, [...verifyIx, ix], [wallet, EOAPP_DELEGATE]),
            new errors.PayloadHashNotFoundError(endpointSDK.getProgram()),
        );
    });

    it('should success', async function () {
        const packet = newNextInPacket();
        const nonce = parseInt(packet.nonce);
        const sender = addressToBytes32(packet.sender);
        const receiver = publicKey(addressToBytes32(packet.receiver));
        const codec = PacketV1Codec.from(PacketSerializer.serialize(packet));

        /// 1. verify nonce
        const verifyIx = await verifyBySimpleMsgLib(umi, endpointSDK, simpleSdk, wallet, packet);

        /// 2. nilify
        const ix = endpointSDK.oAppNilify(EOAPP_DELEGATE, {
            nonce,
            receiver,
            sender,
            srcEid: packet.srcEid,
            payloadHash: hexToBytes(codec.payloadHash()),
        });

        const { signature } = await sendAndConfirm(
            umi,
            [...verifyIx, ix],
            [wallet, EOAPP_DELEGATE],
        );

        // check state
        const [payloadHashPda] = endpointPDA.payloadHash(receiver, packet.srcEid, sender, nonce);
        const hashState = await accounts.fetchPayloadHash(umi, payloadHashPda);
        expect(hashState.hash.toString()).to.be.eq(NIL_PAYLOAD_HASH.toString());

        // check event
        const event = await extractEventFromTransactionSignature(
            connection,
            endpointSDK.programId,
            signature,
            EndpointProgram.events.getPacketNilifiedEventSerializer(),
            { commitment: 'confirmed', maxSupportedTransactionVersion: 1 },
        );
        expect(event?.[0].srcEid).to.be.eq(packet.srcEid);
        expect(event?.[0].nonce.toString()).to.be.eq(nonce.toString());
        expect(event?.[0].sender.toString()).to.be.deep.eq(Array.from(sender).toString());
        expect(event?.[0].receiver).to.be.eq(receiver);
        expect(event?.[0].payloadHash.toString()).to.be.eq(
            hexToNumberArray(codec.payloadHash()).toString(),
        );
    });
};
