import { stellarSentinelNormalizedFromLabel } from '@layerzerolabs/address-utils-stellar';
import { type NormalizedHexString, normalizeHex } from '@layerzerolabs/common-chain-model';
import { tileHex, trim0x } from '@layerzerolabs/common-encoding-utils';
import { ChainName, type ResolvedEncodingForChainName } from '@layerzerolabs/layerzero-definitions';
import { StaticChainConfigs } from '@layerzerolabs/static-chain-info';

import { cantonSentinelNormalizedFromLabel } from './canton';
import { addressParser } from './index';
import type { AddressParser, AddressSentinelNormalizedFromLabel } from './types';

/** Default sentinel: tile `label` across the chain's native address byte width. */
const tiledSentinelNormalizedFromLabel = (
    chainName: ChainName,
    label: string,
): NormalizedHexString => {
    const byteLen = StaticChainConfigs.getAddressSizeInBytes(chainName);
    return normalizeHex(tileHex(label, byteLen * 2));
};

const assertSentinelLabel = (label: string): void => {
    const body = trim0x(label);
    if (body.startsWith('0')) {
        throw new Error(
            'Sentinel labels must not start with a leading zero nibble; use chain zero constants for zero addresses',
        );
    }
};

const assertSentinelRoundTrips = <T extends ChainName>(
    chainName: T,
    parser: AddressParser<T>,
    label: string,
    normalized: NormalizedHexString,
): NormalizedHexString => {
    const roundTripped = parser.parseNative(parser.normalizedToNativeString(normalized));
    if (roundTripped !== normalized) {
        throw new Error(`Sentinel label "${label}" does not round-trip on ${chainName}`);
    }
    return roundTripped;
};

/** Resolve the per-chain sentinel label → normalized hex implementation. */
const resolveSentinelNormalizedFromLabel = <T extends ChainName>(
    chainName: T,
): AddressSentinelNormalizedFromLabel<T> => {
    if (chainName === ChainName.CANTON) {
        return cantonSentinelNormalizedFromLabel as AddressSentinelNormalizedFromLabel<T>;
    }
    if (chainName === ChainName.STELLAR) {
        // chainName unused — required by AddressSentinelNormalizedFromLabel
        return ((_chainName, label) =>
            stellarSentinelNormalizedFromLabel(label)) as AddressSentinelNormalizedFromLabel<T>;
    }
    return tiledSentinelNormalizedFromLabel as AddressSentinelNormalizedFromLabel<T>;
};

const buildSentinelNormalizedFromLabel = <T extends ChainName>(
    chainName: T,
    label: string,
    parser: AddressParser<T>,
): NormalizedHexString => {
    assertSentinelLabel(label);
    const resolvedFn = resolveSentinelNormalizedFromLabel(chainName);
    return assertSentinelRoundTrips(chainName, parser, label, resolvedFn(chainName, label));
};

/**
 * Deterministic sentinel address in normalized hex from a short hex label.
 *
 * @param chainName - Target chain; selects default tiling vs Canton/Stellar specialty builders.
 * @param label - Non-empty even-length hex (optional `0x` stripped). Must satisfy {@link tileHex}
 *                and must not start with a leading zero nibble.
 * @throws If `label` is invalid, starts with a leading zero nibble, or does not round-trip on `chainName`.
 */
export const sentinelNormalizedFromLabel = <T extends ChainName>(
    chainName: T,
    label: string,
): NormalizedHexString =>
    buildSentinelNormalizedFromLabel(chainName, label, addressParser(chainName));

/**
 * Deterministic sentinel address in the chain's native encoding.
 * Native is derived from {@link sentinelNormalizedFromLabel} via the chain parser.
 *
 * @param chainName - Target chain; native form follows that chain's encoding (hex, base58, TON user format, etc.).
 * @param label - Same rules as {@link sentinelNormalizedFromLabel}.
 * @throws Same as {@link sentinelNormalizedFromLabel}.
 */
export const sentinelNativeFromLabel = <T extends ChainName>(
    chainName: T,
    label: string,
): ResolvedEncodingForChainName<T> => {
    const parser = addressParser(chainName);
    return parser.normalizedToNativeString(
        buildSentinelNormalizedFromLabel(chainName, label, parser),
    );
};
