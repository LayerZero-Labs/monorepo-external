import { assert, it } from 'vitest';

import { accounts, errors, Executor, EXECUTOR_PROGRAM_ID } from '../../../src/executor';
import { SolanaTestValidator } from '../../setup';
import {
    ConstraintHasOne,
    EXECUTOR,
    generateMaxExecutor,
    HACKER,
    maxExecutorsLen,
    sendAndConfirm,
    shouldBeRejected,
} from '../../utils';

export const testSuite = (validator: SolanaTestValidator): void => {
    const { umi } = validator;
    const wallet = umi.payer;
    const executorSDK = new Executor(EXECUTOR_PROGRAM_ID);

    it('should failure with invalid admin', async function () {
        const ix = executorSDK.setExecutors(HACKER, [wallet.publicKey]);
        await shouldBeRejected(sendAndConfirm(umi, ix, HACKER), ConstraintHasOne);
    });

    it('should failure with too many executors', async function () {
        const ix = executorSDK.setExecutors(wallet, [wallet.publicKey, ...generateMaxExecutor()]);
        await shouldBeRejected(
            sendAndConfirm(umi, ix, wallet),
            new errors.TooManyExecutorsError(executorSDK.getProgram()),
        );
    });

    it('should success', async function () {
        const [configAccount] = executorSDK.pda.config();
        const ix = executorSDK.setExecutors(wallet, [EXECUTOR.publicKey]);
        await sendAndConfirm(umi, ix, wallet);
        const config = await accounts.fetchExecutorConfig(umi, configAccount);
        assert.strictEqual(config.executors[0], EXECUTOR.publicKey);
    });

    it('should success with multiple executors', async function () {
        const ix = executorSDK.setExecutors(wallet, [
            EXECUTOR.publicKey,
            ...generateMaxExecutor().slice(0, maxExecutorsLen - 1),
        ]);
        await sendAndConfirm(umi, ix, wallet);
        // const config = await accounts.fetchExecutorConfig(umi, configAccount)
        // printToJson({ name: 'ExecutorConfig', obj: config })
    });
};
