import type { HexString, NormalizedHexString } from '@layerzerolabs/common-chain-model';
import { ChainName, type NativeAddress } from '@layerzerolabs/layerzero-definitions';

import { cantonAddressParser } from './canton';
import { hexAddressParser } from './hex';
import { initiaAddressParser } from './initia';
import { base58AddressParser } from './solana';
import { starknetAddressParser } from './starknet';
import { stellarAddressParser } from './stellar';
import { tonAddressParser } from './ton';
import type { AddressParser } from './types';

export {
    cantonAddressParser,
    cantonBytes32HexToNormalized,
    cantonNormalizedToBytes32Hex,
    decodeCantonRefAddress,
    encodeCantonRefAddress,
} from './canton';
export { hexAddressParser } from './hex';
export { initiaAddressParser } from './initia';
export { base58AddressParser } from './solana';
export { starknetAddressParser } from './starknet';
export { stellarAddressParser } from './stellar';
export { tonAddressParser } from './ton';
export type {
    AddressParser,
    ExtensionByChainType,
    InferExtensionByChainName,
    NativeOrString,
} from './types';
export { AddressEncoding } from './types';

/**
 * Chain-scoped address parser for encoding conversions.
 *
 * For deterministic test/harness sentinel addresses from hex labels, use
 * {@link sentinelNativeFromLabel} and {@link sentinelNormalizedFromLabel}.
 */
export function addressParser<T extends ChainName>(chainName: T): AddressParser<T> {
    // TODO: find a way to narrow generics to avoid type cast
    if (chainName === ChainName.TON)
        return tonAddressParser(chainName) as unknown as AddressParser<T>;
    if (chainName === ChainName.SOLANA)
        return base58AddressParser(chainName) as unknown as AddressParser<T>;
    if (chainName === ChainName.INITIA)
        return initiaAddressParser(chainName) as unknown as AddressParser<T>;
    if (chainName === ChainName.STELLAR)
        return stellarAddressParser(chainName) as unknown as AddressParser<T>;
    if (chainName === ChainName.STARKNET)
        return starknetAddressParser(chainName) as unknown as AddressParser<T>;
    if (chainName === ChainName.CANTON)
        return cantonAddressParser(chainName) as unknown as AddressParser<T>;
    return hexAddressParser(chainName) as unknown as AddressParser<T>;
}

export namespace addressParser {
    export const normalizedToUnpaddedString = (address: NormalizedHexString) => {
        return address.toString() as HexString;
    };

    export const normalizedToBigInt = (address: NormalizedHexString) => {
        return BigInt(address as unknown as HexString);
    };

    export const parseNative = (nativeAddress: NativeAddress) => {
        return addressParser(nativeAddress.chainName).parseNative(nativeAddress.nativeAddress);
    };
}

export * from './input';
export { sentinelNativeFromLabel, sentinelNormalizedFromLabel } from './sentinels';
