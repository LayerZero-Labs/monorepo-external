import type { xdr } from '@stellar/stellar-sdk';
import { Address, StrKey } from '@stellar/stellar-sdk';

import { type BaseLeafData, type GenerateLeafsResult } from '@layerzerolabs/onesig-core';

import { Client } from './generated/index';

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
 * A OneSig merkle leaf authorizes exactly ONE self-call on the OneSig contract
 * (see `encodeCalls`, which rejects more than one). This is not a multicall type:
 * each `StellarCall` is a single `(contract, function, args)` invocation.
 *
 * To execute multiple calls under one leaf, you do NOT pass several `StellarCall`s.
 * Instead you make a single `execute_transaction` self-call and put the batch of
 * calls *inside* its `args`: the `calls: Vec<Call>` parameter carries them, and the
 * OneSig contract dispatches each in turn. Use `createExecuteTransactionCall` to
 * build that wrapper. So multicall lives one level down — in the `args` of a single
 * `execute_transaction` call — not in the number of `StellarCall`s per leaf.
 */
export interface StellarCall {
    contractAddress: string; // Soroban contract address (C...)
    functionName: string; // Function name to call
    args: xdr.ScVal[]; // Function arguments as ScVal[] matching contract parameters
}

export type StellarLeafData = BaseLeafData<string, StellarCall>;

/** Generates Stellar leaf data for OneSig Merkle tree */
export function stellarLeafGenerator(
    leafs: StellarLeafData[],
): GenerateLeafsResult<StellarLeafData> {
    return {
        leafs,

        /** Encode OneSig contract address (C...) to 32-byte buffer */
        encodeAddress(address: string): Buffer {
            try {
                return StrKey.decodeContract(address);
            } catch {
                throw new Error(`Invalid OneSig contract address: ${address}. Expected: C...`);
            }
        },

        /**
         * Encode a single self-call to XDR buffer using Call encoding.
         *
         * Each leaf contains exactly one self-call (e.g. `set_seed`, `execute_transaction`).
         * To dispatch multiple external contract calls, use a single `execute_transaction`
         * call whose args carry the list of external calls.
         */
        encodeCalls(calls: StellarCall[]): Buffer {
            if (calls.length !== 1) {
                throw new Error(
                    'Stellar leaf must have exactly one self-call. ' +
                        'For multiple external calls, use execute_transaction whose args contain the call list.',
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
