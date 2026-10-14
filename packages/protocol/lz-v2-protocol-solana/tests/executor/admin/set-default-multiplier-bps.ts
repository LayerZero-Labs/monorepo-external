import { assert, it } from 'vitest';

import { accounts, errors, Executor, EXECUTOR_PROGRAM_ID } from '../../../src/executor';
import { SolanaTestValidator } from '../../setup';
import { defaultMultiplierBps, executorPDA, sendAndConfirm, shouldBeRejected } from '../../utils';
import { HACKER } from '../../utils/constants';

export const testSuite = (validator: SolanaTestValidator): void => {
    const { umi } = validator;
    const wallet = umi.payer;
    const executorSDK = new Executor(EXECUTOR_PROGRAM_ID);

    const [configAccount] = executorPDA.config();

    it('should failure with invalid admin', async function () {
        const ix = executorSDK.setDefaultMultiplierBps(HACKER, defaultMultiplierBps);
        await shouldBeRejected(
            sendAndConfirm(umi, ix, HACKER),
            new errors.NotAdminError(executorSDK.getProgram()),
        );
    });

    it('should success', async function () {
        const ix = executorSDK.setDefaultMultiplierBps(wallet, defaultMultiplierBps);
        await sendAndConfirm(umi, ix, wallet);
        const config = await accounts.fetchExecutorConfig(umi, configAccount);
        assert.strictEqual(config.defaultMultiplierBps, defaultMultiplierBps);
    });
};
