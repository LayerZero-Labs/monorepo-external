import {
    ComputeBudgetProgram,
    PublicKey,
    SystemProgram,
    TransactionInstruction,
} from '@solana/web3.js';
import { describe, expect, it } from 'vitest';

import {
    COMPUTE_BUDGET_PROGRAM_ID,
    ComputeBudgetDiscriminators,
    isComputeBudgetInstruction,
    sampleComputeBudgetFeeValue,
} from '../src/utils';

describe('isComputeBudgetInstruction', () => {
    it('matches a PublicKey programId from ComputeBudgetProgram', () => {
        expect(isComputeBudgetInstruction({ programId: ComputeBudgetProgram.programId })).toBe(
            true,
        );
    });

    it('matches the base58 program id string', () => {
        expect(isComputeBudgetInstruction({ programId: COMPUTE_BUDGET_PROGRAM_ID })).toBe(true);
    });

    it('rejects other program ids', () => {
        // SystemProgram.programId and PublicKey.default are the same all-ones address, so asserting
        // both would be one assertion written twice. Use a genuinely different program instead.
        expect(isComputeBudgetInstruction({ programId: SystemProgram.programId })).toBe(false);
        expect(
            isComputeBudgetInstruction({
                programId: new PublicKey('TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA'),
            }),
        ).toBe(false);
    });

    it('rejects a base58 id differing only by letter case', () => {
        // Base58 is case-sensitive, so a case-mutated id is a different address entirely. A
        // comparison that lowercased both sides — the natural mistake when the EVM helpers next
        // door all do exactly that — would wrongly match here.
        const caseMutated =
            COMPUTE_BUDGET_PROGRAM_ID[0] === COMPUTE_BUDGET_PROGRAM_ID[0].toUpperCase()
                ? COMPUTE_BUDGET_PROGRAM_ID[0].toLowerCase() + COMPUTE_BUDGET_PROGRAM_ID.slice(1)
                : COMPUTE_BUDGET_PROGRAM_ID[0].toUpperCase() + COMPUTE_BUDGET_PROGRAM_ID.slice(1);
        expect(caseMutated).not.toBe(COMPUTE_BUDGET_PROGRAM_ID);
        expect(isComputeBudgetInstruction({ programId: caseMutated })).toBe(false);
    });
});

describe('sampleComputeBudgetFeeValue', () => {
    it('samples SetComputeUnitPrice microLamports', () => {
        const instruction = ComputeBudgetProgram.setComputeUnitPrice({ microLamports: 1000 });
        expect(instruction.data[0]).toBe(ComputeBudgetDiscriminators.SetComputeUnitPrice);
        expect(sampleComputeBudgetFeeValue(instruction)).toBe(1000n);
    });

    it('skips SetLoadedAccountsDataSizeLimit', () => {
        const instruction = new TransactionInstruction({
            keys: [],
            programId: ComputeBudgetProgram.programId,
            data: Buffer.from([
                ComputeBudgetDiscriminators.SetLoadedAccountsDataSizeLimit,
                0x00,
                0x10,
                0x00,
                0x00,
            ]),
        });
        expect(sampleComputeBudgetFeeValue(instruction)).toBeUndefined();
    });

    it('skips SetComputeUnitLimit', () => {
        const instruction = ComputeBudgetProgram.setComputeUnitLimit({ units: 200_000 });
        expect(sampleComputeBudgetFeeValue(instruction)).toBeUndefined();
    });

    it('skips RequestUnits', () => {
        const instruction = ComputeBudgetProgram.requestUnits({
            units: 100,
            additionalFee: 50,
        });
        expect(sampleComputeBudgetFeeValue(instruction)).toBeUndefined();
    });

    it('skips RequestHeapFrame', () => {
        const instruction = ComputeBudgetProgram.requestHeapFrame({ bytes: 32_768 });
        expect(sampleComputeBudgetFeeValue(instruction)).toBeUndefined();
    });

    it('skips SetComputeUnitPrice with a truncated payload', () => {
        const instruction = new TransactionInstruction({
            keys: [],
            programId: ComputeBudgetProgram.programId,
            data: Buffer.from([ComputeBudgetDiscriminators.SetComputeUnitPrice]),
        });
        expect(sampleComputeBudgetFeeValue(instruction)).toBeUndefined();
    });
});
