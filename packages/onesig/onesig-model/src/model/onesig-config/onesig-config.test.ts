import { describe, expect, it } from 'vitest';

import { oneSigOwnershipTransferConfigSchema } from './onesig-config';

const FP_A = `1220${'a'.repeat(64)}`;
const FP_B = `1220${'b'.repeat(64)}`;
const FP_A_UPPER = `1220${'A'.repeat(64)}`;

describe('oneSigOwnershipTransferConfigSchema', () => {
    it('accepts a valid config', () => {
        const parsed = oneSigOwnershipTransferConfigSchema.parse({
            newOwners: [FP_A, FP_B],
            threshold: 2,
        });
        expect(parsed).toEqual({ newOwners: [FP_A, FP_B], threshold: 2 });
    });

    it('rejects a malformed fingerprint', () => {
        expect(
            oneSigOwnershipTransferConfigSchema.safeParse({
                newOwners: ['1221zz'],
                threshold: 1,
            }).success,
        ).toBe(false);
    });

    it('rejects case-insensitive duplicates', () => {
        expect(
            oneSigOwnershipTransferConfigSchema.safeParse({
                newOwners: [FP_A, FP_A_UPPER],
                threshold: 1,
            }).success,
        ).toBe(false);
    });

    it('rejects threshold 0', () => {
        expect(
            oneSigOwnershipTransferConfigSchema.safeParse({
                newOwners: [FP_A],
                threshold: 0,
            }).success,
        ).toBe(false);
    });

    it('rejects threshold greater than the owner count', () => {
        expect(
            oneSigOwnershipTransferConfigSchema.safeParse({
                newOwners: [FP_A, FP_B],
                threshold: 3,
            }).success,
        ).toBe(false);
    });

    it('rejects an empty owner list', () => {
        expect(
            oneSigOwnershipTransferConfigSchema.safeParse({
                newOwners: [],
                threshold: 1,
            }).success,
        ).toBe(false);
    });
});
