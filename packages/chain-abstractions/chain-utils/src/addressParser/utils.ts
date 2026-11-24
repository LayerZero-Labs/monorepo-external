import type { ChainName, ResolvedEncodingForChainName } from '@layerzerolabs/layerzero-definitions';

import { addressParser } from './index';
import type { NativeOrString } from './types';

export const getAddress = <T extends ChainName>(nativeAddress: NativeOrString<T>) => {
    return typeof nativeAddress === 'object' ? nativeAddress.nativeAddress : nativeAddress;
};

export function assertNative<T extends ChainName>(
    nativeAddress: string | undefined,
    expectedChainName: T,
): asserts nativeAddress is ResolvedEncodingForChainName<T> {
    if (!addressParser(expectedChainName).validateNative(nativeAddress)) {
        throw new Error(
            'Cannot convert: "' +
                nativeAddress +
                '" - The native address does not match the expected format for the chain: ' +
                expectedChainName,
        );
    }
}
