import { arrayify } from '@ethersproject/bytes';
import { generateSigner, signerIdentity, sol, some } from '@metaplex-foundation/umi';
import { createUmi } from '@metaplex-foundation/umi-bundle-defaults';
import { randomBytes } from 'crypto';
import { Wallet } from 'ethers';
import { beforeAll, describe, expect, it } from 'vitest';

import {
    ExpiredSignerProofError,
    FailedSignatureRecoveryError,
    InvalidProofError,
    OneSig,
    ONESIG_PROGRAM_ID,
    ReentrancyError,
    SignerProofUnauthorizedError,
    SolanaCallData,
} from '../../src';
import {
    buildOneSigMerkleDataWithLeaf,
    createTransferInstruction,
    DEFAULT_CONFIG,
    LOCAL_RPC_URL,
    performSignerExecution,
    performSignerExecutionTwoStep,
    signSignerProof,
    TransactionContext,
    verifyBalanceChange,
} from '../helpers';
import { sendAndConfirm, shouldBeRejected } from '../utils';

/**
 * Integration tests for `signer_execute_transaction` (signer-as-executor).
 *
 * Uses an ISOLATED OneSig instance so the test suite is independent of other
 * suites that mutate the shared context (setConfig, executor_required flipping).
 */
export function signerAsExecutorTests() {
    // Isolated context — new OneSig initialized with executor_required=true.
    const umi = createUmi(LOCAL_RPC_URL, 'confirmed');
    const payer = generateSigner(umi);
    const recipient = generateSigner(umi);
    const oneSigState = generateSigner(umi);
    const oneSig = new OneSig(ONESIG_PROGRAM_ID, oneSigState);
    const oneSigSeed = arrayify(randomBytes(32));

    // sortedSigners: exactly `threshold` so every one must co-sign the merkle root.
    const sortedSigners = Array(DEFAULT_CONFIG.threshold)
        .fill(0)
        .map(() => Wallet.createRandom())
        .sort((a, b) => a.address.localeCompare(b.address));

    // `delegate` is the Ed25519 account that lands the tx; it's not a registered executor,
    // so under executor_required=true the only way it can submit is via signer_proof.
    const delegate = generateSigner(umi);
    // Placeholder executor needed to flip executor_required=true (cannot be empty).
    const placeholderExecutor = generateSigner(umi);

    const ctx: TransactionContext = {
        umi,
        oneSig,
        payer,
        recipient,
        oneSigState,
        oneSigSeed,
        sortedSigners,
    };

    beforeAll(async () => {
        umi.use(signerIdentity(payer));
        await Promise.all([
            umi.rpc.airdrop(payer.publicKey, sol(100), { commitment: 'confirmed' }),
            umi.rpc.airdrop(delegate.publicKey, sol(100), { commitment: 'confirmed' }),
            umi.rpc.airdrop(recipient.publicKey, sol(1), { commitment: 'confirmed' }),
        ]);

        // Initialize with executor_required=true + a placeholder executor so the
        // executor-gate actually fires (otherwise signer_proof is ignored).
        const initIx = oneSig.initialize(payer, {
            seed: [oneSigSeed],
            threshold: DEFAULT_CONFIG.threshold,
            signers: sortedSigners.map((w) => [arrayify(w.address)]),
            oneSigId: DEFAULT_CONFIG.oneSigId,
            executors: [placeholderExecutor.publicKey],
            executorRequired: true,
        });
        await sendAndConfirm(umi, [initIx], [payer, oneSigState]);
    });

    const transfer = (amount: bigint): SolanaCallData =>
        createTransferInstruction(umi, oneSig.pda.oneSigSigner()[0], recipient.publicKey, amount);

    // --------------------------------------------------------------------------
    // Happy path: one-step
    // --------------------------------------------------------------------------
    it('executes a transaction via signer_proof (one-step, executor_required=true)', async () => {
        const { nonce: nonceBefore } = await oneSig.getState(umi.rpc);
        const call = transfer(100n);
        const proofSigner = sortedSigners[0]; // A real signer authorizes the delegate.

        await verifyBalanceChange(
            umi,
            recipient.publicKey,
            async () => {
                await performSignerExecution(ctx, delegate, proofSigner, nonceBefore, call);
            },
            call.value,
        );

        const { nonce: nonceAfter } = await oneSig.getState(umi.rpc);
        expect(nonceAfter).toEqual(nonceBefore + 1n);
    });

    // --------------------------------------------------------------------------
    // Happy path: two-step (pre-verified merkle root)
    // --------------------------------------------------------------------------
    it('executes via signer_proof using a pre-verified merkle root (two-step)', async () => {
        const call = transfer(150n);
        const proofSigner = sortedSigners[1];
        const { nonce: nonceBefore } = await oneSig.getState(umi.rpc);

        await verifyBalanceChange(
            umi,
            recipient.publicKey,
            async () => {
                await performSignerExecutionTwoStep(ctx, delegate, proofSigner, call);
            },
            call.value,
        );

        const { nonce: nonceAfter } = await oneSig.getState(umi.rpc);
        expect(nonceAfter).toEqual(nonceBefore + 1n);
    });

    // --------------------------------------------------------------------------
    // Negative: expired signer_proof
    // --------------------------------------------------------------------------
    it('rejects an expired signer_proof with ExpiredSignerProof', async () => {
        const { nonce } = await oneSig.getState(umi.rpc);
        const call = transfer(10n);
        const proofSigner = sortedSigners[0];

        await shouldBeRejected(
            performSignerExecution(ctx, delegate, proofSigner, nonce, call, {
                // Sign with an expiry already in the past.
                signerProofExpiryOffsetSec: -60,
            }),
            new ExpiredSignerProofError(oneSig.getProgram()),
        );
    });

    // --------------------------------------------------------------------------
    // Negative: proof signed by a wallet that is NOT a registered signer
    // --------------------------------------------------------------------------
    it('rejects signer_proof by a non-signer with SignerProofUnauthorized', async () => {
        const { nonce } = await oneSig.getState(umi.rpc);
        const call = transfer(10n);
        const outsider = Wallet.createRandom();

        await shouldBeRejected(
            performSignerExecution(ctx, delegate, outsider, nonce, call),
            new SignerProofUnauthorizedError(oneSig.getProgram()),
        );
    });

    // --------------------------------------------------------------------------
    // Negative: delegate binding violation (A signs, B submits)
    // --------------------------------------------------------------------------
    it('rejects when signer binds the proof to a different delegate', async () => {
        const { nonce } = await oneSig.getState(umi.rpc);
        const call = transfer(10n);
        const proofSigner = sortedSigners[0];
        const wrongDelegate = generateSigner(umi);
        await umi.rpc.airdrop(wrongDelegate.publicKey, sol(1), { commitment: 'confirmed' });

        // Proof is signed over `wrongDelegate.publicKey`, but `delegate` actually lands the tx.
        // The on-chain digest is reconstructed from the landing pubkey, so ecrecover
        // returns garbage → not in the signer set.
        await shouldBeRejected(
            performSignerExecution(ctx, delegate, proofSigner, nonce, call, {
                overrideDelegateForSigning: wrongDelegate.publicKey,
            }),
            new SignerProofUnauthorizedError(oneSig.getProgram()),
        );
    });

    // --------------------------------------------------------------------------
    // Negative: tampered expiry
    // --------------------------------------------------------------------------
    it('rejects when the params.signer_proof_expiry diverges from what was signed', async () => {
        const { nonce } = await oneSig.getState(umi.rpc);
        const call = transfer(10n);
        const proofSigner = sortedSigners[0];

        // Build the batch + leaf.
        const { merkleRoot, expiry, signatures, proof, leaf } = await buildOneSigMerkleDataWithLeaf(
            umi,
            oneSig,
            oneSigSeed,
            sortedSigners,
            nonce,
            call,
        );

        // Sign inner with expiry X, but send params with expiry X+60.
        const signedExpiry = BigInt(Math.floor(Date.now() / 1000) + 600);
        const signerProof = await signSignerProof(
            proofSigner,
            leaf,
            delegate.publicKey,
            signedExpiry,
        );

        const {
            multisig: { threshold },
        } = await oneSig.getState(umi.rpc);

        const ix = oneSig.signerExecuteTransaction(delegate, merkleRoot, {
            call,
            proof,
            merkleRootVerification: some({
                expiry,
                signatures:
                    sortedSigners.length > threshold
                        ? arrayify(signatures).slice(0, threshold * 65)
                        : arrayify(signatures),
            }),
            signerProof: [signerProof],
            signerProofExpiry: signedExpiry + 60n, // tampered
        });

        await shouldBeRejected(
            sendAndConfirm(umi, [ix], [delegate]),
            new SignerProofUnauthorizedError(oneSig.getProgram()),
        );
    });

    // --------------------------------------------------------------------------
    // Negative: malformed signer_proof (bad recovery id)
    // --------------------------------------------------------------------------
    it('rejects a malformed signer_proof with FailedSignatureRecovery', async () => {
        const { nonce } = await oneSig.getState(umi.rpc);
        const call = transfer(10n);
        const proofSigner = sortedSigners[0];

        // Start with a valid signature, then clobber the recovery-id byte to an invalid value.
        const { leaf } = await buildOneSigMerkleDataWithLeaf(
            umi,
            oneSig,
            oneSigSeed,
            sortedSigners,
            nonce,
            call,
        );
        const signerProofExpiry = BigInt(Math.floor(Date.now() / 1000) + 600);
        const rawSig = await signSignerProof(
            proofSigner,
            leaf,
            delegate.publicKey,
            signerProofExpiry,
        );
        const bogusSig = new Uint8Array(rawSig);
        bogusSig[64] = 99; // secp256k1_recover requires v ∈ {0,1} (or 27,28 after normalize)

        await shouldBeRejected(
            performSignerExecution(ctx, delegate, proofSigner, nonce, call, {
                overrideSignerProof: bogusSig,
                overrideSignerProofExpiry: signerProofExpiry,
            }),
            new FailedSignatureRecoveryError(oneSig.getProgram()),
        );
    });

    // --------------------------------------------------------------------------
    // Negative: replay
    // --------------------------------------------------------------------------
    it('prevents replay of a signer_proof after execution (nonce advances)', async () => {
        const { nonce } = await oneSig.getState(umi.rpc);
        const call = transfer(20n);
        const proofSigner = sortedSigners[0];

        // First execution — use the helper which funds the PDA with `call.value` before
        // the inner transfer runs.
        await performSignerExecution(ctx, delegate, proofSigner, nonce, call);

        // Replay attempt: reuse the exact same (nonce, proof, merkleRoot). On-chain,
        // the leaf is now recomputed with the advanced nonce, so the merkle proof fails.
        const { merkleRoot, expiry, signatures, proof, leaf } = await buildOneSigMerkleDataWithLeaf(
            umi,
            oneSig,
            oneSigSeed,
            sortedSigners,
            nonce,
            call,
        );
        const signerProofExpiry = BigInt(Math.floor(Date.now() / 1000) + 600);
        const signerProof = await signSignerProof(
            proofSigner,
            leaf,
            delegate.publicKey,
            signerProofExpiry,
        );

        const {
            multisig: { threshold },
        } = await oneSig.getState(umi.rpc);
        const replayIx = oneSig.signerExecuteTransaction(delegate, merkleRoot, {
            call,
            proof,
            merkleRootVerification: some({
                expiry,
                signatures:
                    sortedSigners.length > threshold
                        ? arrayify(signatures).slice(0, threshold * 65)
                        : arrayify(signatures),
            }),
            signerProof: [signerProof],
            signerProofExpiry,
        });

        await shouldBeRejected(
            sendAndConfirm(umi, [replayIx], [delegate]),
            new InvalidProofError(oneSig.getProgram()),
        );
    });

    // --------------------------------------------------------------------------
    // Negative: reentrancy — inner call targets signer_execute_transaction on this
    // program. Data starts with the signer_execute_transaction 8-byte discriminator,
    // so the guard in execution_common::execute_instruction must reject before
    // invoke_signed dispatches.
    // --------------------------------------------------------------------------
    it('blocks re-entry into signer_execute_transaction', async () => {
        const { nonce } = await oneSig.getState(umi.rpc);
        const proofSigner = sortedSigners[0];

        // Minimal malicious payload: OneSig as inner program_id, data = bare signer
        // discriminator. The guard fires before the rest of the data matters.
        // Discriminator literal mirrors generated instruction code at
        // `src/generated/instructions/signerExecuteTransaction.ts` (serializer mapSerializer).
        const SIGNER_EXEC_DISC = new Uint8Array([33, 223, 23, 253, 66, 141, 147, 65]);
        const [oneSigSignerPk] = oneSig.pda.oneSigSigner();
        const malicious: SolanaCallData = {
            programId: ONESIG_PROGRAM_ID,
            keys: [
                // keys[0] = program_id of the inner call
                { pubkey: ONESIG_PROGRAM_ID, isSigner: false, isWritable: false },
                // keys[1..] = (stand-in) inner accounts; guard fires before they're used.
                { pubkey: oneSigSignerPk, isSigner: false, isWritable: false },
            ],
            data: Buffer.from(SIGNER_EXEC_DISC),
            value: 0n,
        };

        await shouldBeRejected(
            performSignerExecution(ctx, delegate, proofSigner, nonce, malicious),
            new ReentrancyError(oneSig.getProgram()),
        );
    });

    // --------------------------------------------------------------------------
    // executor_required = false: signer_proof is skipped; expiry still enforced.
    // --------------------------------------------------------------------------
    describe('when executor_required = false', () => {
        beforeAll(async () => {
            // Flip the flag off by running a config change through the multisig.
            const { nonce } = await oneSig.getState(umi.rpc);
            const call: SolanaCallData = {
                ...oneSig.setExecutorRequired(false),
                value: 0n,
            };
            // Submit via the signer path (executor_required is still true at this point).
            const proofSigner = sortedSigners[0];
            await performSignerExecution(ctx, delegate, proofSigner, nonce, call);

            const state = await oneSig.getState(umi.rpc);
            expect(state.executors.executorRequired).toBe(false);
        });

        it('executes with arbitrary signer_proof bytes (gate skipped)', async () => {
            const { nonce } = await oneSig.getState(umi.rpc);
            const call = transfer(42n);
            // Use an outsider signer + garbage-ish proof. Neither the proof nor its
            // expiry are enforced in permissionless mode.
            const outsider = Wallet.createRandom();

            await verifyBalanceChange(
                umi,
                recipient.publicKey,
                async () => {
                    await performSignerExecution(ctx, delegate, outsider, nonce, call);
                },
                call.value,
            );
        });

        it('accepts an expired signer_proof (expiry is not enforced in permissionless mode)', async () => {
            const { nonce } = await oneSig.getState(umi.rpc);
            const call = transfer(5n);
            const proofSigner = sortedSigners[0];

            await verifyBalanceChange(
                umi,
                recipient.publicKey,
                async () => {
                    await performSignerExecution(ctx, delegate, proofSigner, nonce, call, {
                        signerProofExpiryOffsetSec: -30,
                    });
                },
                call.value,
            );
        });
    });
}
