import type { AbiConstructor } from 'abitype';
import type { Abi } from 'viem';
import { decodeAbiParameters, decodeFunctionData } from 'viem';

import type { HexString } from '@layerzerolabs/common-chain-model';
import { ensure0xPrefixed } from '@layerzerolabs/common-encoding-utils';
import { NonRetryableError } from '@layerzerolabs/common-error-utils';

// Minimal ABI for zkSync's ContractDeployer.create() — the system contract
// that wraps all deployments. We only need the `create` function signature
// to decode constructor args from the third parameter.
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

export interface DerivedConstructorArgs {
    encoded: HexString;
    decoded: Record<string, unknown>;
}

// ---------------------------------------------------------------------------
// Shared helpers
// ---------------------------------------------------------------------------

const getConstructorAbi = (abi: Abi): AbiConstructor | undefined => {
    const constructorAbi = abi.find((item): item is AbiConstructor => item.type === 'constructor');

    if (!constructorAbi?.inputs?.length) {
        return undefined;
    }

    return constructorAbi;
};

const toJsonSafe = (value: unknown): unknown => {
    if (typeof value === 'bigint' || typeof value === 'number') return value.toString();
    if (Array.isArray(value)) return value.map(toJsonSafe);
    if (value !== null && typeof value === 'object') {
        return Object.fromEntries(Object.entries(value).map(([k, v]) => [k, toJsonSafe(v)]));
    }
    return value;
};

const buildDecodedMap = (
    inputs: AbiConstructor['inputs'],
    values: readonly unknown[],
): Record<string, unknown> => {
    const decoded: Record<string, unknown> = {};
    inputs.forEach((input, index) => {
        decoded[input.name ?? `arg${index}`] = toJsonSafe(values[index]);
    });
    return decoded;
};

// ---------------------------------------------------------------------------
// EVM constructor args derivation
// ---------------------------------------------------------------------------

/**
 * Derives constructor arguments for EVM contracts by slicing them from transaction data.
 * Formula: txData = creationBytecode + abiEncodedConstructorArgs
 */
export const deriveEvmConstructorArgs = ({
    txData,
    creationBytecode,
    abi,
}: {
    txData: string | undefined;
    creationBytecode: string;
    abi: Abi;
}): DerivedConstructorArgs | undefined => {
    if (!txData) return undefined;

    const constructorAbi = getConstructorAbi(abi);
    if (!constructorAbi) return undefined;

    const normalizedTxData = ensure0xPrefixed(txData);
    const normalizedBytecode = ensure0xPrefixed(creationBytecode);

    if (!normalizedTxData.toLowerCase().startsWith(normalizedBytecode.toLowerCase())) {
        throw new NonRetryableError(
            `Transaction data does not start with the expected creation bytecode. ` +
                `This may indicate stale build artifacts. ` +
                `txData starts with: ${normalizedTxData.slice(0, 20)}..., ` +
                `expected prefix: ${normalizedBytecode.slice(0, 20)}...`,
        );
    }

    const encoded = ensure0xPrefixed(
        normalizedTxData.slice(normalizedBytecode.length),
    ) as HexString;

    const decodedValues = decodeAbiParameters(constructorAbi.inputs, encoded as `0x${string}`);
    const decoded = buildDecodedMap(constructorAbi.inputs, decodedValues);

    return { encoded, decoded };
};

// ---------------------------------------------------------------------------
// zkSync constructor args derivation
// ---------------------------------------------------------------------------

/**
 * Derives constructor arguments for zkSync contracts from transaction data.
 * zkSync deploy tx data is a call to ContractDeployer.create(salt, bytecodeHash, constructorArgs).
 * The third argument contains the ABI-encoded constructor args.
 */
export const deriveZkSyncConstructorArgs = ({
    txData,
    abi,
}: {
    txData: string | undefined;
    abi: Abi;
}): DerivedConstructorArgs | undefined => {
    if (!txData) return undefined;

    const constructorAbi = getConstructorAbi(abi);
    if (!constructorAbi) return undefined;

    const { args: deployerArgs } = decodeFunctionData({
        abi: zkSyncContractDeployerAbi,
        data: txData as `0x${string}`,
    });

    // Third argument is the ABI-encoded constructor args
    const encoded = deployerArgs[2] as HexString;

    const decodedValues = decodeAbiParameters(constructorAbi.inputs, encoded as `0x${string}`);
    const decoded = buildDecodedMap(constructorAbi.inputs, decodedValues);

    return { encoded, decoded };
};
