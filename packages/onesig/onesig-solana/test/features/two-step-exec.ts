import { arrayify } from '@ethersproject/bytes';
import { generateSigner, sol } from '@metaplex-foundation/umi';
import { randomBytes } from 'crypto';
import { Wallet } from 'ethers';
import { expect, it } from 'vitest';

import {
    InsufficientSignaturesError,
    MerkleRootNotCloseableError,
    OneSig,
    ONESIG_PROGRAM_ID,
    SeedMismatchError,
} from '../../src';
import {
    buildOneSigMerkleData,
    createTransferInstruction,
    executeWithVerifiedMerkleRoot,
    performOneStepExecution,
    performTwoStepExecution,
    prepareAndVerifyMerkleRoot,
    setupOneSig,
    TransactionContext,
} from '../helpers';
import { sendAndConfirm, shouldBeRejected, sleep } from '../utils';

/**
 * Spins up an isolated OneSig (its own state PDA, seed, and signer set) sharing the parent's umi
 * and payer. Lets the signer-rotation tests below mutate the multisig freely without disturbing
 * the shared `ctx` (and the tests that run after).
 */
async function setupIsolatedOneSig(
    ctx: TransactionContext,
    signerCount: number,
    threshold: number,
): Promise<TransactionContext> {
    const oneSigState = generateSigner(ctx.umi);
    const oneSig = new OneSig(ONESIG_PROGRAM_ID, oneSigState);
    const oneSigSeed = arrayify(randomBytes(32));
    const sortedSigners = Array(signerCount)
        .fill(0)
        .map(() => Wallet.createRandom())
        .sort((a, b) => a.address.localeCompare(b.address));
    await setupOneSig(
        ctx.umi,
        oneSig,
        oneSigSeed,
        ctx.payer,
        oneSigState,
        sortedSigners,
        threshold,
    );
    return { ...ctx, oneSig, oneSigState, oneSigSeed, sortedSigners };
}

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
        const closeMerkleRootIx = ctx.oneSig.closeMerkleRootState(merkleRoot, ctx.payer.publicKey);
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

        // Step 3: Attempt to close the merkle root account BEFORE it has expired (seed unchanged)
        // This should fail with a MerkleRootNotCloseableError
        await shouldBeRejected(
            sendAndConfirm(
                ctx.umi,
                [ctx.oneSig.closeMerkleRootState(merkleRoot, ctx.payer.publicKey)],
                [ctx.payer],
            ),
            new MerkleRootNotCloseableError(ctx.oneSig.getProgram()),
        );

        // Verify the account still exists (it wasn't closed)
        const accountInfo = await ctx.umi.rpc.getAccount(
            ctx.oneSig.pda.merkleRootState(merkleRoot)[0],
        );
        expect(accountInfo.exists).toEqual(true);
    });

    it('should allow anyone to close an expired merkle root, refunding the original rent_payer', async () => {
        // Verify a root with a short expiry; ctx.payer is recorded as rent_payer.
        const { merkleRoot } = await performTwoStepExecution(
            ctx,
            createTransferInstruction(
                ctx.umi,
                ctx.oneSig.pda.oneSigSigner()[0],
                ctx.recipient.publicKey,
                100n,
            ),
            1, // 1 second expiry
        );
        const merkleRootState = ctx.oneSig.pda.merkleRootState(merkleRoot)[0];

        // A third party (not the rent_payer) closes it after expiry.
        const closer = generateSigner(ctx.umi);
        await ctx.umi.rpc.airdrop(closer.publicKey, sol(1), { commitment: 'confirmed' });
        await sleep(3000);

        const payerBalanceBefore = await ctx.umi.rpc.getBalance(ctx.payer.publicKey);
        await sendAndConfirm(
            ctx.umi,
            // Submitted/paid by `closer` (≠ rent_payer); rent is refunded to ctx.payer.
            [ctx.oneSig.closeMerkleRootState(merkleRoot, ctx.payer.publicKey)],
            [closer],
        );

        // Rent went to the recorded rent_payer, not the closer, and the account is gone.
        const payerBalanceAfter = await ctx.umi.rpc.getBalance(ctx.payer.publicKey);
        expect(payerBalanceAfter.basisPoints > payerBalanceBefore.basisPoints).toBe(true);
        const accountInfo = await ctx.umi.rpc.getAccount(merkleRootState);
        expect(accountInfo.exists).toEqual(false);
    });

    it('should allow closing a seed-mismatched merkle root before expiry (post-rotation cleanup)', async () => {
        // Verify a root under the current seed with a long expiry.
        const { merkleRoot } = await prepareAndVerifyMerkleRoot(
            ctx,
            createTransferInstruction(
                ctx.umi,
                ctx.oneSig.pda.oneSigSigner()[0],
                ctx.recipient.publicKey,
                100n,
            ),
            1000,
        );
        const merkleRootState = ctx.oneSig.pda.merkleRootState(merkleRoot)[0];

        // Rotate the seed so the PDA's stored seed no longer matches the current state seed.
        const { nonce } = await ctx.oneSig.getState(ctx.umi.rpc);
        const newSeed = arrayify(randomBytes(32));
        await performOneStepExecution(ctx, nonce, { ...ctx.oneSig.setSeed(newSeed), value: 0n });
        ctx.oneSigSeed = newSeed;

        // The PDA is NOT expired, but its seed is now stale → closeable via the seed-mismatch
        // branch, by anyone, refunding the original rent_payer.
        const closer = generateSigner(ctx.umi);
        await ctx.umi.rpc.airdrop(closer.publicKey, sol(1), { commitment: 'confirmed' });
        const payerBalanceBefore = await ctx.umi.rpc.getBalance(ctx.payer.publicKey);
        await sendAndConfirm(
            ctx.umi,
            [ctx.oneSig.closeMerkleRootState(merkleRoot, ctx.payer.publicKey)],
            [closer],
        );

        const payerBalanceAfter = await ctx.umi.rpc.getBalance(ctx.payer.publicKey);
        expect(payerBalanceAfter.basisPoints > payerBalanceBefore.basisPoints).toBe(true);
        const accountInfo = await ctx.umi.rpc.getAccount(merkleRootState);
        expect(accountInfo.exists).toEqual(false);
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

    it('rejects a pre-verified root once too few of its signers remain authorized', async () => {
        // Isolated 3-signer / threshold-2 multisig so we can drop a signer freely.
        const local = await setupIsolatedOneSig(ctx, 3, 2);
        const call = createTransferInstruction(
            local.umi,
            local.oneSig.pda.oneSigSigner()[0],
            local.recipient.publicKey,
            111n,
        );

        // Pre-verify: proved_signers = the threshold signers that signed (the first two).
        const { merkleRoot, proof } = await prepareAndVerifyMerkleRoot(local, call);

        // Remove one of those two signing signers. The removal tx is itself authorized by the
        // still-present signers, so it succeeds; now only one proved signer remains active —
        // below the threshold of 2.
        const removed = arrayify(local.sortedSigners[0].address);
        const { nonce } = await local.oneSig.getState(local.umi.rpc);
        await performOneStepExecution(local, nonce, {
            ...local.oneSig.removeSigner(removed),
            value: 0n,
        });

        // Executing the pre-verified root now fails: fewer than `threshold` of the signers it
        // was signed by are still authorized (matches the inline path, which could no longer
        // gather threshold valid signatures).
        await shouldBeRejected(
            executeWithVerifiedMerkleRoot(local, merkleRoot, call, proof),
            new InsufficientSignaturesError(local.oneSig.getProgram()),
        );
    });

    it('still executes an over-quorum pre-verified root after an unneeded extra co-signer is removed', async () => {
        // Isolated 3-signer / threshold-2 multisig. Pre-verify the call with ALL THREE
        // signatures so proved_signers holds a co-signer beyond the quorum, then drop that
        // extra signer — two proved signers still remain, meeting the threshold.
        const local = await setupIsolatedOneSig(ctx, 3, 2);
        const call = createTransferInstruction(
            local.umi,
            local.oneSig.pda.oneSigSigner()[0],
            local.recipient.publicKey,
            444n,
        );

        // The removal below advances the nonce, so build/sign the target root for the
        // post-removal nonce (N+1). Pre-verification doesn't depend on the nonce; only the
        // leaf encoding at execute time does.
        const { nonce } = await local.oneSig.getState(local.umi.rpc);
        const { merkleRoot, expiry, signatures, proof } = await buildOneSigMerkleData(
            local.oneSig,
            local.oneSigSeed,
            local.sortedSigners,
            nonce + 1n,
            call,
        );

        // Pre-verify with all three signatures → proved_signers = all three signers.
        await sendAndConfirm(
            local.umi,
            [
                local.oneSig.verifyMerkleRoot(local.payer, {
                    merkleRoot: [merkleRoot],
                    expiry,
                    signatures: arrayify(signatures),
                }),
            ],
            [local.payer],
        );

        // Remove the third signer — an extra co-signer not needed for the quorum (nonce → N+1).
        const removed = arrayify(local.sortedSigners[2].address);
        await performOneStepExecution(local, nonce, {
            ...local.oneSig.removeSigner(removed),
            value: 0n,
        });

        // Still executable: 2 of the 3 proved signers remain authorized (≥ threshold), and the
        // leaf nonce (N+1) now matches.
        const beforeBalance = await local.umi.rpc.getBalance(local.recipient.publicKey);
        await executeWithVerifiedMerkleRoot(local, merkleRoot, call, proof);
        const afterBalance = await local.umi.rpc.getBalance(local.recipient.publicKey);
        expect(afterBalance.basisPoints - beforeBalance.basisPoints).toEqual(444n);
    });

    it('rejects a pre-verified root after the threshold is raised above its signer count', async () => {
        // Isolated 3-signer / threshold-2 multisig; two signers sign the root.
        const local = await setupIsolatedOneSig(ctx, 3, 2);
        const call = createTransferInstruction(
            local.umi,
            local.oneSig.pda.oneSigSigner()[0],
            local.recipient.publicKey,
            222n,
        );

        // Pre-verify: proved_signers count = 2.
        const { merkleRoot, proof } = await prepareAndVerifyMerkleRoot(local, call);

        // Raise the threshold to 3 (allowed: 3 signers). The stored proof now has too few signers.
        const { nonce } = await local.oneSig.getState(local.umi.rpc);
        await performOneStepExecution(local, nonce, { ...local.oneSig.setThreshold(3), value: 0n });

        await shouldBeRejected(
            executeWithVerifiedMerkleRoot(local, merkleRoot, call, proof),
            new InsufficientSignaturesError(local.oneSig.getProgram()),
        );
    });

    it('still executes a pre-verified root when the signer set is unchanged', async () => {
        // Regression: the proved-signers re-check must not break the happy path.
        const local = await setupIsolatedOneSig(ctx, 3, 2);
        const call = createTransferInstruction(
            local.umi,
            local.oneSig.pda.oneSigSigner()[0],
            local.recipient.publicKey,
            333n,
        );

        const before = await local.oneSig.getState(local.umi.rpc);
        const beforeBalance = await local.umi.rpc.getBalance(local.recipient.publicKey);

        const { merkleRoot, proof } = await prepareAndVerifyMerkleRoot(local, call);
        await executeWithVerifiedMerkleRoot(local, merkleRoot, call, proof);

        const afterBalance = await local.umi.rpc.getBalance(local.recipient.publicKey);
        expect(afterBalance.basisPoints - beforeBalance.basisPoints).toEqual(333n);
        const after = await local.oneSig.getState(local.umi.rpc);
        expect(after.nonce).toEqual(before.nonce + 1n);
    });
}
