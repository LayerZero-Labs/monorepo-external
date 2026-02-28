import { arrayify } from '@ethersproject/bytes';
import { transferSol } from '@metaplex-foundation/mpl-toolbox';
import {
    AddressLookupTableInput,
    createNoopSigner,
    KeypairSigner,
    lamports,
    PublicKey,
    publicKey,
    some,
    Umi,
    WrappedInstruction,
} from '@metaplex-foundation/umi';
import { Wallet } from 'ethers';
import { expect } from 'vitest';

import {
    encodeLeaf,
    makeOneSigTree,
    signOneSigTree,
    type TypedDataSigner,
} from '@layerzerolabs/onesig-core';

import {
    OneSig,
    prepareSolanaCallDataForMerkleLeaf,
    SolanaCallData,
    solanaLeafGenerator,
} from '../src';
import { sendAndConfirm, TransactionSendResult } from './utils';

// Constants
export const SYSTEM_PROGRAM_ID = publicKey('11111111111111111111111111111111');
export const LOCAL_RPC_URL = 'http://localhost:8799';
export const MAX_SIGNERS = 20;
export const MAX_THRESHOLD = 13;

export const DEFAULT_CONFIG = {
    oneSigId: 900n,
    threshold: 2,
    expiryOffset: 1000,
};

export interface TransactionContext {
    umi: Umi;
    oneSig: OneSig;
    payer: KeypairSigner;
    recipient: KeypairSigner;
    oneSigState: KeypairSigner;
    oneSigSeed: Uint8Array;
    sortedSigners: Wallet[];
}

/**
 * Creates a transfer SOL instruction with proper system program configuration
 */
export function createTransferInstruction(
    umi: Umi,
    source: PublicKey,
    destination: PublicKey,
    amount: bigint,
): SolanaCallData {
    const instruction = transferSol(umi, {
        source: createNoopSigner(source),
        destination,
        amount: lamports(amount),
    }).getInstructions()[0];

    instruction.keys = [
        {
            pubkey: SYSTEM_PROGRAM_ID,
            isSigner: false,
            isWritable: false,
        },
        ...instruction.keys,
    ];

    return { ...instruction, value: lamports(amount).basisPoints };
}

/**
 * Verifies a balance change for a given account after performing an action
 */
export async function verifyBalanceChange<T>(
    umi: Umi,
    account: PublicKey,
    action: () => Promise<T>,
    expectedChange: bigint,
): Promise<T> {
    const beforeBalance = await umi.rpc.getBalance(account);
    const ret = await action();
    const afterBalance = await umi.rpc.getBalance(account);
    expect(afterBalance.basisPoints - beforeBalance.basisPoints).toEqual(expectedChange);
    return ret;
}

/**
 * Creates and initializes a fresh OneSig instance
 */
export async function setupOneSig(
    umi: Umi,
    oneSig: OneSig,
    seed: Uint8Array,
    payer: KeypairSigner,
    oneSigState: KeypairSigner,
    sortedSigners: Wallet[],
    threshold = DEFAULT_CONFIG.threshold,
): Promise<void> {
    const ix = oneSig.initialize(payer, {
        seed: [seed],
        threshold,
        signers: sortedSigners.map((wallet) => {
            return [arrayify(wallet.address)];
        }),
        oneSigId: DEFAULT_CONFIG.oneSigId,
        executors: [],
        executorRequired: false,
    });
    await sendAndConfirm(umi, [ix], [payer, oneSigState]);
}

/**
 * Core functionality for building OneSig merkle data - shared logic extracted
 * from multiple functions
 */
export async function buildOneSigMerkleData(
    umi: Umi,
    oneSig: OneSig,
    seed: Uint8Array,
    signers: TypedDataSigner[],
    nonce: bigint,
    call: SolanaCallData,
    expiryOffset = DEFAULT_CONFIG.expiryOffset,
): Promise<{
    merkleRoot: Uint8Array;
    expiry: number;
    signatures: string;
    proof: string[];
}> {
    const solanaGen = solanaLeafGenerator(oneSig.programId, [
        {
            nonce,
            oneSigId: DEFAULT_CONFIG.oneSigId,
            targetOneSigAddress: oneSig.state.publicKey,
            calls: [prepareSolanaCallDataForMerkleLeaf(oneSig, call)],
        },
    ]);

    // Create merkle tree and sign
    const merkleTree = makeOneSigTree([solanaGen]);
    const merkleRoot = arrayify(merkleTree.getRoot());
    const expiry = Math.floor(Date.now() / 1000) + expiryOffset;

    const signatures = await signOneSigTree(merkleTree, signers, {
        seed,
        expiry,
    });

    // Prepare transaction data
    const proof = merkleTree.getHexProof(encodeLeaf(solanaGen, 0));

    return {
        merkleRoot,
        expiry,
        signatures,
        proof,
    };
}

/**
 * Creates and prepares a OneSig transaction for execution
 */
