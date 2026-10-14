import { none, some } from '@metaplex-foundation/umi';
import { assert, it } from 'vitest';

import { accounts, errors, Executor, EXECUTOR_PROGRAM_ID, types } from '../../../src/executor';
import { SolanaTestValidator } from '../../setup';
import {
    executorPDA,
    maxDstConfigsLen,
    sendAndConfirm,
    shouldBeRejected,
    splitArrayIntoChunks,
} from '../../utils';
import { DST_EID, HACKER } from '../../utils/constants';
import { InvalidSizeError } from '../owner/init-executor';

export const testSuite = (validator: SolanaTestValidator): void => {
    const { umi } = validator;
    const wallet = umi.payer;
    const executorSDK = new Executor(EXECUTOR_PROGRAM_ID);

    const [configAccount] = executorPDA.config();
    const dstConfig: types.DstConfig = {
        eid: DST_EID,
        lzReceiveBaseGas: 1000,
        lzComposeBaseGas: 1000,
        multiplierBps: some(12000),
        floorMarginUsd: none(),
        nativeDropCap: 10000000000n,
    };

    it('should failure with invalid admin', async function () {
        const ix = executorSDK.setDstConfig(HACKER, [dstConfig]);
        await shouldBeRejected(
            sendAndConfirm(umi, ix, HACKER),
            new errors.NotAdminError(executorSDK.getProgram()),
        );
    });

    it('should success', async function () {
        const ix = executorSDK.setDstConfig(wallet, [dstConfig]);

        await sendAndConfirm(umi, ix, wallet);
        const config = await accounts.fetchExecutorConfig(umi, configAccount);
        assert.deepStrictEqual(config.dstConfigs[0], dstConfig);
    });

    it('should success with updated dst config', async function () {
        const updatedDstConfig = {
            ...dstConfig,
            lzReceiveBaseGas: 2000,
        };
        let ix = executorSDK.setDstConfig(wallet, [updatedDstConfig]);

        await sendAndConfirm(umi, ix, wallet);
        const config = await accounts.fetchExecutorConfig(umi, configAccount);
        assert.deepStrictEqual(config.dstConfigs[0], updatedDstConfig);
        // reset to original value
        ix = executorSDK.setDstConfig(wallet, [dstConfig]);
        await sendAndConfirm(umi, ix, wallet);
    });

    it('should success with max dst configs', async function () {
        // when length larger than 91, the quote will fail.
        const array: types.DstConfig[] = Array.from({ length: maxDstConfigsLen - 1 }, (_, i) => {
            return { ...dstConfig, eid: DST_EID + i + 2 };
        });
        const arraySplits = splitArrayIntoChunks(array, 10);
        await Promise.all(
            arraySplits.map(async (split): Promise<void> => {
                const ix = executorSDK.setDstConfig(wallet, split);
                await sendAndConfirm(umi, ix, wallet);
            }),
        );
        const config = await accounts.fetchExecutorConfig(umi, configAccount);
        assert.strictEqual(config.dstConfigs.length, maxDstConfigsLen);
    });

    it('should failure with too many dst configs', async function () {
        const config: types.DstConfig = { ...dstConfig, eid: DST_EID + maxDstConfigsLen + 2 };
        const ix = executorSDK.setDstConfig(wallet, [config]);
        await shouldBeRejected(sendAndConfirm(umi, ix, wallet), InvalidSizeError);
    });
};
