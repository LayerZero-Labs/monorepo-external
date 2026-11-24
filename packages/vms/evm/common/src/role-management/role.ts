import { keccak256 } from 'viem';

import { addressParser } from '@layerzerolabs/chain-utils';
import { BaseContractRole } from '@layerzerolabs/dw-model';
import { withGasLimit } from '@layerzerolabs/evm-gas-limits';
import {
    type FunctionPointer,
    partiallyApplyFunctionPointer,
} from '@layerzerolabs/function-pointer';
import { constructGatedTransaction } from '@layerzerolabs/gated-transaction';
import type { ChainType, InferChainNamesForChainType } from '@layerzerolabs/layerzero-definitions';
import type { NormalizedHexString } from '@layerzerolabs/typescript-utils';

import type { IViemClientWrapper } from '../provider';
import { buildEvmTransaction } from '../transaction';
import type {
    EvmAccessControl2StepContractGetter,
    EvmContractGetter,
    EvmEnumerableContractGetter,
} from './types';

const formatRoleForDisplay = (role: string): string =>
    role
        .replace(/_ROLE$/, '')
        .split('_')
        .map((w) => w.toLowerCase())
        .join(' ');

/**
 * Computes the role hash for a given role name.
 *
 * In OpenZeppelin AccessControl, DEFAULT_ADMIN_ROLE is defined as bytes32(0x00),
 * not as a keccak256 hash. All other roles use keccak256 hash of the role name.
 * This assumes that the contracts are following this pattern, otherwise this will break.
 *
 * @see https://github.com/OpenZeppelin/openzeppelin-contracts/blob/1e5b89110853663f4d7f83c867b3945854f40a76/contracts/access/AccessControl.sol#L57
 */
export const getRoleHash = (role: string): `0x${string}` => {
    if (role === BaseContractRole.DEFAULT_ADMIN) {
        return '0x0000000000000000000000000000000000000000000000000000000000000000';
    }
    return keccak256(Buffer.from(role));
};

/**
 * Creates a gated transaction for granting or revoking a role on a contract.
 * Uses EVM OpenZeppelin AccessControl pattern.
 *
 * @param contractGetter - Function to get the contract instance
 * @param providerAdapter - Provider adapter with viem client
 * @param hasRoleFunctionPointer - Function pointer for the hasRole check
 * @param contractName - Name of the contract for transaction naming
 * @param address - Contract address
 * @param role - Role name to grant/revoke
 * @param accountAddress - Address to grant/revoke the role to/from
 * @param shouldGrant - Whether to grant (true) or revoke (false) the role
 * @param chainName - Chain name for the transaction
 * @param gas - Base execution gas for the transaction
 * @returns Array of gated transactions
 */
export const createSetRoleTransaction = async <R extends string>({
    contractGetter,
    providerAdapter,
    hasRoleFunctionPointer,
    contractName,
    address,
    role,
    accountAddress,
    shouldGrant,
    chainName,
    gas,
}: {
    contractGetter: EvmContractGetter;
    providerAdapter: IViemClientWrapper;
    hasRoleFunctionPointer: FunctionPointer<
        (
            spec: { address: NormalizedHexString },
            args: { role: R; accountAddress: NormalizedHexString },
        ) => Promise<boolean>
    >;
    contractName: string;
    address: NormalizedHexString;
    role: R;
    accountAddress: NormalizedHexString;
    shouldGrant: boolean;
    chainName: InferChainNamesForChainType<ChainType.EVM>;
    gas: bigint;
}) => {
    const localAddressParser = addressParser(chainName);
    const roleHash = getRoleHash(role);
    const accountAddressNative = localAddressParser.normalizedToNativeString(accountAddress);

    // Cast to AccessControlContract for type-safe method access
    const contract = contractGetter(chainName, address, providerAdapter.viem);

    const populatedTransaction = shouldGrant
        ? await contract.oPopulateTransaction.grantRole({
              role: roleHash,
              account: accountAddressNative,
          })
        : await contract.oPopulateTransaction.revokeRole({
              role: roleHash,
              account: accountAddressNative,
          });

    return [
        constructGatedTransaction({
            name: `SetRole-${contractName}-${role}`,
            description: `${shouldGrant ? 'Grant' : 'Revoke'} ${formatRoleForDisplay(role)} role`,
            chainName,
            uniqueIdKeys: {
                contractAddress: localAddressParser.normalizedToNativeString(address),
                role,
                accountAddress: accountAddressNative,
            },
            transaction: await buildEvmTransaction(chainName, {
                populatedTransaction: withGasLimit(chainName, gas, populatedTransaction),
            }),
            check: {
                functionPointer: partiallyApplyFunctionPointer(hasRoleFunctionPointer)(
                    { address },
                    { role, accountAddress },
                ),
                expectedResult: {
                    operator: '=',
                    comparisonValue: shouldGrant,
                },
            },
        }),
    ];
};

