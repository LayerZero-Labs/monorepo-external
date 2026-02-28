import { arrayify, hexlify } from '@ethersproject/bytes';
import { createLut, extendLut } from '@metaplex-foundation/mpl-toolbox';
import {
    AddressLookupTableInput,
    generateSigner,
    PublicKey,
    publicKey,
    Signer,
    sol,
    TRANSACTION_SIZE_LIMIT,
    Umi,
} from '@metaplex-foundation/umi';
import { randomBytes } from 'crypto';
import { Wallet } from 'ethers';
import { expect, it } from 'vitest';

import {
    DuplicateExecutorError,
    DuplicateSignersError,
    EmptyExecutorSetError,
    ExecutorNotFoundError,
    ExecutorRequiredError,
    InvalidSignersLenError,
    InvalidThresholdError,
    MissingSignerError,
    ThresholdExceedsSignersError,
} from '../../src';
import {
    createTransferInstruction,
    DEFAULT_CONFIG,
    executeWithVerifiedMerkleRoot,
    MAX_SIGNERS,
    MAX_THRESHOLD,
    performOneStepExecution,
    prepareAndVerifyMerkleRoot,
    TransactionContext,
    verifyBalanceChange,
} from '../helpers';
import { shouldBeRejected, sleep } from '../utils';

/**
 * Tests for SetConfig operations
 */
