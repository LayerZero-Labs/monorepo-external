import { arrayify } from '@ethersproject/bytes';
import { transferSol } from '@metaplex-foundation/mpl-toolbox';
import {
    AddressLookupTableInput,
    createNoopSigner,
    KeypairSigner,
    lamports,
    PublicKey,
    publicKey,
    publicKeyBytes,
    some,
    Umi,
    WrappedInstruction,
} from '@metaplex-foundation/umi';
import { ethers, Wallet } from 'ethers';
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

// ============================================================================
// signer-as-executor helpers
// ============================================================================

/**
 * Builds the 32-byte inner hash of a signer_proof: `keccak256(leaf || delegatePk || expiry_be)`.
 * The on-chain program wraps this with `\x19Ethereum Signed Message:\n32` and keccaks again
 * to produce the digest that ecrecover recovers from.
 */
export function buildSignerProofInner(
    leaf: Uint8Array,
    delegate: PublicKey,
    signerProofExpiry: bigint,
): Uint8Array {
    if (leaf.byteLength !== 32) {
        throw new Error(`leaf must be 32 bytes, got ${leaf.byteLength}`);
    }
    const delegateBytes = publicKeyBytes(delegate);
    if (delegateBytes.byteLength !== 32) {
        throw new Error(`delegate must be 32 bytes, got ${delegateBytes.byteLength}`);
    }
    // u64 big-endian
    const expiryBe = new Uint8Array(8);
    let v = signerProofExpiry;
    for (let i = 7; i >= 0; i--) {
        expiryBe[i] = Number(v & 0xffn);
        v >>= 8n;
    }
    const payload = new Uint8Array(32 + 32 + 8);
    payload.set(leaf, 0);
    payload.set(delegateBytes, 32);
    payload.set(expiryBe, 64);
    return arrayify(ethers.utils.keccak256(payload));
}

/**
 * Signs the inner hash with ethers' personal_sign, which prepends
 * `\x19Ethereum Signed Message:\n32` and keccaks before ecdsa-signing — matching
 * the on-chain digest reconstruction in `SignatureValidator::verify_signer_proof`.
 * Returns the raw 65 bytes (r || s || v) with v ∈ {27, 28}. On-chain
 * `recover_signer` normalizes v.
 */
export async function signSignerProof(wallet: Wallet, inner: Uint8Array): Promise<Uint8Array> {
    return arrayify(await wallet.signMessage(inner));
}

/**
 * Builds merkle data and computes the leaf hash deterministically for a single-call
 * batch. The leaf is identical to what `MerkleValidator::encode_leaf` produces
 * on-chain, which is what `signer_proof` must bind to.
 */
export async function buildOneSigMerkleDataWithLeaf(
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
    leaf: Uint8Array;
}> {
    const solanaGen = solanaLeafGenerator(oneSig.programId, [
        {
            nonce,
            oneSigId: DEFAULT_CONFIG.oneSigId,
            targetOneSigAddress: oneSig.state.publicKey,
            calls: [prepareSolanaCallDataForMerkleLeaf(oneSig, call)],
        },
    ]);
    const merkleTree = makeOneSigTree([solanaGen]);
    const merkleRoot = arrayify(merkleTree.getRoot());
    const expiry = Math.floor(Date.now() / 1000) + expiryOffset;
    const signatures = await signOneSigTree(merkleTree, signers, {
        seed,
        expiry,
    });
    const leafHex = encodeLeaf(solanaGen, 0);
    const leaf = arrayify(leafHex);
    const proof = merkleTree.getHexProof(leafHex);
    return { merkleRoot, expiry, signatures, proof, leaf };
}

/**
 * Performs a signer-as-executor execution end-to-end: builds the merkle batch,
 * collects threshold signatures on the root, constructs the signer_proof bound to
 * `delegate.publicKey`, and submits `signer_execute_transaction`.
 *
 * `proofSigner` is the secp256k1 wallet that authorizes the delegate. It does NOT
 * need to be a member of the signer set — callers pass a random wallet to exercise
 * the unauthorized path.
 *
 * `overrideDelegateForSigning` decouples the pubkey bound into the digest from the
 * actual delegate — used to exercise the delegate-binding violation path which must
 * fail with `SignerProofUnauthorized` (recovered address is garbage).
 */
