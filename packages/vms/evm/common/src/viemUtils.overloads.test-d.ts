/* eslint-disable @typescript-eslint/no-unused-vars */
import type { ReadContractParameters } from 'viem';
import { zeroAddress } from 'viem';
import { describe, expect, expectTypeOf, it } from 'vitest';

import { sentinelNativeFromLabel } from '@layerzerolabs/chain-utils';
import { ChainName } from '@layerzerolabs/layerzero-definitions';

import type {
    EvmPopulatedTransaction,
    EvmTransactionOverrides,
    EvmTransactionPayableOverrides,
} from './transaction';
import type {
    EnhancedContract,
    OPopulateTransactionAbiToMethod,
    OPopulateTransactionResolveCollectedAbiOverloads,
    OReadAbiToMethod,
    OReadResolveCollectedAbiOverloads,
} from './viemUtils';

const singleFunctionAbi = [
    {
        type: 'function',
        inputs: [{ name: 'x', internalType: 'uint256', type: 'uint256' }],
        name: 'singleFunc',
        outputs: [
            { name: 'test', internalType: 'uint256', type: 'uint256' },
            { name: 'test2', internalType: 'uint256', type: 'uint256' },
        ],
        stateMutability: 'view',
    },
] as const;

const unnamedArgsAbi = [
    {
        type: 'function',
        inputs: [],
        name: 'unnamedArgs',
        outputs: [{ name: '', internalType: 'uint256', type: 'uint256' }],
        stateMutability: 'view',
    },
    {
        type: 'function',
        inputs: [{ name: 'x', internalType: 'uint256', type: 'uint256' }],
        name: 'unnamedArgs',
        outputs: [{ name: '', internalType: 'uint256', type: 'uint256' }],
        stateMutability: 'view',
    },
] as const;

const myOverloadTest1Abi = [
    {
        type: 'function',
        inputs: [
            { name: '', internalType: 'uint256', type: 'uint256' },
            { name: '', internalType: 'address', type: 'address' },
        ],
        name: 'myOverloadTest1',
        outputs: [{ name: '', internalType: 'address', type: 'address' }],
        stateMutability: 'view',
    },
    {
        type: 'function',
        inputs: [
            { name: '', internalType: 'address', type: 'address' },
            { name: '', internalType: 'uint256', type: 'uint256' },
        ],
        name: 'myOverloadTest1',
        outputs: [{ name: '', internalType: 'address', type: 'address' }],
        stateMutability: 'view',
    },
] as const;

const myOverloadTest2Abi = [
    {
        type: 'function',
        inputs: [
            { name: 'addr2', internalType: 'uint256', type: 'uint256' },
            { name: 'addr', internalType: 'address', type: 'address' },
        ],
        name: 'myOverloadTest2',
        outputs: [{ name: '', internalType: 'address', type: 'address' }],
        stateMutability: 'view',
    },
    {
        type: 'function',
        inputs: [
            { name: 'addr', internalType: 'address', type: 'address' },
            { name: 'addr2', internalType: 'uint256', type: 'uint256' },
        ],
        name: 'myOverloadTest2',
        outputs: [{ name: '', internalType: 'address', type: 'address' }],
        stateMutability: 'view',
    },
] as const;

// Write function ABIs for testing OPopulateTransactionResolveCollectedAbiOverloads
const singleWriteAbi = [
    {
        type: 'function',
        inputs: [
            { name: 'to', internalType: 'address', type: 'address' },
            { name: 'amount', internalType: 'uint256', type: 'uint256' },
        ],
        name: 'transfer',
        outputs: [{ name: '', internalType: 'bool', type: 'bool' }],
        stateMutability: 'nonpayable',
    },
] as const;

const overloadedWriteAbi = [
    {
        type: 'function',
        inputs: [
            { name: 'spender', internalType: 'address', type: 'address' },
            { name: 'amount', internalType: 'uint256', type: 'uint256' },
        ],
        name: 'approve',
        outputs: [{ name: '', internalType: 'bool', type: 'bool' }],
        stateMutability: 'nonpayable',
    },
    {
        type: 'function',
        inputs: [{ name: 'spender', internalType: 'address', type: 'address' }],
        name: 'approve',
        outputs: [{ name: '', internalType: 'bool', type: 'bool' }],
        stateMutability: 'nonpayable',
    },
] as const;

