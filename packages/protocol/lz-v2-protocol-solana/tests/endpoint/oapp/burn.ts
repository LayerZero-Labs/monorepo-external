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
import { errors } from '../../../src/endpoint';
import { SolanaTestValidator } from '../../setup';
import {
    clear,
    endpointPDA,
    EOAPP_DELEGATE,
    HACKER,
    hexToNumberArray,
    newNextInPacket,
    sendAndConfirm,
    setOAppInBoundNonce,
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

    it('should success', async function () {
        const packet1 = newNextInPacket();
        const nonce1 = parseInt(packet1.nonce);
        const sender = addressToBytes32(packet1.sender);
        const receiver = publicKey(addressToBytes32(packet1.receiver));
        // PDAs
        const [payloadHashPda1] = endpointPDA.payloadHash(receiver, packet1.srcEid, sender, nonce1);
        const codec = PacketV1Codec.from(PacketSerializer.serialize(packet1));
        /// 1-1. verify nonce1
        const verifyIx1 = await verifyBySimpleMsgLib(umi, endpointSDK, simpleSdk, wallet, packet1);

        const packet2 = newNextInPacket();
        packet2.nonce = `${parseInt(packet1.nonce) + 1}`;
        /// 1-2. verify nonce2
        const verifyIx2 = await verifyBySimpleMsgLib(umi, endpointSDK, simpleSdk, wallet, packet2);

        /// 2. clear nonce2
        const clearIx2 = clear(EOAPP_DELEGATE, packet2);

        await sendAndConfirm(umi, [...verifyIx1, ...verifyIx2, clearIx2], [wallet, EOAPP_DELEGATE]);
        setOAppInBoundNonce(BigInt(packet2.nonce));

        /// 3. burn nonce1
        const ix = endpointSDK.oAppBurnNonce(EOAPP_DELEGATE, {
            nonce: nonce1,
            receiver: receiver,
            sender: sender,
            srcEid: packet1.srcEid,
            payloadHash: hexToBytes(codec.payloadHash()),
        });

        const { signature } = await sendAndConfirm(umi, ix, [wallet, EOAPP_DELEGATE]);

        // check state
        const accountInfo = await umi.rpc.getAccount(payloadHashPda1);
        expect(accountInfo.exists).to.be.false; // should be burnt

        // check event
        const event = await extractEventFromTransactionSignature(
            connection,
            endpointSDK.programId,
            signature,
            EndpointProgram.events.getPacketBurntEventSerializer(),
            { commitment: 'confirmed', maxSupportedTransactionVersion: 1 },
        );
        expect(event?.[0].srcEid).to.be.eq(packet1.srcEid);
        expect(event?.[0].nonce.toString()).to.be.eq(nonce1.toString());
        expect(event?.[0].sender.toString()).to.be.deep.eq(Array.from(sender).toString());
        expect(event?.[0].receiver).to.be.eq(receiver);
        expect(event?.[0].payloadHash.toString()).to.be.eq(
            hexToNumberArray(codec.payloadHash()).toString(),
        );
    });

    it('revert if not authorized', async function () {
        const packet1 = newNextInPacket();
        const nonce1 = parseInt(packet1.nonce);
        const sender = addressToBytes32(packet1.sender);
        const receiver = publicKey(addressToBytes32(packet1.receiver));
        // PDAs
        const codec = PacketV1Codec.from(PacketSerializer.serialize(packet1));
        /// 1-1. verify nonce1
        const verifyIx1 = await verifyBySimpleMsgLib(umi, endpointSDK, simpleSdk, wallet, packet1);

        const packet2 = newNextInPacket();
        packet2.nonce = `${parseInt(packet1.nonce) + 1}`;
        /// 1-2. verify nonce2
        const verifyIx2 = await verifyBySimpleMsgLib(umi, endpointSDK, simpleSdk, wallet, packet2);

        await sendAndConfirm(umi, [...verifyIx1, ...verifyIx2], [wallet]);

        setOAppInBoundNonce(BigInt(packet2.nonce));

        /// 2. clear nonce2
        const clearIx2 = clear(EOAPP_DELEGATE, packet2);

        /// should revert if not authorized
        const ix = endpointSDK.oAppBurnNonce(HACKER, {
            nonce: nonce1,
            receiver: receiver,
            sender: sender,
            srcEid: packet1.srcEid,
            payloadHash: hexToBytes(codec.payloadHash()),
        });
        await shouldBeRejected(
            sendAndConfirm(umi, [clearIx2, ix], [wallet, EOAPP_DELEGATE, HACKER]),
            new errors.UnauthorizedError(endpointSDK.getProgram()),
        );
    });

    it('revert if burn nonce gt inbound nonce', async function () {
        const packet1 = newNextInPacket();
        packet1.nonce = (parseInt(packet1.nonce) + 1).toString(); // skip a nonce, so the inbound nonce won't move
        const nonce1 = parseInt(packet1.nonce);
        const sender = addressToBytes32(packet1.sender);
        const receiver = publicKey(addressToBytes32(packet1.receiver));
        // PDAs
        const codec = PacketV1Codec.from(PacketSerializer.serialize(packet1));

        /// 1-1. verify nonce1
        const verifyIx1 = await verifyBySimpleMsgLib(umi, endpointSDK, simpleSdk, wallet, packet1);
        /// should revert if burn nonce gt inbound nonce
        const ix = endpointSDK.oAppBurnNonce(EOAPP_DELEGATE, {
            nonce: nonce1,
            receiver: receiver,
            sender: sender,
            srcEid: packet1.srcEid,
            payloadHash: hexToBytes(codec.payloadHash()),
        });
        await shouldBeRejected(
            sendAndConfirm(umi, [...verifyIx1, ix], [wallet, EOAPP_DELEGATE]),
            new errors.InvalidNonceError(endpointSDK.getProgram()),
        );
    });

    it('revert if payload hash not found', async function () {
        const packet1 = newNextInPacket();
        const nonce1 = parseInt(packet1.nonce);
        const sender = addressToBytes32(packet1.sender);
        const receiver = publicKey(addressToBytes32(packet1.receiver));

        /// 1-1. verify nonce1
        const verifyIx1 = await verifyBySimpleMsgLib(umi, endpointSDK, simpleSdk, wallet, packet1);

        /// should revert if burn nonce gt inbound nonce
        const ix = endpointSDK.oAppBurnNonce(EOAPP_DELEGATE, {
            nonce: nonce1,
            receiver: receiver,
            sender: sender,
            srcEid: packet1.srcEid,
            payloadHash: hexToBytes(
                '0xffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff',
            ),
        });
        await shouldBeRejected(
            sendAndConfirm(umi, [...verifyIx1, ix], [wallet, EOAPP_DELEGATE]),
            new errors.PayloadHashNotFoundError(endpointSDK.getProgram()),
        );
    });
};
