import { type DecimalString, decimalString } from '@layerzerolabs/common-chain-model';
import { ChainName } from '@layerzerolabs/layerzero-definitions';
import { isArbStackChain, isZkChain } from '@layerzerolabs/static-chain-info';

/**
 * Cost of deploying a max size contract in Ethereum:
 *
 * - 24,576 bytes * 200 gas/byte = 4,915,200 gas (code deposit cost)
 * - ~25,000 bytes * 16 gas/byte = 400,000 gas (calldata cost)
 * - 21,000 gas (transaction cost)
 * - 32,000 gas (contract creation cost)
 * - Dynamic initializer gas cost
 *
 * To be scaled per chain with gas premiums.
 */
export const DEFAULT_DEPLOYMENT_GAS = 6_000_000n;

const DEFAULT_GAS_PER_BYTE = 16n;

const TX_BASE_GAS = 21_000n;
const FLOOR_GAS_PER_BYTE = 40n;

const MIN_GAS_LIMIT_PER_CHAIN: Partial<Record<ChainName, bigint>> = {
    [ChainName.ARBITRUM]: 3_200_000n,
    [ChainName.ARBSEP]: 3_200_000n,
    [ChainName.ETHERLINK]: 10_000_000n,
    [ChainName.FRAME]: 3_200_000n,
    [ChainName.HEDERA]: 700_000n,
    [ChainName.MANTLE]: 3_200_000n,
    [ChainName.MEGAETH]: 9_000_000n,
    [ChainName.MEGAETH2]: 9_000_000n,
    [ChainName.MOONBEAM]: 400_000n,
    [ChainName.MOONRIVER]: 400_000n,
    [ChainName.RARIBLE]: 3_200_000n,
    [ChainName.REAL]: 3_200_000n,
    [ChainName.TREASURE]: 3_200_000n,
    [ChainName.XPLA]: 150_000n,
};

const MAX_GAS_LIMIT_PER_CHAIN: Partial<Record<ChainName, bigint>> = {
    // 12.5M gas limit per block and 3.6x `SSTORE` cost.
    // Applying 10M gas limit to prevent taking the whole block.
    // https://docs.sei.io/evm/differences-with-ethereum#mainnet
    [ChainName.SEI]: 10_000_000n,
    // https://docs.tempo.xyz/protocol/tips/tip-1010.
    [ChainName.TEMPO]: 26_500_000n,
};

const DEFAULT_GAS_LIMIT_PREMIUM = 1_00n;

const GAS_LIMIT_PREMIUM_PER_CHAIN: Partial<Record<ChainName, bigint>> = {
    [ChainName.ABSTRACT]: 2_50n, // TODO: validate
    [ChainName.ETHERLINK]: 36_00n,
    [ChainName.ETHERLINKSHADOWNET]: 36_00n,
    [ChainName.FRAME]: 19_70n,
    [ChainName.GATELAYER]: 15_00n,
    [ChainName.GLUE]: 10_00n,
    [ChainName.GOERLI]: 2_50n,
    // 4x `SLOAD` cost, and different precompile costs.
    // 2x as a middle ground since Monad uses all gas limit instead of refunding.
    // https://docs.monad.xyz/developer-essentials/opcode-pricing
    [ChainName.MONAD]: 2_00n,
    [ChainName.MOONBEAM]: 20_00n,
    [ChainName.MOONRIVER]: 20_00n,
    [ChainName.NOVA]: 4_10n,
    [ChainName.RARIBLE]: 19_70n,
    // 3.6x `SSTORE` cost, the rest of the operations cost the same. 3x is a middle ground.
    // https://docs.sei.io/evm/differences-with-ethereum#sstore-gas-cost
    [ChainName.SEI]: 3_00n,
    [ChainName.SEPOLIA]: 5_00n,
    [ChainName.SOMNIA]: 20_00n,
    // Equivalent transactions:
    // - 1,044,015 gas: https://explore.tempo.xyz/tx/0x81e7f78c35c58cee97014588ab28e9b7f1a48c36b46c81d1711c23c56af63057
    // - 123,615 gas: https://etherscan.io/tx/0x512e1927ab18d5fc4e57eaaf116875401d497a247b00fda424df3989aac34ee3
    [ChainName.TEMPO]: 8_50n,
    [ChainName.XPLA]: 3_00n,
    [ChainName.ZKSYNC]: 2_50n, // TODO: validate
    [ChainName.ZKSYNCSEP]: 2_50n, // TODO: validate
};

