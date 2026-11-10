/**
 * Enum representing the versions for READ MessageLib.
 */
export enum MessageLibCmdRead {
    V_10_0_2 = '10.0.2',
}

/**
 * Enum representing the versions of MessageLib that support Endpoint V2.
 */
export enum MessageLibVersionV2 {
    SIMPLE = '0.0.2',
    ULTRA_LIGHT_NODE_302 = '3.0.2',
}

/**
 * Enum representing the versions of MessageLib that support Endpoint V1.
 */
export enum MessageLibVersionV1 {
    ULTRA_LIGHT_NODE_301 = '3.0.1',
    ULTRA_LIGHT_NODE_201 = '2.0.1',
}

/**
 * Type representing all possible versions for MessageLib.
 */
export type MessageLibVersion = MessageLibVersionV2 | MessageLibVersionV1 | MessageLibCmdRead;
