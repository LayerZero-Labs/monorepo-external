import { arrayify } from '@ethersproject/bytes';
import { generateSigner, signerIdentity, sol } from '@metaplex-foundation/umi';
import { createUmi } from '@metaplex-foundation/umi-bundle-defaults';
import { randomBytes } from 'crypto';
import { Wallet } from 'ethers';
import { beforeAll, describe } from 'vitest';

import { OneSig, ONESIG_PROGRAM_ID } from '../src';
import { oneStepExecutionTests } from './features/one-step-exec';
import { setConfigTests } from './features/set-config';
import { twoStepExecutionTests } from './features/two-step-exec';
import { DEFAULT_CONFIG, LOCAL_RPC_URL, setupOneSig, TransactionContext } from './helpers';

describe('OneSig Solana', () => {
    // Set up a fresh test context for each test
    const umi = createUmi(LOCAL_RPC_URL, 'confirmed');
    const payer = generateSigner(umi);
    const recipient = generateSigner(umi);
    const oneSigState = generateSigner(umi);
    const oneSig = new OneSig(ONESIG_PROGRAM_ID, oneSigState);
    const oneSigSeed = arrayify(randomBytes(32));
    // Create and sort test signers for deterministic testing
    const sortedSigners = Array(DEFAULT_CONFIG.threshold)
        .fill(0)
        .map(() => Wallet.createRandom())
        .sort((a, b) => a.address.localeCompare(b.address));

    // Test context shared across all tests
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
        // Fund accounts
        await Promise.all([
            umi.rpc.airdrop(payer.publicKey, sol(10000), {
                commitment: 'confirmed',
            }),
            umi.rpc.airdrop(recipient.publicKey, sol(1), {
                commitment: 'confirmed',
            }),
        ]);

        // Initialize OneSig
        await setupOneSig(umi, oneSig, oneSigSeed, payer, oneSigState, sortedSigners);
    });

    // Run feature tests with proper binding

    describe('One-Step Transactionon Execution', oneStepExecutionTests.bind(this, ctx));
    describe('Two-Step Transaction Execution', twoStepExecutionTests.bind(this, ctx));
    describe('SetConfig Operations', setConfigTests.bind(this, ctx));
    // describe('Transaction Size', txSizeTests.bind(this, ctx))
});
