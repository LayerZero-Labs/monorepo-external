import type {
    CreateAcceptAdminTransferTransactionsWithSpecializedInput,
    CreateBeginAdminTransferTransactionsWithSpecializedInput,
    CreateSetRoleTransactionsWithSpecializedInput,
    GetPendingAdminWithSpecializedInput,
    GetRoleMembersWithSpecializedInput,
    HasRoleWithSpecializedInput,
    IsAdminTransferStartedOrCompleteWithSpecializedInput,
    IsRoleManagerWithSpecializedInput,
} from '@layerzerolabs/dw-model';
import type { FunctionPointer } from '@layerzerolabs/function-pointer';
import type { ChainType, InferChainNamesForChainType } from '@layerzerolabs/layerzero-definitions';
import type { NormalizedHexString } from '@layerzerolabs/typescript-utils';

import type { IViemClientWrapper } from '../provider';
import {
    createAcceptAdminTransferTransaction,
    createBeginAdminTransferTransaction,
    createSetRoleTransaction,
    getPendingAdmin,
    getRoleMembers,
    hasRole,
    isAdminTransferStartedOrComplete,
    isRoleManager,
} from './role';
import type {
    EvmAccessControl2StepContractGetter,
    EvmContractGetter,
    EvmEnumerableContractGetter,
    IsRoleManagerFunctionPointer,
} from './types';

const generateCreateSetRoleTransactions =
    <R extends readonly string[]>({
        contractGetter,
        providerAdapter,
        hasRoleFunctionPointer,
        isRoleManagerFunctionPointer,
        validRoles,
        contractName,
        chainName,
        gas,
        ignoreRevokeRole,
    }: {
        contractGetter: EvmContractGetter;
        providerAdapter: IViemClientWrapper;
        hasRoleFunctionPointer: FunctionPointer<
            (
                spec: { address: NormalizedHexString },
                args: { role: R[number]; accountAddress: NormalizedHexString },
            ) => Promise<boolean>
        >;
        isRoleManagerFunctionPointer?: IsRoleManagerFunctionPointer;
        validRoles: R;
        contractName: string;
        chainName: InferChainNamesForChainType<ChainType.EVM>;
        gas: bigint;
        ignoreRevokeRole: boolean;
    }): CreateSetRoleTransactionsWithSpecializedInput =>
    async ({ address }, { role, accountAddress, shouldGrant }) => {
        if (!validRoles.includes(role)) {
            throw new Error(`Invalid role: ${role}`);
        }

        if (ignoreRevokeRole && !shouldGrant) {
            return [];
        }

        return await createSetRoleTransaction({
            contractGetter,
            providerAdapter,
            hasRoleFunctionPointer,
            isRoleManagerFunctionPointer,
            contractName,
            address,
            role,
            accountAddress,
            shouldGrant,
            chainName,
            gas,
        });
    };

const generateHasRole =
    <R extends readonly string[]>({
        contractGetter,
        providerAdapter,
        validRoles,
        chainName,
    }: {
        contractGetter: EvmContractGetter;
        providerAdapter: IViemClientWrapper;
        validRoles: R;
        chainName: InferChainNamesForChainType<ChainType.EVM>;
    }): HasRoleWithSpecializedInput =>
    async ({ address }, { role, accountAddress }) => {
        if (!validRoles.includes(role)) {
            throw new Error(`Invalid role: ${role}`);
        }

        return await hasRole({
            contractGetter,
            providerAdapter,
            address,
            role,
            accountAddress,
            chainName,
        });
    };

const generateGetRoleMembers =
    <R extends readonly string[]>({
        contractGetter,
        providerAdapter,
        validRoles,
        chainName,
    }: {
        contractGetter: EvmEnumerableContractGetter;
        providerAdapter: IViemClientWrapper;
        validRoles: R;
        chainName: InferChainNamesForChainType<ChainType.EVM>;
    }): GetRoleMembersWithSpecializedInput =>
    async ({ address }, { role }) => {
        if (!validRoles.includes(role)) {
            throw new Error(`Invalid role: ${role}`);
        }

        return await getRoleMembers({
            contractGetter,
            providerAdapter,
            address,
            role,
            chainName,
        });
    };

/**
 * Generates role management functions (createSetRoleTransactions and hasRole) for a specific contract.
 * This is the main entry point for using role management in EVM activity factories.
 *
 * @example
 * ```typescript
 * // In your EVM activity factory implementation:
 * return {
 *     // ... other activity functions
 *     ...generateRoleManagement({
 *         contractGetter: getMyExampleTokenContract,
 *         providerAdapter,
 *         hasRoleFunctionPointer: getFunctionPointer('hasRole'),
 *         validRoles: tokenRoles,
 *         contractName: MY_EXAMPLE_TOKEN_CONTRACT_NAME,
 *         chainName,
 *         gas: 500_000n,
 *         ignoreRevokeRole: true,
 *         enumerable: true, // Enable getRoleMembers for AccessControlEnumerable
 *     }),
 * };
 * ```
 *
 * @param contractGetter - Function to get the contract instance (must have AccessControl functions)
 * @param providerAdapter - Provider adapter with viem client
 * @param hasRoleFunctionPointer - Function pointer for the hasRole check
 * @param validRoles - Array of valid role names for this contract
 * @param contractName - Name of the contract for transaction naming
 * @param chainName - Chain name for the transaction
 * @param gas - Base execution gas for the transaction
 * @param ignoreRevokeRole - Whether to ignore revoke role requests (shouldGrant = false)
 * @returns Object containing createSetRoleTransactions and hasRole
 */
