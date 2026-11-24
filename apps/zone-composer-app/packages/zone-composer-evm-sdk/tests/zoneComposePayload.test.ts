import { type Hex, hexToBigInt, keccak256, size, slice } from 'viem';
import { describe, expect, it } from 'vitest';

import {
    encodeZoneComposePayload,
    ZONE_IDS,
    ZONE_RECIPIENT_LENGTHS,
    ZoneComposePayloadError,
    type ZoneComposePayloadErrorDetail,
} from '../src';

const ZONE = ZONE_IDS.SYSTEM;
const SETTLED_ZONES = {
    [ZONE_IDS.SYSTEM]: 20,
    [ZONE_IDS.SYSTEM_TESTNET]: 20,
    [ZONE_IDS.ATLAS]: 20,
    [ZONE_IDS.ATLAS_TESTNET]: 20,
};

const UNMAPPED_ZONE_NAMES = ['INTEROP', 'INTEROP_TESTNET', 'PAYMENTS', 'PAYMENTS_TESTNET'] as const;
const WORD_SIZE = 32;

const repeatByte = (byte: string, count: number): Hex => `0x${byte.repeat(count)}`;

const RECIPIENT = repeatByte('11', 20);

const word = (payload: Hex, index: number): bigint =>
    hexToBigInt(slice(payload, index * WORD_SIZE, (index + 1) * WORD_SIZE));

const catchPayloadError = (encode: () => Hex): ZoneComposePayloadErrorDetail => {
    try {
        encode();
    } catch (error) {
        if (error instanceof ZoneComposePayloadError) {
            return error.detail;
        }
        throw error;
    }
    throw new Error('expected encodeZoneComposePayload to throw');
};

const INVALID_HEX_VALUES = [
    { label: 'no 0x prefix', value: '11'.repeat(20) },
    { label: 'odd digit count', value: '0x1' },
    { label: 'non-hex character', value: '0xgg' },
];

