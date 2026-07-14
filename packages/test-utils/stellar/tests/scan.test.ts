import { describe, expect, it, vi } from 'vitest';

import { assertValidScanLedgerRange, resolveScanEndLedger } from '../src/scan.js';

describe('assertValidScanLedgerRange', () => {
    it('accepts a tip strictly after the start ledger', () => {
        expect(() => assertValidScanLedgerRange(100, 101)).not.toThrow();
        expect(() => assertValidScanLedgerRange(100, 200)).not.toThrow();
    });

    it('rejects equal start/end (stalled tip on the tx ledger)', () => {
        expect(() => assertValidScanLedgerRange(100, 100)).toThrow(
            /did not advance past start ledger 100/,
        );
    });

    it('rejects start past tip (would be an invalid getEvents range)', () => {
        expect(() => assertValidScanLedgerRange(105, 100)).toThrow(
            /invalid \/ empty ledger window/,
        );
    });
});

describe('resolveScanEndLedger', () => {
    it('returns immediately when tip is already past start', async () => {
        const getLatestLedger = vi.fn().mockResolvedValue({ sequence: 120 });
        const sleep = vi.fn();

        await expect(resolveScanEndLedger(getLatestLedger, 100, { sleep })).resolves.toBe(120);
        expect(getLatestLedger).toHaveBeenCalledTimes(1);
        expect(sleep).not.toHaveBeenCalled();
    });

    it('waits until tip advances past start', async () => {
        const getLatestLedger = vi
            .fn()
            .mockResolvedValueOnce({ sequence: 100 })
            .mockResolvedValueOnce({ sequence: 100 })
            .mockResolvedValueOnce({ sequence: 101 });
        const sleep = vi.fn().mockResolvedValue(undefined);

        await expect(
            resolveScanEndLedger(getLatestLedger, 100, {
                maxAttempts: 5,
                delayMs: 1,
                sleep,
            }),
        ).resolves.toBe(101);
        expect(sleep).toHaveBeenCalled();
    });

    it('fails closed when localnet tip never advances (stalled)', async () => {
        const getLatestLedger = vi.fn().mockResolvedValue({ sequence: 50 });
        const sleep = vi.fn().mockResolvedValue(undefined);

        await expect(
            resolveScanEndLedger(getLatestLedger, 50, {
                maxAttempts: 3,
                delayMs: 1,
                sleep,
            }),
        ).rejects.toThrow(/localnet tip 50 did not advance past start ledger 50/);
        expect(sleep).toHaveBeenCalledTimes(3);
        expect(getLatestLedger).toHaveBeenCalledTimes(1 + 3);
    });
});
