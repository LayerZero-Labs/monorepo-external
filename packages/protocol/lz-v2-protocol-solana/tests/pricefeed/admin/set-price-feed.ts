import { assert, it } from 'vitest';

import { PriceFeedProgram } from '../../../src';
import { accounts, errors, PriceFeed } from '../../../src/pricefeed';
import { SolanaTestValidator } from '../../setup';
import {
    arbitrumCompressionPercent,
    ConstraintHasOne,
    generateMaxUpdater,
    HACKER,
    maxUpdaterNum,
    priceRatioDenominator,
    sendAndConfirm,
    shouldBeRejected,
} from '../../utils';

export const testSuite = (validator: SolanaTestValidator): void => {
    const { umi } = validator;
    const wallet = umi.payer;
    const priceFeedSdk = new PriceFeed(PriceFeedProgram.PRICEFEED_PROGRAM_ID);
    const [priceFeedAccount] = priceFeedSdk.pda.priceFeed();

    it('should failure with invalid admin', async function () {
        const ix = priceFeedSdk.setPriceFeed(HACKER, {
            updaters: [HACKER.publicKey],
            arbitrumCompressionPercent,
            priceRatioDenominator,
        });
        await shouldBeRejected(sendAndConfirm(umi, [ix], wallet), ConstraintHasOne);
    });

    it('should failure with too many updaters', async function () {
        const ix = priceFeedSdk.setPriceFeed(wallet, {
            updaters: [wallet.publicKey, ...generateMaxUpdater()],
            arbitrumCompressionPercent,
            priceRatioDenominator,
        });

        await shouldBeRejected(
            sendAndConfirm(umi, [ix], wallet),
            new errors.TooManyUpdatersError(priceFeedSdk.getProgram()),
        );
    });

    it('should success', async function () {
        const ix = priceFeedSdk.setPriceFeed(wallet, {
            updaters: [wallet.publicKey],
            arbitrumCompressionPercent,
            priceRatioDenominator,
        });

        await sendAndConfirm(umi, [ix], wallet);

        const priceFeed = await accounts.fetchPriceFeed(umi, priceFeedAccount);
        assert.strictEqual(
            arbitrumCompressionPercent.toString(),
            priceFeed.arbitrumCompressionPercent.toString(),
        );
    });

    it('should success with multiple updaters', async function () {
        const ix = priceFeedSdk.setPriceFeed(wallet, {
            updaters: [wallet.publicKey, ...generateMaxUpdater().slice(0, maxUpdaterNum - 1)],
            arbitrumCompressionPercent,
            priceRatioDenominator,
        });

        await sendAndConfirm(umi, [ix], wallet);
        const priceFeed = await accounts.fetchPriceFeed(umi, priceFeedAccount);
        assert.strictEqual(priceFeed.updaters.length, maxUpdaterNum);
    });
};
