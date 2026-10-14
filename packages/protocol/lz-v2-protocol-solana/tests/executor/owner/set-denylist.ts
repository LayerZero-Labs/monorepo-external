import { assert, it } from 'vitest';

import { accounts, Executor, EXECUTOR_PROGRAM_ID } from '../../../src/executor';
import { SolanaTestValidator } from '../../setup';
import {
    ConstraintHasOne,
    EOAPP_ULN,
    generatePublicKeys,
    maxAllowListNum,
    sendAndConfirm,
    shouldBeRejected,
} from '../../utils';
import { EOAPP, executorPDA, HACKER } from '../../utils/constants';
import { InvalidSizeError } from './init-executor';

export const testSuite = (validator: SolanaTestValidator): void => {
    const { umi } = validator;
    const wallet = umi.payer;
    const executorSDK = new Executor(EXECUTOR_PROGRAM_ID);

    it('should failure with invalid admin', async function () {
        const ix = executorSDK.setDenyList(HACKER, [EOAPP.publicKey]);
        await shouldBeRejected(sendAndConfirm(umi, ix, HACKER), ConstraintHasOne);
    });

    it('should failure with too large deny list', async function () {
        const ix = executorSDK.setDenyList(wallet, [
            EOAPP_ULN.publicKey,
            ...generatePublicKeys(maxAllowListNum),
        ]);
        await shouldBeRejected(sendAndConfirm(umi, ix, wallet), InvalidSizeError);
    });

    it('should success', async function () {
        const [configAccount] = executorPDA.config();
        const ix = executorSDK.setDenyList(wallet, [EOAPP.publicKey]);
        await sendAndConfirm(umi, ix, wallet);
        const config = await accounts.fetchExecutorConfig(umi, configAccount);
        assert.strictEqual(config.acl.denyList[0], EOAPP.publicKey);
    });
};
