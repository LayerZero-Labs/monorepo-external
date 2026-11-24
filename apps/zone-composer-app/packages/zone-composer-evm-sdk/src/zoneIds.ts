export const ZONE_IDS = Object.freeze({
    SYSTEM: 33001,
    SYSTEM_TESTNET: 43001,
    INTEROP: 33002,
    INTEROP_TESTNET: 43002,
    ATLAS: 33003,
    ATLAS_TESTNET: 43003,
    PAYMENTS: 33004,
    PAYMENTS_TESTNET: 43004,
} as const);

export type ZoneName = keyof typeof ZONE_IDS;
