import { encodeAbiParameters, encodeFunctionData } from 'viem';
import { describe, expect, it } from 'vitest';

import { sentinelNativeFromLabel } from '@layerzerolabs/chain-utils';
import { NonRetryableError } from '@layerzerolabs/common-error-utils';
import { ChainName } from '@layerzerolabs/layerzero-definitions';

import { deriveEvmConstructorArgs, deriveZkSyncConstructorArgs } from './encoding';

const TEST_ADDRESS_1 = sentinelNativeFromLabel(ChainName.ETHEREUM, '1234567890abcdef');
const TEST_ADDRESS_2 = sentinelNativeFromLabel(ChainName.ETHEREUM, 'abcdef');

const simpleConstructorAbi = [
    {
        type: 'constructor' as const,
        inputs: [
            { name: '_name', type: 'string' as const },
            { name: '_symbol', type: 'string' as const },
            { name: '_endpoint', type: 'address' as const },
            { name: '_delegate', type: 'address' as const },
        ],
        stateMutability: 'nonpayable' as const,
    },
] as const;

const noConstructorAbi = [
    {
        type: 'function' as const,
        name: 'foo',
        inputs: [],
        outputs: [],
        stateMutability: 'view' as const,
    },
] as const;

const numericConstructorAbi = [
    {
        type: 'constructor' as const,
        inputs: [
            { name: '_decimals', type: 'uint8' as const },
            { name: '_totalSupply', type: 'uint256' as const },
            { name: '_owner', type: 'address' as const },
        ],
        stateMutability: 'nonpayable' as const,
    },
] as const;

const fakeBytecode = '0xDEADBEEF' as const;

describe('deriveEvmConstructorArgs', () => {
    it('derives constructor args from EVM tx data', () => {
        const encodedArgs = encodeAbiParameters(simpleConstructorAbi[0].inputs, [
            'MyToken',
            'MTK',
            TEST_ADDRESS_1,
            TEST_ADDRESS_2,
        ]);
        const txData = `${fakeBytecode}${encodedArgs.slice(2)}`;

        const result = deriveEvmConstructorArgs({
            txData,
            creationBytecode: fakeBytecode,
            abi: simpleConstructorAbi,
        });

        expect(result).toBeDefined();
        expect(result!.encoded).toMatch(/^0x/);
        expect(result!.decoded._name).toBe('MyToken');
        expect(result!.decoded._symbol).toBe('MTK');
        expect((result!.decoded._endpoint as string).toLowerCase()).toBe(TEST_ADDRESS_1);
        expect((result!.decoded._delegate as string).toLowerCase()).toBe(TEST_ADDRESS_2);
    });

    it('returns undefined for contracts with no constructor', () => {
        const result = deriveEvmConstructorArgs({
            txData: fakeBytecode,
            creationBytecode: fakeBytecode,
            abi: noConstructorAbi,
        });

        expect(result).toBeUndefined();
    });

    it('returns undefined when txData is undefined', () => {
        const result = deriveEvmConstructorArgs({
            txData: undefined,
            creationBytecode: fakeBytecode,
            abi: simpleConstructorAbi,
        });

        expect(result).toBeUndefined();
    });

    it('converts BigInt values to strings in decoded map for JSON safety', () => {
        const encodedArgs = encodeAbiParameters(numericConstructorAbi[0].inputs, [
            18,
            1000000000000000000000000n,
            TEST_ADDRESS_1,
        ]);
        const txData = `${fakeBytecode}${encodedArgs.slice(2)}`;

        const result = deriveEvmConstructorArgs({
            txData,
            creationBytecode: fakeBytecode,
            abi: numericConstructorAbi,
        });

        expect(result).toBeDefined();
        expect(result!.decoded._decimals).toBe('18');
        expect(result!.decoded._totalSupply).toBe('1000000000000000000000000');
        expect(typeof result!.decoded._decimals).toBe('string');
        expect(typeof result!.decoded._totalSupply).toBe('string');
        expect(() => JSON.stringify(result)).not.toThrow();
    });

    it('throws NonRetryableError when txData does not start with creationBytecode', () => {
        expect(() =>
            deriveEvmConstructorArgs({
                txData: '0xAAAABBBB1234',
                creationBytecode: '0xDEADBEEF',
                abi: simpleConstructorAbi,
            }),
        ).toThrow(NonRetryableError);
    });
});

