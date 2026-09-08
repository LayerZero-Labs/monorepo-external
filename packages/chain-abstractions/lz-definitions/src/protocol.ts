import { z } from 'zod';

export enum UlnVersion {
    V1 = 'V1',
    V2 = 'V2',
    V300 = 'V300', // simpleMessageLib
    V301 = 'V301',
    V302 = 'V302',
    ReadV1002 = 'ReadV1002',
}

export const ulnVersionSchema = z.enum(UlnVersion);

export enum EndpointVersion {
    V1 = 'v1',
    V2 = 'v2',
}

export const endpointVersionSchema = z.enum(EndpointVersion);

export enum ProtocolContracts {
    ENDPOINT_V2 = 'EndpointV2',
    EXECUTOR = 'Executor',
    EXECUTOR_FEELIB = 'ExecutorFeeLib',
    DVN = 'DVN',
    DVN_FEELIB = 'DVNFeeLib',
    PRICE_FEED = 'PriceFeed',
    SIMPLE_MESSAGE_LIB = 'SimpleMessageLib',
    TREASURY = 'Treasury',
    ULN_V301_SEND = 'UltraLightNodeV301Send',
    ULN_V301_RECEIVE = 'UltraLightNodeV301Receive',
    ULN_V302_SEND = 'UltraLightNodeV302Send',
    ULN_V302_RECEIVE = 'UltraLightNodeV302Receive',
    ULN_READ_V1002 = 'ReadLib1002',
    OAPP = 'OApp',
    OMNI_COUNTER = 'OmniCounter',
    BLOCKED_MESSAGE_LIB = 'BlockedMessageLib',
    /** Canton EndpointV2 artifact subkey — not a top-level deployable contract. */
    REQUEST_FACTORY_CONFIG = 'requestFactoryConfig',
    /** Canton EndpointV2 artifact subkey — not a top-level deployable contract. */
    DISCOVERY_REGISTRY = 'discoveryRegistry',
    /** Canton EndpointV2 artifact subkey — not a top-level deployable contract. */
    REQUEST_FACTORY_ACCESS_CONTROL = 'requestFactoryAccessControl',
    /** Canton EndpointV2 artifact subkey — not a top-level deployable contract. */
    DISCOVERY_REGISTRY_ACCESS_CONTROL = 'discoveryRegistryAccessControl',
}