export const generateRoleManagement = <R extends readonly string[]>({
    contractGetter,
    providerAdapter,
    hasRoleFunctionPointer,
    isRoleManagerFunctionPointer,
    validRoles,
    contractName,
    chainName,
    gas,
    ignoreRevokeRole,
}: {
    contractGetter: EvmContractGetter;
    providerAdapter: IViemClientWrapper;
    hasRoleFunctionPointer: FunctionPointer<
        (
            spec: { address: NormalizedHexString },
            args: { role: R[number]; accountAddress: NormalizedHexString },
        ) => Promise<boolean>
    >;
    isRoleManagerFunctionPointer?: IsRoleManagerFunctionPointer;
    validRoles: R;
    contractName: string;
    chainName: InferChainNamesForChainType<ChainType.EVM>;
    gas: bigint;
    ignoreRevokeRole: boolean;
}) => ({
    createSetRoleTransactions: generateCreateSetRoleTransactions({
        contractGetter,
        providerAdapter,
        hasRoleFunctionPointer,
        isRoleManagerFunctionPointer,
        validRoles,
        contractName,
        chainName,
        gas,
        ignoreRevokeRole,
    }),
    hasRole: generateHasRole({
        contractGetter,
        providerAdapter,
        validRoles,
        chainName,
    }),
});

export const generateEnumerableRoleManagement = <R extends readonly string[]>({
    contractGetter,
    providerAdapter,
    hasRoleFunctionPointer,
    isRoleManagerFunctionPointer,
    validRoles,
    contractName,
    chainName,
    gas,
    ignoreRevokeRole,
}: {
    contractGetter: EvmEnumerableContractGetter;
    providerAdapter: IViemClientWrapper;
    hasRoleFunctionPointer: FunctionPointer<
        (
            spec: { address: NormalizedHexString },
            args: { role: R[number]; accountAddress: NormalizedHexString },
        ) => Promise<boolean>
    >;
    isRoleManagerFunctionPointer?: IsRoleManagerFunctionPointer;
    validRoles: R;
    contractName: string;
    chainName: InferChainNamesForChainType<ChainType.EVM>;
    gas: bigint;
    ignoreRevokeRole: boolean;
}) => ({
    ...generateRoleManagement({
        contractGetter,
        providerAdapter,
        hasRoleFunctionPointer,
        isRoleManagerFunctionPointer,
        validRoles,
        contractName,
        chainName,
        gas,
        ignoreRevokeRole,
    }),
    getRoleMembers: generateGetRoleMembers({
        contractGetter,
        providerAdapter,
        validRoles,
        chainName,
    }),
});

export const generateAdmin2StepManagement = <R extends readonly string[]>({
    contractGetter,
    providerAdapter,
    validRoles: _validRoles,
    hasRoleFunctionPointer,
    adminRole,
    isAdminTransferStartedOrCompleteFunctionPointer,
    contractName,
    chainName,
    gas,
}: {
    contractGetter: EvmAccessControl2StepContractGetter;
    providerAdapter: IViemClientWrapper;
    validRoles: R;
    hasRoleFunctionPointer: FunctionPointer<
        (
            spec: { address: NormalizedHexString },
            args: { role: R[number]; accountAddress: NormalizedHexString },
        ) => Promise<boolean>
    >;
    adminRole: R[number];
    isAdminTransferStartedOrCompleteFunctionPointer: FunctionPointer<
        (
            spec: { address: NormalizedHexString },
            args: { newAdmin: NormalizedHexString },
        ) => Promise<boolean>
    >;
    contractName: string;
    chainName: InferChainNamesForChainType<ChainType.EVM>;
    gas: bigint;
}): {
    getPendingAdmin: GetPendingAdminWithSpecializedInput;
    isRoleManager: IsRoleManagerWithSpecializedInput;
    isAdminTransferStartedOrComplete: IsAdminTransferStartedOrCompleteWithSpecializedInput;
    createBeginAdminTransferTransactions: CreateBeginAdminTransferTransactionsWithSpecializedInput;
    createAcceptAdminTransferTransactions: CreateAcceptAdminTransferTransactionsWithSpecializedInput;
} => ({
    getPendingAdmin: async ({ address }) =>
        getPendingAdmin({ contractGetter, providerAdapter, address, chainName }),

    isRoleManager: async ({ address }, caller) =>
        isRoleManager({ contractGetter, providerAdapter, address, adminRole, caller, chainName }),

    isAdminTransferStartedOrComplete: async ({ address }, { newAdmin }) =>
        isAdminTransferStartedOrComplete({
            contractGetter,
            providerAdapter,
            address,
            adminRole,
            newAdmin,
            chainName,
        }),

    createBeginAdminTransferTransactions: async ({ address }, { newAdmin }) =>
        createBeginAdminTransferTransaction({
            contractGetter,
            providerAdapter,
            isAdminTransferStartedOrCompleteFunctionPointer,
            contractName,
            address,
            newAdmin,
            chainName,
            gas,
        }),

    createAcceptAdminTransferTransactions: async ({ address }, { newAdmin }) =>
        createAcceptAdminTransferTransaction({
            contractGetter,
            providerAdapter,
            hasRoleFunctionPointer,
            adminRole,
            contractName,
            address,
            newAdmin,
            chainName,
            gas,
        }),
});
