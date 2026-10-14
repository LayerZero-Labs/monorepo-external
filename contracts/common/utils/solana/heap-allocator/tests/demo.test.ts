/** Deploy the demo to surfpool, then exercise its allocator through Anchor TS. */
import { AnchorProvider, type Idl, Program, setProvider, Wallet } from '@coral-xyz/anchor';
import {
    ComputeBudgetProgram,
    Keypair,
    sendAndConfirmTransaction,
    Transaction,
    type TransactionInstruction,
} from '@solana/web3.js';
import { readFile } from 'node:fs/promises';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { getBufferTransactions } from '@layerzerolabs/common-solana';
import {
    createKeypairFromSeed,
    startValidator,
    type ValidatorEnv,
} from '@layerzerolabs/test-utils-solana';

const DEFAULT_HEAP = 32 * 1024;
const BASE_PORT = 15133;
const DEMO_SO = 'target/deploy/demo.so';

let validator: ValidatorEnv;
let program: Program;
let payer: Keypair;
let programKeypair: Keypair;

const sendInstructions = async (
    instructions: TransactionInstruction[],
    additionalSigners: Keypair[] = [],
): Promise<void> => {
    await sendAndConfirmTransaction(
        validator.connection,
        new Transaction().add(...instructions),
        [payer, ...additionalSigners],
        { commitment: 'confirmed' },
    );
};

beforeAll(async () => {
    validator = await startValidator({
        basePort: BASE_PORT,
        snapshot: false,
        startupTimeoutSeconds: 90,
    });

    payer = createKeypairFromSeed('umi-payer');
    programKeypair = Keypair.fromSecretKey(
        Uint8Array.from(JSON.parse(await readFile('tests/keys/demo-program.json', 'utf8'))),
    );

    const provider = new AnchorProvider(validator.connection, new Wallet(payer), {
        commitment: 'confirmed',
    });
    setProvider(provider);

    const idl = JSON.parse(await readFile('target/idl/demo.json', 'utf8')) as Idl;
    expect(idl.address).toBe(programKeypair.publicKey.toBase58());
    program = new Program(idl, provider);
}, 240_000);

afterAll(async () => {
    await validator?.teardown();
});

describe('heap allocator demo', () => {
    it('deploys through the upgradeable loader', async () => {
        const programBuffer = await readFile(DEMO_SO);
        const bufferKeypair = Keypair.generate();
        const deployment = await getBufferTransactions({
            connection: validator.connection,
            programBuffer,
            walletPk: payer.publicKey,
            bufferPk: bufferKeypair.publicKey,
            programPk: programKeypair.publicKey,
        });

        await sendInstructions(deployment.createBufferInstructions, [bufferKeypair]);
        for (const instruction of deployment.loadBufferInstructions) {
            await sendInstructions([instruction]);
        }
        await sendInstructions(deployment.deployProgramInstructions, [programKeypair]);

        const programInfo = await validator.connection.getAccountInfo(programKeypair.publicKey);
        expect(programInfo).not.toBeNull();
        expect(programInfo?.executable).toBe(true);
    }, 180_000);

    it('ping succeeds', async () => {
        await program.methods.ping().rpc();
    });

    it('allocate reports heap_used from the custom bump allocator', async () => {
        const size = 1024;
        const used = await program.methods.allocate(size).view();
        expect(Number(used)).toBeGreaterThan(size);
    });

    it('allocate beyond default 32KiB heap with requestHeapFrame', async () => {
        const size = 40 * 1024;
        const heapFrame = 64 * 1024;
        expect(size).toBeGreaterThan(DEFAULT_HEAP);

        const used = await program.methods
            .allocate(size)
            .preInstructions([ComputeBudgetProgram.requestHeapFrame({ bytes: heapFrame })])
            .view();

        expect(Number(used)).toBeGreaterThan(size);
    });
});
