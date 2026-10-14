import { WrappedInstruction } from '@metaplex-foundation/umi';
import { u128 } from '@metaplex-foundation/umi/serializers';
import { assert, it } from 'vitest';

import { PriceFeedProgram } from '../../../src';
import { accounts, errors, PriceFeed } from '../../../src/pricefeed';
import { SolanaTestValidator } from '../../setup';
import {
    DST_EID,
    gasPerByte,
    gasPriceInUnit,
    HACKER,
    maxPriceLen,
    priceRatio,
    priceRatioDenominator,
    revertIx,
    revertTxError,
    sendAndConfirm,
    shouldBeRejected,
    simulateTx,
    splitArrayIntoChunks,
} from '../../utils';

export const testSuite = (validator: SolanaTestValidator): void => {
    const { umi, connection } = validator;
    const priceFeedSdk = new PriceFeed(PriceFeedProgram.PRICEFEED_PROGRAM_ID);
    const [priceFeedAccount] = priceFeedSdk.pda.priceFeed();
    const wallet = umi.payer;

    it('should failure with fake updater', async function () {
        const ix = priceFeedSdk.setPrice(HACKER, {
            dstEid: DST_EID,
            priceRatio,
            gasPriceInUnit,
            gasPerByte,
            modelType: null,
        });

        await shouldBeRejected(
            sendAndConfirm(umi, [ix], wallet),
            new errors.InvalidUpdaterError(priceFeedSdk.getProgram()),
        );
    });

    it('should success', async function () {
        const ix = priceFeedSdk.setPrice(wallet, {
            dstEid: DST_EID,
            priceRatio,
            gasPriceInUnit,
            gasPerByte: 1,
            modelType: null,
        });

        await sendAndConfirm(umi, [ix], wallet);
        const priceFeed = await accounts.fetchPriceFeed(umi, priceFeedAccount);
        const price = priceFeed.prices.find((p) => p.eid === DST_EID);
        if (price === undefined) {
            throw new Error('price not found');
        }
        assert.strictEqual(price.priceRatio.toString(), priceRatio.toString());
        assert.strictEqual(price.gasPriceInUnit.toString(), gasPriceInUnit.toString());
        assert.strictEqual(price.gasPerByte, gasPerByte);
        const gas = 1;
        const calldataSize = 1;
        const feeIx = priceFeedSdk.getFee({
            dstEid: DST_EID,
            calldataSize,
            totalGas: gas,
        });
        const fee = await simulateTx(connection, feeIx, wallet, u128());
        assert.strictEqual(
            fee,
            (BigInt(gas + calldataSize * gasPerByte) * gasPriceInUnit * priceRatio) /
                priceRatioDenominator,
        );
    });

    it('should success with Arbitrum model type', async function () {
        const ix = priceFeedSdk.setPrice(wallet, {
            dstEid: DST_EID,
            priceRatio,
            gasPriceInUnit,
            gasPerByte: 1,
            modelType: {
                gasPerL2Tx: BigInt(0),
                gasPerL1CalldataByte: 0,
                __kind: 'Arbitrum',
            },
        });

        await shouldBeRejected(sendAndConfirm(umi, [ix, revertIx()], wallet), revertTxError());
    });

    it('should success with Optimism model type', async function () {
        const ix = priceFeedSdk.setPrice(wallet, {
            dstEid: DST_EID,
            priceRatio,
            gasPriceInUnit,
            gasPerByte: 1,
            modelType: {
                l1Eid: 0,
                __kind: 'Optimism',
            },
        });
        await shouldBeRejected(sendAndConfirm(umi, [ix, revertIx()], wallet), revertTxError());
    });

    it('should success with multi updaters', async function () {
        const ixs: WrappedInstruction[] = [];
        for (let i = 0; i < maxPriceLen - 1; i++) {
            const ix = priceFeedSdk.setPrice(wallet, {
                dstEid: DST_EID + i + 2,
                priceRatio,
                gasPriceInUnit,
                gasPerByte: 1,
                modelType: null,
            });
            ixs.push(ix);
        }
        const ixSplits = splitArrayIntoChunks(ixs, 10);
        await Promise.all(
            ixSplits.map(async (split): Promise<void> => {
                await sendAndConfirm(umi, split, wallet);
            }),
        );
        const priceFeed = await accounts.fetchPriceFeed(umi, priceFeedAccount);
        assert.strictEqual(priceFeed.prices.length, maxPriceLen);
    });
};
