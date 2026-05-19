import { xdr } from '@stellar/stellar-sdk';

import type { StellarCall } from './leafGenerator';

/**
 * Create a call to set the seed value
 */
export function createSetSeedCall(newSeed: Buffer, contractAddress: string): StellarCall {
    return {
        contractAddress,
        functionName: 'set_seed',
        args: [xdr.ScVal.scvBytes(newSeed)],
    };
}

/**
 * Create a call to set an executor
 */
export function createSetExecutorCall(
    executor: Buffer,
    active: boolean,
    contractAddress: string,
): StellarCall {
    return {
        contractAddress,
        functionName: 'set_executor',
        args: [xdr.ScVal.scvBytes(executor), xdr.ScVal.scvBool(active)],
    };
}

/**
 * Create a call to set executor required flag
 */
export function createSetExecutorRequiredCall(
    required: boolean,
    contractAddress: string,
): StellarCall {
    return {
        contractAddress,
        functionName: 'set_executor_required',
        args: [xdr.ScVal.scvBool(required)],
    };
}

/**
 * Create a call to set the threshold
 */
export function createSetThresholdCall(newThreshold: number, contractAddress: string): StellarCall {
    return {
        contractAddress,
        functionName: 'set_threshold',
        args: [xdr.ScVal.scvU32(newThreshold)],
    };
}

/**
 * Create a call to set a signer
 */
export function createSetSignerCall(
    signerAddress: Buffer,
    active: boolean,
    contractAddress: string,
): StellarCall {
    return {
        contractAddress,
        functionName: 'set_signer',
        args: [xdr.ScVal.scvBytes(signerAddress), xdr.ScVal.scvBool(active)],
    };
}
