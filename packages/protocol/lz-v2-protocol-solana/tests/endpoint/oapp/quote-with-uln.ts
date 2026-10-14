import { publicKeyBytes } from '@metaplex-foundation/umi';
import { fromWeb3JsPublicKey } from '@metaplex-foundation/umi-web3js-adapters';
import { it } from 'vitest';

import { Options } from '@layerzerolabs/lz-v2-utilities';

import { EndpointProgram, SolanaPacketPath, UlnProgram } from '../../../src';
import { errors } from '../../../src/endpoint';
import { SolanaTestValidator } from '../../setup';
import {
    assert,
    calDvnFee,
    calExecutorFee,
    calTreasuryFee,
    defaultTreasuryFee,
    DST_EID,
    EOAPP_ULN,
    getLzTokenMint,
    options,
    quote,
    sendAndConfirm,
    shouldBeRejected,
    simulateTx,
} from '../../utils';

export const testSuite = (validator: SolanaTestValidator): void => {
    const { umi, connection } = validator;
    const wallet = umi.payer;
    const endpointSDK = new EndpointProgram.Endpoint(EndpointProgram.ENDPOINT_PROGRAM_ID);
    const ulnSDK = new UlnProgram.Uln(UlnProgram.ULN_PROGRAM_ID);
    const oAppKp = EOAPP_ULN;

    const message = Uint8Array.from(Buffer.from('hello world'));
    const path: SolanaPacketPath = {
        sender: oAppKp.publicKey,
        dstEid: DST_EID,
        receiver: publicKeyBytes(oAppKp.publicKey),
    };

    it('revert if pay_in_lz_token but lz_token is not enabled', async function () {
        // 1. set lz token to null
        const clearLzTokenIx = endpointSDK.setLzToken(wallet, null);

        // 2. quotes with lz token
        const ix = await quote(umi, endpointSDK, wallet, ulnSDK, path, {
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

    it('success quote not pay in lzToken', async function () {
        const lzReceiveGas = 2000000;
        const options = Options.newOptions().addExecutorLzReceiveOption(lzReceiveGas, 0).toBytes();
        const ix = await quote(umi, endpointSDK, wallet, ulnSDK, path, {
            sender: oAppKp.publicKey,
            dstEid: DST_EID,
            receiver: publicKeyBytes(oAppKp.publicKey),
            message: Uint8Array.from(Buffer.from('hello world')),
            options: options,
            payInLzToken: false,
        });
        const fee = await simulateTx(
            connection,
            ix,
            wallet,
            EndpointProgram.types.getMessagingFeeSerializer(),
        );

        const executorFee = await calExecutorFee(
            validator,
            DST_EID,
            BigInt(message.length),
            BigInt(lzReceiveGas),
            0n,
            0n,
            [],
            false,
        );
        const dvnFee = await calDvnFee(validator, DST_EID);
        const treasuryFee = await calTreasuryFee(validator, executorFee + dvnFee, false);
        assert.strictEqual(executorFee + dvnFee + treasuryFee, fee.nativeFee);
        assert.strictEqual(0n, fee.lzTokenFee);
    });

    it('success quote pay in lzToken', async function () {
        const lzReceiveGas = 2000000;
        const options = Options.newOptions().addExecutorLzReceiveOption(lzReceiveGas, 0).toBytes();
        const ix = endpointSDK.setLzToken(wallet, fromWeb3JsPublicKey(getLzTokenMint()));

        const quoteIx = await quote(umi, endpointSDK, wallet, ulnSDK, path, {
            sender: oAppKp.publicKey,
            dstEid: DST_EID,
            receiver: publicKeyBytes(oAppKp.publicKey),
            message: Uint8Array.from(Buffer.from('hello world')),
            options: options,
            payInLzToken: true,
        });
        const fee = await simulateTx(
            connection,
            [ix, quoteIx],
            wallet,
            EndpointProgram.types.getMessagingFeeSerializer(),
        );

        const executorFee = await calExecutorFee(
            validator,
            DST_EID,
            BigInt(message.length),
            BigInt(lzReceiveGas),
            0n,
            0n,
            [],
            false,
        );
        const dvnFee = await calDvnFee(validator, DST_EID);
        assert.strictEqual(fee.nativeFee, executorFee + dvnFee);
        assert.strictEqual(fee.lzTokenFee, defaultTreasuryFee);
    });
};
