import { encodeAbiParameters, type Hex, hexToBigInt, isHex, size } from 'viem';

import { ZONE_IDS } from './zoneIds';

export const ZONE_RECIPIENT_LENGTHS: Readonly<Record<number, number>> = Object.freeze({
    [ZONE_IDS.SYSTEM]: 20,
    [ZONE_IDS.SYSTEM_TESTNET]: 20,
    [ZONE_IDS.ATLAS]: 20,
    [ZONE_IDS.ATLAS_TESTNET]: 20,
});

const MAX_MEMO_LENGTH = 255;

export type ZoneComposePayloadErrorDetail =
    | { reason: 'INVALID_HEX'; field: 'recipient' | 'memo' }
    | { reason: 'UNKNOWN_ZONE'; zone: number }
    | { reason: 'RECIPIENT_LENGTH_MISMATCH'; zone: number; expected: number; actual: number }
    | { reason: 'ZERO_RECIPIENT'; zone: number }
    | { reason: 'MEMO_TOO_LONG'; maxLength: number; actual: number };

export class ZoneComposePayloadError extends Error {
    override readonly name = 'ZoneComposePayloadError';

    constructor(
        message: string,
        readonly detail: ZoneComposePayloadErrorDetail,
    ) {
        super(message);
    }
}

export interface ZoneComposePayloadInput {
    dstZone: number;
    recipient: Hex;
    memo?: Hex;
}

const isByteHex = (value: unknown): value is Hex => isHex(value) && value.length % 2 === 0;

const assertByteHex = (field: 'recipient' | 'memo', value: unknown): void => {
    if (!isByteHex(value)) {
        throw new ZoneComposePayloadError(
            `${field} must be a 0x-prefixed hex string with an even number of digits`,
            { reason: 'INVALID_HEX', field },
        );
    }
};

export const encodeZoneComposePayload = ({
    dstZone,
    recipient,
    memo,
}: ZoneComposePayloadInput): Hex => {
    assertByteHex('recipient', recipient);
    if (memo !== undefined) {
        assertByteHex('memo', memo);
    }

    if (!Object.hasOwn(ZONE_RECIPIENT_LENGTHS, dstZone)) {
        throw new ZoneComposePayloadError(`zone ${dstZone} is not in ZONE_RECIPIENT_LENGTHS`, {
            reason: 'UNKNOWN_ZONE',
            zone: dstZone,
        });
    }

    const expectedRecipientLength = ZONE_RECIPIENT_LENGTHS[dstZone];
    const recipientLength = size(recipient);
    if (recipientLength !== expectedRecipientLength) {
        throw new ZoneComposePayloadError(
            `zone ${dstZone} needs a ${expectedRecipientLength}-byte recipient, got ${recipientLength} bytes`,
            {
                reason: 'RECIPIENT_LENGTH_MISMATCH',
                zone: dstZone,
                expected: expectedRecipientLength,
                actual: recipientLength,
            },
        );
    }

    if (hexToBigInt(recipient) === 0n) {
        throw new ZoneComposePayloadError(`zone ${dstZone} recipient is all zero bytes`, {
            reason: 'ZERO_RECIPIENT',
            zone: dstZone,
        });
    }

    if (memo === undefined || memo === '0x') {
        return encodeAbiParameters(
            [
                { name: 'dstZone', type: 'uint64' },
                { name: 'recipient', type: 'bytes' },
            ],
            [BigInt(dstZone), recipient],
        );
    }

    const memoLength = size(memo);
    if (memoLength > MAX_MEMO_LENGTH) {
        throw new ZoneComposePayloadError(
            `memo is ${memoLength} bytes, more than the ${MAX_MEMO_LENGTH}-byte maximum`,
            { reason: 'MEMO_TOO_LONG', maxLength: MAX_MEMO_LENGTH, actual: memoLength },
        );
    }

    return encodeAbiParameters(
        [
            { name: 'dstZone', type: 'uint64' },
            { name: 'recipient', type: 'bytes' },
            { name: 'memo', type: 'bytes' },
        ],
        [BigInt(dstZone), recipient, memo],
    );
};
