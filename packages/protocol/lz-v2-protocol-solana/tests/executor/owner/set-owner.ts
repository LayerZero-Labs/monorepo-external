import { assert, it } from 'vitest';

import { accounts, Executor, EXECUTOR_PROGRAM_ID } from '../../../src/executor';
import { SolanaTestValidator } from '../../setup';
import { ConstraintHasOne, sendAndConfirm, shouldBeRejected } from '../../utils';
import { executorPDA, HACKER } from '../../utils/constants';

export const testSuite = (validator: SolanaTestValidator): void => {
    const { umi } = validator;
    const wallet = umi.payer;
    const executorSDK = new Executor(EXECUTOR_PROGRAM_ID);

    it('should failure with invalid admin', async function () {
        const ix = executorSDK.setOwner(HACKER, wallet.publicKey);
        await shouldBeRejected(sendAndConfirm(umi, ix, HACKER), ConstraintHasOne);
    });

    it('should success', async function () {
        const [configAccount] = executorPDA.config();
        const ix = executorSDK.setOwner(wallet, HACKER.publicKey);
        await sendAndConfirm(umi, ix, wallet);
        let config = await accounts.fetchExecutorConfig(umi, configAccount);
        assert.strictEqual(config.owner, HACKER.publicKey);
        const resetIx = executorSDK.setOwner(HACKER, wallet.publicKey);
        await sendAndConfirm(umi, resetIx, HACKER);
        config = await accounts.fetchExecutorConfig(umi, configAccount);
        assert.strictEqual(config.owner, wallet.publicKey);
    });
};
