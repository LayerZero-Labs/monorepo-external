import invariant from 'tiny-invariant';

import { CHAIN_KEY, ENVIRONMENT, ULN_V1_CHAINS } from '../constants';
import {
    Chain,
    ChainKey,
    ChainType,
    EndpointId,
    EndpointVersion,
    Environment,
    EvmChain,
    Stage,
} from '../enums';
import { EndpointSpec, Network } from '../types';

/**
 * Converts a network name and version to an endpoint ID.
 *
 * @param {string} network - The network name.
 * @param {EndpointVersion} version - The endpoint version.
 * @returns {EndpointId} The corresponding endpoint ID.
 * @throws {Error} If the network name is invalid.
 */
export function networkToEndpointId(network: string, version: EndpointVersion): EndpointId {
    const name = network.replace('-local', '');
    const [chain, stage] = name.split('-');

    const key =
        version === EndpointVersion.V1
            ? `${chain.toUpperCase()}_${stage.toUpperCase()}`
            : `${chain.toUpperCase()}_V2_${stage.toUpperCase()}`;
    invariant(key in EndpointId, `Invalid network name: ${network}, key: ${key}`);
    return EndpointId[key as keyof typeof EndpointId] as EndpointId;
}

/**
 * Converts a network name and version to an environment.
 *
 * @param {string} network - The network name.
 * @param {EndpointVersion} version - The endpoint version.
 * @returns {Environment} The corresponding environment.
 */
export function networkToEnv(network: string, version: EndpointVersion): Environment {
    if (network.includes('local') || network === 'hardhat') {
        return Environment.LOCAL;
    }
    const endpointId = networkToEndpointId(network, version);
    return ENVIRONMENT[endpointId];
}

/**
 * Converts a network name to a stage.
 *
 * @param {string} network - The network name.
 * @returns {Stage} The corresponding stage.
 * @throws {Error} If the network name is invalid.
 */
export function networkToStage(network: string): Stage {
    const name = network.replace('-local', '');
    const sp = name.split('-');
    if (sp.length <= 1) {
        throw new Error(`Invalid network name: ${network}`);
    }
    const stage = sp[1].toUpperCase();
    return Stage[stage as keyof typeof Stage];
}

/**
 * Converts an endpoint ID to a network name.
 *
 * @param {number} endpointId - The endpoint ID.
 * @param {Environment | boolean} [envOrIsLocal] - The environment or a boolean indicating if it's local.
 * @returns {Network} The corresponding network name.
 * @throws {Error} If the endpoint ID is invalid.
 */
export function endpointIdToNetwork(
    endpointId: number,
    envOrIsLocal?: Environment | boolean,
): Network {
    const key = EndpointId[endpointId];
    invariant(key, `Invalid endpointId: ${endpointId}`);
    const network = key.toLowerCase().replace(/_/g, '-').replace('-v2', '');
    if (envOrIsLocal === Environment.LOCAL || envOrIsLocal === true) {
        return `${network}-local` as Network;
    }
    return network as Network;
}

/**
 * Converts an endpoint ID to an endpoint version.
 *
 * @param {number} endpointId - The endpoint ID.
 * @returns {EndpointVersion} The corresponding endpoint version.
 * @throws {Error} If the endpoint ID is invalid.
 */
export function endpointIdToVersion(endpointId: number): EndpointVersion {
    const key = EndpointId[endpointId];
    invariant(key, `Invalid endpointId: ${endpointId}`);
    return key.includes('V2') ? EndpointVersion.V2 : EndpointVersion.V1;
}

/**
 * Converts an endpoint ID to a chain key.
 *
 * @param {number} endpointId - The endpoint ID.
 * @returns {ChainKey} The corresponding chain key.
 * @throws {Error} If the endpoint ID is invalid.
 */
export function endpointIdToChainKey(endpointId: number): ChainKey {
    const chainKey = CHAIN_KEY[endpointId as EndpointId];
    invariant(chainKey, `No ChainKey for EndpointId: ${endpointId}`);
    return chainKey;
}

/**
 * Converts a chain and stage to an endpoint ID.
 *
 * @param {Chain} chain - The chain.
 * @param {Stage} stage - The stage.
 * @param {EndpointVersion} version - The endpoint version.
 * @returns {EndpointId} The corresponding endpoint ID.
 * @throws {Error} If the key is invalid.
 */
