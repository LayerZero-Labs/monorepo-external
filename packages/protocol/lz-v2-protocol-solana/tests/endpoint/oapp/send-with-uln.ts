import { KeypairSigner, publicKeyBytes } from '@metaplex-foundation/umi';
import { base58 } from '@metaplex-foundation/umi/serializers';
import {
    fromWeb3JsPublicKey,
    toWeb3JsKeypair,
    toWeb3JsPublicKey,
} from '@metaplex-foundation/umi-web3js-adapters';
import { PublicKey } from '@solana/web3.js';
import { assert, beforeAll, expect, it } from 'vitest';

import {
    EndpointProgram,
    extractEventFromTransactionSignature,
    SetConfigType,
    SolanaPacketPath,
    UlnProgram,
} from '../../../src';
import { accounts, errors } from '../../../src/endpoint';
import { SolanaTestValidator } from '../../setup';
import {
    createFakeLzTokenAccount,
    createLzTokenAccount,
    DST_EID,
    dvnPDA,
    EOAPP_DELEGATE,
    EOAPP_ULN,
    executorPDA,
    getAssociatedFakeLzTokenAddress,
    getAssociatedLzTokenAddress,
    getFakeLzTokenMint,
    getLzTokenAssociatedAccount,
    getLzTokenMint,
    options,
    quote,
    send,
    sendAndConfirm,
    sendWithLzToken,
    shouldBeRejected,
    simulateTx,
    TREASURER,
} from '../../utils';