describe('deriveZkSyncConstructorArgs', () => {
    const zkSyncContractDeployerAbi = [
        {
            inputs: [
                { name: '_salt', type: 'bytes32' },
                { name: '_bytecodeHash', type: 'bytes32' },
                { name: '_input', type: 'bytes' },
            ],
            name: 'create',
            outputs: [{ name: '', type: 'address' }],
            stateMutability: 'payable',
            type: 'function',
        },
        {
            inputs: [
                { name: '_salt', type: 'bytes32' },
                { name: '_bytecodeHash', type: 'bytes32' },
                { name: '_input', type: 'bytes' },
            ],
            name: 'create2',
            outputs: [{ name: '', type: 'address' }],
            stateMutability: 'payable',
            type: 'function',
        },
    ] as const;

    it('derives constructor args from zkSync ContractDeployer.create() tx data', () => {
        const encodedConstructorArgs = encodeAbiParameters(simpleConstructorAbi[0].inputs, [
            'ZkToken',
            'ZKT',
            TEST_ADDRESS_1,
            TEST_ADDRESS_2,
        ]);

        const txData = encodeFunctionData({
            abi: zkSyncContractDeployerAbi,
            functionName: 'create',
            args: [
                '0x0000000000000000000000000000000000000000000000000000000000000000',
                '0x0100000000000000000000000000000000000000000000000000000000000000',
                encodedConstructorArgs,
            ],
        });

        const result = deriveZkSyncConstructorArgs({
            txData,
            abi: simpleConstructorAbi,
        });

        expect(result).toBeDefined();
        expect(result!.encoded).toMatch(/^0x/);
        expect(result!.decoded._name).toBe('ZkToken');
        expect(result!.decoded._symbol).toBe('ZKT');
        expect((result!.decoded._endpoint as string).toLowerCase()).toBe(TEST_ADDRESS_1);
        expect((result!.decoded._delegate as string).toLowerCase()).toBe(TEST_ADDRESS_2);
    });

    it('returns undefined for contracts with no constructor', () => {
        const result = deriveZkSyncConstructorArgs({
            txData: '0x1234',
            abi: noConstructorAbi,
        });

        expect(result).toBeUndefined();
    });

    it('derives constructor args from zkSync ContractDeployer.create2() tx data', () => {
        const encodedConstructorArgs = encodeAbiParameters(simpleConstructorAbi[0].inputs, [
            'ZkToken2',
            'ZK2',
            TEST_ADDRESS_2,
            TEST_ADDRESS_1,
        ]);

        const txData = encodeFunctionData({
            abi: zkSyncContractDeployerAbi,
            functionName: 'create2',
            args: [
                '0x00000000000000000000000000000000000000000000000000000000deadbeef',
                '0x0100000000000000000000000000000000000000000000000000000000000000',
                encodedConstructorArgs,
            ],
        });

        const result = deriveZkSyncConstructorArgs({
            txData,
            abi: simpleConstructorAbi,
        });

        expect(result).toBeDefined();
        expect(result!.decoded._name).toBe('ZkToken2');
        expect(result!.decoded._symbol).toBe('ZK2');
        expect((result!.decoded._endpoint as string).toLowerCase()).toBe(TEST_ADDRESS_2);
        expect((result!.decoded._delegate as string).toLowerCase()).toBe(TEST_ADDRESS_1);
    });

    it('returns undefined when txData is undefined', () => {
        const result = deriveZkSyncConstructorArgs({
            txData: undefined,
            abi: simpleConstructorAbi,
        });

        expect(result).toBeUndefined();
    });
});
