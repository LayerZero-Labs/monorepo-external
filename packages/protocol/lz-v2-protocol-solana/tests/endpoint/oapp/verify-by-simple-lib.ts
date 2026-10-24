import { PublicKey, publicKey, publicKeyBytes } from '@metaplex-foundation/umi';
import { beforeAll, expect, it } from 'vitest';

import {
    calculatePacketGuid,
    Packet,
    PacketHeader,
    PacketV1Codec,
} from '@layerzerolabs/protocol-codecs-v2';

import {
    EndpointProgram,
    extractEventFromTransactionSignature,
    SimpleMessageLibProgram,
} from '../../../src';
import { accounts } from '../../../src/endpoint';
import { SolanaTestValidator } from '../../setup';
import {
    ConstraintRaw,
    DefaultMessageLib,
    DST_EID,
    EMPTY_PAYLOAD_HASH,
    EOAPP,
    EOAPP_DELEGATE,
    fakeReceiveMessageLibPDA,
    oAppInBoundNonce,
    revertIx,
    revertTxError,
    sendAndConfirm,
    setOAppInBoundNonce,
    shouldBeRejected,
    SRC_EID,
} from '../../utils';

export const testSuite = (validator: SolanaTestValidator): void => {
    const { umi, connection } = validator;
    const wallet = umi.payer;
    const endpointSDK = new EndpointProgram.Endpoint(EndpointProgram.ENDPOINT_PROGRAM_ID);
    const simpleSdk = new SimpleMessageLibProgram.SimpleMessageLib(
        SimpleMessageLibProgram.SIMPLE_MESSAGELIB_PROGRAM_ID,
    );
    const oAppKp = EOAPP;
    const oAppDelegateKp = EOAPP_DELEGATE;

    let nonce: bigint;
    let payloadHashPda: PublicKey;
    let payloadHashPdaBump: number;
    let packet: Packet;

    // PDAs
    const [noncePda] = endpointSDK.pda.nonce(
        oAppKp.publicKey,
        SRC_EID,
        publicKeyBytes(oAppKp.publicKey),
    );
    const [pendingNoncePda] = endpointSDK.pda.pendingNonce(
        oAppKp.publicKey,
        SRC_EID,
        publicKeyBytes(oAppKp.publicKey),
    );

    beforeAll(function () {
        nonce = oAppInBoundNonce() + 1n;
        [payloadHashPda, payloadHashPdaBump] = endpointSDK.pda.payloadHash(
            oAppKp.publicKey,
            SRC_EID,
            publicKeyBytes(oAppKp.publicKey),
            Number(nonce),
        );

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
    });

    it('revert if init payloadHash with nonce lte inbound nonce', async function () {
        const nonceAccount = await accounts.fetchNonce(umi, noncePda);
        const ix = endpointSDK.initVerify(wallet, {
            srcEid: SRC_EID,
            sender: publicKeyBytes(oAppKp.publicKey),
            receiver: oAppKp.publicKey,
            nonce: nonceAccount.inboundNonce,
        });
        await shouldBeRejected(sendAndConfirm(umi, ix, wallet), ConstraintRaw);
    });

    it('success init payload_hash', async function () {
        const ix = endpointSDK.initVerify(wallet, {
            srcEid: SRC_EID,
            sender: publicKeyBytes(oAppKp.publicKey),
            receiver: oAppKp.publicKey,
            nonce,
        });
        await sendAndConfirm(umi, ix, wallet);

        // check
        const payloadHashAccount = await accounts.fetchPayloadHash(umi, payloadHashPda);
        expect(payloadHashAccount.bump).to.eq(payloadHashPdaBump);
        expect(payloadHashAccount.hash.toString()).to.eq(EMPTY_PAYLOAD_HASH.toString());
    });

    it('revert if verify by wrong receive-msg-lib', async function () {
        // set oapp receive lib to blocked lib (default is blocked-lib)
        const setBlockedLibIx = endpointSDK.setOAppReceiveLibrary(oAppDelegateKp, {
            receiver: oAppKp.publicKey,
            remote: SRC_EID,
            msgLibProgram: DefaultMessageLib,
            gracePeriod: 0,
        });
        const ix = simpleSdk.validatePacket(wallet, PacketV1Codec.encodeBytes(packet)); // try to use simple-lib to verify
        await shouldBeRejected(
            sendAndConfirm(umi, [setBlockedLibIx, ix], oAppDelegateKp),
            new EndpointProgram.errors.InvalidReceiveLibraryError(endpointSDK.getProgram()),
        );
    });

    /// scenario: oapp config: default; default: simple-lib
    it('can verify by default is simple-lib', async function () {
        // set oapp receive lib to default lib
        const setDefaultLibIx = endpointSDK.setOAppReceiveLibrary(oAppDelegateKp, {
            receiver: oAppKp.publicKey,
            remote: SRC_EID,
            msgLibProgram: DefaultMessageLib,
            gracePeriod: 0,
        });

        // set default to simple-lib
        const setDefaultIx = await endpointSDK.setDefaultReceiveLibrary(umi.rpc, wallet, {
            messageLibProgram: simpleSdk.programId,
            remote: DST_EID,
            gracePeriod: 0,
        });
        const ix = simpleSdk.validatePacket(wallet, PacketV1Codec.encodeBytes(packet));

        await shouldBeRejected(
            // add revertIx() to the end, if it revert with OnlyRevert, it means ixs ahead were success
            sendAndConfirm(
                umi,
                [setDefaultLibIx, setDefaultIx, ix, revertIx()],
                [wallet, oAppDelegateKp],
            ),
            revertTxError(),
        );
    });

    /// scenario: oapp config: fake-lib, timeout: 100; simple-lib
    it('can verify if has timeout and not expired', async function () {
        // set oapp receive lib to fake lib and simple-lib timeout (the old lib is simple-lib)
        const setFakeLibIx = endpointSDK.setOAppReceiveLibrary(oAppDelegateKp, {
            receiver: oAppKp.publicKey,
            remote: SRC_EID,
            msgLibProgram: fakeReceiveMessageLibPDA.program,
            gracePeriod: 100,
        });

        const ix = simpleSdk.validatePacket(wallet, PacketV1Codec.encodeBytes(packet));
        await shouldBeRejected(
            // add revertIx() to the end, if it revert with OnlyRevert, it means ixs ahead were success
            sendAndConfirm(umi, [setFakeLibIx, ix, revertIx()], [wallet, oAppDelegateKp]),
            revertTxError(),
        );
    });

    /// scenario: oapp config: default; default: fake-lib, timeout: 100; simple-lib
    it('can verify if default has timeout and not expired', async function () {
        // set oapp receive lib to default lib
        const setDefaultLibIx = endpointSDK.setOAppReceiveLibrary(oAppDelegateKp, {
            receiver: oAppKp.publicKey,
            remote: SRC_EID,
            msgLibProgram: DefaultMessageLib,
            gracePeriod: 0,
        });

        // set default to simple-lib
        const setDefaultIx = await endpointSDK.setDefaultReceiveLibrary(umi.rpc, wallet, {
            messageLibProgram: simpleSdk.programId,
            remote: DST_EID,
            gracePeriod: 0,
        });

        // set default to fake lib with old lib is simple-lib
        const setDefaultFakeIx = await endpointSDK.setDefaultReceiveLibrary(umi.rpc, wallet, {
            messageLibProgram: fakeReceiveMessageLibPDA.program,
            remote: DST_EID,
            gracePeriod: 100,
        });

        const ix = simpleSdk.validatePacket(wallet, PacketV1Codec.encodeBytes(packet));
        await shouldBeRejected(
            // add revertIx() to the end, if it revert with OnlyRevert, it means ixs ahead were success
            sendAndConfirm(
                umi,
                [setDefaultLibIx, setDefaultIx, setDefaultFakeIx, ix, revertIx()],
                [wallet, oAppDelegateKp],
            ),
            revertTxError(),
        );
    });

    it('success verify', async function () {
        const nonceStateBefore = await accounts.fetchNonce(umi, noncePda);

        const ix = simpleSdk.validatePacket(wallet, PacketV1Codec.encodeBytes(packet));
        const { signature } = await sendAndConfirm(umi, ix, wallet);
        setOAppInBoundNonce(nonce);

        // check inbound nonce
        const codec = PacketV1Codec.from(packet);
        const payloadHash = codec.payloadHash();
        const payloadHashAccount = await accounts.fetchPayloadHash(umi, payloadHashPda);
        expect(`0x${Buffer.from(payloadHashAccount.hash).toString('hex')}`).to.eq(
            payloadHash.toString(),
        );
        const nonceState = await accounts.fetchNonce(umi, noncePda);
        expect(nonceState.inboundNonce).to.eq(nonceStateBefore.inboundNonce + 1n);

        const pendingNonceState = await accounts.fetchPendingInboundNonce(umi, pendingNoncePda);
        expect(pendingNonceState.nonces.length).to.eq(0);

        // check event
        const receiver = publicKey(packet.receiver);
        const event = await extractEventFromTransactionSignature(
            connection,
            endpointSDK.programId,
            signature,
            EndpointProgram.events.getPacketVerifiedEventSerializer(),
            { commitment: 'confirmed', maxSupportedTransactionVersion: 1 },
        );
        if (event === null) {
            throw new Error('event is null');
        }
        expect(event[0].srcEid).to.eq(SRC_EID);
        expect(publicKey(event[0].sender)).to.eq(packet.sender);
        expect(event[0].nonce).to.eq(nonce);
        expect(event[0].receiver).to.eq(receiver);
        expect(`0x${Buffer.from(event[0].payloadHash).toString('hex')}`).to.eq(
            payloadHash.toString(),
        );
    });
};