/**
 * Checks if an account has a specific role on a contract.
 * Uses EVM OpenZeppelin AccessControl pattern.
 *
 * @param contractGetter - Function to get the contract instance
 * @param providerAdapter - Provider adapter with viem client
 * @param address - Contract address
 * @param role - Role name to check
 * @param accountAddress - Address to check for the role
 * @param chainName - Chain name
 * @returns Whether the account has the role
 */
export const hasRole = async ({
    contractGetter,
    providerAdapter,
    address,
    role,
    accountAddress,
    chainName,
}: {
    contractGetter: EvmContractGetter;
    providerAdapter: IViemClientWrapper;
    address: NormalizedHexString;
    role: string;
    accountAddress: NormalizedHexString;
    chainName: InferChainNamesForChainType<ChainType.EVM>;
}): Promise<boolean> => {
    const localAddressParser = addressParser(chainName);
    const roleHash = getRoleHash(role);

    const contract = contractGetter(chainName, address, providerAdapter.viem);

    const isRole = await contract.oRead.hasRole({
        role: roleHash,
        account: localAddressParser.normalizedToNativeString(accountAddress),
    });

    return isRole;
};

/**
 * Gets all addresses that have a specific role on a contract.
 * Uses EVM OpenZeppelin AccessControlEnumerable pattern.
 *
 * @param contractGetter - Function to get the contract instance (must have AccessControlEnumerable)
 * @param providerAdapter - Provider adapter with viem client
 * @param address - Contract address
 * @param role - Role name to enumerate members for
 * @param chainName - Chain name
 * @returns Array of addresses that have the role
 */
export const getRoleMembers = async ({
    contractGetter,
    providerAdapter,
    address,
    role,
    chainName,
}: {
    contractGetter: EvmEnumerableContractGetter;
    providerAdapter: IViemClientWrapper;
    address: NormalizedHexString;
    role: string;
    chainName: InferChainNamesForChainType<ChainType.EVM>;
}): Promise<NormalizedHexString[]> => {
    const localAddressParser = addressParser(chainName);
    const roleHash = getRoleHash(role);

    // Cast to AccessControlEnumerable - caller must ensure contract supports this interface
    const contract = contractGetter(chainName, address, providerAdapter.viem);

    const members = await contract.oRead.getRoleMembers({ role: roleHash });

    return members.map(localAddressParser.nativeToNormalized);
};

export const getPendingAdmin = async ({
    contractGetter,
    providerAdapter,
    address,
    chainName,
}: {
    contractGetter: EvmAccessControl2StepContractGetter;
    providerAdapter: IViemClientWrapper;
    address: NormalizedHexString;
    chainName: InferChainNamesForChainType<ChainType.EVM>;
}): Promise<NormalizedHexString> => {
    const localAddressParser = addressParser(chainName);
    const contract = contractGetter(chainName, address, providerAdapter.viem);
    const pending = await contract.oRead.pendingDefaultAdmin();
    return localAddressParser.nativeToNormalized(pending);
};

