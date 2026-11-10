// import { Chain, ChainType, getChainType, getNetworkForChainId } from ''

import { Chain, ChainType } from './enums';
import { getChainType } from './utils';

/**
 * Interface representing the specification of a blockchain.
 */
export interface ChainSpec {
    /**
     * The chain. {@link Chain}
     */
    chain?: Chain;

    /**
     * The type of the chain. {@link ChainType}
     */
    chainType: ChainType;

    /**
     * The size of the address in bytes.
     */
    addressSizeInBytes: number;

    /**
     * The number of decimals used by the chain.
     */
    decimals: number;
}

/**
 * Type representing the configuration for chain specifications.
 */
type ChainSpecConfig = {
    [chainType in ChainType]?: {
        [chain in Chain | 'default']?: Partial<ChainSpec>;
    };
};

/**
 * Static configuration for chains
 */
const chainSpecConfig: ChainSpecConfig = {
    [ChainType.EVM]: {
        default: {
            addressSizeInBytes: 20,
            decimals: 18,
        },
        [Chain.TRON]: {
            decimals: 6,
        },
    },
    [ChainType.APTOS]: {
        default: {
            addressSizeInBytes: 32,
            decimals: 8,
        },
    },
    [ChainType.SOLANA]: {
        default: {
            addressSizeInBytes: 32,
            decimals: 9,
        },
    },
    [ChainType.INITIA]: {
        default: {
            addressSizeInBytes: 32,
            decimals: 6,
        },
    },
    [ChainType.TON]: {
        default: {
            addressSizeInBytes: 32,
            decimals: 9,
        },
    },
    [ChainType.SUI]: {
        default: {
            addressSizeInBytes: 32,
            decimals: 9,
        },
    },
    [ChainType.IOTAL1]: {
        default: {
            addressSizeInBytes: 32,
            decimals: 9,
        },
    },
    [ChainType.CANTON]: {
        default: {
            addressSizeInBytes: 32,
            decimals: 10,
        },
    },
};

/**
 * Class providing methods to get chain specifications.
 */
export class ChainSpecs {
    /**
     * Gets the address size in bytes for a given chain.
     *
     * @param {Chain} chain - The chain.
     * @returns {number} The address size in bytes.
     */
    static getAddressSizeInBytes(chain: Chain): number {
        return this.getChainSpec(getChainType(chain), chain).addressSizeInBytes;
    }

    /**
     * Gets the chain specification for a given chain type and chain.
     *
     * @param {ChainType} chainType - The type of the chain.
     * @param {Chain | 'default'} chain - The chain or 'default'.
     * @returns {ChainSpec} The chain specification.
     * @throws {Error} If the configuration for the chain type is not found.
     */
    static getChainSpec(chainType: ChainType, chain: Chain | 'default'): ChainSpec {
        if (chainSpecConfig[chainType] === undefined) {
            throw new Error(`config for ${chainType} not found in staticConfig`);
        }

        const config = {
            ...chainSpecConfig[chainType]?.default,
            ...chainSpecConfig[chainType]?.[chain],
        };

        return config as ChainSpec;
    }
}
