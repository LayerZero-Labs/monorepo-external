import {
    createNoopSigner,
    KeypairSigner,
    publicKey,
    publicKeyBytes,
    some,
} from '@metaplex-foundation/umi';
import { u8 } from '@metaplex-foundation/umi/serializers';
import { assert, expect, it } from 'vitest';

import { calculateGuid, Packet, PacketHeader, PacketV1Codec } from '@layerzerolabs/lz-v2-utilities';

import { DVNProgram, EndpointProgram, UlnProgram } from '../../../src';
import { accounts } from '../../../src/uln';
import { SolanaTestValidator } from '../../setup';
import {
    confirmations,
    DST_EID,
    DVNSigner,
    EMPTY_PAYLOAD_HASH,
    EOAPP_ULN,
    MAX_VERIFIER_SIGNERS,
    onChainExpiration,
    sendAndConfirm,
    simulateTx,
    SRC_EID,
} from '../../utils';
import { VerificationState } from '../../utils/constants';

export const testSuite = (validator: SolanaTestValidator): void => {
    const { umi, connection } = validator;
    const wallet = umi.payer as KeypairSigner;
    const endpointSDK = new EndpointProgram.Endpoint(EndpointProgram.ENDPOINT_PROGRAM_ID);
    const ulnSDK = new UlnProgram.Uln(UlnProgram.ULN_PROGRAM_ID);
    const dvnSDK = new DVNProgram.DVN(DVNProgram.DVN_PROGRAM_ID);
    const oAppKp = EOAPP_ULN;
    const nonce = 1;

    const packetHeader: PacketHeader = {
        sender: oAppKp.publicKey,
        srcEid: SRC_EID,
        receiver: oAppKp.publicKey,
        dstEid: DST_EID,
        nonce: nonce.toString(),
        version: 1,
    };
    const packet: Packet = {
        message: Buffer.from('hello world').toString('hex'),
        guid: calculateGuid(packetHeader),
        ...packetHeader,
        payload: '', // will be calculated in the program
    };
    const codec = PacketV1Codec.from(PacketV1Codec.encode(packet));
    const packetBytes = PacketV1Codec.encodeBytes(packet);
    const [dvnPda] = dvnSDK.pda.config();
    const headerHashBytes = Uint8Array.from(Buffer.from(codec.headerHash().slice(2), 'hex'));
    const payloadHashBytes = Uint8Array.from(Buffer.from(codec.payloadHash().slice(2), 'hex'));
    const [confirmationsPda, confirmationsPdaBump] = ulnSDK.pda.confirmations(
        headerHashBytes,
        payloadHashBytes,
        dvnPda,
    );

    const [payloadHashPda, payloadHashPdaBump] = endpointSDK.pda.payloadHash(
        oAppKp.publicKey,
        SRC_EID,
        publicKeyBytes(oAppKp.publicKey),
        nonce,
    );

    it('init verify should success', async function () {
        const ix = ulnSDK.initVerify(wallet, {
            dvn: dvnPda,
            packetBytes: packetBytes,
        });

        await sendAndConfirm(umi, ix, wallet);
        const confirmations = await accounts.fetchConfirmations(umi, confirmationsPda);
        assert.strictEqual(confirmations.bump, confirmationsPdaBump);
    });

    it('verify should success', async function () {
        const ix = await dvnSDK.invoke(
            umi.rpc,
            wallet,
            {
                vid: SRC_EID % 30000,
                expiration: await onChainExpiration(connection, 120),
                instruction: ulnSDK.verify(createNoopSigner(dvnPda), {
                    packetBytes: packetBytes,
                    confirmations: confirmations,
                }).instruction,
            },
            new DVNSigner(MAX_VERIFIER_SIGNERS),
        );
        await sendAndConfirm(umi, ix, wallet);
        const confirmationsAccount = await accounts.fetchConfirmations(umi, confirmationsPda);
        assert.deepStrictEqual(confirmationsAccount.value, some(confirmations));
    });

    it('verifiable verifiable', async function () {
        const verificationState = await simulateTx(
            connection,
            await dvnSDK.verifiable(umi.rpc, { packetBytes }),
            wallet,
            u8(),
        );
        assert.equal(verificationState, VerificationState.Verifiable);
    });

    it('success init payload_hash', async function () {
        const ix = endpointSDK.initVerify(wallet, {
            srcEid: packet.srcEid,
            sender: publicKeyBytes(packet.sender),
            receiver: publicKey(packet.receiver),
            nonce: BigInt(packet.nonce),
        });
        await sendAndConfirm(umi, ix, wallet);

        // check
        const payloadHashAccount = await EndpointProgram.accounts.fetchPayloadHash(
            umi,
            payloadHashPda,
        );
        expect(payloadHashAccount.bump).to.eq(payloadHashPdaBump);
        expect(payloadHashAccount.hash.toString()).to.eq(EMPTY_PAYLOAD_HASH.toString());
    });

    it('commit verification should success', async function () {
        const ix = await ulnSDK.commitVerification(umi.rpc, packetBytes);
        await sendAndConfirm(umi, ix, wallet);
    });

    it('verifiable verified', async function () {
        const verificationState = await simulateTx(
            connection,
            await dvnSDK.verifiable(umi.rpc, { packetBytes }),
            wallet,
            u8(),
        );
        assert.equal(verificationState, VerificationState.Verified);
    });
};