export function chainAndStageToEndpointId(
    chain: Chain,
    stage: Stage,
    version: EndpointVersion,
): EndpointId {
    const key =
        version === EndpointVersion.V2
            ? `${chain.toUpperCase()}_V2_${stage.toUpperCase()}`
            : `${chain.toUpperCase()}_${stage.toUpperCase()}`;
    invariant(key in EndpointId, `Invalid key: ${key}`);
    return EndpointId[key as keyof typeof EndpointId] as EndpointId;
}

/**
 * Converts a chain and stage to a network name.
 *
 * @param {Chain} chain - The chain.
 * @param {Stage} stage - The stage.
 * @param {Environment | boolean} [envOrIsLocal] - The environment or a boolean indicating if it's local.
 * @returns {Network} The corresponding network name.
 */
export function chainAndStageToNetwork(
    chain: Chain,
    stage: Stage,
    envOrIsLocal?: Environment | boolean,
): Network {
    if (envOrIsLocal === Environment.LOCAL || envOrIsLocal === true) {
        return `${chain}-${stage}-local`;
    }
    return `${chain}-${stage}`;
}

/**
 * Converts an endpoint specification to a network name.
 *
 * @param {EndpointSpec} spec - The endpoint specification.
 * @returns {Network} The corresponding network name.
 */
export function endpointSpecToNetwork(spec: EndpointSpec): Network {
    return chainAndStageToNetwork(spec.chain, spec.stage, spec.env);
}

/**
 * Converts an endpoint specification to an environment.
 *
 * @param {EndpointSpec} spec - The endpoint specification.
 * @returns {Environment} The corresponding environment.
 */
export function endpointSpecToEnv(spec: EndpointSpec): Environment {
    return spec.env;
}

/**
 * Converts an endpoint specification to an endpoint ID.
 *
 * @param {EndpointSpec} spec - The endpoint specification.
 * @returns {EndpointId} The corresponding endpoint ID.
 */
export function endpointSpecToEndpointId(spec: EndpointSpec): EndpointId {
    return chainAndStageToEndpointId(spec.chain, spec.stage, spec.version);
}

/**
 * Converts an endpoint ID and environment to an endpoint specification.
 *
 * @param {EndpointId} endpointId - The endpoint ID.
 * @param {Environment} env - The environment.
 * @returns {EndpointSpec} The corresponding endpoint specification.
 */
export function endpointIdToEndpointSpec(endpointId: EndpointId, env: Environment): EndpointSpec {
    const chain = endpointIdToChain(endpointId);
    const stage = endpointIdToStage(endpointId);
    const version = endpointIdToVersion(endpointId);
    return { chain, stage, version, env };
}

/**
 * Converts a network name to a chain.
 *
 * @param {string} network - The network name.
 * @returns {Chain} The corresponding chain.
 */
export function networkToChain(network: string): Chain {
    return network.split('-')[0] as Chain;
}

/**
 * Converts a network name to a chain type.
 *
 * @param {string} network - The network name.
 * @returns {ChainType} The corresponding chain type.
 */
export function networkToChainType(network: string): ChainType {
    const chain = networkToChain(network);
    return chainToChainType(chain);
}

/**
 * Returns the chain family for a given chain
 *
 * @param {Chain} chain - The chain.
 * @returns {ChainType} The corresponding chain type.
 */
export function chainToChainType(chain: Chain): ChainType {
    switch (chain) {
        case Chain.APTOS:
        case Chain.MOVEMENT:
            return ChainType.APTOS;
        case Chain.SOLANA:
            return ChainType.SOLANA;
        case Chain.INITIA:
            return ChainType.INITIA;
        case Chain.TON:
            return ChainType.TON;
        case Chain.SUI:
            return ChainType.SUI;
        case Chain.IOTAL1:
            return ChainType.IOTAL1;
        case Chain.STARKNET:
            return ChainType.STARKNET;
        case Chain.STELLAR:
            return ChainType.STELLAR;
        case Chain.CANTON:
            return ChainType.CANTON;
        default:
            if (Object.values(EvmChain).includes(chain)) {
                return ChainType.EVM;
            } else {
                return ChainType.UNKNOWN;
            }
    }
}

