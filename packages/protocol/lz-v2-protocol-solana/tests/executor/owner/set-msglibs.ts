import { assert, it } from 'vitest';

import { accounts, Executor, EXECUTOR_PROGRAM_ID } from '../../../src/executor';
import { SolanaTestValidator } from '../../setup';
import { ConstraintHasOne, generateMaxMsgLib, sendAndConfirm, shouldBeRejected } from '../../utils';
import { executorPDA, HACKER, ulnPDA } from '../../utils/constants';
import { InvalidSizeError } from './init-executor';

export const testSuite = (validator: SolanaTestValidator): void => {
    const { umi } = validator;
    const wallet = umi.payer;
    const executorSDK = new Executor(EXECUTOR_PROGRAM_ID);
    const [msgLibAccount] = ulnPDA.messageLib();

    it('should failure with invalid admin', async function () {
        const ix = executorSDK.setMsglibByPrograms(HACKER, [msgLibAccount]);
        await shouldBeRejected(sendAndConfirm(umi, ix, HACKER), ConstraintHasOne);
    });

    it('should failure with too many msg libs', async function () {
        const ix = executorSDK.setMsglibByPrograms(wallet, [msgLibAccount, ...generateMaxMsgLib()]);
        await shouldBeRejected(sendAndConfirm(umi, ix, wallet), InvalidSizeError);
    });

    it('should success', async function () {
        const [configAccount] = executorPDA.config();
        const ix = executorSDK.setMsglibByPDAs(wallet, [msgLibAccount]);
        // test remove msgLib
        await sendAndConfirm(umi, ix, wallet);
        let config = await accounts.fetchExecutorConfig(umi, configAccount);
        assert.strictEqual(config.msglibs.length, 0);

        // test add msgLib
        await sendAndConfirm(umi, ix, wallet);
        config = await accounts.fetchExecutorConfig(umi, configAccount);
        assert.strictEqual(config.msglibs[0], msgLibAccount);
    });
};