export async function performSignerExecution(
    ctx: TransactionContext,
    delegate: KeypairSigner,
    proofSigner: Wallet,
    nonce: bigint,
    call: SolanaCallData,
    options: {
        expiryOffsetSec?: number;
        signerProofExpiryOffsetSec?: number;
        overrideSignerProof?: Uint8Array;
        overrideSignerProofExpiry?: bigint;
        overrideDelegateForSigning?: PublicKey;
    } = {},
): Promise<{ merkleRoot: Uint8Array; expiry: number; leaf: Uint8Array }> {
    const {
        expiryOffsetSec = DEFAULT_CONFIG.expiryOffset,
        signerProofExpiryOffsetSec = 600,
        overrideSignerProof,
        overrideSignerProofExpiry,
        overrideDelegateForSigning,
    } = options;

    const { merkleRoot, expiry, signatures, proof, leaf } = await buildOneSigMerkleDataWithLeaf(
        ctx.umi,
        ctx.oneSig,
        ctx.oneSigSeed,
        ctx.sortedSigners,
        nonce,
        call,
        expiryOffsetSec,
    );

    const {
        multisig: { threshold },
    } = await ctx.oneSig.getState(ctx.umi.rpc);

    const signerProofExpiry =
        overrideSignerProofExpiry ??
        BigInt(Math.floor(Date.now() / 1000) + signerProofExpiryOffsetSec);

    let signerProof: Uint8Array;
    if (overrideSignerProof) {
        signerProof = overrideSignerProof;
    } else {
        const inner = buildSignerProofInner(
            leaf,
            overrideDelegateForSigning ?? delegate.publicKey,
            signerProofExpiry,
        );
        signerProof = await signSignerProof(proofSigner, inner);
    }

    const instructions: WrappedInstruction[] = [];
    if (call.value > 0) {
        const transferInstruction = transferSol(ctx.umi, {
            source: createNoopSigner(delegate.publicKey),
            destination: ctx.oneSig.pda.oneSigSigner()[0],
            amount: lamports(call.value),
        }).items[0];
        instructions.push(transferInstruction);
    }

    const executeIx = ctx.oneSig.signerExecuteTransaction(delegate, merkleRoot, {
        call,
        proof,
        merkleRootVerification: some({
            expiry,
            signatures:
                ctx.sortedSigners.length > threshold
                    ? arrayify(signatures).slice(0, threshold * 65)
                    : arrayify(signatures),
        }),
        signerProof: [signerProof],
        signerProofExpiry,
    });
    instructions.push(executeIx);

    await sendAndConfirm(ctx.umi, instructions, [delegate]);

    return { merkleRoot, expiry, leaf };
}

/**
 * Two-step variant: pre-verify the merkle root, then submit signer_execute_transaction
 * referencing the `MerkleRootState` PDA with `merkleRootVerification = null`.
 */
export async function performSignerExecutionTwoStep(
    ctx: TransactionContext,
    delegate: KeypairSigner,
    proofSigner: Wallet,
    call: SolanaCallData,
    options: {
        signerProofExpiryOffsetSec?: number;
    } = {},
): Promise<{ merkleRoot: Uint8Array; leaf: Uint8Array }> {
    const { signerProofExpiryOffsetSec = 600 } = options;

    const { nonce } = await ctx.oneSig.getState(ctx.umi.rpc);

    // Step 1: pre-verify the merkle root (uses the existing helper which signs
    // and submits verify_merkle_root with threshold secp256k1 signatures).
    const { merkleRoot, proof } = await prepareAndVerifyMerkleRoot(ctx, call);

    // Recompute the leaf so the signer_proof binds to the same bytes the program
    // will recompute during execution.
    const solanaGen = solanaLeafGenerator(ctx.oneSig.programId, [
        {
            nonce,
            oneSigId: DEFAULT_CONFIG.oneSigId,
            targetOneSigAddress: ctx.oneSig.state.publicKey,
            calls: [prepareSolanaCallDataForMerkleLeaf(ctx.oneSig, call)],
        },
    ]);
    const leaf = arrayify(encodeLeaf(solanaGen, 0));

    const signerProofExpiry = BigInt(Math.floor(Date.now() / 1000) + signerProofExpiryOffsetSec);
    const inner = buildSignerProofInner(leaf, delegate.publicKey, signerProofExpiry);
    const signerProof = await signSignerProof(proofSigner, inner);

    const instructions: WrappedInstruction[] = [];
    if (call.value > 0) {
        const transferInstruction = transferSol(ctx.umi, {
            source: createNoopSigner(delegate.publicKey),
            destination: ctx.oneSig.pda.oneSigSigner()[0],
            amount: lamports(call.value),
        }).items[0];
        instructions.push(transferInstruction);
    }
    const executeIx = ctx.oneSig.signerExecuteTransaction(delegate, merkleRoot, {
        call,
        proof,
        merkleRootVerification: null,
        signerProof: [signerProof],
        signerProofExpiry,
    });
    instructions.push(executeIx);

    await sendAndConfirm(ctx.umi, instructions, [delegate]);
    return { merkleRoot, leaf };
}