export const testSuite = (validator: SolanaTestValidator): void => {
    const { umi, connection } = validator;
    const wallet = umi.payer as KeypairSigner;
    const endpointSDK = new EndpointProgram.Endpoint(EndpointProgram.ENDPOINT_PROGRAM_ID);
    const ulnSDK = new UlnProgram.Uln(UlnProgram.ULN_PROGRAM_ID);

    const oAppKp = EOAPP_ULN;
    const path: SolanaPacketPath = {
        sender: oAppKp.publicKey,
        dstEid: DST_EID,
        receiver: publicKeyBytes(oAppKp.publicKey),
    };
    // PDAs
    const [messageLibPda] = ulnSDK.pda.messageLib();
    const [noncePda] = endpointSDK.pda.nonce(
        oAppKp.publicKey,
        DST_EID,
        publicKeyBytes(oAppKp.publicKey),
    );
    const [executorConfig] = executorPDA.config();
    const [dvnConfigPda] = dvnPDA.config();

    const message = Uint8Array.from(Buffer.from('hello world'));

    let lzTokenMint: PublicKey;
    let lzTokenSource: PublicKey;

    beforeAll(async function () {
        const walletInWeb3Js = toWeb3JsKeypair(wallet);
        const treasurerInWeb3Js = toWeb3JsKeypair(TREASURER);
        await createLzTokenAccount(connection, walletInWeb3Js, treasurerInWeb3Js.publicKey); // initial lz treasury
        await createFakeLzTokenAccount(connection, walletInWeb3Js, treasurerInWeb3Js.publicKey);

        lzTokenMint = getLzTokenMint();
        lzTokenSource = await getAssociatedLzTokenAddress(walletInWeb3Js.publicKey);
    });

    it('revert if lzToken fee is provided but not enabled', async function () {
        // 1. construct set lz token to null instruction
        const disableLzTokenIx = endpointSDK.setLzToken(wallet, null);

        // 2. construct the send instruction
        const sendIX = await send(umi, endpointSDK, wallet, ulnSDK, path, {
            dstEid: path.dstEid,
            receiver: path.receiver,
            message,
            options: options.toBytes(),
            nativeFee: 100,
            lzTokenFee: 100,
        });

        await shouldBeRejected(
            sendAndConfirm(umi, [disableLzTokenIx, sendIX], [wallet, oAppKp]),
            new errors.LzTokenUnavailableError(endpointSDK.getProgram()),
        );
    });

    it('revert if send with not enough fee', async function () {
        const quoteIx = await quote(umi, endpointSDK, wallet, ulnSDK, path, {
            sender: oAppKp.publicKey,
            dstEid: path.dstEid,
            receiver: path.receiver,
            message,
            options: options.toBytes(),
            payInLzToken: false,
        });
        const quoteFee = await simulateTx(
            connection,
            quoteIx,
            wallet,
            EndpointProgram.types.getMessagingFeeSerializer(),
        );
        assert.ok(quoteFee.nativeFee > 0n);
        assert.ok(quoteFee.lzTokenFee === 0n);

        const ix = await send(umi, endpointSDK, wallet, ulnSDK, path, {
            dstEid: path.dstEid,
            receiver: path.receiver,
            message,
            options: options.toBytes(),
            nativeFee: quoteFee.nativeFee - 1n, // less than quote fee
            lzTokenFee: 0,
        });
        await shouldBeRejected(
            sendAndConfirm(umi, ix, [wallet, oAppKp]),
            new UlnProgram.errors.InsufficientFeeError(ulnSDK.getProgram()),
        );
    });

    it('success send with equal quote fee', async function () {
        const quoteIx = await quote(umi, endpointSDK, wallet, ulnSDK, path, {
            dstEid: path.dstEid,
            receiver: path.receiver,
            message,
            options: options.toBytes(),
            payInLzToken: false,
            sender: oAppKp.publicKey,
        });
        const quoteFee = await simulateTx(
            connection,
            quoteIx,
            wallet,
            EndpointProgram.types.getMessagingFeeSerializer(),
        );
        assert.ok(quoteFee.nativeFee > 0n);
        assert.ok(quoteFee.lzTokenFee === 0n);

        const payerBalanceBefore = await umi.rpc.getBalance(wallet.publicKey);
        const executorBalanceBefore = await umi.rpc.getBalance(executorConfig);
        const dvnBalanceBefore = await umi.rpc.getBalance(dvnConfigPda);
        const treasuryBalanceBefore = await umi.rpc.getBalance(TREASURER.publicKey);
        const nonceBefore = await accounts.fetchNonce(umi, noncePda);

        const ix = await send(umi, endpointSDK, wallet, ulnSDK, path, {
            dstEid: path.dstEid,
            receiver: path.receiver,
            message,
            options: options.toBytes(),
            nativeFee: quoteFee.nativeFee,
            lzTokenFee: quoteFee.lzTokenFee,
        });

        const { signature } = await sendAndConfirm(umi, ix, [wallet, oAppKp]);

        // check outbound
        const nonceAfter = await accounts.fetchNonce(umi, noncePda);
        expect(nonceAfter.outboundNonce).to.be.eq(nonceBefore.outboundNonce + 1n);

        // check fee balance
        const payerBalanceAfter = await umi.rpc.getBalance(wallet.publicKey);
        const executorBalanceAfter = await umi.rpc.getBalance(executorConfig);
        const dvnBalanceAfter = await umi.rpc.getBalance(dvnConfigPda);
        const treasuryBalanceAfter = await umi.rpc.getBalance(TREASURER.publicKey);
        const txReceipt = await umi.rpc.getTransaction(base58.serialize(signature), {
            commitment: 'confirmed',
            // maxSupportedTransactionVersion: 1,
        });
        expect(payerBalanceBefore.basisPoints - payerBalanceAfter.basisPoints).to.be.eq(
            quoteFee.nativeFee + (txReceipt?.meta.fee.basisPoints ?? 0n),
        );
        expect(quoteFee.nativeFee).to.be.eq(
            executorBalanceAfter.basisPoints -
                executorBalanceBefore.basisPoints +
                dvnBalanceAfter.basisPoints -
                dvnBalanceBefore.basisPoints +
                treasuryBalanceAfter.basisPoints -
                treasuryBalanceBefore.basisPoints,
        );

        // check event
        const event = await extractEventFromTransactionSignature(
            connection,
            endpointSDK.programId,
            signature,
            EndpointProgram.events.getPacketSentEventSerializer(),
            { commitment: 'confirmed', maxSupportedTransactionVersion: 1 },
        );
        expect(event?.length).to.be.eq(1);
        expect(event?.[0].sendLibrary).to.be.eq(messageLibPda);
        expect(event?.[0].options.toString()).to.be.eq(options.toBytes().toString());
        expect(event?.[0].encodedPacket).to.not.null; // TODO: check the encoded packet
    });

    it('success refund when send with more than quote fee', async function () {
        const quoteIx = await quote(umi, endpointSDK, wallet, ulnSDK, path, {
            dstEid: path.dstEid,
            receiver: path.receiver,
            message,
            options: options.toBytes(),
            payInLzToken: false,
            sender: oAppKp.publicKey,
        });
        const quoteFee = await simulateTx(
            connection,
            quoteIx,
            wallet,
            EndpointProgram.types.getMessagingFeeSerializer(),
        );
        assert.ok(quoteFee.nativeFee > 0n);
        assert.ok(quoteFee.lzTokenFee === 0n);

        const payerBalanceBefore = await umi.rpc.getBalance(wallet.publicKey);
        const executorBalanceBefore = await umi.rpc.getBalance(executorConfig);
        const dvnBalanceBefore = await umi.rpc.getBalance(dvnConfigPda);
        const treasuryBalanceBefore = await umi.rpc.getBalance(TREASURER.publicKey);
        const nonceBefore = await accounts.fetchNonce(umi, noncePda);

        const ix = await send(umi, endpointSDK, wallet, ulnSDK, path, {
            dstEid: path.dstEid,
            receiver: path.receiver,
            message,
            options: options.toBytes(),
            nativeFee: quoteFee.nativeFee + 1000000000n, // more than quote fee
            lzTokenFee: quoteFee.lzTokenFee,
        });

        const { signature } = await sendAndConfirm(umi, ix, [wallet, oAppKp]);

        // check outbound
        const nonceAfter = await accounts.fetchNonce(umi, noncePda);
        expect(nonceAfter.outboundNonce).to.be.eq(nonceBefore.outboundNonce + 1n);

        // check fee balance
        const payerBalanceAfter = await umi.rpc.getBalance(wallet.publicKey);
        const executorBalanceAfter = await umi.rpc.getBalance(executorConfig);
        const dvnBalanceAfter = await umi.rpc.getBalance(dvnConfigPda);
        const treasuryBalanceAfter = await umi.rpc.getBalance(TREASURER.publicKey);
        const txReceipt = await umi.rpc.getTransaction(base58.serialize(signature), {
            commitment: 'confirmed',
            // maxSupportedTransactionVersion: 1,
        });
        expect(payerBalanceBefore.basisPoints - payerBalanceAfter.basisPoints).to.be.eq(
            quoteFee.nativeFee + (txReceipt?.meta.fee.basisPoints ?? 0n),
        );
        expect(quoteFee.nativeFee).to.be.eq(
            executorBalanceAfter.basisPoints -
                executorBalanceBefore.basisPoints +
                dvnBalanceAfter.basisPoints -
                dvnBalanceBefore.basisPoints +
                treasuryBalanceAfter.basisPoints -
                treasuryBalanceBefore.basisPoints,
        );

        // check event
        const event = await extractEventFromTransactionSignature(
            connection,
            endpointSDK.programId,
            signature,
            EndpointProgram.events.getPacketSentEventSerializer(),
            { commitment: 'confirmed', maxSupportedTransactionVersion: 1 },
        );
        expect(event?.length).to.be.eq(1);
        expect(event?.[0].sendLibrary).to.be.eq(messageLibPda);
        expect(event?.[0].options.toString()).to.be.eq(options.toBytes().toString());
        expect(event?.[0].encodedPacket).to.not.null; // TODO: check the encoded packet
    });

    it('revert if send_with_lz_token not enough fee', async function () {
        const quoteIx = await quote(umi, endpointSDK, wallet, ulnSDK, path, {
            sender: oAppKp.publicKey,
            dstEid: path.dstEid,
            receiver: path.receiver,
            message,
            options: options.toBytes(),
            payInLzToken: true,
        });
        const quoteFee = await simulateTx(
            connection,
            quoteIx,
            wallet,
            EndpointProgram.types.getMessagingFeeSerializer(),
        );
        assert.ok(quoteFee.nativeFee > 0n);
        assert.ok(quoteFee.lzTokenFee > 0n);

        // not enough lz token fee
        const sendArgs = {
            dstEid: path.dstEid,
            receiver: path.receiver,
            message,
            options: options.toBytes(),
            lzTokenFee: quoteFee.lzTokenFee,
            nativeFee: quoteFee.nativeFee,
        };
        const accounts = {
            payer: wallet,
            tokenMint: fromWeb3JsPublicKey(lzTokenMint),
            tokenSource: fromWeb3JsPublicKey(lzTokenSource),
        };
        let ix = await sendWithLzToken(umi, endpointSDK, accounts, ulnSDK, path, {
            ...sendArgs,
            lzTokenFee: quoteFee.lzTokenFee - 1n, // lzToken fee less than quote fee
        });

        await shouldBeRejected(
            sendAndConfirm(umi, ix, [wallet, oAppKp]),
            new UlnProgram.errors.InsufficientFeeError(ulnSDK.getProgram()),
        );

        // not enough native fee
        ix = await sendWithLzToken(umi, endpointSDK, accounts, ulnSDK, path, {
            ...sendArgs,
            nativeFee: quoteFee.nativeFee - 1n, // native fee less than quote fee
        });

        await shouldBeRejected(
            sendAndConfirm(umi, ix, [wallet, oAppKp]),
            new UlnProgram.errors.InsufficientFeeError(ulnSDK.getProgram()),
        );

        // not enough lz token fee & native fee
        ix = await sendWithLzToken(umi, endpointSDK, accounts, ulnSDK, path, {
            ...sendArgs,
            lzTokenFee: quoteFee.lzTokenFee - 1n,
            nativeFee: quoteFee.nativeFee - 1n,
        });
        await shouldBeRejected(
            sendAndConfirm(umi, ix, [wallet, oAppKp]),
            new UlnProgram.errors.InsufficientFeeError(ulnSDK.getProgram()),
        );
    });

    it('revert if send_with_lz_token with fakeLzToken', async function () {
        const quoteIx = await quote(umi, endpointSDK, wallet, ulnSDK, path, {
            sender: oAppKp.publicKey,
            dstEid: path.dstEid,
            receiver: path.receiver,
            message,
            options: options.toBytes(),
            payInLzToken: true,
        });
        const quoteFee = await simulateTx(
            connection,
            quoteIx,
            wallet,
            EndpointProgram.types.getMessagingFeeSerializer(),
        );
        assert.ok(quoteFee.nativeFee > 0n);
        assert.ok(quoteFee.lzTokenFee > 0n);

        const lzTokenSource = await getAssociatedFakeLzTokenAddress(
            toWeb3JsPublicKey(wallet.publicKey),
        );
        const lzTokenTreasury = await getAssociatedFakeLzTokenAddress(
            toWeb3JsPublicKey(TREASURER.publicKey),
        );

        // not enough lz token fee
        const ix = await sendWithLzToken(
            umi,
            endpointSDK,
            {
                payer: wallet,
                tokenMint: fromWeb3JsPublicKey(getFakeLzTokenMint()),
                tokenSource: fromWeb3JsPublicKey(lzTokenSource),
                lzTokenTreasury: fromWeb3JsPublicKey(lzTokenTreasury),
            },
            ulnSDK,
            path,
            {
                dstEid: path.dstEid,
                receiver: path.receiver,
                message,
                options: options.toBytes(),
                nativeFee: quoteFee.nativeFee,
                lzTokenFee: quoteFee.lzTokenFee,
            },
        );
        await shouldBeRejected(
            sendAndConfirm(umi, ix, [wallet, oAppKp]),
            new UlnProgram.errors.InvalidLzTokenMintError(ulnSDK.getProgram()),
        );
    });

    it('success with only optional dvn', async function () {
        const sendConfig = await ulnSDK.getFinalSendConfigState(
            umi.rpc,
            EOAPP_ULN.publicKey,
            DST_EID,
        );
        const newSendConfig = {
            confirmations: sendConfig.confirmations,
            requiredDvns: [],
            requiredDvnCount: 255,
            optionalDvnCount: 1,
            optionalDvnThreshold: 1,
            optionalDvns: [dvnPDA.config()[0]],
        };

        await sendAndConfirm(
            umi,
            [
                await endpointSDK.setOAppConfig(umi.rpc, EOAPP_DELEGATE, {
                    oapp: EOAPP_ULN.publicKey,
                    eid: DST_EID,
                    msgLibProgram: ulnSDK.programId,
                    config: { configType: SetConfigType.SEND_ULN, value: newSendConfig },
                }),
            ],
            [wallet, EOAPP_DELEGATE],
        );

        await sendAndConfirm(
            umi,
            [
                await send(umi, endpointSDK, wallet, ulnSDK, path, {
                    dstEid: path.dstEid,
                    receiver: path.receiver,
                    message,
                    options: options.toBytes(),
                    nativeFee: 3000_000,
                    lzTokenFee: 0,
                }),
            ],
            [wallet, oAppKp],
        );

        // reset the send config
        await sendAndConfirm(
            umi,
            [
                await endpointSDK.setOAppConfig(umi.rpc, EOAPP_DELEGATE, {
                    oapp: EOAPP_ULN.publicKey,
                    eid: DST_EID,
                    msgLibProgram: ulnSDK.programId,
                    config: { configType: SetConfigType.SEND_ULN, value: sendConfig },
                }),
            ],
            [wallet, EOAPP_DELEGATE],
        );
    });

    it('success send_with_lz_token with equal fee', async function () {
        const quoteIx = await quote(umi, endpointSDK, wallet, ulnSDK, path, {
            sender: oAppKp.publicKey,
            dstEid: path.dstEid,
            receiver: path.receiver,
            message,
            options: options.toBytes(),
            payInLzToken: true,
        });
        const quoteFee = await simulateTx(
            connection,
            quoteIx,
            wallet,
            EndpointProgram.types.getMessagingFeeSerializer(),
        );
        assert.ok(quoteFee.nativeFee > 0n);
        assert.ok(quoteFee.lzTokenFee > 0n);

        const nonceBefore = await accounts.fetchNonce(umi, noncePda);
        const payerBalanceBefore = await umi.rpc.getBalance(wallet.publicKey);
        const executorBalanceBefore = await umi.rpc.getBalance(executorConfig);
        const dvnBalanceBefore = await umi.rpc.getBalance(dvnConfigPda);

        const payerLzTokenBalanceBefore = await getLzTokenAssociatedAccount(
            connection,
            toWeb3JsPublicKey(wallet.publicKey),
        );
        const treasuryLzTokenBalanceBefore = await getLzTokenAssociatedAccount(
            connection,
            toWeb3JsPublicKey(TREASURER.publicKey),
        );

        const ix = await sendWithLzToken(
            umi,
            endpointSDK,
            {
                payer: wallet,
                tokenMint: fromWeb3JsPublicKey(lzTokenMint),
                tokenSource: fromWeb3JsPublicKey(lzTokenSource),
            },
            ulnSDK,
            path,
            {
                dstEid: path.dstEid,
                receiver: path.receiver,
                message,
                options: options.toBytes(),
                nativeFee: quoteFee.nativeFee,
                lzTokenFee: quoteFee.lzTokenFee,
            },
        );
        const { signature } = await sendAndConfirm(umi, ix, [wallet, oAppKp], 400000);

        // check outbound
        const nonceAfter = await accounts.fetchNonce(umi, noncePda);
        expect(nonceAfter.outboundNonce).to.be.eq(nonceBefore.outboundNonce + 1n);

        // check lz token fee balance
        const payerLzTokenBalanceAfter = await getLzTokenAssociatedAccount(
            connection,
            toWeb3JsPublicKey(wallet.publicKey),
        );
        const treasuryLzTokenBalanceAfter = await getLzTokenAssociatedAccount(
            connection,
            toWeb3JsPublicKey(TREASURER.publicKey),
        );
        expect(treasuryLzTokenBalanceAfter.amount - treasuryLzTokenBalanceBefore.amount).to.be.eq(
            quoteFee.lzTokenFee,
        );
        expect(payerLzTokenBalanceBefore.amount - payerLzTokenBalanceAfter.amount).to.be.eq(
            quoteFee.lzTokenFee,
        );

        // check native fee balance
        const payerBalanceAfter = await umi.rpc.getBalance(wallet.publicKey);
        const executorBalanceAfter = await umi.rpc.getBalance(executorConfig);
        const dvnBalanceAfter = await umi.rpc.getBalance(dvnConfigPda);
        const txReceipt = await umi.rpc.getTransaction(base58.serialize(signature), {
            commitment: 'confirmed',
            // maxSupportedTransactionVersion: 1,
        });
        expect(payerBalanceBefore.basisPoints - payerBalanceAfter.basisPoints).to.be.eq(
            quoteFee.nativeFee + (txReceipt?.meta.fee.basisPoints ?? 0n),
        );
        expect(quoteFee.nativeFee).to.be.eq(
            executorBalanceAfter.basisPoints -
                executorBalanceBefore.basisPoints +
                dvnBalanceAfter.basisPoints -
                dvnBalanceBefore.basisPoints,
        );

        // check event
        const event = await extractEventFromTransactionSignature(
            connection,
            endpointSDK.programId,
            signature,
            EndpointProgram.events.getPacketSentEventSerializer(),
            { commitment: 'confirmed', maxSupportedTransactionVersion: 1 },
        );
        expect(event?.length).to.be.eq(1);
        expect(event?.[0].sendLibrary).to.be.eq(messageLibPda);
        expect(event?.[0].options.toString()).to.be.eq(options.toBytes().toString());
        expect(event?.[0].encodedPacket).to.not.null; // TODO: check the encoded packet
    });

    it('success refund send_with_lz_token more than fee', async function () {
        const quoteIx = await quote(umi, endpointSDK, wallet, ulnSDK, path, {
            sender: oAppKp.publicKey,
            dstEid: path.dstEid,
            receiver: path.receiver,
            message,
            options: options.toBytes(),
            payInLzToken: true,
        });
        const quoteFee = await simulateTx(
            connection,
            quoteIx,
            wallet,
            EndpointProgram.types.getMessagingFeeSerializer(),
        );
        assert.ok(quoteFee.nativeFee > 0n);
        assert.ok(quoteFee.lzTokenFee > 0n);

        const ixParams: EndpointProgram.instructions.SendInstructionArgs = {
            receiver: path.receiver,
            message,
            options: options.toBytes(),
            lzTokenFee: quoteFee.lzTokenFee,
            nativeFee: quoteFee.nativeFee,
            dstEid: DST_EID,
        };

        const cases = [
            { ...ixParams, lzTokenFee: quoteFee.lzTokenFee + 10000000n }, // lzToken more than quote fee
            { ...ixParams, nativeFee: quoteFee.nativeFee + 10000000n }, // native more than quote fee
            {
                ...ixParams,
                nativeFee: quoteFee.nativeFee + 10000000n,
                lzTokenFee: quoteFee.lzTokenFee + 10000000n,
            }, // both more than quote fee
        ];

        for (const params of cases) {
            const nonceBefore = await accounts.fetchNonce(umi, noncePda);
            const payerBalanceBefore = await umi.rpc.getBalance(wallet.publicKey);
            const executorBalanceBefore = await umi.rpc.getBalance(executorConfig);
            const dvnBalanceBefore = await umi.rpc.getBalance(dvnConfigPda);

            const payerLzTokenBalanceBefore = await getLzTokenAssociatedAccount(
                connection,
                toWeb3JsPublicKey(wallet.publicKey),
            );
            const treasuryLzTokenBalanceBefore = await getLzTokenAssociatedAccount(
                connection,
                toWeb3JsPublicKey(TREASURER.publicKey),
            );

            const ix = await sendWithLzToken(
                umi,
                endpointSDK,
                {
                    payer: wallet,
                    tokenMint: fromWeb3JsPublicKey(lzTokenMint),
                    tokenSource: fromWeb3JsPublicKey(lzTokenSource),
                },
                ulnSDK,
                path,
                params,
            );
            const { signature } = await sendAndConfirm(umi, ix, [wallet, oAppKp], 400000);

            // check outbound
            const nonceAfter = await accounts.fetchNonce(umi, noncePda);
            expect(nonceAfter.outboundNonce).to.be.eq(nonceBefore.outboundNonce + 1n);

            // check lz token fee balance
            const payerLzTokenBalanceAfter = await getLzTokenAssociatedAccount(
                connection,
                toWeb3JsPublicKey(wallet.publicKey),
            );
            const treasuryLzTokenBalanceAfter = await getLzTokenAssociatedAccount(
                connection,
                toWeb3JsPublicKey(TREASURER.publicKey),
            );
            expect(
                treasuryLzTokenBalanceAfter.amount - treasuryLzTokenBalanceBefore.amount,
            ).to.be.eq(quoteFee.lzTokenFee);

            expect(payerLzTokenBalanceBefore.amount - payerLzTokenBalanceAfter.amount).to.be.eq(
                BigInt(quoteFee.lzTokenFee.toString()),
            );
            // check native fee balance
            const payerBalanceAfter = await umi.rpc.getBalance(wallet.publicKey);
            const executorBalanceAfter = await umi.rpc.getBalance(executorConfig);
            const dvnBalanceAfter = await umi.rpc.getBalance(dvnConfigPda);
            const txReceipt = await umi.rpc.getTransaction(base58.serialize(signature), {
                commitment: 'confirmed',
                // maxSupportedTransactionVersion: 1,
            });
            expect(payerBalanceBefore.basisPoints - payerBalanceAfter.basisPoints).to.be.eq(
                quoteFee.nativeFee + (txReceipt?.meta.fee.basisPoints ?? 0n),
            );
            expect(quoteFee.nativeFee).to.be.eq(
                executorBalanceAfter.basisPoints -
                    executorBalanceBefore.basisPoints +
                    dvnBalanceAfter.basisPoints -
                    dvnBalanceBefore.basisPoints,
            );

            // check event
            const event = await extractEventFromTransactionSignature(
                connection,
                endpointSDK.programId,
                signature,
                EndpointProgram.events.getPacketSentEventSerializer(),
                { commitment: 'confirmed', maxSupportedTransactionVersion: 1 },
            );
            expect(event?.length).to.be.eq(1);
            expect(event?.[0].sendLibrary).to.be.eq(messageLibPda);
            expect(event?.[0].options.toString()).to.be.eq(options.toBytes().toString());
            expect(event?.[0].encodedPacket).to.not.null; // TODO: check the encoded packet
        }
    });
};
