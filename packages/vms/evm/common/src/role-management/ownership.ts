import { addressParser } from '@layerzerolabs/chain-utils';
import type { ChainType, InferChainNamesForChainType } from '@layerzerolabs/layerzero-definitions';
import type { NormalizedHexString } from '@layerzerolabs/typescript-utils';

import type { IViemClientWrapper } from '../provider';
import { enhancedContractGetter } from '../viemUtils';

const ownableOwnerAbi = [
    {
        inputs: [],
        name: 'owner',
        outputs: [{ internalType: 'address', name: '', type: 'address' }],
        stateMutability: 'view',
        type: 'function',
    },
] as const;

const getOwnableContract = enhancedContractGetter(ownableOwnerAbi);

/**
 * Whether `accountAddress` is the `owner()` of an OpenZeppelin Ownable contract. Used as the
 * sender-permission predicate of owner-gated wiring transactions.
 */
export const isOwner = async ({
    providerAdapter,
    address,
    accountAddress,
    chainName,
}: {
    providerAdapter: IViemClientWrapper;
    address: NormalizedHexString;
    accountAddress: NormalizedHexString;
    chainName: InferChainNamesForChainType<ChainType.EVM>;
}): Promise<boolean> => {
    const owner = await getOwnableContract(chainName, address, providerAdapter.viem).read.owner();
    return addressParser(chainName).parseNative(owner) === accountAddress;
};
