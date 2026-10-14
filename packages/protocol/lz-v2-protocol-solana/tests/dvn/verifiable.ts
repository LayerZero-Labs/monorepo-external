import { generateSigner, PublicKey, publicKeyBytes } from '@metaplex-foundation/umi';
import { u8 } from '@metaplex-foundation/umi/serializers';
import { assert } from 'vitest';
import { beforeAll as before, it } from 'vitest';

import { arrayify } from '@layerzerolabs/lz-utilities';
import {
    calculateGuid,
    Packet,
    PacketSerializer,
    PacketV1Codec,
} from '@layerzerolabs/lz-v2-utilities';

import { EndpointProgram } from '../../src';
import { DVN, DVN_PROGRAM_ID } from '../../src/dvn';
import { SolanaTestValidator } from '../setup';
import {
    DST_EID,
    dvnPDA,
    eddsa,
    endpointPDA,
    EOAPP_ULN,
    maxPendingInboundNonce,
    simulateTx,
    SRC_EID,
    ulnPDA,
} from '../utils';
import { VerificationState } from '../utils/constants';

export const testSuite = (validator: SolanaTestValidator): void => {
    const { umi, connection } = validator;
    const wallet = umi.payer;
    const dvnSDK = new DVN(DVN_PROGRAM_ID);

    const [dvn] = dvnPDA.config();

    const oAppKp = EOAPP_ULN;
    const receiver = oAppKp.publicKey;
    const sender = oAppKp.publicKey;
    const [nonce] = endpointPDA.nonce(receiver, SRC_EID, publicKeyBytes(sender));

    const packet: Packet = {
        version: 1,
        srcEid: SRC_EID,
        dstEid: DST_EID,
        sender: sender,
        receiver: receiver,
        message: Buffer.from('hello world').toString('hex'),
        guid: '',
        nonce: '0',
        payload: '',
    };

    let packetBytes: Uint8Array,
        headerHashBytes: Uint8Array,
        payloadHashBytes: Uint8Array,
        confirmationsPda: PublicKey;

    before(async function () {
        const nonceAccount = await EndpointProgram.accounts.fetchNonce(umi, nonce);
        const NONCE = nonceAccount.inboundNonce + BigInt(1);
        packet.nonce = NONCE.toString();
        packet.guid = calculateGuid(packet);
        packetBytes = PacketSerializer.serializeBytes(packet);
        const codec = PacketV1Codec.from(packet);
        headerHashBytes = arrayify(codec.headerHash());
        payloadHashBytes = arrayify(codec.payloadHash());
        [confirmationsPda] = ulnPDA.confirmations(headerHashBytes, payloadHashBytes, dvn);
    });

    it('not initializable', async function () {
        const notInitSender = generateSigner({ eddsa }).publicKey;
        const notInitReceiver = generateSigner({ eddsa }).publicKey;

        const state = await simulateTx(
            connection,
            await dvnSDK.verifiable(umi.rpc, {
                packetBytes: PacketSerializer.serializeBytes({
                    ...packet,
                    sender: notInitSender,
                    receiver: notInitReceiver,
                }),
                msgLibProgram: ulnPDA.program,
            }),
            wallet,
            u8(),
        );
        assert.equal(VerificationState.NotInitializable, state);
    });

    it('verifiable verifying', async function () {
        const ix = await dvnSDK.verifiable(umi.rpc, {
            packetBytes,
            msgLibProgram: ulnPDA.program,
        });
        ix.instruction.keys.push({
            pubkey: confirmationsPda,
            isWritable: false,
            isSigner: false,
        });
        const verificationState = await simulateTx(connection, ix, wallet, u8());
        assert.equal(VerificationState.Verifying, verificationState);
    });

    it('verifiable verifiableButCapExceeded', async function () {
        const { inboundNonce } = await EndpointProgram.accounts.fetchNonce(umi, nonce);
        const exceededPacket: Packet = {
            ...packet,
            nonce: (inboundNonce + maxPendingInboundNonce + BigInt(1)).toString(),
        };
        packet.guid = calculateGuid(packet);

        const ix = await dvnSDK.verifiable(umi.rpc, {
            packetBytes: PacketSerializer.serializeBytes(exceededPacket),
            msgLibProgram: ulnPDA.program,
        });

        const verificationState = await simulateTx(connection, ix, wallet, u8());
        assert.equal(VerificationState.VerifiableButCapExceeded, verificationState);
    });
};
