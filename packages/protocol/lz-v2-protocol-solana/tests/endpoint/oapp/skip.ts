import { publicKey } from '@metaplex-foundation/umi';
import { expect, it } from 'vitest';

import { addressToBytes32 } from '@layerzerolabs/protocol-codecs-v2';

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

    it('revert if not authorized', async function () {
        const packet = newNextInPacket();
        const nextNonce = parseInt(packet.nonce);
        const sender = addressToBytes32(packet.sender);
        const receiver = publicKey(addressToBytes32(packet.receiver));
        const { srcEid } = packet;

        const initVerifyIX = endpointSDK.initVerify(wallet, {
            srcEid,
            sender: sender,
            receiver: receiver,
            nonce: parseInt(packet.nonce),
        });

        /// skip next nonce
        const ix = endpointSDK.skip(HACKER, {
            receiver,
            srcEid,
            sender: sender,
            nonce: nextNonce,
        });
        await shouldBeRejected(
            sendAndConfirm(umi, [initVerifyIX, ix], [wallet, HACKER]),
            new errors.UnauthorizedError(endpointSDK.getProgram()),
        );
    });

    it('revert if not skip next nonce', async function () {
        const packet = newNextInPacket();
        const verifyNextNonceIxs = await verifyBySimpleMsgLib(
            umi,
            endpointSDK,
            simpleSdk,
            wallet,
            packet,
        ); // verify next nonce
        const currentNonce = BigInt(packet.nonce);
        const nonces = [currentNonce, currentNonce + 2n, currentNonce + 100n]; // test nonces
        for (const nonce of nonces) {
            packet.nonce = nonce.toString();
            const sender = addressToBytes32(packet.sender);
            const receiver = publicKey(addressToBytes32(packet.receiver));
            const { srcEid } = packet;

            const ixs = [...verifyNextNonceIxs];

            if (nonce !== currentNonce) {
                const initVerifyIX = endpointSDK.initVerify(wallet, {
                    srcEid,
                    sender: sender,
                    receiver: receiver,
                    nonce: parseInt(packet.nonce),
                });
                ixs.push(initVerifyIX);
            }
            const ix = endpointSDK.skip(EOAPP_DELEGATE, {
                receiver,
                srcEid,
                sender: sender,
                nonce: nonce,
            });
            await shouldBeRejected(
                sendAndConfirm(umi, [...ixs, ix], [wallet, EOAPP_DELEGATE]),
                new errors.InvalidNonceError(endpointSDK.getProgram()),
            );
        }
    });

    it('should success', async function () {
        const packet = newNextInPacket();
        const nextNonce = BigInt(packet.nonce);
        const sender = addressToBytes32(packet.sender);
        const receiver = publicKey(addressToBytes32(packet.receiver));
        const { srcEid } = packet;
        // PDAs
        const [noncePda] = endpointPDA.nonce(receiver, packet.srcEid, sender);

        const nonceStateBefore = await accounts.fetchNonce(umi, noncePda);

        const initVerifyIX = endpointSDK.initVerify(wallet, {
            srcEid,
            sender: sender,
            receiver: receiver,
            nonce: parseInt(packet.nonce),
        });

        /// skip next nonce
        const ix = endpointSDK.skip(EOAPP_DELEGATE, {
            receiver,
            srcEid,
            sender: sender,
            nonce: nextNonce,
        });

        const { signature } = await sendAndConfirm(
            umi,
            [initVerifyIX, ix],
            [wallet, EOAPP_DELEGATE],
        );
        setOAppInBoundNonce(nextNonce);

        // check state
        const nonceState = await accounts.fetchNonce(umi, noncePda);
        expect(nonceState.inboundNonce).to.be.eq(nextNonce);
        expect(nonceState.inboundNonce).to.be.eq(nonceStateBefore.inboundNonce + 1n);

        // check event
        const event = await extractEventFromTransactionSignature(
            connection,
            endpointSDK.programId,
            signature,
            EndpointProgram.events.getInboundNonceSkippedEventSerializer(),
            { commitment: 'confirmed', maxSupportedTransactionVersion: 1 },
        );
        expect(event?.[0].srcEid).to.be.eq(packet.srcEid);
        expect(event?.[0].nonce).to.be.eq(nextNonce);
        expect(event?.[0].sender.toString()).to.be.deep.eq(Array.from(sender).toString());
        expect(event?.[0].receiver).to.be.eq(receiver);
    });
};
