import { publicKeyBytes } from '@metaplex-foundation/umi';
import { it } from 'vitest';

import { EndpointProgram, SimpleMessageLibProgram, SolanaPacketPath } from '../../../src';
import { errors } from '../../../src/endpoint';
import { SolanaTestValidator } from '../../setup';
import {
    assert,
    DST_EID,
    EOAPP,
    options,
    quote,
    sendAndConfirm,
    shouldBeRejected,
    simpleMessageLibPDA,
    simulateTx,
} from '../../utils';

export const testSuite = (validator: SolanaTestValidator): void => {
    const { umi, connection } = validator;
    const wallet = umi.payer;
    const endpointSDK = new EndpointProgram.Endpoint(EndpointProgram.ENDPOINT_PROGRAM_ID);
    const simpleSdk = new SimpleMessageLibProgram.SimpleMessageLib(
        SimpleMessageLibProgram.SIMPLE_MESSAGELIB_PROGRAM_ID,
    );
    const oAppKp = EOAPP;
    // PDAs
    const [messageLibPda] = simpleMessageLibPDA.messageLib();
    const path: SolanaPacketPath = {
        sender: oAppKp.publicKey,
        dstEid: DST_EID,
        receiver: publicKeyBytes(oAppKp.publicKey),
    };

    it('revert if pay_in_lz_token but lz_token is not set', async function () {
        // 1. set lz token to null
        const clearLzTokenIx = endpointSDK.setLzToken(wallet, null);

        // 2. quotes with lz token
        const ix = await quote(umi, endpointSDK, wallet, simpleSdk, path, {
            sender: oAppKp.publicKey,
            dstEid: DST_EID,
            receiver: publicKeyBytes(oAppKp.publicKey),
            message: Uint8Array.from(Buffer.from('hello world')),
            options: options.toBytes(),
            payInLzToken: true,
        });

        await shouldBeRejected(
            sendAndConfirm(umi, [clearLzTokenIx, ix], wallet),
            new errors.LzTokenUnavailableError(endpointSDK.getProgram()),
        );
    });

    it('success quote not paying with lzToken', async function () {
        const ix = await quote(umi, endpointSDK, wallet, simpleSdk, path, {
            sender: oAppKp.publicKey,
            dstEid: DST_EID,
            receiver: publicKeyBytes(oAppKp.publicKey),
            message: Uint8Array.from(Buffer.from('hello world')),
            options: options.toBytes(),
            payInLzToken: false,
        });

        const fee = await simulateTx(
            connection,
            ix,
            wallet,
            EndpointProgram.types.getMessagingFeeSerializer(),
        );
        const feeState = await SimpleMessageLibProgram.accounts.fetchMessageLib(umi, messageLibPda);
        assert.strictEqual(feeState.fee, fee.nativeFee);
        assert.strictEqual(0n, fee.lzTokenFee);
    });

    it('success quote paying with lzToken', async function () {
        const ix = await quote(umi, endpointSDK, wallet, simpleSdk, path, {
            sender: oAppKp.publicKey,
            dstEid: DST_EID,
            receiver: publicKeyBytes(oAppKp.publicKey),
            message: Uint8Array.from(Buffer.from('hello world')),
            options: options.toBytes(),
            payInLzToken: true,
        });

        const fee = await simulateTx(
            connection,
            ix,
            wallet,
            EndpointProgram.types.getMessagingFeeSerializer(),
        );
        const feeState = await SimpleMessageLibProgram.accounts.fetchMessageLib(umi, messageLibPda);
        assert.strictEqual(feeState.fee, fee.nativeFee);
        assert.strictEqual(feeState.lzTokenFee, fee.lzTokenFee);
    });
};
