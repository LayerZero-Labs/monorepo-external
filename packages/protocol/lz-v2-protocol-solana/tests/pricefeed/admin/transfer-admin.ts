import { assert, it } from 'vitest';

import { accounts, PriceFeed, PRICEFEED_PROGRAM_ID } from '../../../src/pricefeed';
import { SolanaTestValidator } from '../../setup';
import { ConstraintHasOne, sendAndConfirm, shouldBeRejected } from '../../utils';
import { HACKER } from '../../utils/constants';

export const testSuite = (validator: SolanaTestValidator): void => {
    const { umi } = validator;
    const priceFeedSdk = new PriceFeed(PRICEFEED_PROGRAM_ID);
    const [priceFeedAccount] = priceFeedSdk.pda.priceFeed();
    const wallet = umi.payer;

    it('should failure with invalid admin', async function () {
        const ix = priceFeedSdk.transferAdmin(HACKER, wallet.publicKey);
        await shouldBeRejected(sendAndConfirm(umi, [ix], wallet), ConstraintHasOne);
    });

    it('should success', async function () {
        const ix = priceFeedSdk.transferAdmin(wallet, HACKER.publicKey);
        await sendAndConfirm(umi, [ix], wallet);

        let priceFeed = await accounts.fetchPriceFeed(umi, priceFeedAccount);
        assert.strictEqual(priceFeed.admin, HACKER.publicKey);

        const resetIx = priceFeedSdk.transferAdmin(HACKER, wallet.publicKey);
        await sendAndConfirm(umi, [resetIx], wallet);
        priceFeed = await accounts.fetchPriceFeed(umi, priceFeedAccount);
        assert.strictEqual(priceFeed.admin, wallet.publicKey);
    });
};
