import type { PublicClient } from 'viem';

import type { ChainType, InferChainNamesForChainType } from '@layerzerolabs/layerzero-definitions';
import type {
    DecimalString,
    HexString,
    NormalizedHexString,
    Prettify,
} from '@layerzerolabs/typescript-utils';

import type { EvmPopulatedTransaction } from '../transaction';

/**
 * Interface for contracts with AccessControl functions.
 * This is used internally for type-safe access to role management methods.
 */
export interface AccessControlContract {
    oRead: {
        hasRole: (args: { role: HexString; account: HexString }) => Promise<boolean>;
    };
    oPopulateTransaction: {
        grantRole: (
            args: { role: HexString; account: HexString },
            overrides?: { gas?: DecimalString },
        ) => Promise<EvmPopulatedTransaction>;
        revokeRole: (
            args: { role: HexString; account: HexString },
            overrides?: { gas?: DecimalString },
        ) => Promise<EvmPopulatedTransaction>;
    };
}

// getRoleMember and getRoleCount are omitted — more complex to implement and would incur additional activity calls.
export type EnumerableAccessControlContract = Prettify<
    AccessControlContract & {
        oRead: {
            getRoleMembers: (args: { role: HexString }) => Promise<readonly HexString[]>;
        };
    }
>;

/**
 * Contract getter type for EVM contracts with AccessControl.
 */
export type EvmContractGetter = (
    chainName: InferChainNamesForChainType<ChainType.EVM>,
    address: NormalizedHexString,
    viemClient: PublicClient,
) => AccessControlContract;

/**
 * Contract getter type for EVM contracts with AccessControlEnumerable.
 */
export type EvmEnumerableContractGetter = (
    chainName: InferChainNamesForChainType<ChainType.EVM>,
    address: NormalizedHexString,
    viemClient: PublicClient,
) => EnumerableAccessControlContract;

export interface AccessControl2StepContract {
    oRead: {
        pendingDefaultAdmin: () => Promise<HexString>;
        hasRole: (args: { role: HexString; account: HexString }) => Promise<boolean>;
    };
    oPopulateTransaction: {
        beginDefaultAdminTransfer: (
            args: { _newAdmin: HexString },
            overrides?: { gas?: DecimalString },
        ) => Promise<EvmPopulatedTransaction>;
        acceptDefaultAdminTransfer: (overrides?: {
            gas?: DecimalString;
        }) => Promise<EvmPopulatedTransaction>;
    };
}

export type EvmAccessControl2StepContractGetter = (
    chainName: InferChainNamesForChainType<ChainType.EVM>,
    address: NormalizedHexString,
    viemClient: PublicClient,
) => AccessControl2StepContract;
