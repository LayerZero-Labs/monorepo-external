/**
 * Unit tests for onesig-stellar leaf generation
 */

import { Keypair, xdr } from '@stellar/stellar-sdk';
import { describe, expect, test } from 'vitest';

import { createExecuteTransactionCall, StellarLeafData, stellarLeafGenerator } from '../src/index';
import { createTestCall, generateTestContractAddress } from './helpers';

describe('onesig-stellar', () => {
    const oneSigAddress = generateTestContractAddress();
    const oneSigId = 40161n; // Stellar chain ID

    describe('Address Encoding', () => {
        test('should encode C... contract address to 32 bytes', () => {
            const generator = stellarLeafGenerator([]);
            const encoded = generator.encodeAddress(oneSigAddress);

            expect(encoded).toBeInstanceOf(Buffer);
            expect(encoded.length).toBe(32);
        });

        test('should produce different encodings for different addresses', () => {
            const address1 = generateTestContractAddress();
            const address2 = generateTestContractAddress();

            const generator = stellarLeafGenerator([]);
            const encoded1 = generator.encodeAddress(address1);
            const encoded2 = generator.encodeAddress(address2);

            expect(encoded1.equals(encoded2)).toBe(false);
        });

        test('should throw error for invalid addresses', () => {
            const generator = stellarLeafGenerator([]);

            expect(() => generator.encodeAddress('INVALID')).toThrow(
                'Invalid OneSig contract address',
            );
        });

        test('should throw error for G... account addresses', () => {
            const generator = stellarLeafGenerator([]);
            const gAddress = Keypair.random().publicKey(); // G... address

            expect(() => generator.encodeAddress(gAddress)).toThrow(
                'Invalid OneSig contract address',
            );
        });
    });

    describe('Leaf Generation', () => {
        test('should generate valid leaf data structure', () => {
            // Create a minimal leaf with empty calls (will be validated when contracts are implemented)
            const leaf: StellarLeafData = {
                nonce: 0n,
                oneSigId,
                targetOneSigAddress: oneSigAddress,
                calls: [],
            };

            const generator = stellarLeafGenerator([leaf]);

            expect(generator.leafs).toHaveLength(1);
            expect(generator.leafs[0].nonce).toBe(0n);
            expect(generator.leafs[0].oneSigId).toBe(oneSigId);
            expect(generator.leafs[0].targetOneSigAddress).toBe(oneSigAddress);
            expect(generator.leafs[0].calls).toHaveLength(0);
        });

        test('should generate multiple leaves', () => {
            const leaves: StellarLeafData[] = [
                {
                    nonce: 0n,
                    oneSigId,
                    targetOneSigAddress: oneSigAddress,
                    calls: [],
                },
                {
                    nonce: 1n,
                    oneSigId,
                    targetOneSigAddress: oneSigAddress,
                    calls: [],
                },
            ];

            const generator = stellarLeafGenerator(leaves);

            expect(generator.leafs).toHaveLength(2);
            expect(generator.leafs[0].nonce).toBe(0n);
            expect(generator.leafs[1].nonce).toBe(1n);
        });
    });

    describe('Call Encoding', () => {
        test('should encode single call into Call struct buffer', () => {
            const call = createTestCall(generateTestContractAddress(), 'set_executor', [
                xdr.ScVal.scvBool(true),
            ]);
            const generator = stellarLeafGenerator([]);

            const encoded = generator.encodeCalls([call]);

            expect(Buffer.isBuffer(encoded)).toBe(true);
            const decoded = xdr.ScVal.fromXDR(encoded);
            expect(decoded.switch()).toBe(xdr.ScValType.scvMap());

            const callStruct = decoded.map();
            expect(callStruct).toBeDefined();

            const funcEntry = callStruct?.find((entry) => entry.key().sym()?.toString() === 'func');
            expect(funcEntry?.val().sym()?.toString()).toBe('set_executor');

            const argsEntry = callStruct?.find((entry) => entry.key().sym()?.toString() === 'args');
            expect(argsEntry?.val().vec()?.length).toBe(1);

            const subInvocationsEntry = callStruct?.find(
                (entry) => entry.key().sym()?.toString() === 'sub_invocations',
            );
            expect(subInvocationsEntry).toBeDefined();
            expect(subInvocationsEntry?.val().vec()?.length).toBe(0);
        });

        test('should throw when encoding empty call list', () => {
            const generator = stellarLeafGenerator([]);
            expect(() => generator.encodeCalls([])).toThrow(
                'Stellar leaf must have exactly one self-call',
            );
        });

        test('should throw when encoding multiple calls', () => {
            const generator = stellarLeafGenerator([]);
            const call1 = createTestCall(generateTestContractAddress(), 'set_seed');
            const call2 = createTestCall(generateTestContractAddress(), 'set_threshold');
            expect(() => generator.encodeCalls([call1, call2])).toThrow(
                'Stellar leaf must have exactly one self-call',
            );
        });
    });

    describe('Multicall wrapping (execute_transaction)', () => {
        test('should wrap multiple external calls into a single execute_transaction self-call', () => {
            const tokenA = generateTestContractAddress();
            const tokenB = generateTestContractAddress();
            const inner1 = {
                to: tokenA,
                func: 'transfer',
                args: [xdr.ScVal.scvU32(1)],
                sub_invocations: [],
            };
            const inner2 = {
                to: tokenB,
                func: 'transfer',
                args: [xdr.ScVal.scvU32(2)],
                sub_invocations: [],
            };

            const wrapper = createExecuteTransactionCall(oneSigAddress, [inner1, inner2]);

            // The wrapper is a single self-call targeting the OneSig contract.
            expect(wrapper.contractAddress).toBe(oneSigAddress);
            expect(wrapper.functionName).toBe('execute_transaction');
            expect(wrapper.args).toHaveLength(1);

            // It encodes through the normal single-call path without throwing.
            const generator = stellarLeafGenerator([]);
            const encoded = generator.encodeCalls([wrapper]);
            expect(Buffer.isBuffer(encoded)).toBe(true);

            // The encoded leaf is a Call map whose func is execute_transaction and
            // whose single arg is the Vec<Call> of the two inner calls.
            const decoded = xdr.ScVal.fromXDR(encoded);
            const callStruct = decoded.map();
            const funcEntry = callStruct?.find((e) => e.key().sym()?.toString() === 'func');
            expect(funcEntry?.val().sym()?.toString()).toBe('execute_transaction');

            const argsEntry = callStruct?.find((e) => e.key().sym()?.toString() === 'args');
            const innerCallsVec = argsEntry?.val().vec()?.[0].vec();
            expect(innerCallsVec).toHaveLength(2);
        });
    });

    describe('Determinism', () => {
        test('should generate consistent leaf generators for same input', () => {
            const leaves: StellarLeafData[] = [
                {
                    nonce: 0n,
                    oneSigId,
                    targetOneSigAddress: oneSigAddress,
                    calls: [],
                },
            ];

            const gen1 = stellarLeafGenerator(leaves);
            const gen2 = stellarLeafGenerator(leaves);

            // Verify generators produce same leaf data
            expect(gen1.leafs).toHaveLength(gen2.leafs.length);
            expect(gen1.leafs[0].nonce).toBe(gen2.leafs[0].nonce);
            expect(gen1.leafs[0].oneSigId).toBe(gen2.leafs[0].oneSigId);
            expect(gen1.leafs[0].targetOneSigAddress).toBe(gen2.leafs[0].targetOneSigAddress);
        });
    });
});
