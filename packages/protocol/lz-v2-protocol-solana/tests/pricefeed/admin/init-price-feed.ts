import { assert, it } from 'vitest';

import { PriceFeedProgram } from '../../../src';
import { accounts, errors, PriceFeed } from '../../../src/pricefeed';
import { SolanaTestValidator } from '../../setup';
import { generateMaxUpdater, sendAndConfirm, shouldBeRejected } from '../../utils';
import { priceFeedPda } from '../../utils/constants';

export const testSuite = (validator: SolanaTestValidator): void => {
    const { umi } = validator;
    const priceFeedSdk = new PriceFeed(PriceFeedProgram.PRICEFEED_PROGRAM_ID);
    const wallet = umi.payer;

    it('should failure with too many updaters', async function () {
        const ix = priceFeedSdk.initPriceFeed(wallet, {
            admin: wallet.publicKey,
            updaters: [wallet.publicKey, ...generateMaxUpdater()],
        });

        await shouldBeRejected(
            sendAndConfirm(umi, [ix], wallet),
            new errors.TooManyUpdatersError(priceFeedSdk.getProgram()),
        );
    });

    it('should success', async function () {
        const [priceFeedAccount, bump] = priceFeedPda.priceFeed();

        const ix = priceFeedSdk.initPriceFeed(wallet, {
            admin: wallet.publicKey,
            updaters: [wallet.publicKey],
        });

        await sendAndConfirm(umi, [ix], wallet);

        const priceFeed = await accounts.fetchPriceFeed(umi, priceFeedAccount);
        assert.strictEqual(priceFeed.admin, wallet.publicKey);
        assert.strictEqual(priceFeed.updaters[0], wallet.publicKey);
        assert.strictEqual(priceFeed.bump, bump);
    });
};
