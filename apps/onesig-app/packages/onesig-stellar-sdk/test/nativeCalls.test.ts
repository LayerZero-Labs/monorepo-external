import { Address, Keypair, xdr } from '@stellar/stellar-sdk';
import { describe, expect, test } from 'vitest';

import { encodeLeaf } from '@layerzerolabs/onesig-core';

import {
    createExecuteTransactionCall,
    createSetSeedCall,
    STELLAR_NATIVE_CALLS_TEST_VECTOR,
    type StellarCall,
    type StellarLeafData,
    stellarLeafGenerator,
    toOneSigSelfCall,
} from '../src/index';

const vector = STELLAR_NATIVE_CALLS_TEST_VECTOR;
const oneSigAddress = vector.nativeLeaf.targetOneSigAddress;

const toStellarCall = (call: {
    contractAddress: string;
    functionName: string;
    args: readonly string[];
    subInvocations?: readonly string[];
}): StellarCall => ({
    contractAddress: call.contractAddress,
    functionName: call.functionName,
    args: call.args.map((arg) => xdr.ScVal.fromXDR(arg, 'base64')),
    subInvocations: call.subInvocations?.map((entry) => xdr.ScVal.fromXDR(entry, 'base64')),
});

const nativeCalls = vector.nativeLeaf.calls.map(toStellarCall);
const wrappedCall = toStellarCall(vector.wrappedLeaf.calls[0]);
const subInvocation = nativeCalls[1].subInvocations![0];

const rebuiltWrappedCall = createExecuteTransactionCall(
    oneSigAddress,
    nativeCalls.map((call) => ({
        to: call.contractAddress,
        func: call.functionName,
        args: call.args,
        sub_invocations: call.subInvocations ?? [],
    })),
);

const leafWith = (calls: StellarCall[]): StellarLeafData => ({
    nonce: BigInt(vector.nativeLeaf.nonce),
    oneSigId: BigInt(vector.nativeLeaf.oneSigId),
    targetOneSigAddress: oneSigAddress,
    calls,
});

const leafHash = (calls: StellarCall[]) => encodeLeaf(stellarLeafGenerator([leafWith(calls)]), 0);

const scMap = (fields: Record<string, xdr.ScVal>) =>
    xdr.ScVal.scvMap(
        Object.entries(fields).map(
            ([key, val]) => new xdr.ScMapEntry({ key: xdr.ScVal.scvSymbol(key), val }),
        ),
    );

const withSubInvocation = (entry: xdr.ScVal): StellarCall => ({
    ...nativeCalls[1],
    subInvocations: [entry],
});

