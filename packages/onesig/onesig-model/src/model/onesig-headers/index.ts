/**
 * Custom headers required for OneSig API authentication.
 * Add new auth headers here — they automatically propagate to
 * request validation and signing utilities.
 */
export const ONESIG_AUTH_HEADERS = {
    signature: 'x-request-signature',
    expiry: 'x-request-expiry',
} as const;

export type OneSigAuthHeaderName = (typeof ONESIG_AUTH_HEADERS)[keyof typeof ONESIG_AUTH_HEADERS];

export const ONESIG_AUTH_HEADER_NAMES = Object.values(ONESIG_AUTH_HEADERS);
