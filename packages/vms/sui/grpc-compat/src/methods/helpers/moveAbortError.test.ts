import type { SuiClientTypes } from '@mysten/sui-v2/client';
import { describe, expect, it } from 'vitest';

import { withMoveAbortCode } from './moveAbortError';

describe('withMoveAbortCode', () => {
    it('leaves a normally-formatted abort message untouched', () => {
        const error = {
            $kind: 'MoveAbort',
            message:
                "MoveAbort in 1st command, abort code: 2, in '0x2::price_feed::get_price' (instruction 11)",
            MoveAbort: { abortCode: '2' },
        } as unknown as SuiClientTypes.ExecutionError;

        expect(withMoveAbortCode(error)).toBe(error.message);
    });

    it('re-appends the numeric abort code when a Move #[error] constant hid it', () => {
        const error = {
            $kind: 'MoveAbort',
            message:
                "MoveAbort in 1st command, 'ENoPrice', in '0x2::price_feed::get_price' (instruction 11)",
            MoveAbort: { abortCode: '2', cleverError: { constantName: 'ENoPrice' } },
        } as unknown as SuiClientTypes.ExecutionError;

        expect(withMoveAbortCode(error)).toBe(`${error.message} (abort code: 2)`);
    });

    it('leaves a non-abort error message untouched', () => {
        const error = {
            $kind: 'Unknown',
            message: 'InsufficientGas',
        } as unknown as SuiClientTypes.ExecutionError;

        expect(withMoveAbortCode(error)).toBe('InsufficientGas');
    });
});
