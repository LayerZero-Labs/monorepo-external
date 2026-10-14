import { Keypair, Message, PublicKey, TransactionInstruction } from '@solana/web3.js';
import base58 from 'bs58';
import { describe, expect, it } from 'vitest';

import { serializeSolanaTransactionToBase58Message } from '../src/base58';
import { getSolanaInjectedPayerAddress } from '../src/feePayer';
import { serializeTransactionInstruction } from '../src/serialization';
import type { SolanaTransaction } from '../src/transaction';

const ENV = 'mainnet';
const INJECTED = new PublicKey(getSolanaInjectedPayerAddress(ENV));
const BLOCKHASH = base58.encode(Buffer.alloc(32, 1)); // any valid 32-byte base58

// Build a minimal SolanaTransaction; the helper only reads `populatedTransaction`
// and `replaceAllInjectedPubKeys`, so a partial object is sufficient here.
const makeTx = (
    instruction: TransactionInstruction,
    replaceAllInjectedPubKeys?: boolean,
): SolanaTransaction =>
    ({
        populatedTransaction: { instructions: [serializeTransactionInstruction(instruction)] },
        replaceAllInjectedPubKeys,
    }) as unknown as SolanaTransaction;

const makeTxMany = (instructions: TransactionInstruction[]): SolanaTransaction =>
    ({
        populatedTransaction: { instructions: instructions.map(serializeTransactionInstruction) },
    }) as unknown as SolanaTransaction;

const decode = (b58: string) => Message.from(base58.decode(b58));
const ixDataHex = (msg: Message, i: number) =>
    Buffer.from(base58.decode(msg.instructions[i].data)).toString('hex');

