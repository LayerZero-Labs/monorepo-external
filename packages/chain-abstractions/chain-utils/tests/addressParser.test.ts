import { Address } from '@ton/core';
import * as bs58 from 'bs58';
import { describe, expect, it } from 'vitest';

import type { NormalizedHexString } from '@layerzerolabs/common-chain-model';
import { NORMALIZED_HEX_ZERO, normalizeHex } from '@layerzerolabs/common-chain-model';
import {
    bytesToHexPrefixed,
    hexToBytes,
    hexZeroPad,
    tileHex,
} from '@layerzerolabs/common-encoding-utils';
import {
    ChainName,
    type InitiaString,
    type StellarString,
    type TonString,
} from '@layerzerolabs/layerzero-definitions';

import {
    addressParser,
    sentinelNativeFromLabel,
    sentinelNormalizedFromLabel,
} from '../src/addressParser';

const randomBytes = (length: number): Uint8Array => {
    const bytes = new Uint8Array(length);
    for (let i = 0; i < length; i++) {
        bytes[i] = Math.floor(Math.random() * 256);
    }
    return bytes;
};

const randomHex = (byteLength: number): NormalizedHexString => {
    return normalizeHex(bytesToHexPrefixed(randomBytes(byteLength)));
};

const runPropertyTest = <T>(fn: () => T, iterations = 100): void => {
    for (let i = 0; i < iterations; i++) {
        fn();
    }
};

describe('addressParser - hex/EVM chains', () => {
    const evmChains = [ChainName.ETHEREUM, ChainName.AVALANCHE, ChainName.BSC, ChainName.POLYGON];

    evmChains.forEach((chain) => {
        describe(chain, () => {
            const chainAddressParser = addressParser(chain);

            it('maintains roundtrip invariant: hex -> native -> hex', () => {
                runPropertyTest(() => {
                    const input = randomHex(20);
                    const native = chainAddressParser.normalizedToNative(input);
                    const back = chainAddressParser.nativeToNormalized(native);
                    expect(back).toBe(input);
                });
            });

            it('maintains byte representation consistency', () => {
                runPropertyTest(() => {
                    const input = randomHex(20);
                    const nativeStr = chainAddressParser.normalizedToNativeString(input);
                    const bytesFromHex = hexToBytes(nativeStr);
                    const nativeBytes = chainAddressParser.nativeToBytes(nativeStr);

                    expect(nativeBytes).toEqual(bytesFromHex);
                });
            });

            it('correctly pads addresses', () => {
                runPropertyTest(() => {
                    const byteLength = Math.floor(Math.random() * 20) + 1;
                    const input = randomHex(byteLength);
                    const native = chainAddressParser.normalizedToNative(input);
                    expect(native.nativeAddress.length).toBe(42);
                    expect(native.chainName).toBe(chain);
                });
            });
        });
    });

    it('handles edge cases', () => {
        const evmAddressParser = addressParser(ChainName.ETHEREUM);

        const empty = normalizeHex('0x');
        expect(evmAddressParser.normalizedToNative(empty).nativeAddress.length).toBe(42);

        const max = sentinelNormalizedFromLabel(ChainName.ETHEREUM, 'ff');
        expect(evmAddressParser.nativeToNormalized(evmAddressParser.normalizedToNative(max))).toBe(
            max,
        );

        const single = normalizeHex('0x01');
        expect(evmAddressParser.normalizedToNative(single).nativeAddress).toBe(
            hexZeroPad('0x01', 20),
        );
    });
});

