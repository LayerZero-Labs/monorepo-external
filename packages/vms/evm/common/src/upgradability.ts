// https://raw.githubusercontent.com/OpenZeppelin/openzeppelin-contracts/master/contracts/proxy/utils/Initializable.sol

import { addressParser } from '@layerzerolabs/chain-utils';
import type { ChainType, InferChainNamesForChainType } from '@layerzerolabs/layerzero-definitions';
import type { NormalizedHexString } from '@layerzerolabs/typescript-utils';

import type { EvmProvider } from './provider';

// keccak256(abi.encode(uint256(keccak256("openzeppelin.storage.Initializable")) - 1)) & ~bytes32(uint256(0xff))
const INITIALIZABLE_SLOT = '0xf0c57e16840df040f15088dc2f81fe391c3923bec73e23a9662efc9c229c6a00';

export const isEvmOzUpgradeableInitialized = async ({
    address,
    provider,
    chainName,
}: {
    address: NormalizedHexString;
    provider: EvmProvider;
    chainName: InferChainNamesForChainType<ChainType.EVM>;
}) => {
    const localAddressParser = addressParser(chainName);
    const initializableData = await provider.viem.getStorageAt({
        address: localAddressParser.normalizedToNativeString(address),
        slot: INITIALIZABLE_SLOT,
    });

    const initialized = Number(BigInt(initializableData!) & ((1n << 64n) - 1n));
    return initialized > 0;
};
