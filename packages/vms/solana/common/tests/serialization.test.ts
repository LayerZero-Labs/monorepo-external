import { Keypair, TransactionInstruction } from '@solana/web3.js';
import { describe, expect, it } from 'vitest';

import {
    deserializeTransactionInstructions,
    instructionDataToBuffer,
    instructionDataToHex,
    serializeTransactionInstruction,
} from '../src/serialization';
import { solanaTransactionSchema } from '../src/transaction';

const sampleInstruction = () =>
    new TransactionInstruction({
        programId: Keypair.generate().publicKey,
        keys: [
            { pubkey: Keypair.generate().publicKey, isSigner: true, isWritable: true },
            { pubkey: Keypair.generate().publicKey, isSigner: false, isWritable: false },
        ],
        // includes a leading zero byte to guard against any normalization
        data: Buffer.from([0x00, 0x6d, 0xbd, 0x9f, 0x90, 0xff]),
    });

describe('serializeTransactionInstruction', () => {
    it('serializes data as 0x-prefixed hex', () => {
        const serialized = serializeTransactionInstruction(sampleInstruction());
        expect(serialized.data).toBe('0x006dbd9f90ff');
        expect(typeof serialized.data).toBe('string');
    });

    it('round-trips through deserialize (hex form)', () => {
        const original = sampleInstruction();
        const [restored] = deserializeTransactionInstructions([
            serializeTransactionInstruction(original),
        ]);
        expect(restored.programId.equals(original.programId)).toBe(true);
        expect(Buffer.from(restored.data).equals(original.data)).toBe(true);
        expect(restored.keys.map((k) => k.pubkey.toString())).toEqual(
            original.keys.map((k) => k.pubkey.toString()),
        );
    });
});

describe('instructionData helpers', () => {
    it('instructionDataToBuffer decodes 0x-hex and raw bytes', () => {
        expect(instructionDataToBuffer('0x006dbd9f90ff').toString('hex')).toBe('006dbd9f90ff');
        expect(
            instructionDataToBuffer(Buffer.from([0, 109, 189, 159, 144, 255])).toString('hex'),
        ).toBe('006dbd9f90ff');
    });

    it('instructionDataToHex passes 0x-hex through and encodes raw bytes', () => {
        expect(instructionDataToHex('0x006dbd9f90ff')).toBe('0x006dbd9f90ff');
        expect(instructionDataToHex(Buffer.from([0, 109, 189, 159, 144, 255]))).toBe(
            '0x006dbd9f90ff',
        );
    });
});

describe('solanaTransactionSchema instruction data (0x-hex only)', () => {
    const txWithData = (data: unknown) => ({
        chainName: 'solana',
        timestamps: { created: 0 },
        type: 'test',
        populatedTransaction: { instructions: [{ programId: 'p', keys: [], data }] },
    });

    it('accepts 0x-hex instruction data', () => {
        expect(solanaTransactionSchema.safeParse(txWithData('0x010203')).success).toBe(true);
    });

    it('rejects the legacy number[] instruction data (clean break)', () => {
        expect(solanaTransactionSchema.safeParse(txWithData([0, 1, 2])).success).toBe(false);
    });
});
