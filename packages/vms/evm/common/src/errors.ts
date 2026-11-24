import {
    AbiDecodingZeroDataError,
    CallExecutionError,
    ContractFunctionExecutionError,
    ContractFunctionRevertedError,
    ContractFunctionZeroDataError,
    ExecutionRevertedError,
    RpcRequestError,
    toFunctionSelector,
} from 'viem';

import { ChainName } from '@layerzerolabs/layerzero-definitions';

const IDEMPOTENT_ERROR_PATTERN =
    /nonce too low|transaction already imported|already known|known transaction|nonce too high|tx already in mempool|nonce has already been used|invalid nonce|tx rejected: known tx|revert|returned no data/;

export const isIdempotentError = (error: unknown): boolean => {
    if (error == null || typeof error !== 'object') return false;
    const { details, message } = error as { details?: string; message?: string };
    return (
        (typeof details === 'string' && IDEMPOTENT_ERROR_PATTERN.test(details.toLowerCase())) ||
        (typeof message === 'string' && IDEMPOTENT_ERROR_PATTERN.test(message.toLowerCase()))
    );
};

/**
 * @param err - Viem query error
 * @param errorSignature - Canonical Solidity form, e.g. `LZ_DefaultReceiveLibUnavailable()`
 * @returns Whether the error is a revert with the given error signature
 */
export const isRevertWithError = (err: unknown, chainName: ChainName, errorSignature: string) => {
    if (!(err instanceof ContractFunctionExecutionError)) return false;

    const selector = toFunctionSelector(errorSignature);

    if (
        err.cause instanceof ContractFunctionRevertedError &&
        !err.cause.raw &&
        chainName === ChainName.HARMONY
    ) {
        // Harmony doesn't return revert data.
        return true;
    }

    if (err.cause instanceof CallExecutionError && chainName === ChainName.NIBIRU) {
        // Sample `err.details`:
        // "Execution reverted with reason:  with undecodable reason (raw hex: 78e84d06)".
        return err.details?.endsWith(`(raw hex: ${selector.slice(2)})`) ?? false;
    }

    if (
        err.cause instanceof CallExecutionError &&
        [ChainName.TRON, ChainName.ROOTSTOCK].includes(chainName)
    ) {
        // Tron returns `code: -32000`, so `viem` leaves the selector on `RpcRequestError.data`
        // instead of hoisting it to `ContractFunctionRevertedError`.
        // Rootstock returns `code: -32015`.
        let cursor: unknown = err.cause;
        for (let depth = 0; cursor != null && depth < 16; depth++) {
            if (cursor instanceof RpcRequestError && cursor.data === selector) return true;
            cursor = (cursor as { cause?: unknown }).cause;
        }
        return false;
    }

    if (!(err.cause instanceof ContractFunctionRevertedError)) return false;

    const errorName = errorSignature.split('(')[0];
    if (err.cause.data?.errorName === errorName) return true;

    return err.cause.signature === selector || err.cause.raw === selector;
};

const REVERT_OR_NO_DATA_ERRORS = [
    ContractFunctionRevertedError,
    ContractFunctionZeroDataError,
    AbiDecodingZeroDataError,
    ExecutionRevertedError,
];

const REVERT_DATA_PATTERN = /^0x[0-9a-f]+$/i;
const REVERT_REASON_PATTERN = /revert/i;

const isNodeErrorReportedAsRevert = (error: ContractFunctionRevertedError): boolean => {
    const raw = typeof error.raw === 'string' && error.raw !== '0x' ? error.raw : undefined;
    if (raw !== undefined && REVERT_DATA_PATTERN.test(raw)) {
        return false;
    }
    const message = error.reason ?? raw;
    return message !== undefined && !REVERT_REASON_PATTERN.test(message);
};

export const isRevertOrNoData = (error: unknown): boolean => {
    const seen = new Set<Error>();
    let current = error;
    while (current instanceof Error && !seen.has(current)) {
        if (
            REVERT_OR_NO_DATA_ERRORS.some((errorClass) => current instanceof errorClass) &&
            !(
                current instanceof ContractFunctionRevertedError &&
                isNodeErrorReportedAsRevert(current)
            )
        ) {
            return true;
        }
        seen.add(current);
        current = current.cause;
    }
    return false;
};