describe('addressParser - base58 chains (Solana)', () => {
    const solanaAddressParser = addressParser(ChainName.SOLANA);
    const SOLANA_ZERO_ADDRESS = '11111111111111111111111111111111';

    it('maintains roundtrip invariant: hex -> base58 -> hex', () => {
        runPropertyTest(() => {
            const byteLength = Math.floor(Math.random() * 32) + 1;
            const input = randomHex(byteLength);
            const native = solanaAddressParser.normalizedToNative(input);
            const back = solanaAddressParser.nativeToNormalized(native);
            expect(back).toBe(input);
        });
    });

    it('maintains base58 encoding consistency', () => {
        runPropertyTest(() => {
            const bytes = randomBytes(32);
            const nativeStr = solanaAddressParser.normalizedToNativeString(
                normalizeHex(bytesToHexPrefixed(bytes)),
            );
            const expectedBase58 = bs58.encode(bytes);
            expect(nativeStr).toBe(expectedBase58);

            const nativeBytes = solanaAddressParser.nativeToBytes(nativeStr);
            expect(nativeBytes).toEqual(bs58.decode(expectedBase58));
        });
    });

    it('converts normalized zero to the default public key', () => {
        const native = solanaAddressParser.normalizedToNative(NORMALIZED_HEX_ZERO);

        expect(native.nativeAddress).toBe(SOLANA_ZERO_ADDRESS);
        expect(solanaAddressParser.normalizedToNativeString(NORMALIZED_HEX_ZERO)).toBe(
            SOLANA_ZERO_ADDRESS,
        );
        expect(solanaAddressParser.nativeToBytes(native)).toHaveLength(32);
        expect(solanaAddressParser.nativeToNormalized(native)).toBe(NORMALIZED_HEX_ZERO);
    });

    it('round-trips variable-width normalized values', () => {
        runPropertyTest(() => {
            const byteLength = Math.floor(Math.random() * 32) + 1;
            const input = randomHex(byteLength);
            const native = solanaAddressParser.normalizedToNativeString(input);
            expect(solanaAddressParser.nativeToNormalized(native)).toBe(input);
        });
    });

    it('handles edge cases', () => {
        const single = normalizeHex('0x01');
        const singleNative = solanaAddressParser.normalizedToNative(single);
        expect(solanaAddressParser.nativeToNormalized(singleNative)).toBe(single);

        const empty = normalizeHex('0x');
        expect(() => solanaAddressParser.normalizedToNative(empty)).not.toThrow();

        const full32 = randomHex(32);
        const native32 = solanaAddressParser.normalizedToNative(full32);
        expect(solanaAddressParser.nativeToNormalized(native32)).toBe(full32);
    });
});

describe('addressParser - chain validation', () => {
    it('validates chain names for NativeAddress objects', () => {
        const evmAddressParser = addressParser(ChainName.ETHEREUM);
        const solanaAddressParser = addressParser(ChainName.SOLANA);

        const evmAddress = evmAddressParser.normalizedToNative(randomHex(20));
        const solanaAddress = solanaAddressParser.normalizedToNative(randomHex(32));

        expect(() => solanaAddressParser.nativeToNormalized(evmAddress as any)).toThrow(
            /Cannot convert/,
        );
        expect(() => evmAddressParser.nativeToNormalized(solanaAddress as any)).toThrow(
            /Cannot convert/,
        );
    });

    it('accepts string addresses without validation', () => {
        const evmAddressParser = addressParser(ChainName.ETHEREUM);
        const randomAddress = sentinelNativeFromLabel(ChainName.ETHEREUM, 'ab');

        const result = evmAddressParser.nativeToNormalized(randomAddress as any);
        expect(result).toBe(normalizeHex(randomAddress as any));

        const bytes = evmAddressParser.nativeToBytes(randomAddress as any);
        expect(bytes).toEqual(hexToBytes(randomAddress));
    });
});

