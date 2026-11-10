import { describe, expect, test } from 'vitest';

import {
    chainAndStageToEndpointId,
    chainAndStageToNetwork,
    endpointIdToChainKey,
    endpointIdToNetwork,
    endpointIdToStage,
    getChainType,
    isAptosChain,
    isCantonChain,
    isEvmChain,
    isSolanaChain,
    isTronChain,
    isZKSyncBasedChain,
    networkToEndpointId,
    networkToStage,
} from './utils';
import {
    Chain,
    ChainKey,
    ChainType,
    EndpointId,
    EndpointVersion,
    Environment,
    Stage,
} from '../enums';

describe('Utility', () => {
    // getChainType
    test.each([
        // Chain, ChainFamily
        [Chain.ETHEREUM, ChainType.EVM],
        [Chain.APTOS, ChainType.APTOS],
        ['__NON_EXIST__', ChainType.UNKNOWN],
    ])('getChainType(%s, %s)', (chain, chainType) => {
        const val = chain as Chain;
        const rv = getChainType(val);
        expect(rv).toEqual(chainType);
    });

    test.each([
        [Chain.APTOS, true],
        [Chain.ETHEREUM, false],
        [Chain.SOLANA, false],
    ])('isAptosChain(%s)', (chain, expected) => {
        const val = chain as Chain;
        const rv = isAptosChain(val);
        expect(rv).toEqual(expected);
    });

    test.each([
        [Chain.APTOS, false],
        [Chain.ETHEREUM, true],
        [Chain.SOLANA, false],
    ])('isEvmChain(%s)', (chain, expected) => {
        const val = chain as Chain;
        const rv = isEvmChain(val);
        expect(rv).toEqual(expected);
    });

    test.each([
        [Chain.APTOS, false],
        [Chain.ETHEREUM, false],
        [Chain.SOLANA, true],
    ])('isSolanaChain(%s)', (chain, expected) => {
        const val = chain as Chain;
        const rv = isSolanaChain(val);
        expect(rv).toEqual(expected);
    });

    test.each([
        [Chain.APTOS, false],
        [Chain.ETHEREUM, false],
        [Chain.CANTON, true],
    ])('isCantonChain(%s)', (chain, expected) => {
        const val = chain as Chain;
        const rv = isCantonChain(val);
        expect(rv).toEqual(expected);
    });

    test.each([
        [Chain.TRON, true],
        [Chain.TRONDEV, true],
        [Chain.APTOS, false],
        [Chain.ETHEREUM, false],
        [Chain.SOLANA, false],
    ])('isTronChain(%s)', (chain, expected) => {
        const val = chain as Chain;
        const rv = isTronChain(val);
        expect(rv).toEqual(expected);
    });

    // test chainAndStageToNetwork
    test.each([
        // Chain, Stage, Network
        [[Chain.ETHEREUM, Stage.MAINNET, EndpointVersion.V1], 'ethereum-mainnet'],
        [[Chain.ETHEREUM, Stage.MAINNET, EndpointVersion.V2], 'ethereum-mainnet'],
        [
            [Chain.ETHEREUM, Stage.MAINNET, EndpointVersion.V1, Environment.LOCAL],
            'ethereum-mainnet-local',
        ],
        [
            [Chain.ETHEREUM, Stage.MAINNET, EndpointVersion.V2, Environment.LOCAL],
            'ethereum-mainnet-local',
        ],
    ])('chainAndStageToNetwork(%s, %s)', (params, network) => {
        const valChain = params[0] as Chain;
        const valStage = params[1] as Stage;
        const valEnv = params.length > 3 ? (params[3] as Environment) : undefined;
        const rv = chainAndStageToNetwork(valChain, valStage, valEnv);
        expect(rv).toEqual(network);
    });

    // test chainAndStageToEndpointId
    test.each([
        // Chain, Stage, EndpointId
        [[Chain.ETHEREUM, Stage.MAINNET, EndpointVersion.V1], EndpointId.ETHEREUM_MAINNET],
        [[Chain.ETHEREUM, Stage.MAINNET, EndpointVersion.V2], EndpointId.ETHEREUM_V2_MAINNET],
    ])('chainAndStageToEndpointId(%s, %s)', (params, endpointId) => {
        const valChain = params[0] as Chain;
        const valStage = params[1] as Stage;
        const valVersion = params[2] as unknown as EndpointVersion;
        const rv = chainAndStageToEndpointId(valChain, valStage, valVersion);
        expect(rv).toEqual(endpointId);
    });

    // test endpointIdToStage
    test.each([
        // EndpointId, Stage
        [EndpointId.ETHEREUM_MAINNET, Stage.MAINNET],
        [EndpointId.ETHEREUM_V2_MAINNET, Stage.MAINNET],
    ])('endpointIdToStage(%s, %s)', (endpointId, stage) => {
        const rv = endpointIdToStage(endpointId);
        expect(rv).toEqual(stage);
    });

    // test networkToEndpointId
    test.each([
        ['bsc-sandbox', EndpointVersion.V1, EndpointId.BSC_SANDBOX],
        ['bsc-sandbox', EndpointVersion.V2, EndpointId.BSC_V2_SANDBOX],
    ])('networkToEndpointId(%s, %s, %s)', (network, version, endpointId) => {
        const rv = networkToEndpointId(network, version);
        expect(rv).toEqual(endpointId);
    });

    // test networkToStage
    test.each([
        ['bsc-sandbox', Stage.SANDBOX],
        ['bsc-sandbox-local', Stage.SANDBOX],
    ])('networkToStage(%s, %s)', (network, stage) => {
        const s = networkToStage(network);
        expect(s).toEqual(stage);
    });

    // test endpointIdToNetwork
    test.each([
        [EndpointId.BSC_SANDBOX, Environment.LOCAL, 'bsc-sandbox-local'],
        [EndpointId.BSC_SANDBOX, Environment.MAINNET, 'bsc-sandbox'],
        [EndpointId.BSC_SANDBOX, Environment.TESTNET, 'bsc-sandbox'],
        [EndpointId.BSC_SANDBOX, Environment.DEVNET, 'bsc-sandbox'],
        [EndpointId.BSC_SANDBOX, undefined, 'bsc-sandbox'],
    ])('endpointIdToNetwork(%s, %s, %s)', (endpointId, env, network) => {
        const rv = endpointIdToNetwork(endpointId, env);
        expect(rv).toEqual(network);
    });

    // test endpointIdToNetwork
    test.each([
        [EndpointId.ETHEREUM_SANDBOX, ChainKey.ETHEREUM_SANDBOX],
        [EndpointId.ETHEREUM_MAINNET, ChainKey.ETHEREUM],
    ])('endpointIdToChainKey(%s, %s)', (endpointId, chainKey) => {
        const rv = endpointIdToChainKey(endpointId);
        expect(rv).toEqual(chainKey);
    });
});