const payableWriteAbi = [
    {
        type: 'function',
        inputs: [],
        name: 'deposit',
        outputs: [],
        stateMutability: 'payable',
    },
    {
        type: 'function',
        inputs: [{ name: 'recipient', internalType: 'address', type: 'address' }],
        name: 'deposit',
        outputs: [],
        stateMutability: 'payable',
    },
] as const;

const unnamedWriteArgsAbi = [
    {
        type: 'function',
        inputs: [
            { name: '', internalType: 'uint256', type: 'uint256' },
            { name: '', internalType: 'address', type: 'address' },
        ],
        name: 'myWrite',
        outputs: [],
        stateMutability: 'nonpayable',
    },
    {
        type: 'function',
        inputs: [
            { name: '', internalType: 'address', type: 'address' },
            { name: '', internalType: 'uint256', type: 'uint256' },
        ],
        name: 'myWrite',
        outputs: [],
        stateMutability: 'nonpayable',
    },
] as const;

const overloadedWithExtendedTypes = [
    {
        inputs: [
            {
                components: [
                    {
                        internalType: 'uint256',
                        name: 'id',
                        type: 'uint256',
                    },
                    {
                        internalType: 'string',
                        name: 'name',
                        type: 'string',
                    },
                    {
                        internalType: 'address',
                        name: 'wallet',
                        type: 'address',
                    },
                ],
                internalType: 'struct Contract.MyStruct',
                name: '_myStruct',
                type: 'tuple',
            },
        ],
        name: 'structs',
        outputs: [{ name: '', internalType: 'address', type: 'address' }],
        stateMutability: 'view',
        type: 'function',
    },
    {
        inputs: [
            {
                components: [
                    {
                        name: 'id',
                        type: 'uint256',
                    },
                    {
                        name: 'name',
                        type: 'string',
                    },
                ],
                name: '_myStruct',
                type: 'tuple',
            },
        ],
        name: 'structs',
        outputs: [{ name: '', internalType: 'address', type: 'address' }],
        stateMutability: 'view',
        type: 'function',
    },
    {
        inputs: [
            {
                components: [
                    {
                        internalType: 'uint256',
                        name: 'id',
                        type: 'uint256',
                    },
                    {
                        components: [
                            {
                                internalType: 'uint256',
                                name: 'id',
                                type: 'uint256',
                            },
                        ],
                        internalType: 'struct Contract.MyDoubleStructInner',
                        name: 'innerStruct',
                        type: 'tuple',
                    },
                ],
                internalType: 'struct Contract.MyDoubleStruct',
                name: '_myStruct',
                type: 'tuple',
            },
        ],
        name: 'innerStructs',
        outputs: [{ name: '', internalType: 'address', type: 'address' }],
        stateMutability: 'view',
        type: 'function',
    },
    {
        inputs: [
            {
                components: [
                    {
                        name: 'id',
                        type: 'uint256',
                    },
                    {
                        name: 'id2',
                        type: 'uint256',
                    },
                    {
                        components: [
                            {
                                name: 'id',
                                type: 'uint256',
                            },
                        ],
                        name: 'innerStruct',
                        type: 'tuple',
                    },
                ],
                name: '_myStruct',
                type: 'tuple',
            },
        ],
        name: 'innerStructs',
        outputs: [{ name: '', internalType: 'address', type: 'address' }],
        stateMutability: 'view',
        type: 'function',
    },
    {
        inputs: [
            {
                internalType: 'enum Contract.Status',
                name: 'status',
                type: 'uint8',
            },
        ],
        name: 'enumStatus',
        outputs: [{ name: '', internalType: 'address', type: 'address' }],
        stateMutability: 'view',
        type: 'function',
    },
    {
        inputs: [
            {
                internalType: 'enum Contract.Status[]',
                name: 'statuses',
                type: 'uint8[]',
            },
        ],
        name: 'enumStatus',
        outputs: [{ name: '', internalType: 'address', type: 'address' }],
        stateMutability: 'view',
        type: 'function',
    },
    {
        inputs: [
            {
                components: [
                    {
                        components: [
                            {
                                internalType: 'address',
                                name: 'id',
                                type: 'address',
                            },
                        ],
                        internalType: 'struct Contract.ComplexStructInner[]',
                        name: 'relatedStructs',
                        type: 'tuple[]',
                    },
                ],
                internalType: 'struct Contract.ComplexStruct[]',
                name: '_complexStructs',
                type: 'tuple[]',
            },
        ],
        name: 'complexStructure',
        outputs: [{ name: '', internalType: 'address', type: 'address' }],
        stateMutability: 'view',
        type: 'function',
    },
    {
        inputs: [
            {
                components: [
                    {
                        components: [
                            {
                                name: 'id',
                                type: 'uint256',
                            },
                        ],
                        name: 'relatedStructs',
                        type: 'tuple[]',
                    },
                ],
                name: '_complexStructs',
                type: 'tuple[]',
            },
        ],
        name: 'complexStructure',
        outputs: [{ name: '', internalType: 'address', type: 'address' }],
        stateMutability: 'view',
        type: 'function',
    },
    {
        inputs: [
            {
                components: [
                    {
                        components: [
                            {
                                internalType: 'address',
                                name: 'id',
                                type: 'address',
                            },
                        ],
                        internalType: 'struct Contract.ComplexStructInner[]',
                        name: 'relatedStructs',
                        type: 'tuple[]',
                    },
                ],
                internalType: 'struct Contract.ComplexStruct[][]',
                name: '_complexStructs',
                type: 'tuple[][]',
            },
        ],
        name: 'complexStructure',
        outputs: [{ name: '', internalType: 'address', type: 'address' }],
        stateMutability: 'view',
        type: 'function',
    },
    {
        inputs: [
            {
                components: [
                    {
                        internalType: 'uint256',
                        name: 'id',
                        type: 'uint256',
                    },
                    {
                        internalType: 'address',
                        name: 'wallet',
                        type: 'address',
                    },
                ],
                name: '_myStruct',
                type: 'tuple[][]',
            },
        ],
        name: 'complexStructure',
        outputs: [{ name: '', internalType: 'address', type: 'address' }],
        stateMutability: 'view',
        type: 'function',
    },
    {
        inputs: [
            {
                internalType: 'uint256[]',
                name: '_messages',
                type: 'uint256[]',
            },
        ],
        name: 'arrays',
        outputs: [{ name: '', internalType: 'address', type: 'address' }],
        stateMutability: 'view',
        type: 'function',
    },
    {
        inputs: [
            {
                internalType: 'string[3]',
                name: '_messages',
                type: 'string[3]',
            },
        ],
        name: 'arrays',
        outputs: [{ name: '', internalType: 'address', type: 'address' }],
        stateMutability: 'view',
        type: 'function',
    },
    {
        inputs: [
            {
                name: '_messages',
                type: 'string[][3]',
            },
        ],
        name: 'arrays',
        outputs: [{ name: '', internalType: 'address', type: 'address' }],
        stateMutability: 'view',
        type: 'function',
    },
    {
        inputs: [],
        name: 'arrays',
        outputs: [{ name: '', internalType: 'address', type: 'address' }],
        stateMutability: 'view',
        type: 'function',
    },
] as const;