describe('addressParser - TON', () => {
    const tonAddressParser = addressParser(ChainName.TON);

    it('maintains roundtrip invariant: hex -> ton address -> hex', () => {
        runPropertyTest(() => {
            const byteLength = Math.floor(Math.random() * 32) + 1;
            const input = randomHex(byteLength);
            const native = tonAddressParser.normalizedToNative(input);
            const back = tonAddressParser.nativeToNormalized(native);

            expect(input).toBe(back);
        });
    });

    it('correctly handles TON address format', () => {
        runPropertyTest(() => {
            const input = randomHex(32);
            const native = tonAddressParser.normalizedToNative(input);

            expect(native.chainName).toBe(ChainName.TON);

            expect(typeof native.nativeAddress).toBe('string');
            expect(native.nativeAddress.length).toBeGreaterThan(0);
        });
    });

    it('maintains byte representation consistency', () => {
        runPropertyTest(() => {
            const input = randomHex(32);
            const nativeStr = tonAddressParser.normalizedToNativeString(input);
            const nativeBytes = tonAddressParser.nativeToBytes(nativeStr);

            expect(nativeBytes).toBeInstanceOf(Uint8Array);

            const backFromBytes = tonAddressParser.nativeToNormalized(
                tonAddressParser.normalizedToNative(input),
            );
            expect(backFromBytes).toBe(input);
        });
    });

    it('handles edge cases', () => {
        const zero = normalizeHex('0x0');
        const zeroNative = tonAddressParser.normalizedToNative(zero);
        expect(() => tonAddressParser.nativeToNormalized(zeroNative)).not.toThrow();

        const large = normalizeHex(tileHex('ff', 64));
        const largeNative = tonAddressParser.normalizedToNative(large);
        const largeBack = tonAddressParser.nativeToNormalized(largeNative);
        expect(BigInt(largeBack as any)).toBe(BigInt(large as any));

        const single = normalizeHex('0x01');
        const singleNative = tonAddressParser.normalizedToNative(single);
        const singleBack = tonAddressParser.nativeToNormalized(singleNative);
        expect(BigInt(singleBack as any)).toBe(1n);
    });

    it('validates native addresses', () => {
        const validAddress = tonAddressParser.normalizedToNative(randomHex(32));
        expect(tonAddressParser.validateNative(validAddress.nativeAddress)).toBe(true);

        expect(tonAddressParser.validateNative('invalid-ton-address')).toBe(false);
    });

    describe('strict native format', () => {
        const hash = 'ab'.repeat(32);
        const normalized = normalizeHex(`0x${hash}`);
        const address = Address.parse(`0:${hash}`);
        const raw = `0:${hash}`;
        const bounceable = address.toString();
        const nonBounceable = address.toString({ bounceable: false });
        const testnet = address.toString({ testOnly: true });

        it.each([
            ['bounceable friendly', bounceable],
            ['non-bounceable friendly', nonBounceable],
            ['testnet friendly', testnet],
            ['raw', raw],
            ['raw upper-case', raw.toUpperCase()],
        ])('accepts the %s form and normalizes it to the account hash', (_label, native) => {
            expect(tonAddressParser.validateNative(native)).toBe(true);
            expect(tonAddressParser.parseNative(native)).toBe(normalized);
            expect(tonAddressParser.nativeToNormalized(native as TonString)).toBe(normalized);
        });

        it.each([
            ['0x hex', `0x${hash}`],
            ['bare hex', hash],
            ['base58', bs58.encode(hexToBytes(`0x${hash}`))],
            ['a bad checksum', `${bounceable.slice(0, -1)}${bounceable.endsWith('A') ? 'B' : 'A'}`],
            ['an empty string', ''],
            ['undefined', undefined],
        ])('rejects %s', (_label, native) => {
            expect(tonAddressParser.validateNative(native)).toBe(false);
            expect(() => tonAddressParser.parseNative(native)).toThrow();
        });

        it('returns the bounceable friendly form from normalizedToNative', () => {
            expect(tonAddressParser.normalizedToNativeString(normalized)).toBe(bounceable);
        });

        it('normalizes a TON Address without going through a native string', () => {
            expect(tonAddressParser.tonToNormalized(address)).toBe(normalized);
        });
    });
});

describe('addressParser - Initia', () => {
    const initiaAddressParser = addressParser(ChainName.INITIA);

    it('pads native bytes to 32 bytes when the address has a leading zero nibble', () => {
        const leadingZeroNibble = `0x0${'b'.repeat(63)}` as InitiaString;

        const bytes = initiaAddressParser.nativeToBytes(leadingZeroNibble)!;

        expect(bytes.length).toBe(32);
        expect(bytesToHexPrefixed(bytes)).toBe(leadingZeroNibble);
    });

    it('keeps native bytes at 32 bytes when the address has no leading zeros', () => {
        const noLeadingZeros = `0x${'b'.repeat(64)}` as InitiaString;

        const bytes = initiaAddressParser.nativeToBytes(noLeadingZeros)!;

        expect(bytes.length).toBe(32);
        expect(bytesToHexPrefixed(bytes)).toBe(noLeadingZeros);
    });
});

