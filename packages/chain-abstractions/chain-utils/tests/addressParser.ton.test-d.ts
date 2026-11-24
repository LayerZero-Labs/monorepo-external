import { describe, expectTypeOf, it } from 'vitest';

import type { HexString, NormalizedHexString } from '@layerzerolabs/common-chain-model';
import type {
    ChainNativeAddress,
    ResolvedEncodingForChainName,
    TonString,
} from '@layerzerolabs/layerzero-definitions';
import { ChainName } from '@layerzerolabs/layerzero-definitions';

import { addressParser } from '../src/addressParser';

const tonAddressParser = addressParser(ChainName.TON);
declare const normalized: NormalizedHexString;
declare const hex: HexString;
declare const tonString: TonString;

describe('TON native address type', () => {
    it('resolves to TonString, not HexString', () => {
        expectTypeOf<ResolvedEncodingForChainName<ChainName.TON>>().toEqualTypeOf<TonString>();
        expectTypeOf<ResolvedEncodingForChainName<ChainName.TON>>().not.toEqualTypeOf<HexString>();
    });

    it('types normalizedToNative output as TonString', () => {
        expectTypeOf(
            tonAddressParser.normalizedToNativeString(normalized),
        ).toEqualTypeOf<TonString>();
        expectTypeOf(tonAddressParser.normalizedToNative(normalized)).toEqualTypeOf<
            ChainNativeAddress<ChainName.TON>
        >();
    });

    it('accepts TonString but not hex as native input', () => {
        expectTypeOf(
            tonAddressParser.nativeToNormalized(tonString),
        ).toEqualTypeOf<NormalizedHexString>();
        // @ts-expect-error
        tonAddressParser.nativeToNormalized(hex);
    });

    it('narrows validateNative to TonString', () => {
        const input: string = '';
        if (tonAddressParser.validateNative(input)) {
            expectTypeOf(input).toEqualTypeOf<TonString>();
        }
    });
});
