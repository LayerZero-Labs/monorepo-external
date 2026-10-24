import { PublicKey, publicKey, publicKeyBytes } from '@metaplex-foundation/umi';
import { beforeAll, expect, it } from 'vitest';

import { hexToBytes } from '@layerzerolabs/common-encoding-utils';
import { calculatePacketGuid, Packet, PacketHeader } from '@layerzerolabs/protocol-codecs-v2';

import { EndpointProgram, extractEventFromTransactionSignature } from '../../../src';
import { accounts, errors, instructions } from '../../../src/endpoint';
import { SolanaTestValidator } from '../../setup';
import {
    DST_EID,
    EOAPP,
    EOAPP_DELEGATE,
    HACKER,
    oAppInBoundNonce,
    sendAndConfirm,
    shouldBeRejected,
    SRC_EID,
} from '../../utils';

export const testSuite = (validator: SolanaTestValidator): void => {
    const { umi, connection } = validator;
    const wallet = umi.payer;
    const endpointSDK = new EndpointProgram.Endpoint(EndpointProgram.ENDPOINT_PROGRAM_ID);

    const oAppKp = EOAPP;
    let nonce: bigint;
    // PDAs
    const [endpoint] = endpointSDK.pda.setting();
    const [noncePda] = endpointSDK.pda.nonce(
        oAppKp.publicKey,
        DST_EID,
        publicKeyBytes(oAppKp.publicKey),
    );
    const [oappRegistryPda] = endpointSDK.pda.oappRegistry(oAppKp.publicKey);
    let payloadHashPda: PublicKey;
    let packet: Packet;
    let params: EndpointProgram.instructions.ClearInstructionArgs;

    beforeAll(function () {
        nonce = oAppInBoundNonce();
        payloadHashPda = endpointSDK.pda.payloadHash(
            oAppKp.publicKey,
            SRC_EID,
            publicKeyBytes(oAppKp.publicKey),
            Number(nonce),
        )[0];

        const packetHeader: PacketHeader = {
            sender: oAppKp.publicKey,
            srcEid: SRC_EID,
            receiver: oAppKp.publicKey,
            dstEid: DST_EID,
            nonce: `${nonce}`,
            version: 1,
        };
        packet = {
            message: Buffer.from('hello world').toString('hex'),
            guid: calculatePacketGuid(packetHeader),
            ...packetHeader,
            payload: '', // will be calculated in the program
        };

        params = {
            sender: publicKeyBytes(packet.sender),
            srcEid: packet.srcEid,
            receiver: oAppKp.publicKey,
            nonce,
            guid: Buffer.from(hexToBytes(packet.guid)),
            message: Buffer.from(hexToBytes(packet.message)),
        };
    });

    it('revert if not authorized', async function () {
        const ix = EndpointProgram.instructions.clear(
            { programs: endpointSDK.programRepo },
            {
                signer: HACKER,
                oappRegistry: oappRegistryPda,
                nonce: noncePda,
                payloadHash: payloadHashPda,
                endpoint,
                eventAuthority: endpointSDK.eventAuthority,
                program: endpointSDK.programId,
            },
            params,
        ).items[0];
        await shouldBeRejected(
            sendAndConfirm(umi, ix, [wallet, HACKER]),
            new errors.UnauthorizedError(endpointSDK.getProgram()),
        );
    });

    it('revert if wrong message', async function () {
        const ix = EndpointProgram.instructions.clear(
            { programs: endpointSDK.programRepo },
            {
                signer: oAppKp,
                oappRegistry: oappRegistryPda,
                nonce: noncePda,
                payloadHash: payloadHashPda,
                endpoint,
                eventAuthority: endpointSDK.eventAuthority,
                program: endpointSDK.programId,
            },
            {
                ...params,
                message: Buffer.from('fake message'),
            },
        ).items[0];
        await shouldBeRejected(
            sendAndConfirm(umi, ix, [wallet, oAppKp]),
            new errors.PayloadHashNotFoundError(endpointSDK.getProgram()),
        );
    });

    it('revert if clear nonce is gt inbound nonce', async function () {
        const nonceState = await accounts.fetchNonce(umi, noncePda);
        const currentInboundNonce = nonceState.inboundNonce;
        const nonces = [currentInboundNonce + 1n, currentInboundNonce + 2n];
        for (const nonce of nonces) {
            const [payloadHashPda] = endpointSDK.pda.payloadHash(
                oAppKp.publicKey,
                SRC_EID,
                publicKeyBytes(oAppKp.publicKey),
                Number(nonce),
            );
            /// init payload hash state
            const initIx = endpointSDK.initVerify(wallet, {
                srcEid: SRC_EID,
                sender: publicKeyBytes(oAppKp.publicKey),
                receiver: oAppKp.publicKey,
                nonce,
            });
            const ix = instructions.clear(
                { programs: endpointSDK.programRepo },
                {
                    signer: EOAPP_DELEGATE,
                    oappRegistry: oappRegistryPda,
                    nonce: noncePda,
                    payloadHash: payloadHashPda,
                    endpoint,
                    eventAuthority: endpointSDK.eventAuthority,
                    program: endpointSDK.programId,
                },
                {
                    ...params,
                    nonce,
                },
            ).items[0];
            await shouldBeRejected(
                sendAndConfirm(umi, [initIx, ix], [wallet, EOAPP_DELEGATE]),
                new errors.InvalidNonceError(endpointSDK.getProgram()),
            );
        }
    });

    it('should success', async function () {
        const ix = instructions.clear(
            { programs: endpointSDK.programRepo },
            {
                signer: EOAPP_DELEGATE,
                oappRegistry: oappRegistryPda,
                nonce: noncePda,
                payloadHash: payloadHashPda,
                endpoint,
                eventAuthority: endpointSDK.eventAuthority,
                program: endpointSDK.programId,
            },
            params,
        ).items[0];
        const { signature } = await sendAndConfirm(umi, ix, [wallet, EOAPP_DELEGATE]);

        // check payload hash cleared
        const payloadAccountInfo = await umi.rpc.getAccount(payloadHashPda);
        expect(payloadAccountInfo.exists).to.be.false;

        // check event
        const event = await extractEventFromTransactionSignature(
            connection,
            endpointSDK.programId,
            signature,
            EndpointProgram.events.getPacketDeliveredEventSerializer(),
            { commitment: 'confirmed', maxSupportedTransactionVersion: 1 },
        );
        if (event === null) {
            throw new Error('event is null');
        }
        expect(event[0].srcEid).to.eq(SRC_EID);
        expect(publicKey(event[0].sender)).to.eq(packet.sender);
        expect(event[0].receiver).to.eq(oAppKp.publicKey);
        expect(event[0].nonce).to.eq(nonce);
    });
};