describe('native calls in a Stellar leaf', () => {
    test('hash the same as the execute_transaction self-call that wraps them', () => {
        expect(leafHash(nativeCalls)).toBe(leafHash([wrappedCall]));
        expect(rebuiltWrappedCall.args.map((arg) => arg.toXDR('base64'))).toEqual(
            vector.wrappedLeaf.calls[0].args,
        );
    });

    test('match the shared test vector', () => {
        expect(leafHash(nativeCalls)).toBe(vector.expectedLeafHash);
    });

    test('a single external call is wrapped too', () => {
        const selfCall = toOneSigSelfCall(oneSigAddress, [nativeCalls[0]]);
        expect(selfCall.contractAddress).toBe(oneSigAddress);
        expect(selfCall.functionName).toBe('execute_transaction');
        expect(selfCall.args[0].vec()).toHaveLength(1);
    });

    test('a lone self-call passes through unchanged', () => {
        const setSeed = createSetSeedCall(Buffer.alloc(32, 9), oneSigAddress);
        expect(toOneSigSelfCall(oneSigAddress, [setSeed])).toBe(setSeed);
        expect(toOneSigSelfCall(oneSigAddress, [wrappedCall])).toBe(wrappedCall);
    });

    test('the generator exposes each leaf as its single self-call', () => {
        const [leaf] = stellarLeafGenerator([leafWith(nativeCalls)]).leafs;
        expect(leaf.calls).toHaveLength(1);
        expect(leaf.calls[0].functionName).toBe('execute_transaction');
    });

    test('a self-call mixed with other calls is rejected', () => {
        const setSeed = createSetSeedCall(Buffer.alloc(32, 9), oneSigAddress);
        expect(() => leafHash([setSeed, nativeCalls[0]])).toThrow(
            'A Stellar OneSig self-call must be the only call in its leaf',
        );
    });

    test('a self-call with subInvocations is rejected', () => {
        const setSeed = createSetSeedCall(Buffer.alloc(32, 9), oneSigAddress);
        expect(() =>
            toOneSigSelfCall(oneSigAddress, [{ ...setSeed, subInvocations: [subInvocation] }]),
        ).toThrow('A Stellar OneSig self-call cannot carry subInvocations');
    });

    test('an empty leaf is rejected', () => {
        expect(() => leafHash([])).toThrow('Stellar leaf must have at least one call');
    });

    test('a subInvocation that is not an InvokerContractAuthEntry is rejected', () => {
        expect(() => leafHash([withSubInvocation(xdr.ScVal.scvSymbol('pre_authorized'))])).toThrow(
            'Invalid Stellar subInvocation at calls[0].subInvocations[0]: expected a vec',
        );
    });

    test('a subInvocation with an unknown variant is rejected', () => {
        expect(() =>
            leafHash([
                withSubInvocation(xdr.ScVal.scvVec([xdr.ScVal.scvSymbol('Transfer'), scMap({})])),
            ]),
        ).toThrow('unknown InvokerContractAuthEntry variant Transfer');
    });

    test('a subInvocation context with a missing field is rejected', () => {
        const [tag, body] = subInvocation.vec()!;
        const [context, subInvocations] = body.map()!;
        const brokenContext = scMap({
            args: context.val().map()![0].val(),
            fn_name: context.val().map()![2].val(),
        });
        expect(() =>
            leafHash([
                withSubInvocation(
                    xdr.ScVal.scvVec([
                        tag,
                        scMap({ context: brokenContext, sub_invocations: subInvocations.val() }),
                    ]),
                ),
            ]),
        ).toThrow('expected fields [args, contract, fn_name], got [args, fn_name]');
    });

    test('a nested subInvocation is checked too', () => {
        const [tag, body] = subInvocation.vec()!;
        const [context] = body.map()!;
        const nested = xdr.ScVal.scvVec([
            tag,
            scMap({
                context: context.val(),
                sub_invocations: xdr.ScVal.scvVec([xdr.ScVal.scvU32(1)]),
            }),
        ]);
        expect(() => leafHash([withSubInvocation(nested)])).toThrow(
            'calls[0].subInvocations[0].sub_invocations[0]: expected a vec',
        );
    });

    test('a create-contract subInvocation is accepted', () => {
        const executable = xdr.ScVal.scvVec([
            xdr.ScVal.scvSymbol('Wasm'),
            xdr.ScVal.scvBytes(Buffer.alloc(32, 5)),
        ]);
        const salt = xdr.ScVal.scvBytes(Buffer.alloc(32, 6));
        const create = xdr.ScVal.scvVec([
            xdr.ScVal.scvSymbol('CreateContractWithCtorHostFn'),
            scMap({ constructor_args: xdr.ScVal.scvVec([]), executable, salt }),
        ]);
        expect(() => leafHash([withSubInvocation(create)])).not.toThrow();
    });

    test('a pre-wrapped execute_transaction with a bad inner sub_invocation is rejected', () => {
        const wrapped = createExecuteTransactionCall(oneSigAddress, [
            {
                to: nativeCalls[1].contractAddress,
                func: nativeCalls[1].functionName,
                args: nativeCalls[1].args,
                sub_invocations: [xdr.ScVal.scvSymbol('pre_authorized')],
            },
        ]);
        expect(() => leafHash([wrapped])).toThrow(
            'Invalid Stellar subInvocation at calls[0].args[0][0].sub_invocations[0]: expected a vec',
        );
    });

    test('a subInvocation whose context.contract is not a contract is rejected', () => {
        const [tag, body] = subInvocation.vec()!;
        const [context, subInvocations] = body.map()!;
        const [args, , fnName] = context.val().map()!;
        const withContract = (contract: xdr.ScVal) =>
            withSubInvocation(
                xdr.ScVal.scvVec([
                    tag,
                    scMap({
                        context: scMap({ args: args.val(), contract, fn_name: fnName.val() }),
                        sub_invocations: subInvocations.val(),
                    }),
                ]),
            );
        const account = new Address(Keypair.random().publicKey()).toScVal();
        expect(() => leafHash([withContract(account)])).toThrow(
            'expected a contract address, got scAddressTypeAccount',
        );
    });

    test('native and pre-wrapped forms of the same batch both reject an account target', () => {
        const account = Keypair.random().publicKey();
        const native: StellarCall = { ...nativeCalls[0], contractAddress: account };
        const wrapped = createExecuteTransactionCall(oneSigAddress, [
            { to: account, func: native.functionName, args: native.args, sub_invocations: [] },
        ]);
        expect(() => leafHash([native])).toThrow(
            'Invalid Stellar subInvocation at calls[0].contractAddress: expected a contract address, got scAddressTypeAccount',
        );
        expect(() => leafHash([wrapped])).toThrow(
            'Invalid Stellar subInvocation at calls[0].args[0][0].to: expected a contract address, got scAddressTypeAccount',
        );
    });
});
