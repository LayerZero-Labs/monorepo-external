import { Address } from '@ton/core';
import * as bs58 from 'bs58';
import { describe, expect, it } from 'vitest';

import type { HexString, NormalizedHexString } from '@layerzerolabs/common-chain-model';
import { NORMALIZED_HEX_ZERO, normalizeHex } from '@layerzerolabs/common-chain-model';
import {
    bytesToHexPrefixed,
    hexToBytes,
    hexZeroPad,
    tileHex,
} from '@layerzerolabs/common-encoding-utils';
import { ChainName, type TonString } from '@layerzerolabs/layerzero-definitions';

import {
    addressParser,
    sentinelNativeFromLabel,
    sentinelNormalizedFromLabel,
} from '../src/addressParser';

// Test data generators
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
                    const byteLength = Math.floor(Math.random() * 20) + 1; // 1-20 bytes
                    const input = randomHex(byteLength);
                    const native = chainAddressParser.normalizedToNative(input);
                    expect(native.nativeAddress.length).toBe(42); // Always 20 bytes padded
                    expect(native.chainName).toBe(chain);
                });
            });
        });
    });

    it('normalizedToBytes32Hex pads correctly', () => {
        runPropertyTest(() => {
            const byteLength = Math.floor(Math.random() * 32) + 1; // 1-32 bytes
            const input = randomHex(byteLength);
            const padded = addressParser(ChainName.ETHEREUM).normalizedToBytes32Hex(input);
            expect(padded.length).toBe(66); // 32 bytes -> 64 hex chars + 0x
            expect(padded).toBe(hexZeroPad(input as any, 32));
        });
    });

    it('handles edge cases', () => {
        const evmAddressParser = addressParser(ChainName.ETHEREUM);

        // Empty address
        const empty = normalizeHex('0x');
        expect(evmAddressParser.normalizedToNative(empty).nativeAddress.length).toBe(42);

        // Maximum value
        const max = sentinelNormalizedFromLabel(ChainName.ETHEREUM, 'ff');
        expect(evmAddressParser.nativeToNormalized(evmAddressParser.normalizedToNative(max))).toBe(
            max,
        );

        // Single byte
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
            const byteLength = Math.floor(Math.random() * 32) + 1; // 1-32 bytes
            const input = randomHex(byteLength);
            const native = solanaAddressParser.normalizedToNative(input);
            const back = solanaAddressParser.nativeToNormalized(native);
            expect(back).toBe(input);
        });
    });

    it('maintains base58 encoding consistency', () => {
        runPropertyTest(() => {
            const input = randomHex(32);
            const nativeStr = solanaAddressParser.normalizedToNativeString(input);
            const expectedBase58 = bs58.encode(
                hexToBytes(solanaAddressParser.normalizedToBytes32Hex(input)),
            );
            expect(nativeStr).toBe(expectedBase58);

            // Verify bytes consistency
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

    it('correctly handles 32-byte padding', () => {
        runPropertyTest(() => {
            const byteLength = Math.floor(Math.random() * 32) + 1;
            const input = randomHex(byteLength);
            const native = solanaAddressParser.normalizedToNativeString(input);
            const padded = solanaAddressParser.nativeToBytes32Hex(native);
            expect(padded.length).toBe(66);

            // input is already a NormalizedHexString, so it round-trips to itself. No re-decode:
            // hexToBytes would reject the odd-length hex normalizeHex yields once leading nibbles strip.
            expect(solanaAddressParser.nativeToNormalized(native)).toBe(input);
        });
    });

    it('handles edge cases', () => {
        // Single byte
        const single = normalizeHex('0x01');
        const singleNative = solanaAddressParser.normalizedToNative(single);
        expect(solanaAddressParser.nativeToNormalized(singleNative)).toBe(single);

        // Empty (though typically invalid for Solana)
        const empty = normalizeHex('0x');
        expect(() => solanaAddressParser.normalizedToNative(empty)).not.toThrow();

        // 32 bytes (typical Solana address length)
        const full32 = randomHex(32);
        const native32 = solanaAddressParser.normalizedToNative(full32);
        expect(solanaAddressParser.nativeToNormalized(native32)).toBe(full32);
    });
});

describe('addressParser - chain validation', () => {
    it('validates chain names for nativeToBytes32Hex', () => {
        const evmAddressParser = addressParser(ChainName.ETHEREUM);
        const solanaAddressParser = addressParser(ChainName.SOLANA);

        const evmAddress = evmAddressParser.normalizedToNative(randomHex(20));
        const solanaAddress = solanaAddressParser.normalizedToNative(randomHex(32));

        // nativeTo32BytesHex validates chain names for NativeAddress objects
        expect(() => solanaAddressParser.nativeToBytes32Hex(evmAddress as any)).toThrow(
            /Cannot convert/,
        );
        expect(() => evmAddressParser.nativeToBytes32Hex(solanaAddress as any)).toThrow(
            /Cannot convert/,
        );
    });

    it('accepts string addresses without validation', () => {
        const evmAddressParser = addressParser(ChainName.ETHEREUM);
        const randomAddress = sentinelNativeFromLabel(ChainName.ETHEREUM, 'ab');

        // String addresses bypass chain validation for all methods
        const result = evmAddressParser.nativeToNormalized(randomAddress as any);
        expect(result).toBe(normalizeHex(randomAddress as any));

        const padded = evmAddressParser.nativeToBytes32Hex(randomAddress as any)!;
        expect(padded.length).toBe(66);

        const bytes = evmAddressParser.nativeToBytes(randomAddress as any);
        expect(bytes).toEqual(hexToBytes(randomAddress));
    });
});

describe('addressParser - TON', () => {
    const tonAddressParser = addressParser(ChainName.TON);

    it('maintains roundtrip invariant: hex -> ton address -> hex', () => {
        runPropertyTest(() => {
            // TON addresses are typically 32 bytes (256 bits)
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

            // TON addresses should have the correct chain name
            expect(native.chainName).toBe(ChainName.TON);

            // Should be a valid TON address string
            expect(typeof native.nativeAddress).toBe('string');
            expect(native.nativeAddress.length).toBeGreaterThan(0);
        });
    });

    it('maintains byte representation consistency', () => {
        runPropertyTest(() => {
            const input = randomHex(32);
            const nativeStr = tonAddressParser.normalizedToNativeString(input);
            const nativeBytes = tonAddressParser.nativeToBytes(nativeStr);

            // Both should produce valid byte arrays
            expect(nativeBytes).toBeInstanceOf(Uint8Array);

            // Converting back should preserve the value
            const backFromBytes = tonAddressParser.nativeToNormalized(
                tonAddressParser.normalizedToNative(input),
            );
            expect(backFromBytes).toBe(input);
        });
    });

    it('correctly handles 32-byte padding', () => {
        runPropertyTest(() => {
            const byteLength = Math.floor(Math.random() * 32) + 1;
            const input = randomHex(byteLength);
            const native = tonAddressParser.normalizedToNativeString(input);
            const padded = tonAddressParser.nativeToBytes32Hex(native)!;

            expect(padded.length).toBe(66); // 32 bytes -> 64 hex chars + 0x

            // Verify the numeric value is preserved
            const paddedBigInt = BigInt(padded);
            const inputBigInt = BigInt(input as any);
            expect(paddedBigInt).toBe(inputBigInt);
        });
    });

    it('handles edge cases', () => {
        // Zero address
        const zero = normalizeHex('0x0');
        const zeroNative = tonAddressParser.normalizedToNative(zero);
        expect(() => tonAddressParser.nativeToNormalized(zeroNative)).not.toThrow();

        // Large values
        const large = normalizeHex(tileHex('ff', 64));
        const largeNative = tonAddressParser.normalizedToNative(large);
        const largeBack = tonAddressParser.nativeToNormalized(largeNative);
        expect(BigInt(largeBack as any)).toBe(BigInt(large as any));

        // Single byte
        const single = normalizeHex('0x01');
        const singleNative = tonAddressParser.normalizedToNative(single);
        const singleBack = tonAddressParser.nativeToNormalized(singleNative);
        expect(BigInt(singleBack as any)).toBe(1n);
    });

    it('validates native addresses', () => {
        const validAddress = tonAddressParser.normalizedToNative(randomHex(32));
        expect(tonAddressParser.validateNative(validAddress.nativeAddress)).toBe(true);

        // Invalid addresses should return false
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

describe('addressParser - Stellar', () => {
    const stellarAddressParser = addressParser(ChainName.STELLAR);

    // Valid test addresses from SEP-0023 specification
    const validTestAddresses = {
        // Account address (G...)
        account: 'GA7QYNF7SOWQ3GLR2BGMZEHXAVIRZA4KVWLTJJFC7MGXUA74P7UJVSGZ',
        // Contract address (C...)
        contract: 'CA7QYNF7SOWQ3GLR2BGMZEHXAVIRZA4KVWLTJJFC7MGXUA74P7UJUWDA',
        // Muxed address (M...)
        muxed: 'MA7QYNF7SOWQ3GLR2BGMZEHXAVIRZA4KVWLTJJFC7MGXUA74P7UJUAAAAAAAAAAAACJUQ',
        // Liquidity pool address (L...)
        liquidityPool: 'LA7QYNF7SOWQ3GLR2BGMZEHXAVIRZA4KVWLTJJFC7MGXUA74P7UJUPJN',
        // Claimable balance address (B...)
        claimableBalance: 'BAAD6DBUX6J22DMZOHIEZTEQ64CVCHEDRKWZONFEUL5Q26QD7R76RGR4TU',
        // Signed payload (P...)
        signedPayload:
            'PA7QYNF7SOWQ3GLR2BGMZEHXAVIRZA4KVWLTJJFC7MGXUA74P7UJUAAAAAQACAQDAQCQMBYIBEFAWDANBYHRAEISCMKBKFQXDAMRUGY4DUPB6IBZGM',
    };

    describe('roundtrip conversions', () => {
        it('maintains roundtrip invariant for account addresses (G...)', () => {
            const stellarAddress = validTestAddresses.account;
            const normalized = stellarAddressParser.nativeToNormalized(stellarAddress as any);
            const native = stellarAddressParser.normalizedToNative(normalized)!;

            expect(native.nativeAddress).toBe(stellarAddress);
            expect(native.chainName).toBe(ChainName.STELLAR);
        });

        it('maintains roundtrip invariant for contract addresses (C...)', () => {
            const stellarAddress = validTestAddresses.contract;
            const normalized = stellarAddressParser.nativeToNormalized(stellarAddress as any);
            const native = stellarAddressParser.normalizedToNative(normalized)!;

            expect(native.nativeAddress).toBe(stellarAddress);
        });

        it('maintains roundtrip invariant for muxed addresses (M...)', () => {
            const stellarAddress = validTestAddresses.muxed;
            const normalized = stellarAddressParser.nativeToNormalized(stellarAddress as any);
            const native = stellarAddressParser.normalizedToNative(normalized)!;

            expect(native.nativeAddress).toBe(stellarAddress);
        });

        it('maintains roundtrip invariant for liquidity pool addresses (L...)', () => {
            const stellarAddress = validTestAddresses.liquidityPool;
            const normalized = stellarAddressParser.nativeToNormalized(stellarAddress as any);
            const native = stellarAddressParser.normalizedToNative(normalized)!;

            expect(native.nativeAddress).toBe(stellarAddress);
        });

        it('maintains roundtrip invariant for claimable balance addresses (B...)', () => {
            const stellarAddress = validTestAddresses.claimableBalance;
            const normalized = stellarAddressParser.nativeToNormalized(stellarAddress as any);
            const native = stellarAddressParser.normalizedToNative(normalized)!;

            expect(native.nativeAddress).toBe(stellarAddress);
        });

        it('maintains roundtrip invariant for signed payload (P...)', () => {
            const stellarAddress = validTestAddresses.signedPayload;
            const normalized = stellarAddressParser.nativeToNormalized(stellarAddress as any);
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
            // Invalid addresses from SEP-0023 test cases
            const invalidAddresses = [
                'GAAAAAAAACGC6', // Invalid length
                'GA7QYNF7SOWQ3GLR2BGMZEHXAVIRZA4KVWLTJJFC7MGXUA74P7UJVSGZA', // Invalid length
                'G47QYNF7SOWQ3GLR2BGMZEHXAVIRZA4KVWLTJJFC7MGXUA74P7UJVP2I', // Invalid algorithm
                'invalid-stellar-address',
                '',
                '0x1234567890abcdef', // EVM address
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
            const bytes = stellarAddressParser.nativeToBytes(stellarAddress as any)!;

            // Verify it's UTF-8 encoded ASCII
            const decoder = new TextDecoder();
            const decoded = decoder.decode(bytes);
            expect(decoded).toBe(stellarAddress);
        });

        it('preserves address length in byte representation', () => {
            // Account address (56 chars)
            const accountBytes = stellarAddressParser.nativeToBytes(
                validTestAddresses.account as any,
            )!;
            expect(accountBytes.length).toBe(56);

            // Muxed address (69 chars)
            const muxedBytes = stellarAddressParser.nativeToBytes(validTestAddresses.muxed as any)!;
            expect(muxedBytes.length).toBe(69);

            // Signed payload (variable length)
            const payloadBytes = stellarAddressParser.nativeToBytes(
                validTestAddresses.signedPayload as any,
            )!;
            expect(payloadBytes.length).toBeGreaterThan(56);
        });

        it('normalizedToNativeString returns the address string', () => {
            const stellarAddress = validTestAddresses.account;
            const normalized = stellarAddressParser.nativeToNormalized(stellarAddress as any);
            const nativeString = stellarAddressParser.normalizedToNativeString(normalized);

            expect(nativeString).toBe(stellarAddress);
        });
    });

    describe('parseNative', () => {
        it('parses valid Stellar addresses', () => {
            const stellarAddress = validTestAddresses.account;
            const normalized = stellarAddressParser.parseNative(stellarAddress as any);

            // Should return normalized hex representation
            expect(normalized).toMatch(/^0x[0-9a-f]+$/);
        });

        it('throws on invalid addresses', () => {
            expect(() =>
                stellarAddressParser.parseNative('invalid-stellar-address' as any),
            ).toThrow(/Cannot convert/);
        });

        it('parseNativeToUnpaddedHex returns hex string', () => {
            const stellarAddress = validTestAddresses.account;
            const hex = stellarAddressParser.parseNativeToUnpaddedHex(stellarAddress as any);

            expect(hex).toMatch(/^0x[0-9a-f]+$/);
            expect(hex).toBe(stellarAddressParser.parseNative(stellarAddress as any));
        });
    });

    describe('bytes32 operations', () => {
        it('decodes account address (G...) to 32 bytes', () => {
            const stellarAddress = validTestAddresses.account;
            const bytes32Hex = stellarAddressParser.nativeToBytes32Hex(stellarAddress as any)!;
            const bytes32 = stellarAddressParser.nativeToBytes32(stellarAddress as any)!;

            // Should be 32 bytes (64 hex chars + 0x)
            expect(bytes32Hex.length).toBe(66);
            expect(bytes32Hex).toMatch(/^0x[0-9a-f]{64}$/);

            // Bytes should be 32 bytes
            expect(bytes32.length).toBe(32);

            // Both methods should produce consistent results
            expect(bytesToHexPrefixed(bytes32)).toBe(bytes32Hex);
        });

        it('decodes contract address (C...) to 32 bytes', () => {
            const stellarAddress = validTestAddresses.contract;
            const bytes32Hex = stellarAddressParser.nativeToBytes32Hex(stellarAddress as any)!;
            const bytes32 = stellarAddressParser.nativeToBytes32(stellarAddress as any)!;

            expect(bytes32Hex.length).toBe(66);
            expect(bytes32.length).toBe(32);
            expect(bytesToHexPrefixed(bytes32)).toBe(bytes32Hex);
        });

        it('decodes liquidity pool address (L...) to 32 bytes', () => {
            const stellarAddress = validTestAddresses.liquidityPool;
            const bytes32Hex = stellarAddressParser.nativeToBytes32Hex(stellarAddress as any)!;
            const bytes32 = stellarAddressParser.nativeToBytes32(stellarAddress as any)!;

            expect(bytes32Hex.length).toBe(66);
            expect(bytes32.length).toBe(32);
            expect(bytesToHexPrefixed(bytes32)).toBe(bytes32Hex);
        });

        it('decodes claimable balance address (B...) to 32 bytes (skipping version byte)', () => {
            const stellarAddress = validTestAddresses.claimableBalance;
            const bytes32Hex = stellarAddressParser.nativeToBytes32Hex(stellarAddress as any)!;
            const bytes32 = stellarAddressParser.nativeToBytes32(stellarAddress as any)!;

            // Should be 32 bytes (64 hex chars + 0x)
            expect(bytes32Hex.length).toBe(66);
            expect(bytes32Hex).toMatch(/^0x[0-9a-f]{64}$/);

            // Bytes should be 32 bytes (the hash, without the version byte)
            expect(bytes32.length).toBe(32);

            // Both methods should produce consistent results
            expect(bytesToHexPrefixed(bytes32)).toBe(bytes32Hex);
        });

        it('throws error for muxed address (M...) - not 32 bytes', () => {
            const stellarAddress = validTestAddresses.muxed;

            expect(() => stellarAddressParser.nativeToBytes32Hex(stellarAddress as any)).toThrow(
                /nativeToBytes32 is not supported for Stellar muxed addresses/,
            );
            expect(() => stellarAddressParser.nativeToBytes32(stellarAddress as any)).toThrow(
                /nativeToBytes32 is not supported for Stellar muxed addresses/,
            );
        });

        it('throws error for signed payload (P...) - variable length', () => {
            const stellarAddress = validTestAddresses.signedPayload;

            expect(() => stellarAddressParser.nativeToBytes32Hex(stellarAddress as any)).toThrow(
                /nativeToBytes32 is not supported for Stellar signed payload addresses/,
            );
            expect(() => stellarAddressParser.nativeToBytes32(stellarAddress as any)).toThrow(
                /nativeToBytes32 is not supported for Stellar signed payload addresses/,
            );
        });

        it('returns undefined for undefined input', () => {
            expect(stellarAddressParser.nativeToBytes32Hex(undefined as any)).toBeUndefined();
            expect(stellarAddressParser.nativeToBytes32(undefined as any)).toBeUndefined();
        });

        it('decodes all supported address types to 32 bytes', () => {
            // Account (G), contract (C), liquidity pool (L), and claimable balance (B) addresses can be converted to 32 bytes
            const accountBytes = stellarAddressParser.nativeToBytes32(
                validTestAddresses.account as any,
            )!;
            const contractBytes = stellarAddressParser.nativeToBytes32(
                validTestAddresses.contract as any,
            )!;
            const poolBytes = stellarAddressParser.nativeToBytes32(
                validTestAddresses.liquidityPool as any,
            )!;
            const balanceBytes = stellarAddressParser.nativeToBytes32(
                validTestAddresses.claimableBalance as any,
            )!;

            // All should be exactly 32 bytes
            expect(accountBytes.length).toBe(32);
            expect(contractBytes.length).toBe(32);
            expect(poolBytes.length).toBe(32);
            expect(balanceBytes.length).toBe(32);

            // Should produce consistent hex conversions
            const accountHex = stellarAddressParser.nativeToBytes32Hex(
                validTestAddresses.account as any,
            )!;
            const contractHex = stellarAddressParser.nativeToBytes32Hex(
                validTestAddresses.contract as any,
            )!;
            const poolHex = stellarAddressParser.nativeToBytes32Hex(
                validTestAddresses.liquidityPool as any,
            )!;
            const balanceHex = stellarAddressParser.nativeToBytes32Hex(
                validTestAddresses.claimableBalance as any,
            )!;

            expect(bytesToHexPrefixed(accountBytes)).toBe(accountHex);
            expect(bytesToHexPrefixed(contractBytes)).toBe(contractHex);
            expect(bytesToHexPrefixed(poolBytes)).toBe(poolHex);
            expect(bytesToHexPrefixed(balanceBytes)).toBe(balanceHex);
        });

        it('handles ChainNativeAddress objects for bytes32 operations', () => {
            const nativeObj = {
                chainName: ChainName.STELLAR,
                nativeAddress: validTestAddresses.account,
            };

            const bytes32Hex = stellarAddressParser.nativeToBytes32Hex(nativeObj as any)!;
            const bytes32 = stellarAddressParser.nativeToBytes32(nativeObj as any)!;

            expect(bytes32Hex.length).toBe(66);
            expect(bytes32.length).toBe(32);
        });
    });

    describe('normalizedToBytes32 operations', () => {
        it('produces same result as nativeToBytes32Hex for contract address (C...)', () => {
            const stellarAddress = validTestAddresses.contract;
            const normalized = stellarAddressParser.nativeToNormalized(stellarAddress as any);

            const fromNative = stellarAddressParser.nativeToBytes32Hex(stellarAddress as any)!;
            const fromNormalized = stellarAddressParser.normalizedToBytes32Hex(normalized)!;

            expect(fromNormalized).toBe(fromNative);
        });

        it('normalizedToBytes32 returns correct Uint8Array', () => {
            const stellarAddress = validTestAddresses.account;
            const normalized = stellarAddressParser.nativeToNormalized(stellarAddress as any);

            const bytes32Hex = stellarAddressParser.normalizedToBytes32Hex(normalized)!;
            const bytes32 = stellarAddressParser.normalizedToBytes32(normalized)!;

            expect(bytes32.length).toBe(32);
            expect(bytesToHexPrefixed(bytes32)).toBe(bytes32Hex);
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
                const normalized = stellarAddressParser.nativeToNormalized(addr as any);
                const recovered = stellarAddressParser.normalizedToNative(normalized)!;

                // Should preserve the prefix indicating address type
                expect(recovered.nativeAddress.startsWith(prefix)).toBe(true);
                expect(recovered.nativeAddress).toBe(addr);
            });
        });
    });

    describe('edge cases', () => {
        it('handles ChainNativeAddress objects', () => {
            const nativeObj = {
                chainName: ChainName.STELLAR,
                nativeAddress: validTestAddresses.account,
            };

            const normalized = stellarAddressParser.nativeToNormalized(nativeObj as any);
            expect(normalized).toMatch(/^0x[0-9a-f]+$/);
        });

        it('returns undefined for undefined inputs', () => {
            expect(stellarAddressParser.normalizedToNative(undefined as any)).toBeUndefined();
            expect(stellarAddressParser.normalizedToNativeString(undefined as any)).toBeUndefined();
            expect(stellarAddressParser.nativeToNormalized(undefined as any)).toBeUndefined();
            expect(stellarAddressParser.nativeToBytes(undefined as any)).toBeUndefined();
        });

        it('handles different address lengths correctly', () => {
            // 56-char addresses
            const short = validTestAddresses.account;
            const shortBytes = stellarAddressParser.nativeToBytes(short as any)!;
            expect(shortBytes.length).toBe(56);

            // 69-char addresses (muxed)
            const medium = validTestAddresses.muxed;
            const mediumBytes = stellarAddressParser.nativeToBytes(medium as any)!;
            expect(mediumBytes.length).toBe(69);

            // Variable-length (signed payload)
            const long = validTestAddresses.signedPayload;
            const longBytes = stellarAddressParser.nativeToBytes(long as any)!;
            expect(longBytes.length).toBeGreaterThan(69);
        });
    });

    describe('encoding type', () => {
        it('has STELLAR encoding type', () => {
            expect(stellarAddressParser.encoding).toBe('stellar');
        });
    });
});

describe('addressParser - normalizedToBytes32Hex (cross-chain)', () => {
    const testCases: { name: string; chainName: ChainName; nativeAddr: string }[] = [
        {
            name: 'EVM (Ethereum)',
            chainName: ChainName.ETHEREUM,
            nativeAddr: '0x1234567890abcdef1234567890abcdef12345678',
        },
        {
            name: 'Solana',
            chainName: ChainName.SOLANA,
            nativeAddr: 'Es9vMFrzaCERmJfrF4H2FYD4KCoNkY11McCe8BenwNYB',
        },
        {
            name: 'TON',
            chainName: ChainName.TON,
            nativeAddr: 'EQDtFpEwcFAEcRe5mLVh2N6C0x-_hJEM7W61_JLnSF74p4q2',
        },
        {
            name: 'Stellar',
            chainName: ChainName.STELLAR,
            nativeAddr: 'GAAZI4TCR3TY5OJHCTJC2A4QSY6CJWJH5IAJTGKIN2ER7LBNVKOCCWN7',
        },
        {
            name: 'Aptos',
            chainName: ChainName.APTOS,
            nativeAddr: '0x1',
        },
        {
            name: 'Starknet',
            chainName: ChainName.STARKNET,
            nativeAddr: '0x049d36570d4e46f48e99674bd3fcc84644ddd6b96f7c741b1562b82f9e004dc7',
        },
        {
            name: 'Initia',
            chainName: ChainName.INITIA,
            nativeAddr: '0x1',
        },
    ];

    testCases.forEach(({ name, chainName, nativeAddr }) => {
        it(`${name}: normalizedToBytes32Hex(normalized) === nativeToBytes32Hex(native)`, () => {
            const chainAddressParser = addressParser(chainName);
            const normalized = chainAddressParser.nativeToNormalized(nativeAddr as any);

            const fromNormalized = chainAddressParser.normalizedToBytes32Hex(normalized)!;
            const fromNative = chainAddressParser.nativeToBytes32Hex(nativeAddr as any)!;

            expect(fromNormalized).toBe(fromNative);
            expect(fromNormalized.length).toBe(66);
            expect(fromNormalized).toMatch(/^0x[0-9a-f]{64}$/);
        });
    });

    it('normalizedToBytes32Hex is consistent across chain parsers for ≤32 byte hex', () => {
        const evmAddressParser = addressParser(ChainName.ETHEREUM);
        const solanaAddressParser = addressParser(ChainName.SOLANA);
        const normalized = normalizeHex('0x1234567890abcdef1234567890abcdef12345678');
        expect(evmAddressParser.normalizedToBytes32Hex(normalized)).toBe(
            solanaAddressParser.normalizedToBytes32Hex(normalized),
        );
    });

    it('normalizedToBytes32 returns correct Uint8Array', () => {
        const evmAddressParser = addressParser(ChainName.ETHEREUM);
        const normalized = normalizeHex('0x1234567890abcdef1234567890abcdef12345678');
        const bytes32Hex = evmAddressParser.normalizedToBytes32Hex(normalized)!;
        const bytes32 = evmAddressParser.normalizedToBytes32(normalized)!;
        expect(bytes32.length).toBe(32);
        expect(bytesToHexPrefixed(bytes32)).toBe(bytes32Hex);
    });

    it('returns undefined for undefined input', () => {
        const evmAddressParser = addressParser(ChainName.ETHEREUM);
        expect(evmAddressParser.normalizedToBytes32Hex(undefined as any)).toBeUndefined();
        expect(evmAddressParser.normalizedToBytes32(undefined as any)).toBeUndefined();
    });
});

describe('addressParser - bytes32ToNormalized', () => {
    const ZERO_BYTES32 = tileHex('00', 64);

    describe('round-trip: bytes32ToNormalized(nativeToBytes32Hex(native)) === nativeToNormalized(native)', () => {
        const cases = [
            {
                name: 'EVM',
                chainName: ChainName.ETHEREUM,
                native: '0x1234567890abcdef1234567890abcdef12345678',
            },
            {
                name: 'Solana',
                chainName: ChainName.SOLANA,
                native: 'Es9vMFrzaCERmJfrF4H2FYD4KCoNkY11McCe8BenwNYB',
            },
            {
                name: 'TON',
                chainName: ChainName.TON,
                native: 'EQDtFpEwcFAEcRe5mLVh2N6C0x-_hJEM7W61_JLnSF74p4q2',
            },
            { name: 'Initia', chainName: ChainName.INITIA, native: '0x1' },
            {
                name: 'Starknet',
                chainName: ChainName.STARKNET,
                native: '0x049d36570d4e46f48e99674bd3fcc84644ddd6b96f7c741b1562b82f9e004dc7',
            },
            { name: 'Aptos', chainName: ChainName.APTOS, native: '0x1' },
        ];

        cases.forEach(({ name, chainName, native }) => {
            it(`${name}: round-trip`, () => {
                const chainAddressParser = addressParser(chainName);
                const normalized = chainAddressParser.nativeToNormalized(native as any);
                const bytes32Hex = chainAddressParser.nativeToBytes32Hex(native as any)!;
                expect(chainAddressParser.bytes32ToNormalized(bytes32Hex)).toBe(normalized);
            });
        });

        it('Stellar contract: round-trip', () => {
            const stellarAddressParser = addressParser(ChainName.STELLAR);
            const contractAddr = 'CA7QYNF7SOWQ3GLR2BGMZEHXAVIRZA4KVWLTJJFC7MGXUA74P7UJUWDA';
            const normalized = stellarAddressParser.nativeToNormalized(contractAddr as any);
            const bytes32Hex = stellarAddressParser.nativeToBytes32Hex(contractAddr as any)!;
            expect(stellarAddressParser.bytes32ToNormalized(bytes32Hex)).toBe(normalized);
        });
    });

    it('undefined input returns undefined', () => {
        const evmAddressParser = addressParser(ChainName.ETHEREUM);
        expect(evmAddressParser.bytes32ToNormalized(undefined as any)).toBeUndefined();
    });

    it('non-Stellar: bytes32ToNative === normalizeHex for same input', () => {
        const chains = [ChainName.ETHEREUM, ChainName.SOLANA, ChainName.TON, ChainName.STARKNET];
        const bytes32 =
            '0x0000000000000000000000001234567890abcdef1234567890abcdef12345678' as HexString;
        chains.forEach((chainName) => {
            expect(addressParser(chainName).bytes32ToNormalized(bytes32)).toBe(
                normalizeHex(bytes32),
            );
        });
    });

    it('zero bytes32: EVM returns NORMALIZED_HEX_ZERO', () => {
        const evmAddressParser = addressParser(ChainName.ETHEREUM);
        expect(evmAddressParser.bytes32ToNormalized(ZERO_BYTES32)).toBe(NORMALIZED_HEX_ZERO);
    });

    it('zero bytes32: Stellar returns C-address for zero contract ID (not undefined)', () => {
        const stellarAddressParser = addressParser(ChainName.STELLAR);
        const result = stellarAddressParser.bytes32ToNormalized(ZERO_BYTES32);
        // Should be a valid C-address string encoded as UTF-8 normalized hex, not undefined
        expect(result).toBeDefined();
        expect(result).not.toBe(NORMALIZED_HEX_ZERO);
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
        const parser = addressParser(ChainName.STELLAR);
        const native = sentinelNativeFromLabel(ChainName.STELLAR, SENTINEL_LABEL);

        expect(native.startsWith('C')).toBe(true);
        expect(parser.nativeToBytes32Hex(native)).toBe(tileHex(SENTINEL_LABEL, 64));
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
