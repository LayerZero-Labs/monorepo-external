import { arrayify } from '@ethersproject/bytes';
import { randomBytes } from 'crypto';
import { expect, it } from 'vitest';

import { MerkleRootNotExpiredError, SeedMismatchError } from '../../src';
import {
    createTransferInstruction,
    executeWithVerifiedMerkleRoot,
    performOneStepExecution,
    performTwoStepExecution,
    prepareAndVerifyMerkleRoot,
    TransactionContext,
} from '../helpers';
import { sendAndConfirm, shouldBeRejected, sleep } from '../utils';

/**
 * Tests for two-step transaction execution
 */
export function twoStepExecutionTests(ctx: TransactionContext) {
    it('should support two-step execution with verify_merkle_root and execute_transaction', async () => {
        const transferAmount = 100n;
        const beforeBalance = await ctx.umi.rpc.getBalance(ctx.recipient.publicKey);

        // Step 1: Prepare and verify merkle root
        const beforeState = await ctx.oneSig.getState(ctx.umi.rpc);
        await performTwoStepExecution(
            ctx,
            createTransferInstruction(
                ctx.umi,
                ctx.oneSig.pda.oneSigSigner()[0],
                ctx.recipient.publicKey,
                transferAmount,
            ),
        );

        // Check the balance was updated correctly
        const afterBalance = await ctx.umi.rpc.getBalance(ctx.recipient.publicKey);
        expect(afterBalance.basisPoints - beforeBalance.basisPoints).toEqual(transferAmount);

        // Verify nonce was incremented
        const afterState = await ctx.oneSig.getState(ctx.umi.rpc);
        expect(afterState.nonce).toEqual(beforeState.nonce + 1n);
    });

    it('should close merkle root account after two-step execution', async () => {
        const transferAmount = 100n;

        // Step 1 & 2: Prepare, verify merkle root, and execute transaction with a short expiry
        const { merkleRoot } = await performTwoStepExecution(
            ctx,
            createTransferInstruction(
                ctx.umi,
                ctx.oneSig.pda.oneSigSigner()[0],
                ctx.recipient.publicKey,
                transferAmount,
            ),
            1, // 1 second expiry
        );

        // Get the payer's balance before closing the merkle root account
        const oneSigSigner = ctx.oneSig.pda.oneSigSigner()[0];
        const merkleRootState = ctx.oneSig.pda.merkleRootState(merkleRoot)[0];
        const balanceBefore = await ctx.umi.rpc.getBalance(oneSigSigner);

        // Step 3: Close the merkle root account
        const closeMerkleRootIx = ctx.oneSig.closeMerkleRootState(ctx.payer, merkleRoot);
        // Wait for the merkle tree to be expired
        await sleep(3000);
        await sendAndConfirm(ctx.umi, [closeMerkleRootIx], [ctx.payer]);

        // Verify the payer received the rent from the closed account
        const balanceAfter = await ctx.umi.rpc.getBalance(oneSigSigner);
        expect(balanceAfter.basisPoints >= balanceBefore.basisPoints).toEqual(true);

        // Double check that the account is closed
        const accountInfo = await ctx.umi.rpc.getAccount(merkleRootState);
        expect(accountInfo.exists).toEqual(false);
    });

    it('should fail to close merkle root account before expiry', async () => {
        const transferAmount = 100n;

        const { merkleRoot } = await performTwoStepExecution(
            ctx,
            createTransferInstruction(
                ctx.umi,
                ctx.oneSig.pda.oneSigSigner()[0],
                ctx.recipient.publicKey,
                transferAmount,
            ),
            10, // 10 seconds expiry
        );

        // Step 3: Attempt to close the merkle root account BEFORE it has expired
        // This should fail with a MerkleRootNotExpiredError
        await shouldBeRejected(
            sendAndConfirm(
                ctx.umi,
                [ctx.oneSig.closeMerkleRootState(ctx.payer, merkleRoot)],
                [ctx.payer],
            ),
            new MerkleRootNotExpiredError(ctx.oneSig.getProgram()),
        );

        // Verify the account still exists (it wasn't closed)
        const accountInfo = await ctx.umi.rpc.getAccount(
            ctx.oneSig.pda.merkleRootState(merkleRoot)[0],
        );
        expect(accountInfo.exists).toEqual(true);
    });

    it('should revoke merkle tree by changing seed', async () => {
        const { nonce } = await ctx.oneSig.getState(ctx.umi.rpc);
        // Create multiple transfer instructions (like in the Aptos test)
        const transferAmount = 100n;
        const transferInstruction = createTransferInstruction(
            ctx.umi,
            ctx.oneSig.pda.oneSigSigner()[0],
            ctx.recipient.publicKey,
            transferAmount,
        );

        const { merkleRoot, proof } = await prepareAndVerifyMerkleRoot(ctx, transferInstruction);

        // Create a new seed for changing
        const newSeed = arrayify(randomBytes(32));
        await performOneStepExecution(ctx, nonce, { ...ctx.oneSig.setSeed(newSeed), value: 0n });

        // This should fail with SeedMismatchError because the merkle root was verified
        // with the old seed but the seed has changed
        await shouldBeRejected(
            executeWithVerifiedMerkleRoot(ctx, merkleRoot, transferInstruction, proof),
            new SeedMismatchError(ctx.oneSig.getProgram()),
        );

        // Update the context with the new seed
        ctx.oneSigSeed = newSeed;
    });
}