describe('encodeZoneComposePayload', () => {
    describe('byte inputs', () => {
        it.each(INVALID_HEX_VALUES)(
            'throws INVALID_HEX for a recipient with $label',
            ({ value }) => {
                const detail = catchPayloadError(() =>
                    encodeZoneComposePayload({ dstZone: ZONE, recipient: value as Hex }),
                );

                expect(detail).toEqual({ reason: 'INVALID_HEX', field: 'recipient' });
            },
        );

        it.each(INVALID_HEX_VALUES)('throws INVALID_HEX for a memo with $label', ({ value }) => {
            const detail = catchPayloadError(() =>
                encodeZoneComposePayload({
                    dstZone: ZONE,
                    recipient: RECIPIENT,
                    memo: value as Hex,
                }),
            );

            expect(detail).toEqual({ reason: 'INVALID_HEX', field: 'memo' });
        });

        it('throws INVALID_HEX before the zone, recipient length, and memo length checks', () => {
            const tooLongMemo = repeatByte('ef', 256);

            expect(
                catchPayloadError(() =>
                    encodeZoneComposePayload({
                        dstZone: 0,
                        recipient: '0xgg' as Hex,
                        memo: tooLongMemo,
                    }),
                ),
            ).toEqual({ reason: 'INVALID_HEX', field: 'recipient' });
            expect(
                catchPayloadError(() =>
                    encodeZoneComposePayload({
                        dstZone: 0,
                        recipient: repeatByte('11', 32),
                        memo: '0x1' as Hex,
                    }),
                ),
            ).toEqual({ reason: 'INVALID_HEX', field: 'memo' });
        });

        it('keeps the leading zero byte of a 20-byte recipient in the payload', () => {
            const recipient = `0x00${'11'.repeat(19)}` as const;

            const payload = encodeZoneComposePayload({ dstZone: ZONE, recipient });

            expect(word(payload, 2)).toBe(20n);
            expect(slice(payload, 3 * WORD_SIZE, 3 * WORD_SIZE + 20)).toBe(recipient);
        });
    });

    describe('zones', () => {
        it.each(UNMAPPED_ZONE_NAMES)(
            'throws UNKNOWN_ZONE with the zone for ZONE_IDS.%s',
            (name) => {
                const dstZone = ZONE_IDS[name];

                const detail = catchPayloadError(() =>
                    encodeZoneComposePayload({ dstZone, recipient: RECIPIENT }),
                );

                expect(detail).toEqual({ reason: 'UNKNOWN_ZONE', zone: dstZone });
            },
        );

        it.each([0, 1, 2, 1234, 33000, 43000, 2 ** 32, -1, 1.5])(
            'throws UNKNOWN_ZONE with the zone for zone %s',
            (dstZone) => {
                const detail = catchPayloadError(() =>
                    encodeZoneComposePayload({ dstZone, recipient: RECIPIENT }),
                );

                expect(detail).toEqual({ reason: 'UNKNOWN_ZONE', zone: dstZone });
            },
        );

        it.each([0, 1, 19, 21, 32])(
            'throws RECIPIENT_LENGTH_MISMATCH with ZONE_IDS.SYSTEM, expected length 20, and actual length %s',
            (length) => {
                const detail = catchPayloadError(() =>
                    encodeZoneComposePayload({
                        dstZone: ZONE,
                        recipient: repeatByte('11', length),
                    }),
                );

                expect(detail).toEqual({
                    reason: 'RECIPIENT_LENGTH_MISMATCH',
                    zone: ZONE,
                    expected: 20,
                    actual: length,
                });
            },
        );

        it('throws ZERO_RECIPIENT with ZONE_IDS.SYSTEM for a 20-byte all-zero recipient', () => {
            const detail = catchPayloadError(() =>
                encodeZoneComposePayload({ dstZone: ZONE, recipient: repeatByte('00', 20) }),
            );

            expect(detail).toEqual({ reason: 'ZERO_RECIPIENT', zone: ZONE });
        });

        it.each([1, 19, 21, 32])(
            'throws RECIPIENT_LENGTH_MISMATCH with ZONE_IDS.SYSTEM, expected length 20, and actual length %s for an all-zero recipient',
            (length) => {
                const detail = catchPayloadError(() =>
                    encodeZoneComposePayload({
                        dstZone: ZONE,
                        recipient: repeatByte('00', length),
                    }),
                );

                expect(detail).toEqual({
                    reason: 'RECIPIENT_LENGTH_MISMATCH',
                    zone: ZONE,
                    expected: 20,
                    actual: length,
                });
            },
        );

        it('throws UNKNOWN_ZONE before the recipient length, zero recipient, and memo length checks', () => {
            const detail = catchPayloadError(() =>
                encodeZoneComposePayload({
                    dstZone: 1,
                    recipient: repeatByte('00', 32),
                    memo: repeatByte('ef', 256),
                }),
            );

            expect(detail).toEqual({ reason: 'UNKNOWN_ZONE', zone: 1 });
        });

        it('throws RECIPIENT_LENGTH_MISMATCH before the zero recipient and memo length checks', () => {
            const detail = catchPayloadError(() =>
                encodeZoneComposePayload({
                    dstZone: ZONE,
                    recipient: repeatByte('00', 32),
                    memo: repeatByte('ef', 256),
                }),
            );

            expect(detail).toEqual({
                reason: 'RECIPIENT_LENGTH_MISMATCH',
                zone: ZONE,
                expected: 20,
                actual: 32,
            });
        });

        it('throws ZERO_RECIPIENT before the memo length check', () => {
            const detail = catchPayloadError(() =>
                encodeZoneComposePayload({
                    dstZone: ZONE,
                    recipient: repeatByte('00', 20),
                    memo: repeatByte('ef', 256),
                }),
            );

            expect(detail).toEqual({ reason: 'ZERO_RECIPIENT', zone: ZONE });
        });

        it.each(['SYSTEM', 'SYSTEM_TESTNET', 'ATLAS', 'ATLAS_TESTNET'] as const)(
            'returns a 128-byte payload with ZONE_IDS.%s in the first word for a 20-byte recipient',
            (name) => {
                const dstZone = ZONE_IDS[name];
                const payload = encodeZoneComposePayload({ dstZone, recipient: RECIPIENT });

                expect(size(payload)).toBe(128);
                expect(word(payload, 0)).toBe(BigInt(dstZone));
            },
        );

        it.each(
            (['SYSTEM_TESTNET', 'ATLAS', 'ATLAS_TESTNET'] as const).flatMap((name) =>
                [19, 21, 32].map((length) => ({ name, length })),
            ),
        )(
            'throws RECIPIENT_LENGTH_MISMATCH with ZONE_IDS.$name, expected length 20, and actual length $length',
            ({ name, length }) => {
                const dstZone = ZONE_IDS[name];

                const detail = catchPayloadError(() =>
                    encodeZoneComposePayload({ dstZone, recipient: repeatByte('11', length) }),
                );

                expect(detail).toEqual({
                    reason: 'RECIPIENT_LENGTH_MISMATCH',
                    zone: dstZone,
                    expected: 20,
                    actual: length,
                });
            },
        );

        it.each(['ATLAS', 'ATLAS_TESTNET'] as const)(
            'throws ZERO_RECIPIENT with ZONE_IDS.%s for a 20-byte all-zero recipient',
            (name) => {
                const dstZone = ZONE_IDS[name];

                const detail = catchPayloadError(() =>
                    encodeZoneComposePayload({ dstZone, recipient: repeatByte('00', 20) }),
                );

                expect(detail).toEqual({ reason: 'ZERO_RECIPIENT', zone: dstZone });
            },
        );
    });

    describe('payload shape', () => {
        it.each([
            { label: 'omitted', memo: undefined },
            { label: 'empty', memo: '0x' as const },
        ])(
            'encodes zone and recipient with recipient offset 0x40 and no memo field when the memo is $label',
            ({ memo }) => {
                const payload = encodeZoneComposePayload({
                    dstZone: ZONE,
                    recipient: RECIPIENT,
                    memo,
                });

                expect(size(payload)).toBe(4 * WORD_SIZE);
                expect(word(payload, 0)).toBe(BigInt(ZONE));
                expect(word(payload, 1)).toBe(0x40n);
                expect(word(payload, 2)).toBe(20n);
                expect(slice(payload, 3 * WORD_SIZE, 3 * WORD_SIZE + 20)).toBe(RECIPIENT);
            },
        );

        it('encodes zone, recipient, and memo with recipient offset 0x60 when the memo is not empty', () => {
            const memo = repeatByte('ee', 1);

            const payload = encodeZoneComposePayload({ dstZone: ZONE, recipient: RECIPIENT, memo });

            expect(size(payload)).toBe(7 * WORD_SIZE);
            expect(word(payload, 0)).toBe(BigInt(ZONE));
            expect(word(payload, 1)).toBe(0x60n);
            expect(word(payload, 2)).toBe(0xa0n);
            expect(word(payload, 3)).toBe(20n);
            expect(slice(payload, 4 * WORD_SIZE, 4 * WORD_SIZE + 20)).toBe(RECIPIENT);
            expect(word(payload, 5)).toBe(1n);
            expect(slice(payload, 6 * WORD_SIZE, 6 * WORD_SIZE + 1)).toBe(memo);
        });

        it.each([
            {
                label: 'no memo',
                memo: undefined,
                length: 128,
                hash: '0x473284def5e50ec922b3e7f9bda972ff2de2d09a125e53429d4dccd5667eea0e',
            },
            {
                label: 'a 1-byte memo',
                memo: repeatByte('ee', 1),
                length: 224,
                hash: '0x1effae21fb2e5717b7248f352ba53177d96df803597bc9e0ec659949c7c0756f',
            },
            {
                label: 'a 255-byte memo',
                memo: repeatByte('ef', 255),
                length: 448,
                hash: '0x63d247a1636404a1accc8a39a6c2ce18e55353e2bd672acf4f3321cda421d9d3',
            },
        ])(
            'returns $length bytes with the pinned keccak256 for $label',
            ({ memo, length, hash }) => {
                const payload = encodeZoneComposePayload({
                    dstZone: ZONE,
                    recipient: RECIPIENT,
                    memo,
                });

                expect(size(payload)).toBe(length);
                expect(keccak256(payload)).toBe(hash);
            },
        );

        it('throws a ZoneComposePayloadError with a distinct reason for each broken rule and returns no payload', () => {
            const brokenInputs = [
                { dstZone: ZONE, recipient: '0x1' as Hex },
                { dstZone: 1, recipient: RECIPIENT },
                { dstZone: ZONE, recipient: repeatByte('11', 32) },
                { dstZone: ZONE, recipient: repeatByte('00', 20) },
                { dstZone: ZONE, recipient: RECIPIENT, memo: repeatByte('ef', 256) },
            ];

            const reasons = brokenInputs.map((input) => {
                let payload: Hex | undefined;
                let thrown: unknown;
                try {
                    payload = encodeZoneComposePayload(input);
                } catch (error) {
                    thrown = error;
                }
                expect(payload).toBeUndefined();
                expect(thrown).toBeInstanceOf(ZoneComposePayloadError);
                return thrown instanceof ZoneComposePayloadError ? thrown.detail.reason : undefined;
            });

            expect(reasons).toEqual([
                'INVALID_HEX',
                'UNKNOWN_ZONE',
                'RECIPIENT_LENGTH_MISMATCH',
                'ZERO_RECIPIENT',
                'MEMO_TOO_LONG',
            ]);
        });
    });

    describe('memo', () => {
        it('throws MEMO_TOO_LONG with the maximum and actual length for a 256-byte memo', () => {
            const detail = catchPayloadError(() =>
                encodeZoneComposePayload({
                    dstZone: ZONE,
                    recipient: RECIPIENT,
                    memo: repeatByte('ef', 256),
                }),
            );

            expect(detail).toEqual({ reason: 'MEMO_TOO_LONG', maxLength: 255, actual: 256 });
        });

        it.each([
            { label: 'omitted', memo: undefined, length: 128 },
            { label: 'empty', memo: '0x' as const, length: 128 },
            { label: '1 byte', memo: repeatByte('ee', 1), length: 224 },
            { label: '255 bytes', memo: repeatByte('ef', 255), length: 448 },
        ])('returns a $length-byte payload when the memo is $label', ({ memo, length }) => {
            const payload = encodeZoneComposePayload({ dstZone: ZONE, recipient: RECIPIENT, memo });

            expect(size(payload)).toBe(length);
        });
    });
});