/**
 * @deprecated Use `chainToChainType` instead
 * Returns the chain type for a given chain.
 *
 * @param {Chain} chain - The chain.
 * @returns {ChainType} The corresponding chain type.
 */
export function getChainType(chain: Chain): ChainType {
    return chainToChainType(chain);
}

/**
 * Converts an endpoint ID to a chain.
 *
 * @param {number} endpointId - The endpoint ID.
 * @returns {Chain} The corresponding chain.
 * @throws {Error} If the endpoint ID is invalid.
 */
export function endpointIdToChain(endpointId: number): Chain {
    const key = EndpointId[endpointId];
    invariant(key, `Invalid endpointId: ${endpointId}`);
    return key.split('_')[0].toLowerCase() as Chain;
}

/**
 * Converts an endpoint ID to a stage.
 *
 * @param {number} endpointId - The endpoint ID.
 * @returns {Stage} The corresponding stage.
 * @throws {Error} If the endpoint ID is invalid.
 */
export function endpointIdToStage(endpointId: number): Stage {
    if (endpointId < 10000) {
        return Stage.MAINNET;
    } else if (endpointId < 20000) {
        return Stage.TESTNET;
    } else if (endpointId < 30000) {
        return Stage.SANDBOX;
    } else if (endpointId < 40000) {
        return Stage.MAINNET;
    } else if (endpointId < 50000) {
        return Stage.TESTNET;
    } else if (endpointId < 60000) {
        return Stage.SANDBOX;
    }
    throw new Error(`Invalid endpointId: ${endpointId}`);
}

/**
 * Converts an endpoint ID to a chain type.
 *
 * @param {number} endpointId - The endpoint ID.
 * @returns {ChainType} The corresponding chain type.
 */
export function endpointIdToChainType(endpointId: number): ChainType {
    const chain = endpointIdToChain(endpointId);
    return chainToChainType(chain);
}

/**
 * Gets the networks for a given stage.
 *
 * @param {Stage} stage - The stage.
 * @returns {string[]} The corresponding networks.
 */
export function getNetworksForStage(stage: Stage): string[] {
    const networks: string[] = [];
    for (const key in EndpointId) {
        if (Number(key) >= 0) {
            const network = endpointIdToNetwork(Number(key));
            const s = network.split('-')[1] as Stage;
            if (stage === s) {
                networks.push(network);
            }
        }
    }
    return networks;
}

const ULN_V1_BIAS = 100;

/**
 * Gets the endpoint version for a given ULN version.
 *
 * @param {string} ulnVersion - The ULN version.
 * @returns {EndpointVersion} The corresponding endpoint version.
 * @throws {Error} If the ULN version is invalid.
 */
export const getEndpointVersionForUlnVersion = (ulnVersion: string): EndpointVersion => {
    const [, , /*majorVerion*/ /*minorVersion*/ endpointVersion] = ulnVersion.split('.');
    if (typeof endpointVersion === 'undefined') {
        return EndpointVersion.V1;
    }
    const version = {
        '1': EndpointVersion.V1,
        '2': EndpointVersion.V2,
    }[endpointVersion];
    if (version == null) {
        throw new Error(`Invalid ulnVersion: ${ulnVersion}`);
    }
    return version;
};

/**
 * Gets the chain ID for a given network.
 *
 * @param {string} chain - The chain.
 * @param {string} stage - The stage.
 * @param {string} ulnVersion - The ULN version.
 * @returns {string} The corresponding chain ID.
 */
export function getChainIdForNetwork(chain: string, stage: string, ulnVersion: string): string {
    const endpointId = chainAndStageToEndpointId(
        chain as Chain,
        stage as Stage,
        getEndpointVersionForUlnVersion(ulnVersion),
    );
    return (ulnVersion == '1' ? endpointId - ULN_V1_BIAS : endpointId).toString();
}

/**
 * Gets the network for a given chain ID.
 *
 * @param {number} targetChainId - The target chain ID.
 * @returns {{ chainName: Chain; env: Stage; ulnVersion: string }} The corresponding network information.
 */
