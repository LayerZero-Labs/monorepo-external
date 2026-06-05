import { Address, xdr } from '@stellar/stellar-sdk';

import { type Call } from './generated/index';
import { type StellarCall } from './leafGenerator';

/** Build an `(symbol => value)` ScMap entry. */
const scMapEntry = (key: string, val: xdr.ScVal) =>
    new xdr.ScMapEntry({ key: xdr.ScVal.scvSymbol(key), val });

/**
 * Bundle multiple external calls into a single `execute_transaction` self-call
 * (the OneSig multicall path).
 *
 * A OneSig merkle leaf authorizes exactly one self-call on the OneSig contract.
 * To dispatch several external calls under one leaf, wrap them as the `calls`
 * argument of `execute_transaction`; the OneSig contract is the direct invoker
 * of each, so they need no separate OneSig auth.
 *
 * The inner calls use the generated {@link Call} type so they mirror the
 * contract's `Call` struct exactly (`to`, `func`, `args`, `sub_invocations`).
 * Each `Call` is encoded as an ScMap by hand rather than via `nativeToScVal`,
 * because the spec cannot serialize the `InvokerContractAuthEntry` values in
 * `sub_invocations`; the hand-rolled encoding is byte-identical to what the
 * generated client submits, and additionally supports nested pre-authorization.
 *
 * The returned {@link StellarCall} is consumed by the leaf generator's
 * `encodeCalls` exactly like any other self-call.
 *
 * @param oneSigAddress - The OneSig contract address (C...); the wrapper's target.
 * @param calls - External calls to execute atomically inside `execute_transaction`.
 */
export function createExecuteTransactionCall(oneSigAddress: string, calls: Call[]): StellarCall {
    // ScMap keys must be sorted; Call fields are alphabetical: args, func, sub_invocations, to.
    const callsScVal = xdr.ScVal.scvVec(
        calls.map((call) =>
            xdr.ScVal.scvMap([
                scMapEntry('args', xdr.ScVal.scvVec(call.args)),
                scMapEntry('func', xdr.ScVal.scvSymbol(call.func)),
                scMapEntry('sub_invocations', xdr.ScVal.scvVec(call.sub_invocations)),
                scMapEntry('to', Address.fromString(call.to).toScVal()),
            ]),
        ),
    );

    return {
        contractAddress: oneSigAddress,
        functionName: 'execute_transaction',
        args: [callsScVal],
    };
}

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
