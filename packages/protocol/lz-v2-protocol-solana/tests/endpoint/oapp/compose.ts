import { expect, it } from 'vitest';

import { hexToBytes } from '@layerzerolabs/common-encoding-utils';
import { calculateGuid, keccak256, Packet, PacketHeader } from '@layerzerolabs/lz-v2-utilities';

import { EndpointProgram, extractEventFromTransactionSignature } from '../../../src';
import { accounts, errors, instructions } from '../../../src/endpoint';
import { SolanaTestValidator } from '../../setup';
import {
    ConstraintSeeds,
    DST_EID,
    endpointPDA,
    EOAPP,
    sendAndConfirm,
    shouldBeRejected,
    SRC_EID,
} from '../../utils';

export const testSuite = (validator: SolanaTestValidator): void => {
    const { umi, connection } = validator;
    const wallet = umi.payer;
    const endpointSDK = new EndpointProgram.Endpoint(EndpointProgram.ENDPOINT_PROGRAM_ID);

    const oAppKp = EOAPP;

    const packetHeader: PacketHeader = {
        sender: oAppKp.publicKey,
        srcEid: SRC_EID,
        receiver: oAppKp.publicKey,
        dstEid: DST_EID,
        nonce: '1',
        version: 1,
    };
    const packet: Packet = {
        message: Buffer.from('hello world').toString('hex'),
        guid: calculateGuid(packetHeader),
        ...packetHeader,
        payload: '', // will be calculated in the program
    };
    const guid = Buffer.from(hexToBytes(packet.guid));
    const messageHash = Buffer.from(hexToBytes(keccak256(`0x${packet.message}`)));
    const [composedMessagePda, bump] = endpointPDA.composedMessage(
        oAppKp.publicKey,
        guid,
        0,
        oAppKp.publicKey,
        messageHash,
    );

    it('send compose success', async function () {
        const ix = instructions.sendCompose(
            {
                programs: endpointSDK.programRepo,
                payer: wallet,
            },
            {
                payer: wallet,
                from: oAppKp,
                composeMessage: composedMessagePda,
                eventAuthority: endpointSDK.eventAuthority,
                program: endpointSDK.programId,

                // param
                guid: guid,
                index: 0,
                message: Buffer.from(hexToBytes(packet.message)),
                to: oAppKp.publicKey,
            },
        ).items[0];
        const { signature } = await sendAndConfirm(umi, ix, [wallet, oAppKp]);

        // check
        const composedMessage = await accounts.fetchComposeMessageState(umi, composedMessagePda);
        expect(composedMessage.bump).to.be.eq(bump);
        expect(composedMessage.received).to.be.eq(false);

        // check event
        const event = await extractEventFromTransactionSignature(
            connection,
            endpointSDK.programId,
            signature,
            EndpointProgram.events.getComposeSentEventSerializer(),
            { commitment: 'confirmed', maxSupportedTransactionVersion: 1 },
        );
        expect(event?.[0].from).to.be.eq(oAppKp.publicKey);
        expect(event?.[0].to).to.be.eq(oAppKp.publicKey);
        expect(event?.[0].index).to.be.eq(0);
        expect(event?.[0].guid.toString()).to.be.deep.eq(Array.from(guid).toString());
        expect(event?.[0].message.toString()).to.be.deep.eq(hexToBytes(packet.message).toString());
    });

    it('revert if clear wrong hash', async function () {
        const ix = instructions.clearCompose(
            { programs: endpointSDK.programRepo },
            {
                to: oAppKp,
                composeMessage: composedMessagePda,
                eventAuthority: endpointSDK.eventAuthority,
                program: endpointSDK.programId,

                //args
                from: oAppKp.publicKey,
                guid,
                index: 0,
                message: Buffer.from('fake message'),
            },
        ).items[0];
        await shouldBeRejected(sendAndConfirm(umi, ix, [wallet, oAppKp]), ConstraintSeeds);
    });

    it('clear compose success', async function () {
        const ix = instructions.clearCompose(
            { programs: endpointSDK.programRepo },
            {
                to: oAppKp,
                composeMessage: composedMessagePda,
                eventAuthority: endpointSDK.eventAuthority,
                program: endpointSDK.programId,
                from: oAppKp.publicKey,
                // arg
                guid,
                index: 0,
                message: Buffer.from(hexToBytes(packet.message)),
            },
        ).items[0];

        const { signature } = await sendAndConfirm(umi, ix, [wallet, oAppKp]);

        // check
        const composedMessage = await accounts.fetchComposeMessageState(umi, composedMessagePda);
        expect(composedMessage.received).to.be.eq(true);

        // check event
        const event = await extractEventFromTransactionSignature(
            connection,
            endpointSDK.programId,
            signature,
            EndpointProgram.events.getComposeDeliveredEventSerializer(),
            { commitment: 'confirmed', maxSupportedTransactionVersion: 1 },
        );
        expect(event?.[0].from).to.be.eq(oAppKp.publicKey);
        expect(event?.[0].to).to.be.eq(oAppKp.publicKey);
        expect(event?.[0].index).to.be.eq(0);
        expect(event?.[0].guid.toString()).to.be.deep.eq(Array.from(guid).toString());
    });

    it('revert if double clear', async function () {
        const ix = instructions.clearCompose(
            { programs: endpointSDK.programRepo },
            {
                to: oAppKp,
                composeMessage: composedMessagePda,
                eventAuthority: endpointSDK.eventAuthority,
                program: endpointSDK.programId,
                from: oAppKp.publicKey,
                // arg
                guid,
                index: 0,
                message: Buffer.from(hexToBytes(packet.message)),
            },
        ).items[0];
        await shouldBeRejected(
            sendAndConfirm(umi, ix, [wallet, oAppKp]),
            new errors.ComposeNotFoundError(endpointSDK.getProgram()),
        );
    });
};