describe('ZONE_RECIPIENT_LENGTHS', () => {
    it('holds only the System Zone and ATLAS, mainnet and testnet, with a 20-byte recipient', () => {
        expect(ZONE_RECIPIENT_LENGTHS).toEqual(SETTLED_ZONES);
    });

    it('has integer zone keys in [1, 2^53 - 1] and integer recipient lengths in [1, 255]', () => {
        const entries = Object.entries(ZONE_RECIPIENT_LENGTHS);

        expect(entries.length).toBeGreaterThan(0);
        for (const [key, recipientLength] of entries) {
            const zone = Number(key);
            expect(String(zone)).toBe(key);
            expect(Number.isInteger(zone)).toBe(true);
            expect(zone).toBeGreaterThanOrEqual(1);
            expect(zone).toBeLessThanOrEqual(Number.MAX_SAFE_INTEGER);
            expect(Number.isInteger(recipientLength)).toBe(true);
            expect(recipientLength).toBeGreaterThanOrEqual(1);
            expect(recipientLength).toBeLessThanOrEqual(255);
        }
    });

    it('is frozen, throws a TypeError when an entry is added, changed, or deleted, and keeps zone 0 unknown', () => {
        const map = ZONE_RECIPIENT_LENGTHS as Record<number, number>;

        expect(Object.isFrozen(ZONE_RECIPIENT_LENGTHS)).toBe(true);
        expect(() => {
            map[0] = 20;
        }).toThrow(TypeError);
        expect(() => {
            map[ZONE] = 32;
        }).toThrow(TypeError);
        expect(() => {
            delete map[ZONE];
        }).toThrow(TypeError);
        expect(ZONE_RECIPIENT_LENGTHS).toEqual(SETTLED_ZONES);
        expect(
            catchPayloadError(() => encodeZoneComposePayload({ dstZone: 0, recipient: RECIPIENT })),
        ).toEqual({ reason: 'UNKNOWN_ZONE', zone: 0 });
    });
});

describe('ZONE_IDS', () => {
    it('holds the chain IDs of the finalized list of 2026-11-03', () => {
        expect(ZONE_IDS).toEqual({
            SYSTEM: 33001,
            SYSTEM_TESTNET: 43001,
            INTEROP: 33002,
            INTEROP_TESTNET: 43002,
            ATLAS: 33003,
            ATLAS_TESTNET: 43003,
            PAYMENTS: 33004,
            PAYMENTS_TESTNET: 43004,
        });
    });

    it.each(['SYSTEM', 'INTEROP', 'ATLAS', 'PAYMENTS'] as const)(
        'gives ZONE_IDS.%s_TESTNET as the mainnet ID plus 10,000',
        (name) => {
            expect(ZONE_IDS[`${name}_TESTNET`]).toBe(ZONE_IDS[name] + 10_000);
        },
    );

    it('is frozen', () => {
        expect(Object.isFrozen(ZONE_IDS)).toBe(true);
    });
});
