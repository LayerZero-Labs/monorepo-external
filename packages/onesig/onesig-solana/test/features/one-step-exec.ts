import { arrayify } from '@ethersproject/bytes';
import { transferSol } from '@metaplex-foundation/mpl-toolbox';
import { createNoopSigner, lamports, sol, some } from '@metaplex-foundation/umi';
import { Connection } from '@solana/web3.js';
import { Wallet } from 'ethers';
import { expect, it } from 'vitest';

import {
    buildOneSigSolanaLeaves,
    DuplicateSignersError,
    ExpiredMerkleRootError,
    FailedSignatureRecoveryError,
    InsufficientSignaturesError,
    InvalidProofError,
    MissingSignerError,
} from '../../src';
import {
    buildOneSigMerkleData,
    createOneSigTransaction,
    createTransferInstruction,
    LOCAL_RPC_URL,
    performOneStepExecution,
    TransactionContext,
    verifyBalanceChange,
} from '../helpers';
import { sendAndConfirm, shouldBeRejected } from '../utils';

/**
 * Tests for one-step transaction execution
 */
export function oneStepExecutionTests(ctx: TransactionContext) {
    const transferInstruction = createTransferInstruction(
        ctx.umi,
        ctx.oneSig.pda.oneSigSigner()[0],
        ctx.recipient.publicKey,
        100n,
    );

    it('should execute a single call transaction', async () => {
        await verifyBalanceChange(
            ctx.umi,
            ctx.recipient.publicKey,
            async () => {
                await performOneStepExecution(
                    ctx,
                    (await ctx.oneSig.getState(ctx.umi.rpc)).nonce,
                    transferInstruction,
                );
            },
            transferInstruction.value,
        );
    });

    it('should build executable leaves with simulated lamport allowance', async () => {
        const amount = 100n;
        const [oneSigSigner] = ctx.oneSig.pda.oneSigSigner();
        await ctx.umi.rpc.airdrop(oneSigSigner, sol(1), { commitment: 'confirmed' });

        const [instruction] = transferSol(ctx.umi, {
            source: createNoopSigner(oneSigSigner),
            destination: ctx.recipient.publicKey,
            amount: lamports(amount),
        }).getInstructions();
        const { nonce } = await ctx.oneSig.getState(ctx.umi.rpc);

        const built = await buildOneSigSolanaLeaves({
            connection: new Connection(LOCAL_RPC_URL, 'confirmed'),
            dummyFeePayer: ctx.payer.publicKey,
            oneSigState: ctx.oneSig.state.publicKey,
            instructions: [instruction],
        });
        const [leaf] = built.leaves;

        expect(leaf.call.value).toEqual(amount);
        const { merkleRoot, expiry, signatures, proof } = await buildOneSigMerkleData(
            ctx.oneSig,
            ctx.oneSigSeed,
            ctx.sortedSigners,
            nonce,
            leaf.call,
        );
        expect(Array.from(built.merkleRoot)).toEqual(Array.from(merkleRoot));
        expect(leaf.proof).toEqual(proof);

        const ix = ctx.oneSig.executeTransaction(ctx.umi.payer, built.merkleRoot, {
            call: leaf.call,
            proof: leaf.proof,
            merkleRootVerification: some({
                expiry,
                signatures: arrayify(signatures),
            }),
        });

        await verifyBalanceChange(
            ctx.umi,
            ctx.recipient.publicKey,
            () => sendAndConfirm(ctx.umi, [ix], [ctx.payer]),
            amount,
        );
    });

    // Error cases
    it('should fail when using an incorrect nonce', async () => {
        // First execute a transaction with nonce 0
        const { ix } = await createOneSigTransaction(
            ctx.umi,
            ctx.oneSig,
            ctx.sortedSigners,
            ctx.oneSigSeed,
            0n, // Reusing nonce 0
            transferInstruction,
        );

        const beforeBalance = await ctx.umi.rpc.getBalance(ctx.recipient.publicKey);

        await shouldBeRejected(
            sendAndConfirm(ctx.umi, [ix], [ctx.payer]),
            new InvalidProofError(ctx.oneSig.getProgram()),
        );

        const afterBalance = await ctx.umi.rpc.getBalance(ctx.recipient.publicKey);
        expect(afterBalance.basisPoints).toEqual(beforeBalance.basisPoints);
    });

    it('should fail when the merkle tree has expired', async () => {
        // Set expiry time in the past
        const { ix } = await createOneSigTransaction(
            ctx.umi,
            ctx.oneSig,
            ctx.sortedSigners,
            ctx.oneSigSeed,
            0n,
            transferInstruction,
            -100, // Expiry in the past
        );

        const beforeBalance = await ctx.umi.rpc.getBalance(ctx.recipient.publicKey);

        await shouldBeRejected(
            sendAndConfirm(ctx.umi, [ix], [ctx.payer]),
            new ExpiredMerkleRootError(ctx.oneSig.getProgram()),
        );

        const afterBalance = await ctx.umi.rpc.getBalance(ctx.recipient.publicKey);
        expect(afterBalance.basisPoints).toEqual(beforeBalance.basisPoints);
    });

    it('should fail with InsufficientSignatures when not enough signatures provided', async () => {
        const {
            nonce,
            multisig: { threshold },
        } = await ctx.oneSig.getState(ctx.umi.rpc);

        // Attempt to create transaction with fewer signatures than required by the threshold
        const { ix } = await createOneSigTransaction(
            ctx.umi,
            ctx.oneSig,
            // Use fewer signers than the threshold requires
            ctx.sortedSigners.slice(0, threshold - 1),
            ctx.oneSigSeed,
            nonce,
            transferInstruction,
        );

        await shouldBeRejected(
            sendAndConfirm(ctx.umi, [ix], [ctx.payer]),
            new InsufficientSignaturesError(ctx.oneSig.getProgram()),
        );

        const { nonce: afterNonce } = await ctx.oneSig.getState(ctx.umi.rpc);
        expect(afterNonce).toEqual(nonce);
    });

    it('should fail with MissingSigner when signer is not in authorized list', async () => {
        const { nonce } = await ctx.oneSig.getState(ctx.umi.rpc);
        const signers = [Wallet.createRandom(), ctx.sortedSigners[0]];

        const { ix } = await createOneSigTransaction(
            ctx.umi,
            ctx.oneSig,
            signers,
            ctx.oneSigSeed,
            nonce,
            transferInstruction,
        );

        await shouldBeRejected(
            sendAndConfirm(ctx.umi, [ix], [ctx.payer]),
            new MissingSignerError(ctx.oneSig.getProgram()),
        );
        const { nonce: afterNonce } = await ctx.oneSig.getState(ctx.umi.rpc);
        expect(afterNonce).toEqual(nonce);
    });

    it('should fail with DuplicateSigners when a signer signs multiple times', async () => {
        const { nonce } = await ctx.oneSig.getState(ctx.umi.rpc);
        const signers = [ctx.sortedSigners[0], ctx.sortedSigners[0]];

        const { ix } = await createOneSigTransaction(
            ctx.umi,
            ctx.oneSig,
            signers,
            ctx.oneSigSeed,
            nonce,
            transferInstruction,
        );

        await shouldBeRejected(
            sendAndConfirm(ctx.umi, [ix], [ctx.payer]),
            new DuplicateSignersError(ctx.oneSig.getProgram()),
        );
        const { nonce: afterNonce } = await ctx.oneSig.getState(ctx.umi.rpc);
        expect(afterNonce).toEqual(nonce);
    });

    it('should fail with FailedSignatureRecovery when signatures are corrupted', async () => {
        const { nonce } = await ctx.oneSig.getState(ctx.umi.rpc);
        const { merkleRoot, expiry, signatures, proof } = await buildOneSigMerkleData(
            ctx.oneSig,
            ctx.oneSigSeed,
            ctx.sortedSigners,
            nonce,
            transferInstruction,
        );
        const signaturesArray = arrayify(signatures);

        // Create execution instruction
        const ix = ctx.oneSig.executeTransaction(ctx.umi.payer, merkleRoot, {
            call: transferInstruction,
            proof,
            merkleRootVerification: some({
                expiry,
                signatures: signaturesArray.fill(29, signaturesArray[signaturesArray.length - 1]),
            }),
        });

        await shouldBeRejected(
            sendAndConfirm(ctx.umi, [ix], [ctx.payer]),
            new FailedSignatureRecoveryError(ctx.oneSig.getProgram()),
        );
        const { nonce: afterNonce } = await ctx.oneSig.getState(ctx.umi.rpc);
        expect(afterNonce).toEqual(nonce);
    });

    it('should prevent transaction replay attacks', async () => {
        const { nonce } = await ctx.oneSig.getState(ctx.umi.rpc);
        const { instructions } = await performOneStepExecution(ctx, nonce, transferInstruction);

        await shouldBeRejected(
            sendAndConfirm(ctx.umi, instructions, [ctx.payer]),
            new InvalidProofError(ctx.oneSig.getProgram()),
        );
    });
}