describe('serializeSolanaTransactionToBase58Message', () => {
    it('sets the fee payer, replaces an injected-payer signer, and preserves data', () => {
        const payer = Keypair.generate().publicKey;
        const program = Keypair.generate().publicKey;
        const data = Buffer.from([0xde, 0xad, 0xbe, 0xef]);
        const instruction = new TransactionInstruction({
            programId: program,
            keys: [
                { pubkey: INJECTED, isSigner: true, isWritable: true }, // injected payer (signer slot)
                { pubkey: Keypair.generate().publicKey, isSigner: false, isWritable: true },
            ],
            data,
        });

        const message = decode(
            serializeSolanaTransactionToBase58Message({
                transaction: makeTx(instruction),
                feePayer: payer.toString(),
                environment: ENV,
                recentBlockhash: BLOCKHASH,
            }),
        );

        expect(message.accountKeys[0].toString()).toBe(payer.toString()); // fee payer
        expect(message.accountKeys.some((k) => k.equals(INJECTED))).toBe(false); // placeholder gone
        expect(message.accountKeys.some((k) => k.equals(program))).toBe(true);
        expect(message.instructions).toHaveLength(1);
        expect(Buffer.from(base58.decode(message.instructions[0].data)).toString('hex')).toBe(
            data.toString('hex'),
        );
    });

    it('replaces an injected payer in a non-signer slot when the tx sets replaceAllInjectedPubKeys', () => {
        // The closeProgram/closeBuffer case: injected payer in a non-signer slot, flag set.
        const payer = Keypair.generate().publicKey;
        const instruction = new TransactionInstruction({
            programId: Keypair.generate().publicKey,
            keys: [
                { pubkey: Keypair.generate().publicKey, isSigner: true, isWritable: true },
                { pubkey: INJECTED, isSigner: false, isWritable: true }, // injected payer (non-signer slot)
            ],
            data: Buffer.from([0x01]),
        });

        const message = decode(
            serializeSolanaTransactionToBase58Message({
                transaction: makeTx(instruction, true),
                feePayer: payer.toString(),
                environment: ENV,
                recentBlockhash: BLOCKHASH,
            }),
        );

        expect(message.accountKeys.some((k) => k.equals(INJECTED))).toBe(false);
        expect(message.accountKeys.some((k) => k.equals(payer))).toBe(true);
    });

    it('leaves a non-signer injected payer in place when the tx does not set the flag', () => {
        // The injected payer is funded for simulation; without the flag the swap only touches
        // signer slots, so a non-signer placeholder is intentionally left untouched.
        const payer = Keypair.generate().publicKey;
        const instruction = new TransactionInstruction({
            programId: Keypair.generate().publicKey,
            keys: [
                { pubkey: Keypair.generate().publicKey, isSigner: true, isWritable: true },
                { pubkey: INJECTED, isSigner: false, isWritable: true },
            ],
            data: Buffer.from([0x01]),
        });

        const message = decode(
            serializeSolanaTransactionToBase58Message({
                transaction: makeTx(instruction), // no replaceAllInjectedPubKeys
                feePayer: payer.toString(),
                environment: ENV,
                recentBlockhash: BLOCKHASH,
            }),
        );

        expect(message.accountKeys.some((k) => k.equals(INJECTED))).toBe(true);
    });

    it('throws on partial wallet-transfer instructions (unsupported)', () => {
        // The schema also permits the { dstWalletAddress, lamports, gas } shape; reject it
        // up front rather than letting deserialize fail on .map.
        const tx = {
            populatedTransaction: {
                instructions: { dstWalletAddress: `0x${'ab'.repeat(32)}`, lamports: '1', gas: '1' },
            },
        } as unknown as SolanaTransaction;

        expect(() =>
            serializeSolanaTransactionToBase58Message({
                transaction: tx,
                feePayer: Keypair.generate().publicKey.toString(),
                environment: ENV,
                recentBlockhash: BLOCKHASH,
            }),
        ).toThrow(/partial wallet-transfer/);
    });

    it('throws on an invalid base58 feePayer', () => {
        const instruction = new TransactionInstruction({
            programId: Keypair.generate().publicKey,
            keys: [{ pubkey: INJECTED, isSigner: true, isWritable: true }],
            data: Buffer.from([0x01]),
        });

        expect(() =>
            serializeSolanaTransactionToBase58Message({
                transaction: makeTx(instruction),
                feePayer: 'not-valid-base58!!!',
                environment: ENV,
                recentBlockhash: BLOCKHASH,
            }),
        ).toThrow(/invalid base58 feePayer/);
    });

    it('throws when the compiled message exceeds the packet size limit', () => {
        const instruction = new TransactionInstruction({
            programId: Keypair.generate().publicKey,
            keys: [{ pubkey: INJECTED, isSigner: true, isWritable: true }],
            data: Buffer.alloc(1300), // alone exceeds the 1232-byte ceiling
        });

        expect(() =>
            serializeSolanaTransactionToBase58Message({
                transaction: makeTx(instruction),
                feePayer: Keypair.generate().publicKey.toString(),
                environment: ENV,
                recentBlockhash: BLOCKHASH,
            }),
        ).toThrow(/exceeds the \d+-byte tx limit/);
    });

    it('preserves every instruction in order and dedupes shared account keys', () => {
        const payer = Keypair.generate().publicKey;
        const program = Keypair.generate().publicKey;
        const shared = Keypair.generate().publicKey; // referenced by both instructions
        const ix0 = new TransactionInstruction({
            programId: program,
            keys: [
                { pubkey: INJECTED, isSigner: true, isWritable: true },
                { pubkey: shared, isSigner: false, isWritable: true },
            ],
            data: Buffer.from([0xaa]),
        });
        const ix1 = new TransactionInstruction({
            programId: program,
            keys: [
                { pubkey: shared, isSigner: false, isWritable: true },
                { pubkey: Keypair.generate().publicKey, isSigner: false, isWritable: false },
            ],
            data: Buffer.from([0xbb, 0xcc]),
        });

        const message = decode(
            serializeSolanaTransactionToBase58Message({
                transaction: makeTxMany([ix0, ix1]),
                feePayer: payer.toString(),
                environment: ENV,
                recentBlockhash: BLOCKHASH,
            }),
        );

        expect(message.instructions).toHaveLength(2);
        expect(ixDataHex(message, 0)).toBe('aa'); // order preserved
        expect(ixDataHex(message, 1)).toBe('bbcc');
        expect(message.accountKeys.filter((k) => k.equals(shared))).toHaveLength(1); // deduped
        expect(message.accountKeys[0].equals(payer)).toBe(true); // payer slot
        expect(message.accountKeys.some((k) => k.equals(INJECTED))).toBe(false); // replacement ran across instructions
    });
});
