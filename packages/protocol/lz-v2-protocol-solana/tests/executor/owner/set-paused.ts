import { assert, it } from 'vitest';

import { accounts, Executor, EXECUTOR_PROGRAM_ID } from '../../../src/executor';
import { SolanaTestValidator } from '../../setup';
import { ConstraintHasOne, HACKER, sendAndConfirm, shouldBeRejected } from '../../utils';
import { executorPDA } from '../../utils/constants';

export const testSuite = (validator: SolanaTestValidator): void => {
    const { umi } = validator;
    const wallet = umi.payer;
    const executorSDK = new Executor(EXECUTOR_PROGRAM_ID);

    it('should failure with invalid admin', async function () {
        const ix = executorSDK.setPaused(HACKER, true);
        await shouldBeRejected(sendAndConfirm(umi, ix, HACKER), ConstraintHasOne);
    });

    it('should success', async function () {
        const [configAccount] = executorPDA.config();
        const ix = executorSDK.setPaused(wallet, true);
        await sendAndConfirm(umi, ix, wallet);
        let config = await accounts.fetchExecutorConfig(umi, configAccount);
        assert.strictEqual(config.paused, true);

        const resetIx = executorSDK.setPaused(wallet, false);
        await sendAndConfirm(umi, resetIx, wallet);
        config = await accounts.fetchExecutorConfig(umi, configAccount);
        assert.strictEqual(config.paused, false);
    });
};