export const isAdminTransferStartedOrComplete = async ({
    contractGetter,
    providerAdapter,
    address,
    adminRole,
    newAdmin,
    chainName,
}: {
    contractGetter: EvmAccessControl2StepContractGetter;
    providerAdapter: IViemClientWrapper;
    address: NormalizedHexString;
    adminRole: string;
    newAdmin: NormalizedHexString;
    chainName: InferChainNamesForChainType<ChainType.EVM>;
}): Promise<boolean> => {
    const localAddressParser = addressParser(chainName);
    const contract = contractGetter(chainName, address, providerAdapter.viem);
    const [pending, isAdmin] = await Promise.all([
        contract.oRead.pendingDefaultAdmin(),
        contract.oRead.hasRole({
            role: getRoleHash(adminRole),
            account: localAddressParser.normalizedToNativeString(newAdmin),
        }),
    ]);
    return isAdmin || localAddressParser.nativeToNormalized(pending) === newAdmin;
};

export const createBeginAdminTransferTransaction = async ({
    contractGetter,
    providerAdapter,
    isAdminTransferStartedOrCompleteFunctionPointer,
    contractName,
    address,
    newAdmin,
    chainName,
    gas,
}: {
    contractGetter: EvmAccessControl2StepContractGetter;
    providerAdapter: IViemClientWrapper;
    isAdminTransferStartedOrCompleteFunctionPointer: FunctionPointer<
        (
            spec: { address: NormalizedHexString },
            args: { newAdmin: NormalizedHexString },
        ) => Promise<boolean>
    >;
    contractName: string;
    address: NormalizedHexString;
    newAdmin: NormalizedHexString;
    chainName: InferChainNamesForChainType<ChainType.EVM>;
    gas: bigint;
}) => {
    const localAddressParser = addressParser(chainName);
    const contract = contractGetter(chainName, address, providerAdapter.viem);

    const populatedTransaction = await contract.oPopulateTransaction.beginDefaultAdminTransfer({
        _newAdmin: localAddressParser.normalizedToNativeString(newAdmin),
    });

    return [
        constructGatedTransaction({
            name: `BeginAdminTransfer-${contractName}`,
            description: `Begin admin transfer`,
            chainName,
            uniqueIdKeys: {
                contractAddress: localAddressParser.normalizedToNativeString(address),
                newAdmin: localAddressParser.normalizedToNativeString(newAdmin),
            },
            transaction: await buildEvmTransaction(chainName, {
                populatedTransaction: withGasLimit(chainName, gas, populatedTransaction),
            }),
            check: {
                functionPointer: partiallyApplyFunctionPointer(
                    isAdminTransferStartedOrCompleteFunctionPointer,
                )({ address }, { newAdmin }),
                expectedResult: {
                    operator: '=',
                    comparisonValue: true,
                },
            },
        }),
    ];
};

export const createAcceptAdminTransferTransaction = async <R extends string>({
    contractGetter,
    providerAdapter,
    hasRoleFunctionPointer,
    adminRole,
    contractName,
    address,
    newAdmin,
    chainName,
    gas,
}: {
    contractGetter: EvmAccessControl2StepContractGetter;
    providerAdapter: IViemClientWrapper;
    hasRoleFunctionPointer: FunctionPointer<
        (
            spec: { address: NormalizedHexString },
            args: { role: R; accountAddress: NormalizedHexString },
        ) => Promise<boolean>
    >;
    adminRole: R;
    contractName: string;
    address: NormalizedHexString;
    newAdmin: NormalizedHexString;
    chainName: InferChainNamesForChainType<ChainType.EVM>;
    gas: bigint;
}) => {
    const localAddressParser = addressParser(chainName);
    const contract = contractGetter(chainName, address, providerAdapter.viem);

    const populatedTransaction = await contract.oPopulateTransaction.acceptDefaultAdminTransfer();

    return [
        constructGatedTransaction({
            name: `AcceptAdminTransfer-${contractName}`,
            description: `Accept admin transfer`,
            chainName,
            uniqueIdKeys: {
                contractAddress: localAddressParser.normalizedToNativeString(address),
                newAdmin: localAddressParser.normalizedToNativeString(newAdmin),
            },
            transaction: await buildEvmTransaction(chainName, {
                populatedTransaction: withGasLimit(chainName, gas, populatedTransaction),
            }),
            check: {
                functionPointer: partiallyApplyFunctionPointer(hasRoleFunctionPointer)(
                    { address },
                    { role: adminRole, accountAddress: newAdmin },
                ),
                expectedResult: {
                    operator: '=',
                    comparisonValue: true,
                },
            },
        }),
    ];
};
