import type { xdr } from '@stellar/stellar-sdk';
import { Address, StrKey } from '@stellar/stellar-sdk';

import { type BaseLeafData, type GenerateLeafsResult } from '@layerzerolabs/onesig-core';

import {
    assertContractTarget,
    assertExecuteTransactionArgs,
    assertInvokerContractAuthEntry,
} from './authEntry';
import { createExecuteTransactionCall } from './calls';
import { Client, type InvokerContractAuthEntry } from './generated/index';

// Get the contract spec and Call type at module load. Only `.spec` is used here (no
// network call), but stellar-sdk v16 eagerly builds an RpcServer in the Client
// constructor and validates `rpcUrl` via `new URL(...)`, so an empty string throws
// "Invalid URL". Pass a syntactically valid placeholder instead.
const ONE_SIG_SPEC = new Client({
    contractId: '',
    rpcUrl: 'http://localhost',
    networkPassphrase: '',
    allowHttp: true,
}).spec;
const callInput = ONE_SIG_SPEC.getFunc('encode_leaf')
    .inputs()
    .find((input: xdr.ScSpecFunctionInputV0) => input.name().toString() === 'call');
if (!callInput) throw new Error('Could not find call parameter in encode_leaf function');
const CALL_TYPE = callInput.type();

/**
 * Stellar contract call data structure
 *
 * Arguments are provided as pre-encoded ScVal[] matching the contract function's parameter types.
 * The entire Call struct (to, func, args) is encoded using nativeToScVal for XDR encoding.
 *
 * A OneSig merkle leaf authorizes exactly ONE self-call on the OneSig contract.
 * A leaf's `calls` hold either that one self-call (e.g. `set_seed`, or an
 * `execute_transaction` built by `createExecuteTransactionCall`), or one or more
 * external calls. When the leaf is encoded, external calls are wrapped into a single
 * `execute_transaction` self-call on the leaf's OneSig (see `toOneSigSelfCall`), so
 * both forms of the same batch hash to the same leaf.
 */
export interface StellarCall {
    contractAddress: string; // Soroban contract address (C...)
    functionName: string; // Function name to call
    args: xdr.ScVal[]; // Function arguments as ScVal[] matching contract parameters
    subInvocations?: InvokerContractAuthEntry[];
}

export type StellarLeafData = BaseLeafData<string, StellarCall>;

const isSameContract = (a: string, b: string) =>
    Address.fromString(a).toString() === Address.fromString(b).toString();

export const toOneSigSelfCall = (oneSigAddress: string, calls: StellarCall[]): StellarCall => {
    if (calls.length === 0) {
        throw new Error('Stellar leaf must have at least one call');
    }

    calls.forEach((call, callIndex) => {
        assertContractTarget(call.contractAddress, `calls[${callIndex}].contractAddress`);
        call.subInvocations?.forEach((entry, entryIndex) =>
            assertInvokerContractAuthEntry(
                entry,
                `calls[${callIndex}].subInvocations[${entryIndex}]`,
            ),
        );
    });

    if (!calls.some((call) => isSameContract(call.contractAddress, oneSigAddress))) {
        return createExecuteTransactionCall(
            oneSigAddress,
            calls.map((call) => ({
                to: call.contractAddress,
                func: call.functionName,
                args: call.args,
                sub_invocations: call.subInvocations ?? [],
            })),
        );
    }

    if (calls.length !== 1) {
        throw new Error('A Stellar OneSig self-call must be the only call in its leaf');
    }
    if (calls[0].subInvocations?.length) {
        throw new Error('A Stellar OneSig self-call cannot carry subInvocations');
    }
    if (calls[0].functionName === 'execute_transaction') {
        assertExecuteTransactionArgs(calls[0].args, 'calls[0].args');
    }
    return calls[0];
};

/** Generates Stellar leaf data for OneSig Merkle tree */
export function stellarLeafGenerator(
    leafs: StellarLeafData[],
): GenerateLeafsResult<StellarLeafData> {
    return {
        leafs: leafs.map((leaf) => ({
            ...leaf,
            calls: [toOneSigSelfCall(leaf.targetOneSigAddress, leaf.calls)],
        })),

        /** Encode OneSig contract address (C...) to 32-byte buffer */
        encodeAddress(address: string): Buffer {
            try {
                return StrKey.decodeContract(address);
            } catch {
                throw new Error(`Invalid OneSig contract address: ${address}. Expected: C...`);
            }
        },

        /**
         * Encode a leaf's single self-call to XDR buffer using Call encoding.
         *
         * `leafs` already hold one self-call each (e.g. `set_seed`, `execute_transaction`):
         * external calls were wrapped into one `execute_transaction` on the leaf's OneSig.
         */
        encodeCalls(calls: StellarCall[]): Buffer {
            if (calls.length !== 1) {
                throw new Error(
                    `A Stellar leaf encodes exactly one OneSig self-call, got ${calls.length}`,
                );
            }

            const call = calls[0];
            const callObject = {
                to: Address.fromString(call.contractAddress),
                func: call.functionName,
                args: call.args,
                sub_invocations: [],
            };

            return ONE_SIG_SPEC.nativeToScVal(callObject, CALL_TYPE).toXDR();
        },
    };
}
