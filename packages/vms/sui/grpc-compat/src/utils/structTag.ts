/**
 * Move type strings, normalized to JSON-RPC's rendering.
 *
 * gRPC prints every address fully-padded and no space after a type argument's
 * comma, where JSON-RPC strips leading zeros only for the system addresses
 * below (keeping every other address, e.g. a deployed package, at full
 * 64-hex width) and adds a space after each comma:
 *
 *   gRPC      `0x0000…0002::dynamic_field::Field<u64,bool>`
 *   JSON-RPC  `0x2::dynamic_field::Field<u64, bool>`
 *
 *   gRPC      `0x00c1a56e…::usdc::USDC`
 *   JSON-RPC  `0x00c1a56e…::usdc::USDC` (unchanged — not a system address)
 *
 * Callers compare these strings — against a coin type, or to pick a struct out
 * of a transaction's object changes — so leaving the gRPC form in place makes
 * those comparisons silently fail.
 */
export const toShortStructTag = (structTag: string): string =>
    toShortAddress(structTag).replace(/,\s*/g, ', ');

/**
 * The addresses of the Move stdlib (0x1), Sui framework (0x2) and Sui system (0x3) packages —
 * the only ones whose type-tag rendering JSON-RPC shortens (confirmed against mainnet
 * `objectChanges`; every other address, e.g. a deployed package, stays at full 64-hex width).
 * Hardcoded rather than imported from `@mysten/sui`: this package also depends on `@mysten/sui-v2`
 * (a different major version, catalog-aliased to the same `@mysten/sui` name), and the two
 * versions render these same constants differently (short vs. zero-padded).
 */
const SYSTEM_ADDRESSES: ReadonlySet<string> = new Set(['0x1', '0x2', '0x3']);

/** The address half of the same normalization, for fields that carry only one. */
export const toShortAddress = (address: string): string =>
    address.replace(/0x[0-9a-f]+/gi, (match) => {
        const short = `0x${match
            .slice(2)
            .toLowerCase()
            .replace(/^0+(?=.)/, '')}`;
        return SYSTEM_ADDRESSES.has(short) ? short : match;
    });

/**
 * Move type tags as rendered by legacy devInspect (and by the SDK's own
 * `normalizeSuiPackageId(id, true, true)`) omit leading zeros from *every* address, not just the
 * system addresses `toShortAddress` shortens above. That rule is specific to `objectChanges`
 * (confirmed against mainnet); devInspect return-value type tags — read by
 * `configurePtbSimulation` and the SDK's `decodeMoveCalls` — use this one instead.
 */
export const toTypeTagAddress = (address: string): string =>
    address.replace(
        /0x[0-9a-f]+/gi,
        (match) =>
            `0x${match
                .slice(2)
                .toLowerCase()
                .replace(/^0+(?=.)/, '')}`,
    );

/**
 * Splits `0x2::coin::Coin<0x2::sui::SUI>` into its base type and the text between its outer angle
 * brackets. `typeArgs` is `undefined` when the type has no `<...>` suffix.
 */
export const splitTypeArgs = (type: string): { base: string; typeArgs: string | undefined } => {
    const typeArgsStart = type.indexOf('<');
    if (typeArgsStart === -1 || !type.endsWith('>')) {
        return { base: type, typeArgs: undefined };
    }
    return { base: type.slice(0, typeArgsStart), typeArgs: type.slice(typeArgsStart + 1, -1) };
};

/** `0x2::coin::Coin<0x…::wbtc::WBTC>` -> `0x…::wbtc::WBTC`. */
export const coinTypeFromObjectType = (objectType: string | undefined): string => {
    const typeArgs = objectType === undefined ? undefined : splitTypeArgs(objectType).typeArgs;

    return typeArgs === undefined ? '' : toShortStructTag(typeArgs);
};