// Arbitrum: L2 tx overhead and L1 calldata byte cost from `ArbGasInfo` precompile.
// Validated against on-chain data across 16 arb-stack chains (now, -7d, -28d).
const ARB_GAS_PER_L2_TX = 20_000n;
const ARB_GAS_PER_L1_CALLDATA_BYTE = 200n;

// Nova is an outlier (~129k gasPerL2Tx, ~920 gasPerL1CallDataByte on-chain).
const ARB_GAS_PER_L2_TX_PER_CHAIN: Partial<Record<ChainName, bigint>> = {
    [ChainName.NOVA]: 200_000n,
};
const ARB_GAS_PER_L1_CALLDATA_BYTE_PER_CHAIN: Partial<Record<ChainName, bigint>> = {
    [ChainName.NOVA]: 2_000n,
};

// Mantle: L2 tx overhead, L1 calldata byte cost, and MNT/ETH token ratio
// from `BVM_GasPriceOracle`. Validated against on-chain data (now, -7d, -28d).
const MANTLE_GAS_PER_L2_TX = 21_000n;
const MANTLE_GAS_PER_L1_CALLDATA_BYTE = 60_000n;
const MANTLE_TOKEN_RATIO = 4_000n;

// Optimism fixed L2 overhead added to the base gas.
const OPTIMISM_OVERHEAD_GAS = 3_188n;

type GasLimitParams = {
    chainName: ChainName;
    gas: bigint;
    // TODO: can we make this `HexString`?
    data?: string;
};

const clampGasLimit = (gasLimit: bigint, chainName: ChainName): bigint => {
    const maxGasLimit = MAX_GAS_LIMIT_PER_CHAIN[chainName];
    const clamped = maxGasLimit && gasLimit > maxGasLimit ? maxGasLimit : gasLimit;

    const minGasLimit = MIN_GAS_LIMIT_PER_CHAIN[chainName];
    if (minGasLimit && clamped < minGasLimit) {
        return minGasLimit;
    }
    return clamped;
};

const getArbitrumGasLimit = (params: GasLimitParams): bigint => {
    const { chainName, gas, data = '0x' } = params;

    const gasPerL2Tx = ARB_GAS_PER_L2_TX_PER_CHAIN[chainName] ?? ARB_GAS_PER_L2_TX;
    const gasPerL1CallDataByte =
        ARB_GAS_PER_L1_CALLDATA_BYTE_PER_CHAIN[chainName] ?? ARB_GAS_PER_L1_CALLDATA_BYTE;

    const dataBytes = BigInt(data.slice(2).length / 2);
    const gasForL1CallData = dataBytes * gasPerL1CallDataByte;
    const gasForL2CallData = dataBytes * DEFAULT_GAS_PER_BYTE;

    const gasLimitPremiumPercent =
        GAS_LIMIT_PREMIUM_PER_CHAIN[chainName] ?? DEFAULT_GAS_LIMIT_PREMIUM;
    const gasLimit =
        ((gas + gasPerL2Tx + gasForL1CallData + gasForL2CallData) * gasLimitPremiumPercent) / 1_00n;

    return clampGasLimit(gasLimit, chainName);
};

const getOptimismGasLimit = (params: GasLimitParams): bigint => {
    const { chainName, gas, data = '0x' } = params;

    const dataBytes = BigInt(data.slice(2).length / 2);
    const gasForCallData = dataBytes * DEFAULT_GAS_PER_BYTE;

    const gasLimitPremiumPercent =
        GAS_LIMIT_PREMIUM_PER_CHAIN[chainName] ?? DEFAULT_GAS_LIMIT_PREMIUM;
    const gasLimit =
        ((gas + OPTIMISM_OVERHEAD_GAS + gasForCallData * 2n) * gasLimitPremiumPercent) / 1_00n;

    return clampGasLimit(gasLimit, chainName);
};

