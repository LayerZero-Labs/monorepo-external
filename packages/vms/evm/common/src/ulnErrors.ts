import {
    ContractFunctionExecutionError,
    ContractFunctionRevertedError,
    ContractFunctionZeroDataError,
} from 'viem';

// Heuristic to detect reverts from getUlnConfig when no default config is set.
// RPCs return revert data in inconsistent formats across chains, so we check
// multiple patterns.
const REVERT_INDICATORS = [
    'execution reverted',
    'revert',
    'vm execution error',
    'ce2c3751', // LZ_ULN_AtLeastOneDVN() selector
    'LZ_ULN_AtLeastOneDVN',
];

// TODO: consider merging with `isRevertWithError`.
export const isGetUlnConfigRevert = (error: unknown): boolean => {
    if (error instanceof ContractFunctionExecutionError) {
        // ContractFunctionZeroDataError means the contract returned 0x — the
        // address has no deployed code or doesn't implement the function.
        // This is NOT the "no config" revert and must propagate so callers
        // detect missing deployments.
        if (error.cause instanceof ContractFunctionZeroDataError) {
            return false;
        }
        if (error.cause instanceof ContractFunctionRevertedError) {
            return true;
        }
    }
    if (error instanceof Error) {
        const msg = error.message.toLowerCase();
        return REVERT_INDICATORS.some((indicator) => msg.includes(indicator.toLowerCase()));
    }
    return false;
};
