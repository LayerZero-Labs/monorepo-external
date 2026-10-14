import { KeypairSigner, publicKeyBytes } from '@metaplex-foundation/umi';
import {
    fromWeb3JsPublicKey,
    toWeb3JsKeypair,
    toWeb3JsPublicKey,
} from '@metaplex-foundation/umi-web3js-adapters';
import { assert, beforeAll, expect, it } from 'vitest';

import {
    EndpointProgram,
    extractEventFromTransactionSignature,
    SimpleMessageLibProgram,
    SolanaPacketPath,
} from '../../../src';
import { accounts, errors } from '../../../src/endpoint';
import { SolanaTestValidator } from '../../setup';
import {
    createFakeLzTokenAccount,
    createLzTokenAccount,
    DST_EID,
    EOAPP,
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
    setOAppOutBoundNonce,
    shouldBeRejected,
    simulateTx,
} from '../../utils';

export const testSuite = (validator: SolanaTestValidator): void => {
    const { umi, connection } = validator;
    const wallet = umi.payer as KeypairSigner;
    const endpointSDK = new EndpointProgram.Endpoint(EndpointProgram.ENDPOINT_PROGRAM_ID);
    const simpleSdk = new SimpleMessageLibProgram.SimpleMessageLib(
        SimpleMessageLibProgram.SIMPLE_MESSAGELIB_PROGRAM_ID,
    );
    const oAppKp = EOAPP;

    const [messageLibPda] = simpleSdk.pda.messageLib();
    const [noncePda] = endpointSDK.pda.nonce(
        oAppKp.publicKey,
        DST_EID,
        publicKeyBytes(oAppKp.publicKey),
    );
    const path: SolanaPacketPath = {
        sender: oAppKp.publicKey,
        dstEid: DST_EID,
        receiver: publicKeyBytes(oAppKp.publicKey),
    };

    beforeAll(async function () {
        const msgLibInWeb3 = toWeb3JsPublicKey(messageLibPda);
        await createLzTokenAccount(connection, toWeb3JsKeypair(wallet), msgLibInWeb3); // create tokenAccount for messageLibPda
        await createFakeLzTokenAccount(connection, toWeb3JsKeypair(wallet), msgLibInWeb3); // create tokenAccount for messageLibPda
    });

    it('revert if send with lzToken fee but lzToken is not set to msglib', async function () {
        const lzTokenMint = getLzTokenMint();
        const lzTokenSource = await getAssociatedLzTokenAddress(
            toWeb3JsPublicKey(wallet.publicKey),
        );
        // const messageLibPdaLzAccountAddr = await getAssociatedLzTokenAddress(messageLibPda)

        const clearLzTokenIx = endpointSDK.setLzToken(wallet, null);

        const ix = await sendWithLzToken(
            umi,
            endpointSDK,
            {
                payer: wallet,
                tokenMint: fromWeb3JsPublicKey(lzTokenMint),
                tokenSource: fromWeb3JsPublicKey(lzTokenSource),
            },
            simpleSdk,
            path,
            {
                dstEid: DST_EID,
                receiver: publicKeyBytes(oAppKp.publicKey),
                message: Uint8Array.from(Buffer.from('hello world')),
                options: options.toBytes(),
                nativeFee: 100,
                lzTokenFee: 100,
            },
        );
        await shouldBeRejected(
            sendAndConfirm(umi, [clearLzTokenIx, ix], [wallet, oAppKp]),
            new errors.LzTokenUnavailableError(endpointSDK.getProgram()),
        );
    });

    it('revert if send with not enough fee', async function () {
        const quoteIx = await quote(umi, endpointSDK, wallet, simpleSdk, path, {
            sender: path.sender,
            dstEid: DST_EID,
            receiver: path.receiver,
            message: Uint8Array.from(Buffer.from('hello world')),
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

        const ix = await send(umi, endpointSDK, wallet, simpleSdk, path, {
            dstEid: path.dstEid,
            receiver: path.receiver,
            message: Uint8Array.from(Buffer.from('hello world')),
            options: options.toBytes(),
            nativeFee: quoteFee.nativeFee - 1n,
            lzTokenFee: quoteFee.lzTokenFee,
        });

        await shouldBeRejected(
            sendAndConfirm(umi, [ix], [wallet, oAppKp]),
            new SimpleMessageLibProgram.errors.InsufficientFeeError(simpleSdk.getProgram()),
        );
    });

    it('success send with equal quote fee', async function () {
        const quoteIx = await quote(umi, endpointSDK, wallet, simpleSdk, path, {
            sender: path.sender,
            dstEid: DST_EID,
            receiver: path.receiver,
            message: Uint8Array.from(Buffer.from('hello world')),
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

        const payerBalanceBefore = await umi.rpc.getBalance(wallet.publicKey);
        const balanceBefore = await umi.rpc.getBalance(messageLibPda);
        const nonceBefore = await accounts.fetchNonce(umi, noncePda);
        const ix = await send(umi, endpointSDK, wallet, simpleSdk, path, {
            dstEid: path.dstEid,
            receiver: path.receiver,
            message: Uint8Array.from(Buffer.from('hello world')),
            options: options.toBytes(),
            nativeFee: quoteFee.nativeFee,
            lzTokenFee: quoteFee.lzTokenFee,
        });
        const { signature } = await sendAndConfirm(umi, [ix], [wallet, oAppKp]);

        // check outbound
        const nonceAfter = await accounts.fetchNonce(umi, noncePda);
        assert.strictEqual(nonceAfter.outboundNonce, nonceBefore.outboundNonce + 1n);

        setOAppOutBoundNonce(nonceAfter.outboundNonce); // save the nonce for the next test

        const payerBalanceAfter = await umi.rpc.getBalance(wallet.publicKey);
        // check fee collected
        assert.strictEqual(
            balanceBefore.basisPoints + quoteFee.nativeFee,
            (await umi.rpc.getBalance(messageLibPda)).basisPoints,
        );

        // check payer balance
        const txReceipt = await connection.getParsedTransaction(signature, {
            commitment: 'confirmed',
            maxSupportedTransactionVersion: 1,
        });
        assert.strictEqual(
            payerBalanceBefore.basisPoints - quoteFee.nativeFee - BigInt(txReceipt?.meta?.fee ?? 0),
            payerBalanceAfter.basisPoints,
        );

        // check event
        const event = await extractEventFromTransactionSignature(
            connection,
            endpointSDK.programId,
            signature,
            EndpointProgram.events.getPacketSentEventSerializer(),
            { commitment: 'confirmed', maxSupportedTransactionVersion: 1 },
        );
        expect(event?.[0].sendLibrary).to.be.eq(messageLibPda);
        expect(event?.[0].options.toString()).to.be.eq(options.toBytes().toString());
        expect(event?.[0].encodedPacket).to.not.null; // TODO: check the encoded packet
    });

    it('success refund when send with more than quote fee', async function () {
        const quoteIx = await quote(umi, endpointSDK, wallet, simpleSdk, path, {
            sender: path.sender,
            dstEid: DST_EID,
            receiver: path.receiver,
            message: Uint8Array.from(Buffer.from('hello world')),
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

        const payerBalanceBefore = await umi.rpc.getBalance(wallet.publicKey);
        const balanceBefore = await umi.rpc.getBalance(messageLibPda);
        const nonceBefore = await accounts.fetchNonce(umi, noncePda);
        const ix = await send(umi, endpointSDK, wallet, simpleSdk, path, {
            dstEid: path.dstEid,
            receiver: path.receiver,
            message: Uint8Array.from(Buffer.from('hello world')),
            options: options.toBytes(),
            nativeFee: quoteFee.nativeFee + 1n, // more than quote fee
            lzTokenFee: quoteFee.lzTokenFee,
        });

        const { signature } = await sendAndConfirm(umi, ix, [wallet, oAppKp]);

        // check outbound
        const nonceAfter = await accounts.fetchNonce(umi, noncePda);
        assert.strictEqual(nonceAfter.outboundNonce, nonceBefore.outboundNonce + 1n);
        setOAppOutBoundNonce(nonceAfter.outboundNonce); // save the nonce for the next test

        const payerBalanceAfter = await umi.rpc.getBalance(wallet.publicKey);
        // check fee collected
        assert.strictEqual(
            balanceBefore.basisPoints + quoteFee.nativeFee,
            (await umi.rpc.getBalance(messageLibPda)).basisPoints,
        );

        // check payer balance
        const txReceipt = await connection.getParsedTransaction(signature, {
            commitment: 'confirmed',
            maxSupportedTransactionVersion: 1,
        });
        assert.strictEqual(
            payerBalanceBefore.basisPoints - quoteFee.nativeFee - BigInt(txReceipt?.meta?.fee ?? 0),
            payerBalanceAfter.basisPoints,
        );

        // check event
        const event = await extractEventFromTransactionSignature(
            connection,
            endpointSDK.programId,
            signature,
            EndpointProgram.events.getPacketSentEventSerializer(),
            { commitment: 'confirmed', maxSupportedTransactionVersion: 1 },
        );
        expect(event?.[0].sendLibrary).to.be.eq(messageLibPda);
        expect(event?.[0].options.toString()).to.be.eq(options.toBytes().toString());
        expect(event?.[0].encodedPacket).to.not.null; // TODO: check the encoded packet
    });

    it('revert if send_with_lz_token not enough fee', async function () {
        const lzTokenMint = getLzTokenMint();
        const lzTokenSource = await getAssociatedLzTokenAddress(
            toWeb3JsPublicKey(wallet.publicKey),
        );
        // const messageLibPdaLzAccountAddr = await getAssociatedLzTokenAddress(messageLibPda)

        const quoteIx = await quote(umi, endpointSDK, wallet, simpleSdk, path, {
            sender: path.sender,
            dstEid: DST_EID,
            receiver: path.receiver,
            message: Uint8Array.from(Buffer.from('hello world')),
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

        let ix = await sendWithLzToken(
            umi,
            endpointSDK,
            {
                payer: wallet,
                tokenMint: fromWeb3JsPublicKey(lzTokenMint),
                tokenSource: fromWeb3JsPublicKey(lzTokenSource),
            },
            simpleSdk,
            path,
            {
                dstEid: path.dstEid,
                receiver: path.receiver,
                message: Uint8Array.from(Buffer.from('hello world')),
                options: options.toBytes(),
                nativeFee: quoteFee.nativeFee - 1n, // not enough native fee
                lzTokenFee: quoteFee.lzTokenFee,
            },
        );

        await shouldBeRejected(
            sendAndConfirm(umi, ix, [wallet, oAppKp]),
            new SimpleMessageLibProgram.errors.InsufficientFeeError(simpleSdk.getProgram()),
        );
        ix = await sendWithLzToken(
            umi,
            endpointSDK,
            {
                payer: wallet,
                tokenMint: fromWeb3JsPublicKey(lzTokenMint),
                tokenSource: fromWeb3JsPublicKey(lzTokenSource),
            },
            simpleSdk,
            path,
            {
                dstEid: path.dstEid,
                receiver: path.receiver,
                message: Uint8Array.from(Buffer.from('hello world')),
                options: options.toBytes(),
                nativeFee: quoteFee.nativeFee,
                lzTokenFee: quoteFee.lzTokenFee - 1n, // not enough lz token fee
            },
        );

        await shouldBeRejected(
            sendAndConfirm(umi, ix, [wallet, oAppKp]),
            new SimpleMessageLibProgram.errors.InsufficientFeeError(simpleSdk.getProgram()),
        );
    });

    it('revert if send_with_lz_token with fakeLzToken', async function () {
        const fakeLzTokenMint = getFakeLzTokenMint();
        const lzTokenSource = await getAssociatedFakeLzTokenAddress(
            toWeb3JsPublicKey(wallet.publicKey),
        );
        // const messageLibPdaLzAccountAddr = await getAssociatedFakeLzTokenAddress(messageLibPda)

        const quoteIx = await quote(umi, endpointSDK, wallet, simpleSdk, path, {
            sender: path.sender,
            dstEid: DST_EID,
            receiver: path.receiver,
            message: Uint8Array.from(Buffer.from('hello world')),
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

        const ix = await sendWithLzToken(
            umi,
            endpointSDK,
            {
                payer: wallet,
                tokenMint: fromWeb3JsPublicKey(fakeLzTokenMint),
                tokenSource: fromWeb3JsPublicKey(lzTokenSource),
            },
            simpleSdk,
            path,
            {
                dstEid: path.dstEid,
                receiver: path.receiver,
                message: Uint8Array.from(Buffer.from('hello world')),
                options: options.toBytes(),
                nativeFee: quoteFee.nativeFee,
                lzTokenFee: quoteFee.lzTokenFee,
            },
        );

        await shouldBeRejected(
            sendAndConfirm(umi, ix, [wallet, oAppKp]),
            new SimpleMessageLibProgram.errors.InvalidLzTokenMintError(simpleSdk.getProgram()),
        );
    });

    it('success send_with_lz_token with equal fee', async function () {
        const lzTokenMint = getLzTokenMint();
        const lzTokenSource = await getAssociatedLzTokenAddress(
            toWeb3JsPublicKey(wallet.publicKey),
        );

        const quoteIx = await quote(umi, endpointSDK, wallet, simpleSdk, path, {
            sender: path.sender,
            dstEid: DST_EID,
            receiver: path.receiver,
            message: Uint8Array.from(Buffer.from('hello world')),
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
        const payerLzTokenBalanceBefore = await getLzTokenAssociatedAccount(
            connection,
            toWeb3JsPublicKey(wallet.publicKey),
        );
        const payerBalanceBefore = await umi.rpc.getBalance(wallet.publicKey);
        const libLzTokenBalanceBefore = await getLzTokenAssociatedAccount(
            connection,
            toWeb3JsPublicKey(messageLibPda),
        );
        const libBalanceBefore = await umi.rpc.getBalance(messageLibPda);

        const ix = await sendWithLzToken(
            umi,
            endpointSDK,
            {
                payer: wallet,
                tokenMint: fromWeb3JsPublicKey(lzTokenMint),
                tokenSource: fromWeb3JsPublicKey(lzTokenSource),
            },
            simpleSdk,
            path,
            {
                dstEid: path.dstEid,
                receiver: path.receiver,
                message: Uint8Array.from(Buffer.from('hello world')),
                options: options.toBytes(),
                nativeFee: quoteFee.nativeFee,
                lzTokenFee: quoteFee.lzTokenFee,
            },
        );

        const { signature } = await sendAndConfirm(umi, ix, [wallet, oAppKp]);

        // check outbound
        const nonceAfter = await accounts.fetchNonce(umi, noncePda);
        assert.strictEqual(nonceAfter.outboundNonce, nonceBefore.outboundNonce + 1n);
        setOAppOutBoundNonce(nonceAfter.outboundNonce); // save the nonce for the next test

        // check lz token fee collected
        const lzTokenBalanceAfter = await getLzTokenAssociatedAccount(
            connection,
            toWeb3JsPublicKey(messageLibPda),
        );
        assert.strictEqual(
            lzTokenBalanceAfter.amount,
            libLzTokenBalanceBefore.amount + quoteFee.lzTokenFee,
        );

        // check payer lzToken balance
        const payerTokenBalanceAfter = await getLzTokenAssociatedAccount(
            connection,
            toWeb3JsPublicKey(wallet.publicKey),
        );
        assert.strictEqual(
            payerTokenBalanceAfter.amount,
            payerLzTokenBalanceBefore.amount - quoteFee.lzTokenFee,
        );

        // check native token collected
        const libBalanceAfter = await umi.rpc.getBalance(messageLibPda);
        assert.strictEqual(
            libBalanceAfter.basisPoints,
            libBalanceBefore.basisPoints + quoteFee.nativeFee,
        );

        // check payer native balance
        const payerBalanceAfter = await umi.rpc.getBalance(wallet.publicKey);
        const txReceipt = await connection.getParsedTransaction(signature, {
            commitment: 'confirmed',
            maxSupportedTransactionVersion: 1,
        });

        assert.strictEqual(
            payerBalanceBefore.basisPoints - quoteFee.nativeFee - BigInt(txReceipt?.meta?.fee ?? 0),
            payerBalanceAfter.basisPoints,
        );

        // check event
        const event = await extractEventFromTransactionSignature(
            connection,
            endpointSDK.programId,
            signature,
            EndpointProgram.events.getPacketSentEventSerializer(),
            { commitment: 'confirmed', maxSupportedTransactionVersion: 1 },
        );
        expect(event?.[0].sendLibrary).to.be.eq(messageLibPda);
        expect(event?.[0].options.toString()).to.be.eq(options.toBytes().toString());
        expect(event?.[0].encodedPacket).to.not.null; // TODO: check the encoded packet
    });

    it('success send_with_lz_token more than fee', async function () {
        const lzTokenMint = getLzTokenMint();
        const lzTokenSource = await getAssociatedLzTokenAddress(
            toWeb3JsPublicKey(wallet.publicKey),
        );

        const quoteIx = await quote(umi, endpointSDK, wallet, simpleSdk, path, {
            sender: path.sender,
            dstEid: DST_EID,
            receiver: path.receiver,
            message: Uint8Array.from(Buffer.from('hello world')),
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
        const payerLzTokenBalanceBefore = await getLzTokenAssociatedAccount(
            connection,
            toWeb3JsPublicKey(wallet.publicKey),
        );
        const payerBalanceBefore = await umi.rpc.getBalance(wallet.publicKey);
        const libLzTokenBalanceBefore = await getLzTokenAssociatedAccount(
            connection,
            toWeb3JsPublicKey(messageLibPda),
        );
        const libBalanceBefore = await umi.rpc.getBalance(messageLibPda);

        const ix = await sendWithLzToken(
            umi,
            endpointSDK,
            {
                payer: wallet,
                tokenMint: fromWeb3JsPublicKey(lzTokenMint),
                tokenSource: fromWeb3JsPublicKey(lzTokenSource),
            },
            simpleSdk,
            path,
            {
                dstEid: path.dstEid,
                receiver: path.receiver,
                message: Uint8Array.from(Buffer.from('hello world')),
                options: options.toBytes(),
                nativeFee: quoteFee.nativeFee + 1000n, // more than quote fee
                lzTokenFee: quoteFee.lzTokenFee + 1000n, // more than quote fee
            },
        );
        const { signature } = await sendAndConfirm(umi, [ix], [wallet, oAppKp]);

        // check outbound
        const nonceAfter = await accounts.fetchNonce(umi, noncePda);
        assert.strictEqual(nonceAfter.outboundNonce, nonceBefore.outboundNonce + 1n);

        setOAppOutBoundNonce(nonceAfter.outboundNonce); // save the nonce for the next test

        // check lz token fee collected
        const lzTokenBalanceAfter = await getLzTokenAssociatedAccount(
            connection,
            toWeb3JsPublicKey(messageLibPda),
        );
        assert.strictEqual(
            lzTokenBalanceAfter.amount,
            libLzTokenBalanceBefore.amount + quoteFee.lzTokenFee,
        );

        // check payer lzToken balance
        const payerTokenBalanceAfter = await getLzTokenAssociatedAccount(
            connection,
            toWeb3JsPublicKey(wallet.publicKey),
        );
        assert.strictEqual(
            payerTokenBalanceAfter.amount,
            payerLzTokenBalanceBefore.amount - quoteFee.lzTokenFee,
        );

        // check native token collected
        const libBalanceAfter = await umi.rpc.getBalance(messageLibPda);
        assert.strictEqual(
            libBalanceAfter.basisPoints,
            libBalanceBefore.basisPoints + quoteFee.nativeFee,
        );

        // check payer native balance
        const payerBalanceAfter = await umi.rpc.getBalance(wallet.publicKey);
        const txReceipt = await connection.getParsedTransaction(signature, {
            commitment: 'confirmed',
            maxSupportedTransactionVersion: 1,
        });
        assert.strictEqual(
            payerBalanceBefore.basisPoints - quoteFee.nativeFee - BigInt(txReceipt?.meta?.fee ?? 0),
            payerBalanceAfter.basisPoints,
        );

        // check event
        const event = await extractEventFromTransactionSignature(
            connection,
            endpointSDK.programId,
            signature,
            EndpointProgram.events.getPacketSentEventSerializer(),
            { commitment: 'confirmed', maxSupportedTransactionVersion: 1 },
        );
        expect(event?.[0].sendLibrary).to.be.eq(messageLibPda);
        expect(event?.[0].options.toString()).to.be.eq(options.toBytes().toString());
        expect(event?.[0].encodedPacket).to.not.null; // TODO: check the encoded packet
    });
};
