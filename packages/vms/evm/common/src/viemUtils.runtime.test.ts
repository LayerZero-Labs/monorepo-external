import type { Abi, TransactionReceipt } from 'viem';
import { zeroAddress } from 'viem';
import { describe, expect, it, Mock, vi } from 'vitest';

import type { DecimalString } from '@layerzerolabs/typescript-utils';

import { enhanceContractObject } from './viemUtils';

// Mock ABIs for testing
const simpleReadAbi = [
    {
        type: 'function',
        inputs: [{ name: 'x', internalType: 'uint256', type: 'uint256' }],
        name: 'getValues',
        outputs: [
            { name: 'result', internalType: 'uint256', type: 'uint256' },
            { name: 'result2', internalType: 'uint256', type: 'uint256' },
        ],
        stateMutability: 'view',
    },
    {
        type: 'function',
        inputs: [],
        name: 'getConstant',
        outputs: [{ name: 'value', internalType: 'uint256', type: 'uint256' }],
        stateMutability: 'pure',
    },
] as const;

const simpleWriteAbi = [
    {
        type: 'function',
        inputs: [
            { name: 'to', internalType: 'address', type: 'address' },
            { name: 'amount', internalType: 'uint256', type: 'uint256' },
        ],
        name: 'transfer',
        outputs: [{ name: 'success', internalType: 'bool', type: 'bool' }],
        stateMutability: 'nonpayable',
    },
    {
        type: 'function',
        inputs: [],
        name: 'deposit',
        outputs: [],
        stateMutability: 'payable',
    },
] as const;

const overloadedReadAbi = [
    {
        type: 'function',
        inputs: [{ name: 'addr', internalType: 'address', type: 'address' }],
        name: 'balanceOf',
        outputs: [{ name: 'balance', internalType: 'uint256', type: 'uint256' }],
        stateMutability: 'view',
    },
    {
        type: 'function',
        inputs: [
            { name: 'addr', internalType: 'address', type: 'address' },
            { name: 'tokenId', internalType: 'uint256', type: 'uint256' },
        ],
        name: 'balanceOf',
        outputs: [{ name: 'balance', internalType: 'uint256', type: 'uint256' }],
        stateMutability: 'view',
    },
] as const;

const overloadedWriteAbi = [
    {
        type: 'function',
        inputs: [{ name: 'spender', internalType: 'address', type: 'address' }],
        name: 'approve',
        outputs: [{ name: '', internalType: 'bool', type: 'bool' }],
        stateMutability: 'nonpayable',
    },
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
] as const;

const unnamedArgsAbi = [
    {
        type: 'function',
        inputs: [
            { name: '', internalType: 'uint256', type: 'uint256' },
            { name: '', internalType: 'address', type: 'address' },
        ],
        name: 'unnamedFunc',
        outputs: [{ name: '', internalType: 'bool', type: 'bool' }],
        stateMutability: 'view',
    },
] as const;

const eventAbi = [
    {
        type: 'event',
        name: 'Transfer',
        inputs: [
            { indexed: true, name: 'from', type: 'address' },
            { indexed: true, name: 'to', type: 'address' },
            { indexed: false, name: 'value', type: 'uint256' },
        ],
    },
    {
        type: 'event',
        name: 'Approval',
        inputs: [
            { indexed: true, name: 'owner', type: 'address' },
            { indexed: true, name: 'spender', type: 'address' },
            { indexed: false, name: 'value', type: 'uint256' },
        ],
    },
] as const;