const testAbi = [
    // Adding errors here just to make sure they are not included in the resolved functions
    {
        inputs: [
            {
                internalType: 'address',
                name: 'sender',
                type: 'address',
            },
            {
                internalType: 'uint256',
                name: 'balance',
                type: 'uint256',
            },
            {
                internalType: 'uint256',
                name: 'needed',
                type: 'uint256',
            },
        ],
        name: 'ERC20InsufficientBalance',
        type: 'error',
    },
    {
        inputs: [
            {
                internalType: 'address',
                name: 'approver',
                type: 'address',
            },
        ],
        name: 'ERC20InvalidApprover',
        type: 'error',
    },
    {
        inputs: [],
        name: 'SEND_AND_CALL',
        outputs: [
            {
                internalType: 'uint16',
                name: '',
                type: 'uint16',
            },
        ],
        stateMutability: 'view',
        type: 'function',
    },
    ...singleFunctionAbi,
    ...unnamedArgsAbi,
    ...myOverloadTest2Abi,
    ...myOverloadTest1Abi,
    ...singleWriteAbi,
    ...overloadedWriteAbi,
    ...payableWriteAbi,
    ...unnamedWriteArgsAbi,
    ...overloadedWithExtendedTypes,
] as const;

type ReadResolvedFunctions = OReadResolveCollectedAbiOverloads<typeof testAbi>;
type OPopulateTransactionResolvedFunctions = OPopulateTransactionResolveCollectedAbiOverloads<
    typeof testAbi