export async function createOneSigTransaction(
    umi: Umi,
    oneSig: OneSig,
    signers: TypedDataSigner[],
    seed: Uint8Array,
    nonce: bigint,
    call: SolanaCallData,
    expiryOffset = DEFAULT_CONFIG.expiryOffset,
) {
    // Use shared function to build merkle data
    const { merkleRoot, expiry, signatures, proof } = await buildOneSigMerkleData(
        umi,
        oneSig,
        seed,
        signers,
        nonce,
        call,
        expiryOffset,
    );

    const oneSigState = await oneSig.getState(umi.rpc);
    const threshold = oneSigState.multisig.threshold;

    // Create execution instruction
    const ix = oneSig.executeTransaction(umi.payer, merkleRoot, {
        call,
        proof,
        merkleRootVerification: some({
            expiry,
            signatures:
                signers.length > threshold
                    ? arrayify(signatures).slice(0, threshold * 65)
                    : arrayify(signatures),
        }),
    });

    return { ix, expiry, merkleRoot };
}

/**
 * Performs a one-step execution flow, creating and executing
 * the transaction in a single operation
 */
export async function performOneStepExecution(
    ctx: TransactionContext,
    nonce: bigint,
    call: SolanaCallData,
    expiryOffset = DEFAULT_CONFIG.expiryOffset,
    computeUnitsLimit = 0,
) {
    const instructions: WrappedInstruction[] = [];
    if (call.value > 0) {
        const transferInstruction = transferSol(ctx.umi, {
            source: createNoopSigner(ctx.umi.payer.publicKey),
            destination: ctx.oneSig.pda.oneSigSigner()[0],
            amount: lamports(call.value),
        }).items[0];
        instructions.push(transferInstruction);
    }
    const {
        ix: executeInstruction,
        expiry,
        merkleRoot,
    } = await createOneSigTransaction(
        ctx.umi,
        ctx.oneSig,
        ctx.sortedSigners,
        ctx.oneSigSeed,
        nonce,
        call,
        expiryOffset,
    );
    instructions.push(executeInstruction);

    const receipt = await sendAndConfirm(ctx.umi, instructions, [ctx.umi.payer], computeUnitsLimit);
    return { receipt, merkleRoot, expiry, instructions };
}

/**
 * Performs the complete two-step execution flow:
 * 1. Verifies the merkle root
 * 2. Executes the transaction with the verified merkle root
 */
export async function performTwoStepExecution(
    ctx: TransactionContext,
    call: SolanaCallData,
    expiryOffset = DEFAULT_CONFIG.expiryOffset,
    lut?: AddressLookupTableInput,
) {
    // Step 1: Prepare and verify merkle root
    const { merkleRoot, proof } = await prepareAndVerifyMerkleRoot(ctx, call, expiryOffset, lut);

    // Step 2: Execute with verified merkle root
    await executeWithVerifiedMerkleRoot(ctx, merkleRoot, call, proof);
    return { merkleRoot, call, proof };
}

/**
 * Prepares and executes the first step of a two-step execution process
 * Creates and verifies a merkle root for a transaction
 */
export async function prepareAndVerifyMerkleRoot(
    ctx: TransactionContext,
    call: SolanaCallData,
    expiryOffset = DEFAULT_CONFIG.expiryOffset,
    lut?: AddressLookupTableInput,
): Promise<{
    merkleRoot: Uint8Array;
    proof: string[];
    txReceipt: TransactionSendResult;
}> {
    // Get current nonce
    const {
        nonce,
        multisig: { threshold },
    } = await ctx.oneSig.getState(ctx.umi.rpc);

    // Use shared function to build merkle data
    const { merkleRoot, expiry, signatures, proof } = await buildOneSigMerkleData(
        ctx.umi,
        ctx.oneSig,
        ctx.oneSigSeed,
        ctx.sortedSigners,
        nonce,
        call,
        expiryOffset,
    );

    // Create and execute verify_merkle_root instruction
    const verifyMerkleRootIx = ctx.oneSig.verifyMerkleRoot(ctx.payer, {
        merkleRoot: [merkleRoot],
        expiry,
        signatures:
            ctx.sortedSigners.length > threshold
                ? arrayify(signatures).slice(0, threshold * 65)
                : arrayify(signatures),
    });

    const result = await sendAndConfirm(ctx.umi, [verifyMerkleRootIx], [ctx.payer], 2000000, lut);

    return {
        merkleRoot,
        proof,
        txReceipt: result,
    };
}

/**
 * Executes the second step of a two-step execution process
 * Uses a pre-verified merkle root to execute a transaction
 */
export async function executeWithVerifiedMerkleRoot(
    ctx: TransactionContext,
    merkleRoot: Uint8Array,
    call: SolanaCallData,
    proof: string[],
): Promise<TransactionSendResult> {
    const instructions: WrappedInstruction[] = [];
    if (call.value > 0) {
        const transferInstruction = transferSol(ctx.umi, {
            source: createNoopSigner(ctx.payer.publicKey),
            destination: ctx.oneSig.pda.oneSigSigner()[0],
            amount: lamports(call.value),
        }).items[0];
        instructions.push(transferInstruction);
    }

    const executeInstruction = ctx.oneSig.executeTransaction(ctx.umi.payer, merkleRoot, {
        call,
        proof,
        merkleRootVerification: null,
    });
    instructions.push(executeInstruction);

    // Execute the transaction
    return sendAndConfirm(ctx.umi, instructions, [ctx.payer]);
}