export function setConfigTests(ctx: TransactionContext) {
    // Generate a new executor
    const newExecutor = generateSigner(ctx.umi);

    it('should add a new signer to the multisig', async () => {
        // Create a new signer to add
        const newWallet = Wallet.createRandom();
        const newSignerAddress = arrayify(newWallet.address);

        // Create set_config add signer instruction
        const addSignerIx = ctx.oneSig.addSigner(newSignerAddress);

        // Get current nonce for the transaction
        const { nonce: currentNonce } = await ctx.oneSig.getState(ctx.umi.rpc);

        // Get current state to compare later
        const beforeState = await ctx.oneSig.getState(ctx.umi.rpc);
        const signersBefore = beforeState.multisig.signers.map((s) => hexlify(s[0]));

        // Execute the transaction to add the signer
        await performOneStepExecution(ctx, currentNonce, { ...addSignerIx, value: 0n });

        // Verify the signer was added
        const afterState = await ctx.oneSig.getState(ctx.umi.rpc);
        const signersAfter = afterState.multisig.signers.map((s) => hexlify(s[0]));

        // New array should have one more element
        expect(signersAfter.length).toEqual(signersBefore.length + 1);

        // The new signer should exist in the array
        const newSignerHex = hexlify(newSignerAddress);
        expect(signersAfter.includes(newSignerHex)).toEqual(true);
        ctx.sortedSigners = [...ctx.sortedSigners, newWallet];
    });

    it('should remove a signer from the multisig', async () => {
        // Add an extra signer first that we can then remove
        const extraWallet = Wallet.createRandom();
        const extraSignerAddress = arrayify(extraWallet.address);

        // Add the extra signer
        const addSignerIx = ctx.oneSig.addSigner(extraSignerAddress);
        let { nonce: currentNonce } = await ctx.oneSig.getState(ctx.umi.rpc);
        await performOneStepExecution(ctx, currentNonce, { ...addSignerIx, value: 0n });

        // Verify it was added
        const signers = (await ctx.oneSig.getState(ctx.umi.rpc)).multisig.signers.map((s) =>
            hexlify(s[0]),
        );
        const extraSigner = hexlify(extraSignerAddress);
        expect(signers.includes(extraSigner)).toEqual(true);

        // Now remove the signer
        const removeSignerIx = ctx.oneSig.removeSigner(extraSignerAddress);
        currentNonce = (await ctx.oneSig.getState(ctx.umi.rpc)).nonce;
        await performOneStepExecution(ctx, currentNonce, { ...removeSignerIx, value: 0n });

        // Verify it was removed
        const afterState = await ctx.oneSig.getState(ctx.umi.rpc);
        const signersAfter = afterState.multisig.signers.map((s) => hexlify(s[0]));
        expect(signersAfter.includes(extraSigner)).toEqual(false);
    });

    it('should update the threshold', async () => {
        // Create set_config set threshold instruction
        const newThreshold = 1; // Change from the default of 2
        const setThresholdIx = ctx.oneSig.setThreshold(newThreshold);
        const { nonce } = await ctx.oneSig.getState(ctx.umi.rpc);

        // Execute the transaction to update the threshold
        await performOneStepExecution(ctx, nonce, { ...setThresholdIx, value: 0n });

        // Verify the threshold was updated
        const afterState = await ctx.oneSig.getState(ctx.umi.rpc);
        const thresholdAfter = afterState.multisig.threshold;
        expect(thresholdAfter).toEqual(newThreshold);
    });

    it('should update the seed value', async () => {
        // Create a new random seed
        const newSeed = arrayify(randomBytes(32));
        const setSeedIx = ctx.oneSig.setSeed(newSeed);
        const { nonce } = await ctx.oneSig.getState(ctx.umi.rpc);

        // Get current state to compare later
        const beforeState = await ctx.oneSig.getState(ctx.umi.rpc);
        const seedBefore = beforeState.seed;

        // Execute the transaction to update the seed
        await performOneStepExecution(ctx, nonce, { ...setSeedIx, value: 0n });

        // Verify the seed was updated
        const afterState = await ctx.oneSig.getState(ctx.umi.rpc);
        const seedAfter = afterState.seed;

        // The seed should be different from the previous one
        expect(hexlify(seedAfter[0])).not.toEqual(hexlify(seedBefore[0]));

        // The seed should match what we set
        expect(hexlify(seedAfter[0])).toEqual(hexlify(newSeed));

        // Update the context with the new seed
        ctx.oneSigSeed = newSeed;

        // Verify we can still execute transactions with the new seed
        const instruction = createTransferInstruction(
            ctx.umi,
            ctx.oneSig.pda.oneSigSigner()[0],
            ctx.recipient.publicKey,
            50n,
        );

        await verifyBalanceChange(
            ctx.umi,
            ctx.recipient.publicKey,
            async () => {
                await performOneStepExecution(ctx, afterState.nonce, instruction);
            },
            instruction.value,
        );
    });

    it('should add an executor', async () => {
        // Get current executors for comparison
        const state = await ctx.oneSig.getState(ctx.umi.rpc);
        const executorsBefore = state.executors.executors;

        // Add the executor
        const ix = ctx.oneSig.addExecutor(newExecutor.publicKey);
        await performOneStepExecution(ctx, state.nonce, { ...ix, value: 0n });

        // Verify the executor was added
        const stateAfter = await ctx.oneSig.getState(ctx.umi.rpc);
        const executorsAfter = stateAfter.executors.executors;

        expect(executorsAfter.length).toEqual(executorsBefore.length + 1);

        // The new executor should exist in the array
        expect(executorsAfter.some((e) => e.toString() === newExecutor.publicKey.toString())).toBe(
            true,
        );
    });

    it('should only allow executors to execute when executorRequired is true', async () => {
        // Get current state
        const stateBefore = await ctx.oneSig.getState(ctx.umi.rpc);
        const initialRequiredState = stateBefore.executors.executorRequired;
        expect(initialRequiredState).toBe(false);

        const ix = ctx.oneSig.setExecutorRequired(true);
        await performOneStepExecution(ctx, stateBefore.nonce, { ...ix, value: 0n });

        // Verify the flag was updated
        const stateAfter = await ctx.oneSig.getState(ctx.umi.rpc);
        expect(stateAfter.executors.executorRequired).toBe(true);

        // T
        const instruction = createTransferInstruction(
            ctx.umi,
            ctx.oneSig.pda.oneSigSigner()[0],
            ctx.recipient.publicKey,
            50n,
        );
        await shouldBeRejected(
            performOneStepExecution(ctx, stateAfter.nonce, instruction),
            new ExecutorRequiredError(ctx.oneSig.getProgram()),
        );

        // Set it back to the initial state for other tests
        await ctx.umi.rpc.airdrop(newExecutor.publicKey, sol(10000), {
            commitment: 'confirmed',
        });
        ctx.umi.payer = newExecutor;
        await performOneStepExecution(ctx, stateAfter.nonce, {
            ...ctx.oneSig.setExecutorRequired(false),
            value: 0n,
        });
        // Reset the payer to the original payer
        ctx.umi.payer = ctx.payer;
    });

    it('should fail to remove the last executor when executor_required is true', async () => {
        let state = await ctx.oneSig.getState(ctx.umi.rpc);
        await performOneStepExecution(ctx, state.nonce, {
            ...ctx.oneSig.setExecutorRequired(true),
            value: 0n,
        });

        // Verify executor_required is true
        state = await ctx.oneSig.getState(ctx.umi.rpc);
        expect(state.executors.executorRequired).toBe(true);
        expect(state.executors.executors.length).toBe(1);

        // Try to remove the only executor - should fail
        ctx.umi.payer = newExecutor;
        await shouldBeRejected(
            performOneStepExecution(ctx, state.nonce, {
                ...ctx.oneSig.removeExecutor(newExecutor.publicKey),
                value: 0n,
            }),
            new EmptyExecutorSetError(ctx.oneSig.getProgram()),
        );

        // Set it back to the initial state for other tests
        state = await ctx.oneSig.getState(ctx.umi.rpc);
        await performOneStepExecution(ctx, state.nonce, {
            ...ctx.oneSig.setExecutorRequired(false),
            value: 0n,
        });
        // Reset the payer to the original payer
        ctx.umi.payer = ctx.payer;
    });

    it('should remove an executor', async () => {
        const ix = ctx.oneSig.removeExecutor(newExecutor.publicKey);
        const state = await ctx.oneSig.getState(ctx.umi.rpc);
        await performOneStepExecution(ctx, state.nonce, { ...ix, value: 0n });

        // Verify it was removed
        const stateAfter = await ctx.oneSig.getState(ctx.umi.rpc);
        expect(
            stateAfter.executors.executors.some((e) => e.toString() === newExecutor.toString()),
        ).toBe(false);
    });

    // ===================== FAILURE TEST CASES =====================

    it('should fail to add a duplicate signer', async () => {
        const { nonce, multisig } = await ctx.oneSig.getState(ctx.umi.rpc);
        const existingSignerAddress = multisig.signers[0][0];

        await shouldBeRejected(
            performOneStepExecution(ctx, nonce, {
                ...ctx.oneSig.addSigner(existingSignerAddress),
                value: 0n,
            }),
            new DuplicateSignersError(ctx.oneSig.getProgram()),
        );
    });

    it('should fail to remove a non-existent signer', async () => {
        // Create a random signer that doesn't exist in the multisig
        const nonExistentWallet = Wallet.createRandom();
        const nonExistentSignerAddress = arrayify(nonExistentWallet.address);

        const { nonce } = await ctx.oneSig.getState(ctx.umi.rpc);
        await shouldBeRejected(
            performOneStepExecution(ctx, nonce, {
                ...ctx.oneSig.removeSigner(nonExistentSignerAddress),
                value: 0n,
            }),
            new MissingSignerError(ctx.oneSig.getProgram()),
        );
    });

    it('should fail to add a duplicate executor', async () => {
        const state = await ctx.oneSig.getState(ctx.umi.rpc);
        const ix = ctx.oneSig.addExecutor(newExecutor.publicKey);
        await performOneStepExecution(ctx, state.nonce, { ...ix, value: 0n });

        await shouldBeRejected(
            performOneStepExecution(ctx, state.nonce + 1n, { ...ix, value: 0n }),
            new DuplicateExecutorError(ctx.oneSig.getProgram()),
        );
    });

    it('should fail to remove a non-existent executor', async () => {
        const newExecutor = generateSigner(ctx.umi);
        const state = await ctx.oneSig.getState(ctx.umi.rpc);
        const ix = ctx.oneSig.removeExecutor(newExecutor.publicKey);
        await shouldBeRejected(
            performOneStepExecution(ctx, state.nonce, { ...ix, value: 0n }),
            new ExecutorNotFoundError(ctx.oneSig.getProgram()),
        );
    });

    it('should fail to set threshold to zero', async () => {
        // Create set_config set threshold instruction with threshold = 0
        const invalidThreshold = 0;
        const { nonce } = await ctx.oneSig.getState(ctx.umi.rpc);

        await shouldBeRejected(
            performOneStepExecution(ctx, nonce, {
                ...ctx.oneSig.setThreshold(invalidThreshold),
                value: 0n,
            }),
            new InvalidThresholdError(ctx.oneSig.getProgram()),
        );
    });

    it('should fail to set threshold higher than MAX_THRESHOLD', async () => {
        // MAX_THRESHOLD is 13 according to the constants
        const invalidThreshold = MAX_THRESHOLD + 1;
        const { nonce } = await ctx.oneSig.getState(ctx.umi.rpc);

        await shouldBeRejected(
            performOneStepExecution(ctx, nonce, {
                ...ctx.oneSig.setThreshold(invalidThreshold),
                value: 0n,
            }),
            new InvalidThresholdError(ctx.oneSig.getProgram()),
        );
    });

    it('should fail to set threshold higher than number of signers', async () => {
        const { nonce, multisig } = await ctx.oneSig.getState(ctx.umi.rpc);
        const numSigners = multisig.signers.length;
        // Try to set threshold to number of signers + 1
        const invalidThreshold = numSigners + 1;

        await shouldBeRejected(
            performOneStepExecution(ctx, nonce, {
                ...ctx.oneSig.setThreshold(invalidThreshold),
                value: 0n,
            }),
            new ThresholdExceedsSignersError(ctx.oneSig.getProgram()),
        );
    });

    it('should fail to remove a signer if it would cause threshold to exceed signers count', async () => {
        const { multisig, nonce } = await ctx.oneSig.getState(ctx.umi.rpc);
        const numSigners = multisig.signers.length;
        await performOneStepExecution(ctx, nonce, {
            ...ctx.oneSig.setThreshold(numSigners),
            value: 0n,
        });

        // Select a signer to remove
        const signerToRemove = multisig.signers[0][0];

        // Attempt to remove the signer
        await shouldBeRejected(
            performOneStepExecution(ctx, nonce + 1n, {
                ...ctx.oneSig.removeSigner(signerToRemove),
                value: 0n,
            }),
            new ThresholdExceedsSignersError(ctx.oneSig.getProgram()),
        );
    });

    it(
        'should fail to add signer when max signers reached',
        async () => {
            const { nonce, multisig } = await ctx.oneSig.getState(ctx.umi.rpc);
            const currentSignerCount = multisig.signers.length;

            // Add signers until we reach the maximum
            for (let i = 0; i < MAX_SIGNERS - currentSignerCount; i++) {
                const newWallet = Wallet.createRandom();
                const newSignerAddress = arrayify(newWallet.address);
                await performOneStepExecution(ctx, nonce + BigInt(i), {
                    ...ctx.oneSig.addSigner(newSignerAddress),
                    value: 0n,
                });
                // Update context with new signer
                ctx.sortedSigners = [...ctx.sortedSigners, newWallet];
            }

            // Now try to add one more signer
            const oneMoreWallet = Wallet.createRandom();
            const oneMoreSignerAddress = arrayify(oneMoreWallet.address);
            await shouldBeRejected(
                performOneStepExecution(ctx, nonce + BigInt(MAX_SIGNERS - currentSignerCount), {
                    ...ctx.oneSig.addSigner(oneMoreSignerAddress),
                    value: 0n,
                }),
                new InvalidSignersLenError(ctx.oneSig.getProgram()),
            );
        },
        120 * 1000,
    );

    it('should verify MAX_THRESHOLD is constrained by transaction size limit', async () => {
        // Create a new signer to add
        const { nonce, multisig } = await ctx.oneSig.getState(ctx.umi.rpc);
        // In previous tests, we have added MAX_SIGNERS signers, so we expect the number of signers to be MAX_SIGNERS
        expect(multisig.signers.length).toEqual(MAX_SIGNERS);

        // Set the threshold to MAX_THRESHOLD
        await performOneStepExecution(ctx, nonce, {
            ...ctx.oneSig.setThreshold(MAX_THRESHOLD),
            value: 0n,
        });

        const lut = await createLookupTable(ctx.umi, ctx.payer, [
            ctx.recipient.publicKey,
            ctx.payer.publicKey,
            ctx.oneSig.state.publicKey,
            ctx.oneSig.pda.oneSigSigner()[0],
            publicKey('11111111111111111111111111111111'),
        ]);
        const call = {
            ...ctx.oneSig.setThreshold(DEFAULT_CONFIG.threshold),
            value: 0n,
        };
        const {
            merkleRoot,
            proof,
            txReceipt: { txSize },
        } = await prepareAndVerifyMerkleRoot(ctx, call, 100, lut);

        // This test validates that MAX_THRESHOLD (13) is properly limited by Solana's transaction size constraints.
        // Each signature in OneSig is 65 bytes.
        // When set to MAX_THRESHOLD+1, the signatures would push the transaction
        // beyond Solana's maximum transaction size (1232 bytes), causing the transaction to fail.
        // This demonstrates why MAX_THRESHOLD is set to 13, and confirms the correct threshold limit for reliable operation.
        expect(txSize + 65 > TRANSACTION_SIZE_LIMIT).toEqual(true);
        await executeWithVerifiedMerkleRoot(ctx, merkleRoot, call, proof);
    });
}

/**
 * Helper function to create a lookup table for address references
 */
async function createLookupTable(
    umi: Umi,
    payer: Signer,
    ixKeys: PublicKey[],
): Promise<AddressLookupTableInput> {
    const recentSlot = await umi.rpc.getSlot({ commitment: 'finalized' });
    const keys = Array.from(new Set(ixKeys));

    const trunkInstructionKeysArray: PublicKey[][] = [];
    const trunkSize = 30;
    for (let i = 0; i < keys.length; i += trunkSize) {
        trunkInstructionKeysArray.push(keys.slice(i, i + trunkSize));
    }

    const [builder, input] = createLut(umi, {
        recentSlot,
        authority: payer,
        payer: payer,
        addresses: trunkInstructionKeysArray[0],
    });
    await builder.sendAndConfirm(umi);
    await sleep(500);
    for (let i = 1; i < trunkInstructionKeysArray.length; i++) {
        await extendLut(umi, {
            authority: payer,
            address: input.publicKey, // The address of the LUT.
            addresses: trunkInstructionKeysArray[i], // The addresses to add to the LUT.
        }).sendAndConfirm(umi);
        input.addresses.push(...trunkInstructionKeysArray[i]);
        await sleep(500);
    }
    return input;
}