>;

describe('viemUtils - Overloaded Function Types', () => {
    describe('OReadResolveCollectedAbiOverloads', () => {
        it('should create correct type structure for overloaded functions', () => {
            expectTypeOf<ReadResolvedFunctions['myOverloadTest1']>().toMatchObjectType<{
                '(uint256, address)': OReadAbiToMethod<(typeof myOverloadTest1Abi)[0]>;
                '(address, uint256)': OReadAbiToMethod<(typeof myOverloadTest1Abi)[1]>;
            }>();

            expectTypeOf<ReadResolvedFunctions['myOverloadTest2']>().toMatchObjectType<{
                '(uint256, address)': OReadAbiToMethod<(typeof myOverloadTest2Abi)[0]>;
                '(address, uint256)': OReadAbiToMethod<(typeof myOverloadTest2Abi)[0]>; // Types match here, so either or is the same
            }>();
        });

        it('should have correct parameter types for overloaded functions', () => {
            expectTypeOf<
                Parameters<ReadResolvedFunctions['myOverloadTest2']['(uint256, address)']>[0]
            >().toMatchObjectType<{
                addr2: bigint;
                addr: `0x${string}`;
            }>();

            expectTypeOf<
                Parameters<ReadResolvedFunctions['myOverloadTest2']['(address, uint256)']>[0]
            >().toMatchObjectType<{
                addr: `0x${string}`;
                addr2: bigint;
            }>();
        });

        it('should handle overloaded functions with structs correctly', () => {
            expectTypeOf<ReadResolvedFunctions['structs']>().toMatchObjectType<{
                '(struct Contract.MyStruct)': OReadAbiToMethod<
                    (typeof overloadedWithExtendedTypes)[0]
                >;
                '((uint256, string))': OReadAbiToMethod<(typeof overloadedWithExtendedTypes)[1]>;
            }>();

            expectTypeOf<ReadResolvedFunctions['innerStructs']>().toMatchObjectType<{
                '(struct Contract.MyDoubleStruct)': OReadAbiToMethod<
                    (typeof overloadedWithExtendedTypes)[2]
                >;
                '((uint256, uint256, (uint256)))': OReadAbiToMethod<
                    (typeof overloadedWithExtendedTypes)[3]
                >;
            }>();

            expectTypeOf<ReadResolvedFunctions['enumStatus']>().toMatchObjectType<{
                '(enum Contract.Status)': OReadAbiToMethod<(typeof overloadedWithExtendedTypes)[4]>;
                '(enum Contract.Status[])': OReadAbiToMethod<
                    (typeof overloadedWithExtendedTypes)[5]
                >;
            }>();

            expectTypeOf<ReadResolvedFunctions['complexStructure']>().toMatchObjectType<{
                '(struct Contract.ComplexStruct[])': OReadAbiToMethod<
                    (typeof overloadedWithExtendedTypes)[6]
                >;
                '(((uint256)[])[])': OReadAbiToMethod<(typeof overloadedWithExtendedTypes)[7]>;
                '(struct Contract.ComplexStruct[][])': OReadAbiToMethod<
                    (typeof overloadedWithExtendedTypes)[8]
                >;
                '((uint256, address)[][])': OReadAbiToMethod<
                    (typeof overloadedWithExtendedTypes)[9]
                >;
            }>();

            expectTypeOf<ReadResolvedFunctions['arrays']>().toMatchObjectType<{
                '(uint256[])': OReadAbiToMethod<(typeof overloadedWithExtendedTypes)[10]>;
                '(string[3])': OReadAbiToMethod<(typeof overloadedWithExtendedTypes)[11]>;
                '(string[][3])': OReadAbiToMethod<(typeof overloadedWithExtendedTypes)[12]>;
                '()': OReadAbiToMethod<(typeof overloadedWithExtendedTypes)[13]>;
            }>();
        });

        it('should have correct parameter types for unnamed parameters', () => {
            expectTypeOf<
                Parameters<ReadResolvedFunctions['myOverloadTest1']['(uint256, address)']>[0]
            >().toMatchObjectType<{
                '0_inputs': bigint;
                '1_inputs': `0x${string}`;
            }>();

            expectTypeOf<
                Parameters<ReadResolvedFunctions['myOverloadTest1']['(address, uint256)']>[0]
            >().toMatchObjectType<{
                '0_inputs': `0x${string}`;
                '1_inputs': bigint;
            }>();
        });

        it('should have correct return types', () => {
            expectTypeOf<
                Awaited<ReturnType<ReadResolvedFunctions['myOverloadTest2']['(uint256, address)']>>
            >().toEqualTypeOf<`0x${string}`>();

            expectTypeOf<Awaited<ReturnType<ReadResolvedFunctions['singleFunc']>>>().toEqualTypeOf<{
                test: bigint;
                test2: bigint;
            }>();
        });

        it('should handle non-overloaded functions correctly', () => {
            expectTypeOf<ReadResolvedFunctions['SEND_AND_CALL']>().parameters.toEqualTypeOf<
                [
                    parameters?: Omit<
                        ReadContractParameters,
                        'abi' | 'address' | 'args' | 'functionName'
                    >,
                ]
            >();

            expectTypeOf<ReadResolvedFunctions['SEND_AND_CALL']>().returns.toEqualTypeOf<
                Promise<number>
            >();
        });

        it('should correctly distinguish between different overload signatures', () => {
            expectTypeOf<
                Parameters<ReadResolvedFunctions['myOverloadTest2']['(uint256, address)']>[0]
            >().toMatchObjectType<{
                addr2: bigint;
                addr: `0x${string}`;
            }>();

            expectTypeOf<
                Parameters<ReadResolvedFunctions['myOverloadTest2']['(address, uint256)']>[0]
            >().toMatchObjectType<{
                addr: `0x${string}`;
                addr2: bigint;
            }>();
        });
    });

    describe('Type safety tests', () => {
        it('should enforce correct parameter types for overloads', () => {
            // This should type-check correctly
            type ValidCall = Parameters<
                ReadResolvedFunctions['myOverloadTest2']['(uint256, address)']
            >;

            const validArgs: ValidCall[0] = {
                addr2: 1n,
                addr: zeroAddress,
            };

            expect(validArgs).toBeDefined();
            expect(validArgs.addr2).toBe(1n);
            expect(validArgs.addr).toBe(zeroAddress);
        });
    });

    describe('Edge cases', () => {
        it('should handle functions with no inputs (default key)', () => {
            expectTypeOf<ReadResolvedFunctions['unnamedArgs']>().toMatchObjectType<{
                '()': OReadAbiToMethod<(typeof unnamedArgsAbi)[0]>;
                '(uint256)': OReadAbiToMethod<(typeof unnamedArgsAbi)[1]>;
            }>();

            expectTypeOf<
                Exclude<Parameters<ReadResolvedFunctions['unnamedArgs']['()']>[0], undefined>
            >().toEqualTypeOf<
                Omit<ReadContractParameters, 'abi' | 'address' | 'args' | 'functionName'>
            >();
        });

        it('should handle single overload (no overload object needed)', () => {
            expectTypeOf<ReadResolvedFunctions['singleFunc']>().toEqualTypeOf<
                OReadAbiToMethod<(typeof singleFunctionAbi)[0]>
            >();
        });
    });

    describe('OPopulateTransactionResolveCollectedAbiOverloads', () => {
        it('should create correct type structure for overloaded write functions', () => {
            type ApproveFunc = OPopulateTransactionResolvedFunctions['approve'];
            type DepositFunc = OPopulateTransactionResolvedFunctions['deposit'];
            type MyWriteFunc = OPopulateTransactionResolvedFunctions['myWrite'];

            expectTypeOf<ApproveFunc>().toMatchObjectType<{
                '(address, uint256)': OPopulateTransactionAbiToMethod<
                    (typeof overloadedWriteAbi)[0]
                >;
                '(address)': OPopulateTransactionAbiToMethod<(typeof overloadedWriteAbi)[1]>;
            }>();

            expectTypeOf<DepositFunc>().toMatchObjectType<{
                '()': OPopulateTransactionAbiToMethod<(typeof payableWriteAbi)[0]>;
                '(address)': OPopulateTransactionAbiToMethod<(typeof payableWriteAbi)[1]>;
            }>();

            expectTypeOf<MyWriteFunc>().toMatchObjectType<{
                '(uint256, address)': OPopulateTransactionAbiToMethod<
                    (typeof unnamedWriteArgsAbi)[0]
                >;
                '(address, uint256)': OPopulateTransactionAbiToMethod<
                    (typeof unnamedWriteArgsAbi)[1]
                >;
            }>();
        });

        it('should have correct parameter types for nonpayable functions', () => {
            type ApproveWithAmount =
                OPopulateTransactionResolvedFunctions['approve']['(address, uint256)'];

            expectTypeOf<ApproveWithAmount>().toBeFunction();
            expectTypeOf<Parameters<ApproveWithAmount>[0]>().toMatchObjectType<{
                spender: `0x${string}`;
                amount: bigint;
            }>();

            type ApproveWithoutAmount =
                OPopulateTransactionResolvedFunctions['approve']['(address)'];

            expectTypeOf<ApproveWithoutAmount>().toBeFunction();
            expectTypeOf<Parameters<ApproveWithoutAmount>[0]>().toMatchObjectType<{
                spender: `0x${string}`;
            }>();
        });

        it('should have correct parameter types for payable functions', () => {
            type DepositDefault = OPopulateTransactionResolvedFunctions['deposit']['()'];
            expectTypeOf<
                Exclude<Parameters<DepositDefault>[0], undefined>
            >().toEqualTypeOf<EvmTransactionPayableOverrides>();

            type DepositWithRecipient =
                OPopulateTransactionResolvedFunctions['deposit']['(address)'];
            expectTypeOf<Parameters<DepositWithRecipient>[0]>().toEqualTypeOf<{
                recipient: `0x${string}`;
            }>();
        });

        it('should have correct parameter types for unnamed parameters', () => {
            expectTypeOf<
                Parameters<
                    OPopulateTransactionResolvedFunctions['myWrite']['(uint256, address)']
                >[0]
            >().toEqualTypeOf<{
                '0_inputs': bigint;
                '1_inputs': `0x${string}`;
            }>();

            expectTypeOf<
                Parameters<
                    OPopulateTransactionResolvedFunctions['myWrite']['(address, uint256)']
                >[0]
            >().toEqualTypeOf<{
                '0_inputs': `0x${string}`;
                '1_inputs': bigint;
            }>();
        });

        it('should have correct return types for populate transaction functions', () => {
            expectTypeOf<OPopulateTransactionResolvedFunctions['transfer']>().returns.toEqualTypeOf<
                Promise<EvmPopulatedTransaction>
            >();

            expectTypeOf<
                OPopulateTransactionResolvedFunctions['approve']['(address, uint256)']
            >().returns.toEqualTypeOf<Promise<EvmPopulatedTransaction>>();
        });

        it('should handle non-overloaded write functions correctly', () => {
            expectTypeOf<
                Parameters<OPopulateTransactionResolvedFunctions['transfer']>[0]
            >().toEqualTypeOf<{
                to: `0x${string}`;
                amount: bigint;
            }>();
        });

        it('should correctly distinguish between nonpayable and payable overloads', () => {
            expectTypeOf<
                Parameters<
                    OPopulateTransactionResolvedFunctions['approve']['(address, uint256)']
                >[1]
            >().toEqualTypeOf<EvmTransactionOverrides | undefined>();

            expectTypeOf<
                Parameters<OPopulateTransactionResolvedFunctions['deposit']['(address)']>[1]
            >().toEqualTypeOf<EvmTransactionPayableOverrides | undefined>();
        });

        it('should handle functions with no inputs using default key', () => {
            expectTypeOf<
                Parameters<OPopulateTransactionResolvedFunctions['deposit']['()']>[0]
            >().toEqualTypeOf<EvmTransactionPayableOverrides | undefined>();
        });

        it('should verify type safety for write function parameters', () => {
            type TransferCall = Parameters<OPopulateTransactionResolvedFunctions['transfer']>;
            const spender = sentinelNativeFromLabel(ChainName.ETHEREUM, '11');
            const validTransferArgs: TransferCall[0] = {
                to: zeroAddress,
                amount: 100n,
            };

            expect(validTransferArgs).toBeDefined();
            expect(validTransferArgs.to).toBe(zeroAddress);
            expect(validTransferArgs.amount).toBe(100n);

            type ApproveCall = Parameters<
                OPopulateTransactionResolvedFunctions['approve']['(address)']
            >;

            const validApproveArgs: ApproveCall[0] = {
                spender,
            };

            expect(validApproveArgs).toBeDefined();
            expect(validApproveArgs.spender).toBe(spender);
        });
    });

    describe('EnhancedContract populateTransaction', () => {
        it('should not require args parameter for functions with no inputs', () => {
            const noInputWriteAbi = [
                {
                    type: 'function',
                    inputs: [],
                    name: 'noInputFunction',
                    outputs: [],
                    stateMutability: 'nonpayable',
                },
            ] as const;

            type Contract = EnhancedContract<typeof noInputWriteAbi>;

            expectTypeOf<
                Contract['populateTransaction']['noInputFunction']
            >().parameters.toEqualTypeOf<[overrides?: EvmTransactionOverrides | undefined]>();
        });

        it('should require args parameter for functions with inputs', () => {
            const withInputWriteAbi = [
                {
                    type: 'function',
                    inputs: [
                        { name: 'to', internalType: 'address', type: 'address' },
                        { name: 'amount', internalType: 'uint256', type: 'uint256' },
                    ],
                    name: 'transfer',
                    outputs: [{ name: '', internalType: 'bool', type: 'bool' }],
                    stateMutability: 'nonpayable',
                },
            ] as const;

            type Contract = EnhancedContract<typeof withInputWriteAbi>;

            expectTypeOf<
                Parameters<Contract['populateTransaction']['transfer']>[0]
            >().toEqualTypeOf<readonly [`0x${string}`, bigint]>();

            expectTypeOf<
                Parameters<Contract['oPopulateTransaction']['transfer']>[0]
            >().toEqualTypeOf<{ to: `0x${string}`; amount: bigint }>();
        });

        it('should handle payable functions with no inputs', () => {
            const payableNoInputAbi = [
                {
                    type: 'function',
                    inputs: [],
                    name: 'receiveEther',
                    outputs: [],
                    stateMutability: 'payable',
                },
            ] as const;

            type Contract = EnhancedContract<typeof payableNoInputAbi>;

            expectTypeOf<
                Parameters<Contract['populateTransaction']['receiveEther']>[0]
            >().toEqualTypeOf<EvmTransactionOverrides | undefined>();
        });

        it('should handle payable functions with inputs', () => {
            const payableWithInputAbi = [
                {
                    type: 'function',
                    inputs: [{ name: 'recipient', internalType: 'address', type: 'address' }],
                    name: 'sendTo',
                    outputs: [],
                    stateMutability: 'payable',
                },
            ] as const;

            type Contract = EnhancedContract<typeof payableWithInputAbi>;
            type SendToFunc = Contract['populateTransaction']['sendTo'];

            expectTypeOf<SendToFunc>().toBeCallableWith(['0x0' as `0x${string}`]);
            expectTypeOf<Parameters<SendToFunc>[0]>().toEqualTypeOf<readonly [`0x${string}`]>();
        });
    });
});