describe('addressParser - Stellar', () => {
    const stellarAddressParser = addressParser(ChainName.STELLAR);

    const validTestAddresses = {
        account: 'GA7QYNF7SOWQ3GLR2BGMZEHXAVIRZA4KVWLTJJFC7MGXUA74P7UJVSGZ' as StellarString,

        contract: 'CA7QYNF7SOWQ3GLR2BGMZEHXAVIRZA4KVWLTJJFC7MGXUA74P7UJUWDA' as StellarString,

        muxed: 'MA7QYNF7SOWQ3GLR2BGMZEHXAVIRZA4KVWLTJJFC7MGXUA74P7UJUAAAAAAAAAAAACJUQ' as StellarString,

        liquidityPool: 'LA7QYNF7SOWQ3GLR2BGMZEHXAVIRZA4KVWLTJJFC7MGXUA74P7UJUPJN' as StellarString,

        claimableBalance:
            'BAAD6DBUX6J22DMZOHIEZTEQ64CVCHEDRKWZONFEUL5Q26QD7R76RGR4TU' as StellarString,

        signedPayload:
            'PA7QYNF7SOWQ3GLR2BGMZEHXAVIRZA4KVWLTJJFC7MGXUA74P7UJUAAAAAQACAQDAQCQMBYIBEFAWDANBYHRAEISCMKBKFQXDAMRUGY4DUPB6IBZGM' as StellarString,
    };

    describe('roundtrip conversions', () => {
        it('maintains roundtrip invariant for account addresses (G...)', () => {
            const stellarAddress = validTestAddresses.account;
            const normalized = stellarAddressParser.nativeToNormalized(stellarAddress);
            const native = stellarAddressParser.normalizedToNative(normalized)!;

            expect(native.nativeAddress).toBe(stellarAddress);
            expect(native.chainName).toBe(ChainName.STELLAR);
        });

        it('maintains roundtrip invariant for contract addresses (C...)', () => {
            const stellarAddress = validTestAddresses.contract;
            const normalized = stellarAddressParser.nativeToNormalized(stellarAddress);
            const native = stellarAddressParser.normalizedToNative(normalized)!;

            expect(native.nativeAddress).toBe(stellarAddress);
        });

        it('maintains roundtrip invariant for muxed addresses (M...)', () => {
            const stellarAddress = validTestAddresses.muxed;
            const normalized = stellarAddressParser.nativeToNormalized(stellarAddress);
            const native = stellarAddressParser.normalizedToNative(normalized)!;

            expect(native.nativeAddress).toBe(stellarAddress);
        });

        it('maintains roundtrip invariant for liquidity pool addresses (L...)', () => {
            const stellarAddress = validTestAddresses.liquidityPool;
            const normalized = stellarAddressParser.nativeToNormalized(stellarAddress);
            const native = stellarAddressParser.normalizedToNative(normalized)!;

            expect(native.nativeAddress).toBe(stellarAddress);
        });

        it('maintains roundtrip invariant for claimable balance addresses (B...)', () => {
            const stellarAddress = validTestAddresses.claimableBalance;
            const normalized = stellarAddressParser.nativeToNormalized(stellarAddress);
            const native = stellarAddressParser.normalizedToNative(normalized)!;

            expect(native.nativeAddress).toBe(stellarAddress);
        });

        it('maintains roundtrip invariant for signed payload (P...)', () => {
            const stellarAddress = validTestAddresses.signedPayload;
            const normalized = stellarAddressParser.nativeToNormalized(stellarAddress);
            const native = stellarAddressParser.normalizedToNative(normalized)!;

            expect(native.nativeAddress).toBe(stellarAddress);
        });
    });

    describe('validation', () => {
        it('validates all valid Stellar address types', () => {
            expect(stellarAddressParser.validateNative(validTestAddresses.account)).toBe(true);
            expect(stellarAddressParser.validateNative(validTestAddresses.contract)).toBe(true);
            expect(stellarAddressParser.validateNative(validTestAddresses.muxed)).toBe(true);
            expect(stellarAddressParser.validateNative(validTestAddresses.liquidityPool)).toBe(
                true,
            );
            expect(stellarAddressParser.validateNative(validTestAddresses.claimableBalance)).toBe(
                true,
            );
            expect(stellarAddressParser.validateNative(validTestAddresses.signedPayload)).toBe(
                true,
            );
        });

        it('rejects invalid Stellar addresses', () => {
            const invalidAddresses = [
                'GAAAAAAAACGC6',
                'GA7QYNF7SOWQ3GLR2BGMZEHXAVIRZA4KVWLTJJFC7MGXUA74P7UJVSGZA',
                'G47QYNF7SOWQ3GLR2BGMZEHXAVIRZA4KVWLTJJFC7MGXUA74P7UJVP2I',
                'invalid-stellar-address',
                '',
                '0x1234567890abcdef',
            ];

            invalidAddresses.forEach((addr) => {
                expect(stellarAddressParser.validateNative(addr)).toBe(false);
            });
        });

        it('rejects undefined addresses', () => {
            expect(stellarAddressParser.validateNative(undefined)).toBe(false);
        });
    });

    describe('ASCII encoding/decoding', () => {
        it('converts Stellar address to UTF-8 bytes correctly', () => {
            const stellarAddress = validTestAddresses.account;
            const bytes = stellarAddressParser.nativeToBytes(stellarAddress)!;

            const decoder = new TextDecoder();
            const decoded = decoder.decode(bytes);
            expect(decoded).toBe(stellarAddress);
        });

        it('preserves address length in byte representation', () => {
            const accountBytes = stellarAddressParser.nativeToBytes(validTestAddresses.account)!;
            expect(accountBytes.length).toBe(56);

            const muxedBytes = stellarAddressParser.nativeToBytes(validTestAddresses.muxed)!;
            expect(muxedBytes.length).toBe(69);

            const payloadBytes = stellarAddressParser.nativeToBytes(
                validTestAddresses.signedPayload,
            )!;
            expect(payloadBytes.length).toBeGreaterThan(56);
        });

        it('normalizedToNativeString returns the address string', () => {
            const stellarAddress = validTestAddresses.account;
            const normalized = stellarAddressParser.nativeToNormalized(stellarAddress);
            const nativeString = stellarAddressParser.normalizedToNativeString(normalized);

            expect(nativeString).toBe(stellarAddress);
        });

        it('normalizedToNativeString throws for non-StrKey hex', () => {
            expect(() =>
                stellarAddressParser.normalizedToNativeString(normalizeHex(tileHex('ab', 64))),
            ).toThrow(/Cannot convert/);
            expect(() =>
                stellarAddressParser.normalizedToNative(normalizeHex('0xdeadbeef')),
            ).toThrow(/Cannot convert/);
        });
    });

    describe('parseNative', () => {
        it('parses valid Stellar addresses', () => {
            const stellarAddress = validTestAddresses.account;
            const normalized = stellarAddressParser.parseNative(stellarAddress);

            expect(normalized).toMatch(/^0x[0-9a-f]+$/);
        });

        it('throws on invalid addresses', () => {
            expect(() => stellarAddressParser.parseNative('invalid-stellar-address')).toThrow(
                /Cannot convert/,
            );
        });

        it('does not treat a peer bytes32 payload as a native address', () => {
            expect(() => stellarAddressParser.parseNative(tileHex('00', 64))).toThrow(
                /Cannot convert/,
            );
        });

        it('parseNativeToUnpaddedHex returns hex string', () => {
            const stellarAddress = validTestAddresses.account;
            const hex = stellarAddressParser.parseNativeToUnpaddedHex(stellarAddress);

            expect(hex).toMatch(/^0x[0-9a-f]+$/);
            expect(hex).toBe(stellarAddressParser.parseNative(stellarAddress));
        });
    });

    describe('address type preservation', () => {
        it('preserves address type information through conversion', () => {
            const addresses = [
                { addr: validTestAddresses.account, prefix: 'G' },
                { addr: validTestAddresses.contract, prefix: 'C' },
                { addr: validTestAddresses.muxed, prefix: 'M' },
                { addr: validTestAddresses.liquidityPool, prefix: 'L' },
                { addr: validTestAddresses.claimableBalance, prefix: 'B' },
                { addr: validTestAddresses.signedPayload, prefix: 'P' },
            ];

            addresses.forEach(({ addr, prefix }) => {
                const normalized = stellarAddressParser.nativeToNormalized(addr);
                const recovered = stellarAddressParser.normalizedToNative(normalized)!;

                expect(recovered.nativeAddress.startsWith(prefix)).toBe(true);
                expect(recovered.nativeAddress).toBe(addr);
            });
        });
    });

    describe('edge cases', () => {
        it('handles ChainNativeAddress objects', () => {
            const nativeObj = {
                chainName: ChainName.STELLAR as const,
                nativeAddress: validTestAddresses.account,
            };

            const normalized = stellarAddressParser.nativeToNormalized(nativeObj);
            expect(normalized).toMatch(/^0x[0-9a-f]+$/);
        });

        it('returns undefined for undefined inputs', () => {
            expect(stellarAddressParser.normalizedToNative(undefined)).toBeUndefined();
            expect(stellarAddressParser.normalizedToNativeString(undefined)).toBeUndefined();
            expect(stellarAddressParser.nativeToNormalized(undefined)).toBeUndefined();
            expect(stellarAddressParser.nativeToBytes(undefined)).toBeUndefined();
        });

        it('handles different address lengths correctly', () => {
            const short = validTestAddresses.account;
            const shortBytes = stellarAddressParser.nativeToBytes(short)!;
            expect(shortBytes.length).toBe(56);

            const medium = validTestAddresses.muxed;
            const mediumBytes = stellarAddressParser.nativeToBytes(medium)!;
            expect(mediumBytes.length).toBe(69);

            const long = validTestAddresses.signedPayload;
            const longBytes = stellarAddressParser.nativeToBytes(long)!;
            expect(longBytes.length).toBeGreaterThan(69);
        });
    });

    describe('encoding type', () => {
        it('has STELLAR encoding type', () => {
            expect(stellarAddressParser.encoding).toBe('stellar');
        });
    });
});

