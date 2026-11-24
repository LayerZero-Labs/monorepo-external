import type { StellarStrKeyPrefix } from '@layerzerolabs/address-utils-stellar';
import {
    stellarAccountHexToNormalized,
    stellarContractHexToNormalized,
} from '@layerzerolabs/address-utils-stellar';
import type { HexString, NormalizedHexString } from '@layerzerolabs/common-chain-model';
import { ensure0xPrefixed } from '@layerzerolabs/common-encoding-utils';
import type { ChainName } from '@layerzerolabs/layerzero-definitions';
import { ChainType, getChainTypeForChainName } from '@layerzerolabs/layerzero-definitions';

import { addressParser } from './index';

export type AddressParseOptionsByChainType = {
    stellar: { strKeyPrefix: StellarStrKeyPrefix };
};

const stellarHexToNormalized = (
    hexAddress: HexString,
    { strKeyPrefix }: AddressParseOptionsByChainType['stellar'],
): NormalizedHexString =>
    strKeyPrefix === 'C'
        ? stellarContractHexToNormalized(hexAddress)
        : stellarAccountHexToNormalized(hexAddress);

export const serviceAddressToNormalized = (
    chainName: ChainName,
    address: string,
    options: AddressParseOptionsByChainType,
): NormalizedHexString => {
    const parser = addressParser(chainName);
    return getChainTypeForChainName(chainName) === ChainType.STELLAR &&
        !parser.validateNative(address)
        ? stellarHexToNormalized(ensure0xPrefixed(address), options.stellar)
        : parser.parseNative(address);
};