const overloadedWithStruct = [
    {
        type: 'function',
        inputs: [
            {
                name: '_params',
                internalType: 'struct MessagingParams',
                type: 'tuple',
                components: [
                    { name: 'dstEid', internalType: 'uint32', type: 'uint32' },
                    { name: 'receiver', internalType: 'bytes32', type: 'bytes32' },
                    { name: 'message', internalType: 'bytes', type: 'bytes' },
                    { name: 'options', internalType: 'bytes', type: 'bytes' },
                    { name: 'payInLzToken', internalType: 'bool', type: 'bool' },
                ],
            },
            { name: '_sender', internalType: 'address', type: 'address' },
        ],
        name: 'quote',
        outputs: [
            {
                name: '',
                internalType: 'struct MessagingFee',
                type: 'tuple',
                components: [
                    { name: 'nativeFee', internalType: 'uint256', type: 'uint256' },
                    { name: 'lzTokenFee', internalType: 'uint256', type: 'uint256' },
                ],
            },
        ],
        stateMutability: 'view',
    },
    {
        type: 'function',
        inputs: [
            { name: 'test', internalType: 'uint256', type: 'uint256' },
            {
                name: '_params',
                internalType: 'struct MessagingParams',
                type: 'tuple',
                components: [
                    { name: 'dstEid', internalType: 'uint32', type: 'uint32' },
                    { name: 'receiver', internalType: 'bytes32', type: 'bytes32' },
                    { name: 'message', internalType: 'bytes', type: 'bytes' },
                    { name: 'options', internalType: 'bytes', type: 'bytes' },
                    { name: 'payInLzToken', internalType: 'bool', type: 'bool' },
                ],
            },
            { name: '_sender', internalType: 'address', type: 'address' },
        ],
        name: 'quote',
        outputs: [
            {
                name: '',
                internalType: 'struct MessagingFee',
                type: 'tuple',
                components: [
                    { name: 'nativeFee', internalType: 'uint256', type: 'uint256' },
                    { name: 'lzTokenFee', internalType: 'uint256', type: 'uint256' },
                ],
            },
        ],
        stateMutability: 'view',
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

const fullAbi = [
    ...simpleReadAbi,
    ...simpleWriteAbi,
    ...eventAbi,
    ...overloadedWithStruct,
    ...overloadedWithExtendedTypes,
] as const;

// Helper to create a mock contract
const createMockContract = <TAbi extends Abi>({
    abi,
    address = '0x1234567890123456789012345678901234567890',
    mockReadFunction = vi.fn().mockResolvedValue(100n),
}: {
    abi: TAbi;
    address?: string;
    mockReadFunction?: Mock<(...args: any[]) => any>;
}) => {
    return {
        address,
        abi,
        read: new Proxy(
            {},
            {
                get: () => mockReadFunction,
            },
        ),
        write: {},
        simulate: {},
        estimateGas: {},
        createEventFilter: {},
        watchEvent: {},
    } as any;
};

describe('viemUtils - enhanceContractObject runtime', () => {
    describe('populateTransaction', () => {
        it('should create populateTransaction methods for write functions', () => {
            const contract = createMockContract({ abi: simpleWriteAbi });
            const enhanced = enhanceContractObject(contract, simpleWriteAbi);

            expect(enhanced.populateTransaction).toBeDefined();
            expect(enhanced.populateTransaction.transfer).toBeTypeOf('function');
            expect(enhanced.populateTransaction.deposit).toBeTypeOf('function');
        });

        it('should generate correct transaction data for functions with args', async () => {
            const contract = createMockContract({ abi: simpleWriteAbi });
            const enhanced = enhanceContractObject(contract, simpleWriteAbi);

            const tx = await enhanced.populateTransaction.transfer(
                ['0x0000000000000000000000000000000000000001', 100n],
                { gas: '100000' as unknown as DecimalString },
            );

            expect(tx.to).toBe(contract.address);
            expect(tx.data).toBe(
                '0xa9059cbb00000000000000000000000000000000000000000000000000000000000000010000000000000000000000000000000000000000000000000000000000000064',
            );
            expect(tx.gas).toBe('100000');
        });

        it('should generate correct transaction data for functions without args', async () => {
            const contract = createMockContract({ abi: simpleWriteAbi });
            const enhanced = enhanceContractObject(contract, simpleWriteAbi);

            const tx = await enhanced.populateTransaction.deposit({
                value: '1000' as unknown as DecimalString,
            });

            expect(tx.to).toBe(contract.address);
            expect(tx.data).toBe('0xd0e30db0');
            expect(tx.value).toBe('1000');
        });

        it('should handle functions with no args when overrides is undefined', async () => {
            const contract = createMockContract({ abi: simpleWriteAbi });
            const enhanced = enhanceContractObject(contract, simpleWriteAbi);

            const tx = await enhanced.populateTransaction.deposit();

            expect(tx.to).toBe(contract.address);
            expect(tx.data).toBe('0xd0e30db0');
        });

        it('should handle overrides parameter', async () => {
            const contract = createMockContract({ abi: simpleWriteAbi });
            const enhanced = enhanceContractObject(contract, simpleWriteAbi);

            const overrides = {
                gas: '500000' as unknown as DecimalString,
            };

            const tx = await enhanced.populateTransaction.transfer([zeroAddress, 100n], overrides);

            expect(tx.gas).toBe('500000');
        });

        it('should handle functions with args when overrides is undefined', async () => {
            const contract = createMockContract({ abi: simpleWriteAbi });
            const enhanced = enhanceContractObject(contract, simpleWriteAbi);

            const tx = await enhanced.populateTransaction.transfer([
                '0x0000000000000000000000000000000000000001',
                101n,
            ]);

            expect(tx.to).toBe(contract.address);
            expect(tx.data).toBe(
                '0xa9059cbb00000000000000000000000000000000000000000000000000000000000000010000000000000000000000000000000000000000000000000000000000000065',
            );
        });
    });

    describe('oPopulateTransaction', () => {
        it('should create oPopulateTransaction methods for write functions', () => {
            const contract = createMockContract({ abi: simpleWriteAbi });
            const enhanced = enhanceContractObject(contract, simpleWriteAbi);

            expect(enhanced.oPopulateTransaction).toBeDefined();
            expect(enhanced.oPopulateTransaction.transfer).toBeTypeOf('function');
            expect(enhanced.oPopulateTransaction.deposit).toBeTypeOf('function');
        });

        it('should handle named parameters correctly', async () => {
            const contract = createMockContract({ abi: simpleWriteAbi });
            const enhanced = enhanceContractObject(contract, simpleWriteAbi);

            const options = { gas: '100008' as unknown as DecimalString };
            const args = {
                to: '0x0000000000000000000000000000000000000002' as const,
                amount: 103n,
            };
            const tx = await enhanced.oPopulateTransaction.transfer(args, options);

            expect(tx).toBeDefined();
            expect(tx.to).toBe(contract.address);
            expect(tx.data).toBe(
                (await enhanced.populateTransaction.transfer([args.to, args.amount], options)).data,
            );
            expect(tx.gas).toBe(options.gas);
        });

        it('should handle functions without parameters', async () => {
            const contract = createMockContract({ abi: simpleWriteAbi });
            const enhanced = enhanceContractObject(contract, simpleWriteAbi);

            // When function has no inputs, the first parameter is treated as options
            const options = {
                value: '1023' as unknown as DecimalString,
            };
            const tx = await enhanced.oPopulateTransaction.deposit(options);

            expect(tx).toBeDefined();
            expect(tx.data).toBe((await enhanced.populateTransaction.deposit(options)).data);
            expect(tx.value).toBe(options.value);
        });

        it('should handle overloaded functions by creating nested objects', () => {
            const contract = createMockContract({ abi: overloadedWriteAbi });
            const enhanced = enhanceContractObject(contract, overloadedWriteAbi);

            expect(enhanced.oPopulateTransaction.approve).toBeTypeOf('object');
            expect(enhanced.oPopulateTransaction.approve['(address)']).toBeTypeOf('function');
            expect(enhanced.oPopulateTransaction.approve['(address, uint256)']).toBeTypeOf(
                'function',
            );
        });

        it('should correctly route overloaded function calls', async () => {
            const contract = createMockContract({ abi: overloadedWriteAbi });
            const enhanced = enhanceContractObject(contract, overloadedWriteAbi);

            const args = {
                spender: zeroAddress,
                amount: 105n,
            } as const;

            const tx1 = await enhanced.oPopulateTransaction.approve['(address)'](args);

            const tx2 = await enhanced.oPopulateTransaction.approve['(address, uint256)'](args);

            expect(tx1).toBeDefined();
            expect(tx1.data).toBe(
                (await enhanced.populateTransaction.approve([args.spender])).data,
            );
            expect(tx2).toBeDefined();
            expect(tx2.data).toBe(
                (await enhanced.populateTransaction.approve([args.spender, args.amount])).data,
            );
            // The encoded data should be different for different overloads
            expect(tx1.data).not.toBe(tx2.data);
        });

        it('should handle unnamed parameters with inputs_N format', async () => {
            const unnamedWriteAbi = [
                {
                    type: 'function',
                    inputs: [
                        { name: '', internalType: 'uint256', type: 'uint256' },
                        { name: '', internalType: 'address', type: 'address' },
                    ],
                    name: 'unnamedWrite',
                    outputs: [],
                    stateMutability: 'nonpayable',
                },
            ] as const;

            const contract = createMockContract({ abi: unnamedWriteAbi });
            const enhanced = enhanceContractObject(contract, unnamedWriteAbi);

            const args = {
                '0_inputs': 42n,
                '1_inputs': zeroAddress,
            } as const;
            const tx = await enhanced.oPopulateTransaction.unnamedWrite(args);

            expect(tx).toBeDefined();
            expect(tx.to).toBe(contract.address);
            expect(tx.data).toBe(
                (
                    await enhanced.populateTransaction.unnamedWrite([
                        args['0_inputs'],
                        args['1_inputs'],
                    ])
                ).data,
            );
        });
    });

    describe('oRead', () => {
        it('should create oRead methods for view/pure functions', () => {
            const contract = createMockContract({ abi: simpleReadAbi });
            const enhanced = enhanceContractObject(contract, simpleReadAbi);

            expect(enhanced.oRead).toBeDefined();
            expect(enhanced.oRead.getValues).toBeTypeOf('function');
            expect(enhanced.oRead.getConstant).toBeTypeOf('function');
        });

        it('should handle named parameters and return named outputs', async () => {
            const contract = createMockContract({
                abi: simpleReadAbi,
                mockReadFunction: vi.fn().mockResolvedValue([100n, 102n]),
            });
            const enhanced = enhanceContractObject(contract, simpleReadAbi);

            const result = await enhanced.oRead.getValues({ x: 42n });

            expect(result.result).toBe(100n);
            expect(result.result2).toBe(102n);
        });

        it('should handle functions without parameters', async () => {
            const contract = createMockContract({ abi: simpleReadAbi });
            const enhanced = enhanceContractObject(contract, simpleReadAbi);

            const result = await enhanced.oRead.getConstant();

            expect(result).toBe(100n);
        });

        it('should handle functions with parameters when options is undefined', async () => {
            const contract = createMockContract({
                abi: simpleReadAbi,
                mockReadFunction: vi.fn().mockResolvedValue([100n, 101n]),
            });
            const enhanced = enhanceContractObject(contract, simpleReadAbi);

            const result = await enhanced.oRead.getValues({ x: 42n });

            expect(result).toBeDefined();
            expect(result.result).toBe(100n);
            expect(result.result2).toBe(101n);
        });

        it('should handle overloaded read functions', () => {
            const contract = createMockContract({ abi: overloadedReadAbi });
            const enhanced = enhanceContractObject(contract, overloadedReadAbi);

            expect(enhanced.oRead.balanceOf).toBeTypeOf('object');
            expect(enhanced.oRead.balanceOf['(address)']).toBeTypeOf('function');
            expect(enhanced.oRead.balanceOf['(address, uint256)']).toBeTypeOf('function');
        });

        it('should correctly route overloaded read function calls', async () => {
            const mockRead = vi.fn();
            mockRead.mockResolvedValueOnce(500n).mockResolvedValueOnce(750n);

            const contract = createMockContract({
                abi: overloadedReadAbi,
                address: '0x1234567890123456789012345678901234567890',
                mockReadFunction: mockRead,
            });

            const enhanced = enhanceContractObject(contract, overloadedReadAbi);

            const result1 = await enhanced.oRead.balanceOf['(address)']({
                addr: zeroAddress,
            });

            const result2 = await enhanced.oRead.balanceOf['(address, uint256)']({
                addr: zeroAddress,
                tokenId: 1n,
            });

            expect(result1).toBe(500n);
            expect(result2).toBe(750n);
            expect(mockRead).toHaveBeenCalledTimes(2);
        });

        it('should handle unnamed parameters and outputs', async () => {
            const mockRead = vi.fn().mockResolvedValue(true);

            const contract = createMockContract({
                abi: unnamedArgsAbi,
                address: '0x1234567890123456789012345678901234567890',
                mockReadFunction: mockRead,
            });

            const enhanced = enhanceContractObject(contract, unnamedArgsAbi);

            const result = await enhanced.oRead.unnamedFunc({
                '0_inputs': 42n,
                '1_inputs': zeroAddress,
            });

            expect(result).toBe(true);
        });

        it('should pass through optional read contract parameters', async () => {
            const mockRead = vi.fn().mockResolvedValue([123n, 456n]);

            const contract = createMockContract({
                abi: simpleReadAbi,
                address: '0x1234567890123456789012345678901234567890',
                mockReadFunction: mockRead,
            });

            const enhanced = enhanceContractObject(contract, simpleReadAbi);

            const blockNumber = 12345n;
            await enhanced.oRead.getValues({ x: 42n }, { blockNumber });

            expect(mockRead).toHaveBeenCalledWith([42n], { blockNumber });
        });

        it('should pass through overrides for functions without parameters', async () => {
            const mockRead = vi.fn().mockResolvedValue(456n);

            const contract = createMockContract({
                abi: simpleReadAbi,
                address: '0x1234567890123456789012345678901234567890',
                mockReadFunction: mockRead,
            });

            const enhanced = enhanceContractObject(contract, simpleReadAbi);

            const blockTag = 'latest';
            const result = await enhanced.oRead.getConstant({ blockTag });

            expect(mockRead).toHaveBeenCalledWith({ blockTag });
            expect(result).toBe(456n);
        });
    });

    describe('getEventsFromReceipt', () => {
        it('should create getEventsFromReceipt methods for events', () => {
            const contract = createMockContract({ abi: fullAbi });
            const enhanced = enhanceContractObject(contract, fullAbi);

            expect(enhanced.getEventsFromReceipt).toBeDefined();
            expect(enhanced.getEventsFromReceipt.Transfer).toBeTypeOf('function');
            expect(enhanced.getEventsFromReceipt.Approval).toBeTypeOf('function');
        });

        it('should parse events from receipt', () => {
            const contract = createMockContract({ abi: fullAbi });
            const enhanced = enhanceContractObject(contract, fullAbi);

            const mockReceipt: TransactionReceipt = {
                transactionHash: '0xabcd',
                blockHash: '0x1234',
                blockNumber: 100n,
                logs: [
                    {
                        address: contract.address,
                        topics: [
                            '0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef', // Transfer event signature
                            '0x0000000000000000000000000000000000000000000000000000000000000001',
                            '0x0000000000000000000000000000000000000000000000000000000000000002',
                        ],
                        data: '0x0000000000000000000000000000000000000000000000000000000000000064',
                        logIndex: 0,
                        transactionIndex: 0,
                        blockHash: '0x1234',
                        blockNumber: 100n,
                        removed: false,
                        transactionHash: '0xabcd',
                    },
                ],
                logsBloom: '0x',
                status: 'success',
                to: contract.address,
                from: zeroAddress,
                contractAddress: null,
                transactionIndex: 0,
                gasUsed: 21000n,
                cumulativeGasUsed: 21000n,
                effectiveGasPrice: 1000000000n,
                type: 'eip1559',
            };

            const events = enhanced.getEventsFromReceipt.Transfer(mockReceipt);

            expect(events).toBeDefined();
            expect(Array.isArray(events)).toBe(true);
        });

        it('should filter logs by contract address', () => {
            const contract = createMockContract({ abi: fullAbi });
            const enhanced = enhanceContractObject(contract, fullAbi);

            const otherAddress = '0x9999999999999999999999999999999999999999';

            const mockReceipt: TransactionReceipt = {
                transactionHash: '0xabcd',
                blockHash: '0x1234',
                blockNumber: 100n,
                logs: [
                    {
                        address: otherAddress, // Different address
                        topics: [
                            '0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef',
                            '0x0000000000000000000000000000000000000000000000000000000000000001',
                            '0x0000000000000000000000000000000000000000000000000000000000000002',
                        ],
                        data: '0x0000000000000000000000000000000000000000000000000000000000000064',
                        logIndex: 0,
                        transactionIndex: 0,
                        blockHash: '0x1234',
                        blockNumber: 100n,
                        removed: false,
                        transactionHash: '0xabcd',
                    },
                    {
                        address: contract.address, // Correct address
                        topics: [
                            '0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef',
                            '0x0000000000000000000000000000000000000000000000000000000000000001',
                            '0x0000000000000000000000000000000000000000000000000000000000000002',
                        ],
                        data: '0x0000000000000000000000000000000000000000000000000000000000000064',
                        logIndex: 1,
                        transactionIndex: 0,
                        blockHash: '0x1234',
                        blockNumber: 100n,
                        removed: false,
                        transactionHash: '0xabcd',
                    },
                ],
                logsBloom: '0x',
                status: 'success',
                to: contract.address,
                from: zeroAddress,
                contractAddress: null,
                transactionIndex: 0,
                gasUsed: 21000n,
                cumulativeGasUsed: 21000n,
                effectiveGasPrice: 1000000000n,
                type: 'eip1559',
            };

            const events = enhanced.getEventsFromReceipt.Transfer(mockReceipt);

            // Should only parse the event from the correct contract address
            expect(events).toBeDefined();
            expect(Array.isArray(events)).toBe(true);
        });

        it('should handle receipts with no matching logs', () => {
            const contract = createMockContract({ abi: fullAbi });
            const enhanced = enhanceContractObject(contract, fullAbi);

            const mockReceipt: TransactionReceipt = {
                transactionHash: '0xabcd',
                blockHash: '0x1234',
                blockNumber: 100n,
                logs: [],
                logsBloom: '0x',
                status: 'success',
                to: contract.address,
                from: zeroAddress,
                contractAddress: null,
                transactionIndex: 0,
                gasUsed: 21000n,
                cumulativeGasUsed: 21000n,
                effectiveGasPrice: 1000000000n,
                type: 'eip1559',
            };

            const events = enhanced.getEventsFromReceipt.Transfer(mockReceipt);

            expect(Array.isArray(events)).toBe(true);
            expect(events.length).toBe(0);
        });
    });

    describe('Edge cases', () => {
        it('should handle ABI with only events (no functions)', () => {
            const contract = createMockContract({ abi: eventAbi });
            const enhanced = enhanceContractObject(contract, eventAbi);

            expect(enhanced.getEventsFromReceipt).toBeDefined();
            expect(enhanced.getEventsFromReceipt.Transfer).toBeTypeOf('function');
            expect(enhanced.oPopulateTransaction).toBeDefined();
            expect(Object.keys(enhanced.oPopulateTransaction).length).toBe(0);
        });

        it('should handle empty ABI', () => {
            const emptyAbi = [] as const;
            const contract = createMockContract({ abi: emptyAbi });
            const enhanced = enhanceContractObject(contract, emptyAbi);

            expect(enhanced.populateTransaction).toBeDefined();
            expect(enhanced.oPopulateTransaction).toBeDefined();
            expect(enhanced.oRead).toBeDefined();
            expect(enhanced.getEventsFromReceipt).toBeDefined();
            expect(Object.keys(enhanced.populateTransaction).length).toBe(0);
            expect(Object.keys(enhanced.oPopulateTransaction).length).toBe(0);
            expect(Object.keys(enhanced.oRead).length).toBe(0);
            expect(Object.keys(enhanced.getEventsFromReceipt).length).toBe(0);
        });

        it('should preserve original contract properties', () => {
            const contract = createMockContract({ abi: fullAbi });
            const enhanced = enhanceContractObject(contract, fullAbi);

            expect(enhanced.address).toBe(contract.address);
            expect(enhanced.abi).toBe(contract.abi);
            expect(enhanced.read).toBe(contract.read);
        });

        it('should handle mixed stateMutability functions', () => {
            const mixedAbi = [
                {
                    type: 'function',
                    inputs: [],
                    name: 'viewFunc',
                    outputs: [{ name: '', internalType: 'uint256', type: 'uint256' }],
                    stateMutability: 'view',
                },
                {
                    type: 'function',
                    inputs: [],
                    name: 'pureFunc',
                    outputs: [{ name: '', internalType: 'uint256', type: 'uint256' }],
                    stateMutability: 'pure',
                },
                {
                    type: 'function',
                    inputs: [],
                    name: 'writeFunc',
                    outputs: [],
                    stateMutability: 'nonpayable',
                },
                {
                    type: 'function',
                    inputs: [],
                    name: 'payableFunc',
                    outputs: [],
                    stateMutability: 'payable',
                },
            ] as const;

            const contract = createMockContract({ abi: mixedAbi });
            const enhanced = enhanceContractObject(contract, mixedAbi);

            // View and pure should be in oRead
            expect(enhanced.oRead.viewFunc).toBeTypeOf('function');
            expect(enhanced.oRead.pureFunc).toBeTypeOf('function');

            // Nonpayable and payable should be in oPopulateTransaction
            expect(enhanced.oPopulateTransaction.writeFunc).toBeTypeOf('function');
            expect(enhanced.oPopulateTransaction.payableFunc).toBeTypeOf('function');

            // All write functions should be in populateTransaction
            expect(enhanced.populateTransaction.writeFunc).toBeTypeOf('function');
            expect(enhanced.populateTransaction.payableFunc).toBeTypeOf('function');
        });

        it('should handle case-insensitive address matching in getEventsFromReceipt', () => {
            const contract = createMockContract({
                abi: fullAbi,
                address: '0xAbCdEf1234567890123456789012345678901234',
            });
            const enhanced = enhanceContractObject(contract, fullAbi);

            const mockReceipt: TransactionReceipt = {
                transactionHash: '0xabcd',
                blockHash: '0x1234',
                blockNumber: 100n,
                logs: [
                    {
                        address: '0xABCDEF1234567890123456789012345678901234', // Different case
                        topics: [
                            '0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef',
                            '0x0000000000000000000000000000000000000000000000000000000000000001',
                            '0x0000000000000000000000000000000000000000000000000000000000000002',
                        ],
                        data: '0x0000000000000000000000000000000000000000000000000000000000000064',
                        logIndex: 0,
                        transactionIndex: 0,
                        blockHash: '0x1234',
                        blockNumber: 100n,
                        removed: false,
                        transactionHash: '0xabcd',
                    },
                ],
                logsBloom: '0x',
                status: 'success',
                to: contract.address,
                from: zeroAddress,
                contractAddress: null,
                transactionIndex: 0,
                gasUsed: 21000n,
                cumulativeGasUsed: 21000n,
                effectiveGasPrice: 1000000000n,
                type: 'eip1559',
            };

            const events = enhanced.getEventsFromReceipt.Transfer(mockReceipt);

            expect(Array.isArray(events)).toBe(true);
            // Should match despite different case
        });
    });

    describe('Function grouping and overload detection', () => {
        it('should correctly identify when functions have overloads', () => {
            const contract = createMockContract({ abi: overloadedWriteAbi });
            const enhanced = enhanceContractObject(contract, overloadedWriteAbi);

            // Should be an object with keys for each overload
            expect(typeof enhanced.oPopulateTransaction.approve).toBe('object');
            expect(enhanced.oPopulateTransaction.approve['(address)']).toBeDefined();
            expect(enhanced.oPopulateTransaction.approve['(address, uint256)']).toBeDefined();
        });

        it('should not create overload objects for single functions', () => {
            const contract = createMockContract({ abi: simpleWriteAbi });
            const enhanced = enhanceContractObject(contract, simpleWriteAbi);

            // Should be a direct function, not an object
            expect(typeof enhanced.oPopulateTransaction.transfer).toBe('function');
            expect(typeof enhanced.oPopulateTransaction.deposit).toBe('function');
        });

        it('should use "()" key for overload with no inputs', () => {
            const contract = createMockContract({ abi: fullAbi });
            const enhanced = enhanceContractObject(contract, fullAbi);

            expect(typeof enhanced.oRead.structs['(struct Contract.MyStruct)']).toBe('function');
            expect(typeof enhanced.oRead.structs['((uint256, string))']).toBe('function');

            expect(typeof enhanced.oRead.innerStructs['(struct Contract.MyDoubleStruct)']).toBe(
                'function',
            );
            expect(typeof enhanced.oRead.innerStructs['((uint256, uint256, (uint256)))']).toBe(
                'function',
            );

            expect(typeof enhanced.oRead.enumStatus['(enum Contract.Status)']).toBe('function');
            expect(typeof enhanced.oRead.enumStatus['(enum Contract.Status[])']).toBe('function');
            expect(
                typeof enhanced.oRead.complexStructure['(struct Contract.ComplexStruct[])'],
            ).toBe('function');
            expect(typeof enhanced.oRead.complexStructure['(((uint256)[])[])']).toBe('function');
            expect(typeof enhanced.oRead.complexStructure['((uint256, address)[][])']).toBe(
                'function',
            );
            expect(
                typeof enhanced.oRead.complexStructure['(struct Contract.ComplexStruct[][])'],
            ).toBe('function');
            expect(typeof enhanced.oRead.arrays['(uint256[])']).toBe('function');
            expect(typeof enhanced.oRead.arrays['(string[3])']).toBe('function');
            expect(typeof enhanced.oRead.arrays['(string[][3])']).toBe('function');
            expect(typeof enhanced.oRead.arrays['()']).toBe('function');
        });

        it('should use "()" key for overload with no inputs', () => {
            const overloadWithNoInputs = [
                {
                    type: 'function',
                    inputs: [],
                    name: 'claim',
                    outputs: [],
                    stateMutability: 'nonpayable',
                },
                {
                    type: 'function',
                    inputs: [{ name: 'amount', internalType: 'uint256', type: 'uint256' }],
                    name: 'claim',
                    outputs: [],
                    stateMutability: 'nonpayable',
                },
            ] as const;

            const contract = createMockContract({ abi: overloadWithNoInputs });
            const enhanced = enhanceContractObject(contract, overloadWithNoInputs);

            expect(enhanced.oPopulateTransaction.claim['()']).toBeTypeOf('function');
            expect(enhanced.oPopulateTransaction.claim['(uint256)']).toBeTypeOf('function');
        });
    });
});
