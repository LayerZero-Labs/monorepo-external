import { EndpointId } from '../enums';

/**
 * A list of endpoint IDs that support ULN (Ultra Light Node) version 1.
 * This array contains the endpoint IDs for various blockchains that are compatible with ULN version 1.
 *
 * @type {EndpointId[]}
 */
export const ULN_V1_CHAINS = [
    EndpointId.ETHEREUM_MAINNET,
    EndpointId.ETHEREUM_TESTNET,
    EndpointId.ETHEREUM_SANDBOX,
    EndpointId.BSC_MAINNET,
    EndpointId.BSC_TESTNET,
    EndpointId.BSC_SANDBOX,
    EndpointId.AVALANCHE_MAINNET,
    EndpointId.AVALANCHE_TESTNET,
    EndpointId.AVALANCHE_SANDBOX,
    EndpointId.POLYGON_MAINNET,
    EndpointId.POLYGON_TESTNET,
    EndpointId.POLYGON_SANDBOX,
    EndpointId.ARBITRUM_MAINNET,
    EndpointId.OPTIMISM_MAINNET,
    EndpointId.FANTOM_MAINNET,
    EndpointId.FANTOM_TESTNET,
    EndpointId.SWIMMER_MAINNET,
    EndpointId.SWIMMER_TESTNET,
    EndpointId.DFK_MAINNET,
    EndpointId.DFK_TESTNET,
    EndpointId.HARMONY_MAINNET,
    EndpointId.HARMONY_TESTNET,
    EndpointId.MOONBEAM_MAINNET,
    EndpointId.MOONBEAM_TESTNET,
    EndpointId.DEXALOT_TESTNET,
    EndpointId.CELO_TESTNET,
    EndpointId.INTAIN_TESTNET,
];
