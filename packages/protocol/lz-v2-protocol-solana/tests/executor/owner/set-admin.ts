import { assert, it } from 'vitest';

import { accounts, errors, Executor, EXECUTOR_PROGRAM_ID } from '../../../src/executor';
import { SolanaTestValidator } from '../../setup';
import { ConstraintHasOne, generateMaxAdmin, sendAndConfirm, shouldBeRejected } from '../../utils';
import { executorPDA, HACKER } from '../../utils/constants';

export const testSuite = (validator: SolanaTestValidator): void => {
    const { umi } = validator;
    const wallet = umi.payer;
    const executorSDK = new Executor(EXECUTOR_PROGRAM_ID);

    it('should failure with invalid admin', async function () {
        const ix = executorSDK.setAdmins(HACKER, [wallet.publicKey]);
        await shouldBeRejected(sendAndConfirm(umi, ix, HACKER), ConstraintHasOne);
    });

    it('should failure with too many admins', async function () {
        const ix = executorSDK.setAdmins(wallet, [HACKER.publicKey, ...generateMaxAdmin()]);
        await shouldBeRejected(
            sendAndConfirm(umi, ix, wallet),
            new errors.TooManyAdminsError(executorSDK.getProgram()),
        );
    });

    it('should success', async function () {
        const [configAccount] = executorPDA.config();
        const ix = executorSDK.setAdmins(wallet, [HACKER.publicKey]);
        await sendAndConfirm(umi, ix, wallet);
        let config = await accounts.fetchExecutorConfig(umi, configAccount);
        assert.strictEqual(config.admins[0], HACKER.publicKey);
        const resetIx = executorSDK.setAdmins(wallet, [wallet.publicKey]);
        await sendAndConfirm(umi, resetIx, wallet);
        config = await accounts.fetchExecutorConfig(umi, configAccount);
        assert.strictEqual(config.admins[0], wallet.publicKey);
    });
};
