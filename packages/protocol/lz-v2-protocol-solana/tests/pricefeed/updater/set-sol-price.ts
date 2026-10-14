import { isNone } from '@metaplex-foundation/umi';
import { assert, it } from 'vitest';

import { accounts, errors, PriceFeed, PRICEFEED_PROGRAM_ID } from '../../../src/pricefeed';
import { SolanaTestValidator } from '../../setup';
import { sendAndConfirm, shouldBeRejected } from '../../utils';
import { HACKER } from '../../utils/constants';

export const testSuite = (validator: SolanaTestValidator): void => {
    const { umi } = validator;
    const priceFeedSdk = new PriceFeed(PRICEFEED_PROGRAM_ID);
    const [priceFeedAccount] = priceFeedSdk.pda.priceFeed();
    const wallet = umi.payer;

    it('should failure with fake updater', async function () {
        const ix = priceFeedSdk.setSolPrice(HACKER, null);

        await shouldBeRejected(
            sendAndConfirm(umi, [ix], wallet),
            new errors.InvalidUpdaterError(priceFeedSdk.getProgram()),
        );
    });

    it('should success', async function () {
        const ix = priceFeedSdk.setSolPrice(wallet, null);

        await sendAndConfirm(umi, [ix], wallet);
        const priceFeed = await accounts.fetchPriceFeed(umi, priceFeedAccount);
        assert.ok(isNone(priceFeed.nativeTokenPriceUsd));
    });
};
