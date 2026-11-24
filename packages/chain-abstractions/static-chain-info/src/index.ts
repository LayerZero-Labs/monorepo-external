import { ChainName, chainNameSchema, Environment } from '@layerzerolabs/layerzero-definitions';
import { EndpointVersion, UlnVersion } from '@layerzerolabs/layerzero-definitions';
import type { Chain, EndpointId, Stage } from '@layerzerolabs/lz-definitions';
import {
    chainAndStageToEndpointId,
    ChannelId,
    endpointIdToStage,
    EndpointV2IdBase,
    getNetworkForChainId,
} from '@layerzerolabs/lz-definitions';

import { ChainSubType, staticConfig } from './staticChainInfo';

export { ChainSubType };

export * from './staticChainInfo';

const STELLAR_V2_SANDBOX_EID = 50600 as EndpointId;

export const getChainNameFromEndpointId = (endpointId: EndpointId): ChainName => {
    if (endpointId === STELLAR_V2_SANDBOX_EID) {
        return ChainName.STELLAR;
    }
    return chainNameSchema.parse(getNetworkForChainId(endpointId).chainName);
};

export const isLzReadEndpointId = (endpointId: EndpointId) => {
    return Object.values(ChannelId).includes(Number(endpointId));
};

export const getEndpointVersionFromEndpointId = (endpointId: EndpointId): EndpointVersion => {
    if (isLzReadEndpointId(endpointId)) {
        return EndpointVersion.V2;
    }
    return endpointId < EndpointV2IdBase ? EndpointVersion.V1 : EndpointVersion.V2;
};

export const getEndpointVersionFromUlnVersion = (ulnVersion: UlnVersion): EndpointVersion => {
    if (ulnVersion === UlnVersion.V1) {
        throw new Error('UlnVersion.V1 is not supported');
    }
    switch (ulnVersion) {
        case UlnVersion.V2:
        case UlnVersion.V301:
            return EndpointVersion.V1;
        case UlnVersion.V300:
        case UlnVersion.ReadV1002:
        case UlnVersion.V302:
            return EndpointVersion.V2;
        default:
            throw new Error(`Unknown UlnVersion: ${ulnVersion}`);
    }
};

// Note: This doesn't work for UlnVersion.V1
export const getEndpointId = (
    chainName: ChainName,
    environment: Environment,
    version: EndpointVersion,
): EndpointId => {
    if (
        chainName === ChainName.STELLAR &&
        environment === Environment.SANDBOX &&
        version === EndpointVersion.V2
    ) {
        return STELLAR_V2_SANDBOX_EID;
    }
    return chainAndStageToEndpointId(
        chainName as unknown as Chain,
        environment as unknown as Stage,
        version,
    );
};

export const getChainNamesForEndpoint = (
    environment: Environment,
    version: EndpointVersion,
): ChainName[] => {
    return Object.values(ChainName).filter((name) => {
        try {
            getEndpointId(name, environment, version);
            return true;
        } catch {
            return false;
        }
    });
};

export const getEnvironmentFromEndpointId = (endpointId: EndpointId): Environment => {
    return endpointIdToStage(endpointId) as unknown as Environment;
};

export const getVId = (chainName: ChainName, environment: Environment): string => {
    // By convention the vid is the endpointV1 endpoint id.
    // Chains deployed only on V2 have no V1 endpoint id, so derive it from the V2 one.
    if (StaticChainConfigs.chainsDeployedOnlyOnV2.includes(chainName)) {
        const eid = getEndpointId(chainName, environment, EndpointVersion.V2);
        return (parseInt(eid.toString()) % 30000).toString();
    }
    return getEndpointId(chainName, environment, EndpointVersion.V1).toString();
};

export class StaticChainConfigs {
    static chainsDeployedOnlyOnV2: ChainName[] = [
        ChainName.SOLANA,
        ChainName.TON,
        ChainName.INITIA,
        ChainName.MOVEMENT,
        ChainName.STARKNET,
        ChainName.STELLAR,
        ChainName.CANTON,
        ChainName.ALPEN,
        ChainName.ZEROINTEROP,
    ];

    static getAddressSizeInBytes(chainName: ChainName): number {
        return staticConfig[chainName].addressSizeInBytes;
    }

    static getSymbol(chainName: ChainName): string {
        return staticConfig[chainName].symbol;
    }

    static getDecimals(chainName: ChainName): number {
        return staticConfig[chainName].decimals;
    }

    static getMptBaseFee(chainName: ChainName): number {
        return staticConfig[chainName].mptBaseGas!;
    }

    static getChainLayer(chainName: ChainName): number {
        return staticConfig[chainName].chainLayer ?? 1;
    }

    static getChainSubType(chainName: ChainName): ChainSubType | undefined {
        return staticConfig[chainName].chainSubType;
    }

    static getGasPriceDecimals(chainName: ChainName): number {
        if (chainName === ChainName.HEDERA) {
            return 18;
        }
        return staticConfig[chainName].decimals;
    }
}
