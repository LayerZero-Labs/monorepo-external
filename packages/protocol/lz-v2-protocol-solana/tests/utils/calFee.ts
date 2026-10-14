import { isSome } from '@metaplex-foundation/umi';
import { LAMPORTS_PER_SOL } from '@solana/web3.js';
import { BN } from 'bn.js';

import { DVNProgram, ExecutorProgram, PriceFeedProgram, UlnProgram } from '../../src';
import { SolanaTestValidator } from '../setup';
import { dvnPDA, executorPDA, ulnPDA } from './constants';
import { getPriceFeedFeeSerializer } from './decodePriceFeedFee';
import { simulateTx } from './util';

const [executorConfigAccount] = executorPDA.config();
const [dvnConfigAccount] = dvnPDA.config();

const priceFeedSdk = new PriceFeedProgram.PriceFeed();

export async function calExecutorFee(
    validator: SolanaTestValidator,
    eid: number,
    calldataSize: bigint,
    lzReceiveGas: bigint,
    lzReceiveValue: bigint,
    nativeDropAmount: bigint,
    composes: {
        composeGas: bigint;
        composeValue: bigint;
    }[],
    order = false,
): Promise<bigint> {
    const { umi, connection } = validator;
    const wallet = validator.umi.payer;
    const config = await ExecutorProgram.accounts.fetchExecutorConfig(umi, executorConfigAccount);
    const { defaultMultiplierBps } = config;

    const dstConfig = config.dstConfigs.find((config) => config.eid === eid);
    if (dstConfig === undefined) {
        throw new Error('Destination config not found');
    }
    const multiplierBps = isSome(dstConfig.multiplierBps)
        ? dstConfig.multiplierBps.value
        : defaultMultiplierBps;
    const marginUSD = dstConfig.floorMarginUsd;
    const solDecimalsRate = BigInt(LAMPORTS_PER_SOL);
    let totalGas = BigInt(dstConfig.lzReceiveBaseGas) + lzReceiveGas;
    for (const compose of composes) {
        totalGas = totalGas + BigInt(dstConfig.lzComposeBaseGas) + compose.composeGas;
    }
    if (order) {
        totalGas = (totalGas * BigInt(102)) / BigInt(100);
    }
    const getFeeIx = priceFeedSdk.getFee({
        dstEid: eid,
        calldataSize,
        totalGas,
    });
    const { fee, priceRatio, priceRatioDenominator, nativeTokenPriceUsd } = await simulateTx(
        connection,
        getFeeIx,
        wallet,
        getPriceFeedFeeSerializer(),
    );
    const feeWithMultiplier = (fee * BigInt(multiplierBps)) / 10000n;

    // const feeWithMultiplier = new BN(fee).mul(new BN(multiplierBps)).div(new BN(10000))
    let feeForGas = feeWithMultiplier;
    if (isSome(nativeTokenPriceUsd) && isSome(marginUSD)) {
        const feeWithMargin = (marginUSD.value * solDecimalsRate) / nativeTokenPriceUsd.value + fee;
        feeForGas = BigInt(
            BN.max(
                new BN(feeWithMargin.toString()),
                new BN(feeWithMultiplier.toString()),
            ).toString(),
        );
    }
    let totalAmount = lzReceiveValue + nativeDropAmount;
    for (const compose of composes) {
        totalAmount = totalAmount + compose.composeValue;
    }
    const feeForAmount =
        (((totalAmount * priceRatio) / priceRatioDenominator) * BigInt(multiplierBps)) / 10000n;
    return feeForGas + feeForAmount;
}

export async function calDvnFee(validator: SolanaTestValidator, eid: number): Promise<bigint> {
    const { umi, connection } = validator;
    const wallet = umi.payer;
    const dvnConfig = await DVNProgram.accounts.fetchDvnConfig(umi, dvnConfigAccount);
    const dstConfig = dvnConfig.dstConfigs.find((config) => config.eid === eid);
    if (dstConfig === undefined) {
        throw new Error('Destination config not found');
    }
    const { quorum } = dvnConfig.multisig;
    const { defaultMultiplierBps } = dvnConfig;
    const gas = dstConfig.dstGas;
    const marginUsd = dstConfig.floorMarginUsd;

    const solDecimalsRate = BigInt(LAMPORTS_PER_SOL);
    let totalSignatureBytes = quorum * 65;
    if (totalSignatureBytes % 32 != 0) {
        totalSignatureBytes = totalSignatureBytes - (totalSignatureBytes % 32) + 32;
    }
    const calldataSize = 68 + 320 + totalSignatureBytes + 64;
    const getFeeIx = priceFeedSdk.getFee({
        dstEid: eid,
        calldataSize,
        totalGas: gas,
    });
    const { fee, nativeTokenPriceUsd } = await simulateTx(
        connection,
        getFeeIx,
        wallet,
        getPriceFeedFeeSerializer(),
    );
    const multiplierBps = isSome(dstConfig.multiplierBps)
        ? dstConfig.multiplierBps.value
        : defaultMultiplierBps;
    const feeWithMultiplier = (fee * BigInt(multiplierBps)) / 10000n;
    // const feeWithMultiplier = new BN(fee).mul(new BN(multiplierBps)).div(new BN(10000))
    if (isSome(nativeTokenPriceUsd) && isSome(marginUsd)) {
        const feeWithMargin = (marginUsd.value * solDecimalsRate) / nativeTokenPriceUsd.value + fee;
        const retval = BN.max(
            new BN(feeWithMargin.toString()),
            new BN(feeWithMultiplier.toString()),
        );
        return BigInt(retval.toString());
    }
    // if (nativeTokenPriceUsd !== null && marginUsd !== null) {
    //     const feeWithFloorMargin = new BN(marginUsd)
    //         .mul(solDecimalsRate)
    //         .div(new BN(nativeTokenPriceUsd))
    //         .add(new BN(fee))
    //     return BN.max(feeWithFloorMargin, feeWithMultiplier)
    // }
    return feeWithMultiplier;
}

export async function calTreasuryFee(
    validator: SolanaTestValidator,
    workerFee: bigint,
    payInLzToken: boolean,
): Promise<bigint> {
    const { umi } = validator;
    const [ulnConfigAccount] = ulnPDA.setting();
    const ulnConfig = await UlnProgram.accounts.fetchUlnSettings(umi, ulnConfigAccount);
    // const { nativeFeeBps } = ulnConfig.treasury
    let treasury: UlnProgram.types.Treasury | null = null;
    if (isSome(ulnConfig.treasury)) {
        treasury = ulnConfig.treasury.value;
    } else {
        throw new Error('ulnConfig.treasury is undefined');
    }
    // const treasury = unwrapOption(ulnConfig.treasury)!
    const { nativeFeeBps } = treasury;
    let lzTokenFee = 0n;
    if (isSome(treasury.lzToken)) {
        lzTokenFee = treasury.lzToken.value.fee;
    } else {
        throw new Error('lzTokenFee is undefined');
    }
    if (payInLzToken) {
        return lzTokenFee;
    } else {
        return (workerFee * nativeFeeBps) / 10000n;
    }
}