export function getNetworkForChainId(targetChainId: number): {
    chainName: Chain;
    env: Stage;
    ulnVersion: string;
} {
    if (ULN_V1_CHAINS.includes(targetChainId + ULN_V1_BIAS)) {
        const endpointId = targetChainId + ULN_V1_BIAS;
        const chain = endpointIdToChain(endpointId);
        const stage = networkToStage(endpointIdToNetwork(endpointId));
        return {
            chainName: chain,
            env: stage,
            ulnVersion: '1',
        };
    }
    const chain = endpointIdToChain(targetChainId);
    const stage = networkToStage(endpointIdToNetwork(targetChainId));
    return {
        chainName: chain,
        env: stage,
        ulnVersion: '2',
    };
}

/**
 * Checks if a network endpoint ID is supported.
 *
 * @param {string} network - The network name.
 * @param {EndpointVersion} endpointVersion - The endpoint version.
 * @returns {boolean} True if the network endpoint ID is supported, false otherwise.
 */
export function isNetworkEndpointIdSupported(
    network: string,
    endpointVersion: EndpointVersion,
): boolean {
    try {
        networkToEndpointId(network, endpointVersion);
        return true;
    } catch (e) {
        return false;
    }
}

/**
 * Determine if a chain is zkSync based.
 *
 * @param {Chain} chain - The chain.
 * @returns {boolean} True if the chain is zkSync based, false otherwise.
 */
export function isZKSyncBasedChain(chain: Chain): boolean {
    return (
        chain === Chain.ZKSYNC ||
        chain === Chain.ZKSYNCSEP ||
        chain === Chain.ZKLINK ||
        chain === Chain.ABSTRACT ||
        chain === Chain.SOPHON ||
        chain === Chain.TREASURE ||
        chain === Chain.CRONOSZKEVM ||
        chain === Chain.LENS
    );
}

/**
 * Determine if a chain is tron based.
 *
 * @param {Chain} chain - The chain.
 * @returns {boolean} True if the chain is Tron based, false otherwise.
 */
export function isTronChain(chain: Chain): boolean {
    return chain === Chain.TRON || chain === Chain.TRONDEV;
}

/**
 * Determines if a chain is EVM based.
 *
 * @param {Chain} chain - The chain.
 * @returns {boolean} True if the chain is EVM based, false otherwise.
 */
export function isEvmChain(chain: Chain): boolean {
    return chainToChainType(chain) === ChainType.EVM;
}

/**
 * Determines if a chain is Aptos based.
 *
 * @param {Chain} chain - The chain.
 * @returns {boolean} True if the chain is Aptos based, false otherwise.
 */
export function isAptosChain(chain: Chain): boolean {
    return chainToChainType(chain) === ChainType.APTOS;
}

/**
 * Determines if a chain is Solana based.
 *
 * @param {Chain} chain - The chain.
 * @returns {boolean} True if the chain is Solana based, false otherwise.
 */
export function isSolanaChain(chain: Chain): boolean {
    return chainToChainType(chain) === ChainType.SOLANA;
}

/**
 * Determines if a chain is Initia based.
 *
 * @param {Chain} chain - The chain.
 * @returns {boolean} True if the chain is Initia based, false otherwise.
 */
export function isInitiaChain(chain: Chain): boolean {
    return chainToChainType(chain) === ChainType.INITIA;
}

/**
 * Determines if a chain is Placeholder based.
 *
 * @param {Chain} chain - The chain.
 * @returns {boolean} True if the chain is Placeholder based, false otherwise.
 */
export function isSuiChain(chain: Chain): boolean {
    return chainToChainType(chain) === ChainType.SUI;
}

/**
 * Determines if a chain is Iota Move based.
 *
 * @param {Chain} chain - The chain.
 * @returns {boolean} True if the chain is Iota Move based, false otherwise.
 */
export function isIotaL1Chain(chain: Chain): boolean {
    return chainToChainType(chain) === ChainType.IOTAL1;
}

/**
 * Determines if a chain is Canton based.
 *
 * @param {Chain} chain - The chain.
 * @returns {boolean} True if the chain is Canton based, false otherwise.
 */
export function isCantonChain(chain: Chain): boolean {
    return chainToChainType(chain) === ChainType.CANTON;
}

/**
 * Checks if the given value is a valid Chain. {@link Chain}
 *
 * @param value - The value to check.
 * @returns True if the value is a Chain, false otherwise.
 */
export function isChain(value: unknown): value is Chain {
    return Object.values(Chain).includes(value as Chain);
}
