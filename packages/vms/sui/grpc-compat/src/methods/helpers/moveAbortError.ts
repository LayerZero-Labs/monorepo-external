import type { SuiClientTypes } from '@mysten/sui-v2/client';

// A Move `#[error]` constant makes `formatMoveAbortMessage` print `'CONSTANT_NAME'` instead of
// `abort code: N`, even though `MoveAbort.abortCode` still has the number. Re-append it so
// downstream numeric parsing (`extractMoveAbortCode`/`handleError`) still works.
export const withMoveAbortCode = (error: SuiClientTypes.ExecutionError): string =>
    error.$kind === 'MoveAbort' &&
    error.MoveAbort.cleverError?.constantName &&
    !/abort code:/i.test(error.message)
        ? `${error.message} (abort code: ${error.MoveAbort.abortCode})`
        : error.message;