// TODO: validate that ZKSync and Optimism gas models match.
const getZkSyncGasLimit = (params: GasLimitParams): bigint => {
    return getOptimismGasLimit(params);
};

// L2ExecutionFee = L2gasPrice * L2gasUsed * tokenRatio
// L1RollupFee = (rollupDataGas + overhead) * L1gasPrice * tokenRatio * scalar
const getMantleGasLimit = (params: GasLimitParams): bigint => {
    const { chainName, gas, data = '0x' } = params;

    const dataBytes = BigInt(data.slice(2).length / 2);
    const gasForL1CallData = dataBytes * MANTLE_GAS_PER_L1_CALLDATA_BYTE;
    const gasForL2CallData = dataBytes * DEFAULT_GAS_PER_BYTE;

    const gasLimitPremiumPercent =
        GAS_LIMIT_PREMIUM_PER_CHAIN[chainName] ?? DEFAULT_GAS_LIMIT_PREMIUM;
    const gasLimit =
        ((gas * MANTLE_TOKEN_RATIO + // https://docs-v2.mantle.xyz/devs/concepts/tx-fee/ef
            MANTLE_GAS_PER_L2_TX + // mantle dynamic overhead
            gasForL1CallData +
            gasForL2CallData) *
            gasLimitPremiumPercent) /
        1_00n;

    return clampGasLimit(gasLimit, chainName);
};

const getDefaultGasLimit = (params: GasLimitParams): bigint => {
    const { chainName, gas, data = '0x' } = params;

    // Worst case-scenario, since zero calldata bytes are cheaper than non-zero calldata bytes.
    const dataBytes = BigInt(data.slice(2).length / 2);
    const gasForCallData = dataBytes * DEFAULT_GAS_PER_BYTE;
    const callDataFloor = TX_BASE_GAS + dataBytes * FLOOR_GAS_PER_BYTE;
    const baseGas = gas + gasForCallData < callDataFloor ? callDataFloor : gas + gasForCallData;

    const gasLimitPremiumPercent =
        GAS_LIMIT_PREMIUM_PER_CHAIN[chainName] ?? DEFAULT_GAS_LIMIT_PREMIUM;
    const gasLimit = (baseGas * gasLimitPremiumPercent) / 1_00n;

    return clampGasLimit(gasLimit, chainName);
};

/**
 * @param params.chainName LZ name of the chain.
 * @param params.gas Base execution gas of the operation.
 * @param params.data Call data of the transaction.
 */
export const getGasLimit = (params: GasLimitParams): DecimalString => {
    const { chainName } = params;

    let gasLimit: bigint;
    if (isArbStackChain(chainName)) {
        gasLimit = getArbitrumGasLimit(params);
    } else if (chainName === ChainName.OPTIMISM || chainName === ChainName.OPTSEP) {
        gasLimit = getOptimismGasLimit(params);
    } else if (isZkChain(chainName)) {
        gasLimit = getZkSyncGasLimit(params);
    } else if (chainName === ChainName.MANTLE || chainName === ChainName.MANTLESEP) {
        gasLimit = getMantleGasLimit(params);
    } else {
        gasLimit = getDefaultGasLimit(params);
    }

    return decimalString.parse(gasLimit);
};

/**
 * Scales the base execution gas for a chain and returns the transaction with the gas limit.
 * Extracts `data` from the transaction for calldata-dependent gas costs.
 *
 * @param chainName LZ name of the chain.
 * @param gas Base execution gas of the operation.
 * @param tx Transaction with optional `data` field.
 */
export const withGasLimit = <T extends { data?: string }>(
    chainName: ChainName,
    gas: bigint,
    tx: T, // TODO: can we make this `HexString`?
): Omit<T, 'gas'> & { gas: DecimalString } => ({
    ...tx,
    gas: getGasLimit({ chainName, gas, data: tx.data }),
});
