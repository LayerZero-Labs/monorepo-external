import { pack as solidityPack } from '@ethersproject/solidity';
import { generateSigner, none, some, WrappedInstruction } from '@metaplex-foundation/umi';
import { u64 } from '@metaplex-foundation/umi/serializers';
import { Keypair } from '@solana/web3.js';
import { assert, it } from 'vitest';

import { hexToBytes } from '@layerzerolabs/common-encoding-utils';
import { Serializer } from '@layerzerolabs/lz-serdes';

import { accounts, errors, Executor, EXECUTOR_PROGRAM_ID } from '../../src/executor';
import { PermissionDeniedError } from '../../src/generated/worker_interface';
import { SolanaTestValidator } from '../setup';
import {
    calExecutorFee,
    defaultCallDataSize,
    eddsa,
    sendAndConfirm,
    shouldBeRejected,
    simulateTx,
} from '../utils';
import { DST_EID, EOAPP_ULN, priceFeedPda, ulnPDA } from '../utils/constants';

export const testSuite = (validator: SolanaTestValidator): void => {
    const { umi, connection } = validator;
    const wallet = umi.payer;
    const executorSDK = new Executor(EXECUTOR_PROGRAM_ID);
    const [executorConfigAccount] = executorSDK.pda.config();
    const priceFeedProgram = priceFeedPda.program;
    const [msglib] = ulnPDA.messageLib();
    const lzReceiveGas = 1n;
    const lzReceiveValue = BigInt(1e9);
    const optionParamBuf = hexToBytes(
        solidityPack(['uint128', 'uint128'], [lzReceiveGas, lzReceiveValue]),
    );

    function setPauseIx(pause: boolean): WrappedInstruction {
        return executorSDK.setPaused(wallet, pause);
    }

    it('should failure when executor pause is true', async function () {
        const ix = executorSDK.quoteExecutor({
            priceFeedProgram,
            msglib,
            dstEid: DST_EID,
            sender: EOAPP_ULN.publicKey,
            calldataSize: defaultCallDataSize,
            options: [
                {
                    optionType: 1,
                    params: optionParamBuf,
                },
            ],
        });

        await shouldBeRejected(
            sendAndConfirm(umi, [setPauseIx(true), ix], wallet),
            new errors.PausedError(executorSDK.getProgram()),
        );
    });

    it('should failure with not exist msgLib', async function () {
        const ix = executorSDK.quoteExecutor({
            priceFeedProgram,
            msglib: generateSigner({ eddsa }).publicKey,
            dstEid: DST_EID,
            sender: EOAPP_ULN.publicKey,
            calldataSize: defaultCallDataSize,
            options: [
                {
                    optionType: 1,
                    params: optionParamBuf,
                },
            ],
        });

        await shouldBeRejected(
            sendAndConfirm(umi, ix, wallet),
            new errors.MsgLibNotAllowedError(executorSDK.getProgram()),
        );
    });

    it('should failure with fake sender', async function () {
        const ix = executorSDK.quoteExecutor({
            priceFeedProgram,
            msglib,
            dstEid: DST_EID,
            sender: generateSigner({ eddsa }).publicKey,
            calldataSize: defaultCallDataSize,
            options: [
                {
                    optionType: 1,
                    params: optionParamBuf,
                },
            ],
        });

        await shouldBeRejected(
            sendAndConfirm(umi, ix, wallet),
            new PermissionDeniedError(executorSDK.getProgram()),
        );
    });

    it('should failure with not exist option type', async function () {
        const ix = executorSDK.quoteExecutor({
            priceFeedProgram,
            msglib,
            dstEid: DST_EID,
            sender: EOAPP_ULN.publicKey,
            calldataSize: defaultCallDataSize,
            options: [
                {
                    //fake option type
                    optionType: 5,
                    params: optionParamBuf,
                },
            ],
        });

        await shouldBeRejected(
            sendAndConfirm(umi, ix, wallet),
            new errors.UnsupportedOptionTypeError(executorSDK.getProgram()),
        );
    });

    it('should failure with large option amount', async function () {
        const config = await accounts.fetchExecutorConfig(umi, executorConfigAccount);
        const nativeDropCap = parseInt(config.dstConfigs[0].nativeDropCap.toString());
        const opb = new Serializer(false)
            .serializeU128(1)
            .serializeU128(nativeDropCap + 1)
            .getBytes();

        const ix = executorSDK.quoteExecutor({
            priceFeedProgram,
            msglib,
            dstEid: DST_EID,
            sender: EOAPP_ULN.publicKey,
            calldataSize: defaultCallDataSize,
            options: [
                {
                    optionType: 1,
                    params: opb,
                },
            ],
        });

        await shouldBeRejected(
            sendAndConfirm(umi, ix, wallet),
            new errors.NativeAmountExceedsCapError(executorSDK.getProgram()),
        );
    });

    it('should failure with zero lz receive gas', async function () {
        // const opb = arrayify(solidityPack(['uint128', 'uint128'], [0, 0]))
        const opb = new Serializer(false).serializeU128(0).serializeU128(0).getBytes();

        const ix = executorSDK.quoteExecutor({
            priceFeedProgram,
            msglib,
            dstEid: DST_EID,
            sender: EOAPP_ULN.publicKey,
            calldataSize: defaultCallDataSize,
            options: [
                {
                    optionType: 1,
                    params: opb,
                },
            ],
        });

        await shouldBeRejected(
            sendAndConfirm(umi, ix, wallet),
            new errors.ZeroLzReceiveGasProvidedError(executorSDK.getProgram()),
        );
    });

    it('should failure with zero lz compose gas', async function () {
        // const opb = arrayify(solidityPack(['uint16', 'uint128', 'uint128'], [0, 0, 0]))
        const opb = new Serializer(false)
            .serializeU16(0)
            .serializeU128(0)
            .serializeU128(0)
            .getBytes();
        const ix = executorSDK.quoteExecutor({
            priceFeedProgram,
            msglib,
            dstEid: DST_EID,
            sender: EOAPP_ULN.publicKey,
            calldataSize: defaultCallDataSize,
            options: [
                {
                    optionType: 1,
                    params: optionParamBuf,
                },
                {
                    optionType: 3,
                    params: opb,
                },
            ],
        });

        await shouldBeRejected(
            sendAndConfirm(umi, ix, wallet),
            new errors.ZeroLzComposeGasProvidedError(executorSDK.getProgram()),
        );
    });

    it('should fail with zero dstConfig.lz_receive_base_gas', async function () {
        const quoteIx = executorSDK.quoteExecutor({
            priceFeedProgram,
            msglib,
            dstEid: DST_EID,
            sender: EOAPP_ULN.publicKey,
            calldataSize: defaultCallDataSize,
            options: [
                {
                    optionType: 1,
                    params: optionParamBuf,
                },
            ],
        });

        const dstConfigIx = executorSDK.setDstConfig(wallet, [
            {
                eid: DST_EID,
                lzReceiveBaseGas: 0,
                lzComposeBaseGas: 1000,
                multiplierBps: some(12000),
                floorMarginUsd: none(),
                nativeDropCap: 10000000000n,
            },
        ]);
        await shouldBeRejected(
            sendAndConfirm(umi, [dstConfigIx, quoteIx], wallet),
            new errors.EidNotSupportedError(executorSDK.getProgram()),
        );
    });

    it('should success', async function () {
        const nativeDropAmount = BigInt(1e9);
        const composeGas = 1000n;
        const composeValue = BigInt(1e9);
        const optionsList = [
            [
                {
                    optionType: 1,
                    params: optionParamBuf,
                },
            ], // only lz receive option
            [
                {
                    optionType: 1,
                    params: optionParamBuf,
                },
                {
                    optionType: 2,
                    params: new Serializer(false)
                        .serializeU128(nativeDropAmount)
                        .serializeFixedBytes(Keypair.generate().publicKey.toBytes())
                        .getBytes(),
                },
            ], // lz receive and native drop options
            [
                {
                    optionType: 1,
                    params: optionParamBuf,
                },
                {
                    optionType: 2,
                    params: new Serializer(false)
                        .serializeU128(nativeDropAmount)
                        .serializeFixedBytes(Keypair.generate().publicKey.toBytes())
                        .getBytes(),
                },
                {
                    optionType: 3,
                    params: new Serializer(false)
                        .serializeU16(0)
                        .serializeU128(composeGas)
                        .serializeU128(composeValue)
                        .getBytes(),
                },
            ], // lz receive and native drop and lz compose options
            [
                {
                    optionType: 1,
                    params: optionParamBuf,
                },
                {
                    optionType: 2,
                    params: new Serializer(false)
                        .serializeU128(nativeDropAmount)
                        .serializeFixedBytes(Keypair.generate().publicKey.toBytes())
                        .getBytes(),
                },
                {
                    optionType: 3,
                    params: new Serializer(false)
                        .serializeU16(0)
                        .serializeU128(composeGas)
                        .serializeU128(composeValue)
                        .getBytes(),
                },
                {
                    optionType: 4,
                    params: Uint8Array.from([]),
                },
            ], // lz receive and native drop and lz compose options with ordered
        ];
        for (const [index, options] of optionsList.entries()) {
            const order = options.length === 4;
            const nativeDropBN = options.length >= 2 ? nativeDropAmount : 0n;
            const composeGasBN = options.length >= 3 ? composeGas : 0n;
            const composeValueBN = options.length >= 3 ? composeValue : 0n;
            const ix = executorSDK.quoteExecutor({
                priceFeedProgram,
                msglib,
                dstEid: DST_EID,
                sender: EOAPP_ULN.publicKey,
                calldataSize: defaultCallDataSize,
                options,
            });

            const fee = await simulateTx(connection, ix, wallet, u64());

            const expectedFee = await calExecutorFee(
                validator,
                DST_EID,
                defaultCallDataSize,
                lzReceiveGas,
                lzReceiveValue,
                nativeDropBN,
                composeGasBN > 0n
                    ? [{ composeGas: composeGasBN, composeValue: composeValueBN }]
                    : [],
                order,
            );
            console.log(
                'index: ',
                index,
                'fee: ',
                fee.toString(),
                'expectedFee: ',
                expectedFee.toString(),
            );
            assert.strictEqual(fee, expectedFee);
        }
    });
};