describe('addressParser - sentinelFromLabel', () => {
    const SENTINEL_LABEL = 'c0';
    const SENTINEL_LABEL_WIDE = 'c1da';

    it('tiles a 1-byte label across a 20-byte EVM address', () => {
        expect(sentinelNativeFromLabel(ChainName.ETHEREUM, SENTINEL_LABEL)).toBe(
            tileHex(SENTINEL_LABEL, 40),
        );
    });

    it('tiles a multi-byte label, truncating to the address width', () => {
        expect(sentinelNativeFromLabel(ChainName.ETHEREUM, SENTINEL_LABEL_WIDE)).toBe(
            tileHex(SENTINEL_LABEL_WIDE, 40),
        );
    });

    it('uses a 32-byte hex for non-EVM/Solana chains (Aptos)', () => {
        expect(sentinelNativeFromLabel(ChainName.APTOS, SENTINEL_LABEL)).toBe(
            tileHex(SENTINEL_LABEL, 64),
        );
    });

    it('produces a base58 Solana address that round-trips to the tiled 32 bytes', () => {
        const native = sentinelNativeFromLabel(ChainName.SOLANA, SENTINEL_LABEL);
        expect([...bs58.decode(native)]).toEqual([...hexToBytes(tileHex(SENTINEL_LABEL, 64))]);
    });

    it.each([
        ChainName.ETHEREUM,
        ChainName.APTOS,
        ChainName.SOLANA,
        ChainName.STARKNET,
        ChainName.TON,
        ChainName.INITIA,
        ChainName.STELLAR,
        ChainName.CANTON,
    ] as const)('round-trips sentinel addresses for %s', (chainName) => {
        const parser = addressParser(chainName);
        const native = sentinelNativeFromLabel(chainName, SENTINEL_LABEL);
        const normalized = sentinelNormalizedFromLabel(chainName, SENTINEL_LABEL);

        expect(parser.validateNative(native)).toBe(true);
        expect(parser.parseNative(native)).toBe(normalized);
        expect(parser.normalizedToNativeString(normalized)).toBe(native);
    });

    it('builds a Canton party sentinel with the trailing 01 discriminator', () => {
        const normalized = sentinelNormalizedFromLabel(ChainName.CANTON, SENTINEL_LABEL);

        expect(String(normalized).endsWith('01')).toBe(true);
        expect(sentinelNativeFromLabel(ChainName.CANTON, SENTINEL_LABEL)).toMatch(
            /^<<CANTON_PARTY::c0::1220(?:c0){32}>>$/,
        );
    });

    it('builds a Stellar contract sentinel from tiled 32-byte payload', () => {
        const native = sentinelNativeFromLabel(ChainName.STELLAR, SENTINEL_LABEL);

        expect(native.startsWith('C')).toBe(true);
    });

    const LEADING_ZERO_LABEL_ERROR = /leading zero nibble/;

    it.each([ChainName.ETHEREUM, ChainName.CANTON, ChainName.STARKNET] as const)(
        'rejects sentinel labels starting with a leading zero nibble on %s',
        (chainName) => {
            for (const label of ['00', '0a'] as const) {
                expect(() => sentinelNormalizedFromLabel(chainName, label)).toThrow(
                    LEADING_ZERO_LABEL_ERROR,
                );
                expect(() => sentinelNativeFromLabel(chainName, label)).toThrow(
                    LEADING_ZERO_LABEL_ERROR,
                );
            }
        },
    );
});