describe('endpointIdToStage', () => {
    const cases: [number, Stage][] = Object.values(EndpointId)
        .filter((value) => typeof value === 'number')
        .map((endpointId) => endpointId as number)
        .map((endpointId) => [endpointId, endpointIdToStageDeprecated(endpointId)]);

    // deprecated function
    function endpointIdToStageDeprecated(endpointId: number): Stage {
        if (!(endpointId in EndpointId)) throw new Error(`Invalid endpointId: ${endpointId}`);
        let key = EndpointId[endpointId];
        key = key.replace('_V2', '');
        return key.split('_')[1].toLowerCase() as Stage;
    }

    test.each(cases)('endpointIdToStage(%s, %s)', (endpointId, stage) => {
        const value = endpointIdToStage(endpointId);
        expect(value).toEqual(stage);
    });
});

describe('isZKSyncBasedChain', () => {
    test.each([
        // positive cases
        [Chain.ZKSYNC, true],
        [Chain.ZKSYNCSEP, true],
        [Chain.ZKLINK, true],
        [Chain.ABSTRACT, true],
        [Chain.SOPHON, true],
        [Chain.TREASURE, true],
        [Chain.CRONOSZKEVM, true],
        [Chain.LENS, true],

        // negative cases
        ...Object.values(Chain)
            .filter(
                (chain) =>
                    chain !== Chain.ZKSYNC &&
                    chain !== Chain.ZKSYNCSEP &&
                    chain !== Chain.ZKLINK &&
                    chain !== Chain.ABSTRACT &&
                    chain !== Chain.SOPHON &&
                    chain !== Chain.TREASURE &&
                    chain !== Chain.CRONOSZKEVM &&
                    chain !== Chain.LENS,
            )
            .map((chain) => [chain, false]),
    ])('isZKSyncBasedChain(%s, %s)', (chain, expected) => {
        expect(isZKSyncBasedChain(chain as Chain)).toEqual(expected);
    });
});
