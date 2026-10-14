import { assert, it } from 'vitest';

import { accounts, errors, Executor, EXECUTOR_PROGRAM_ID } from '../../../src/executor';
import { SolanaTestValidator } from '../../setup';
import {
    EXECUTOR,
    generateMaxExecutor,
    generateMaxMsgLib,
    priceFeedPda,
    sendAndConfirm,
    shouldBeRejected,
    ulnPDA,
} from '../../utils';
import { executorPDA } from '../../utils/constants';
import { generateMaxAdmin } from '../../utils/util';

// packages/layerzero-v2/solana/target/idl/worker_interface.json
export const InvalidSizeError = {
    name: 'InvalidSize',
    code: 0x1771, // 6001
};

export const testSuite = (validator: SolanaTestValidator): void => {
    const { umi } = validator;
    const wallet = umi.payer;
    const executorSDK = new Executor(EXECUTOR_PROGRAM_ID);

    const [configAccount, bump] = executorPDA.config();
    const [msgLibAccount] = ulnPDA.messageLib();
    const [priceFeedAccount] = priceFeedPda.priceFeed();

    it('should failure with too many admins', async function () {
        const ix = executorSDK.initExecutor(wallet, {
            owner: wallet.publicKey,
            admins: [wallet.publicKey, ...generateMaxAdmin()],
            executors: [wallet.publicKey],
            msglibs: [msgLibAccount],
            priceFeed: priceFeedAccount,
        });
        await shouldBeRejected(
            sendAndConfirm(umi, ix, wallet),
            new errors.TooManyAdminsError(executorSDK.getProgram()),
        );
    });

    it('should failure with too many msg libs', async function () {
        const ix = executorSDK.initExecutor(wallet, {
            owner: wallet.publicKey,
            admins: [wallet.publicKey],
            executors: [wallet.publicKey],
            msglibs: [msgLibAccount, ...generateMaxMsgLib()],
            priceFeed: priceFeedAccount,
        });

        await shouldBeRejected(sendAndConfirm(umi, ix, wallet), InvalidSizeError);
    });

    it('should failure with too many executors', async function () {
        const ix = executorSDK.initExecutor(wallet, {
            owner: wallet.publicKey,
            admins: [wallet.publicKey],
            executors: [wallet.publicKey, ...generateMaxExecutor()],
            msglibs: [msgLibAccount],
            priceFeed: priceFeedAccount,
        });

        await shouldBeRejected(
            sendAndConfirm(umi, ix, wallet),
            new errors.TooManyExecutorsError(executorSDK.getProgram()),
        );
    });

    it('should success', async function () {
        const ix = executorSDK.initExecutor(wallet, {
            owner: wallet.publicKey,
            admins: [wallet.publicKey],
            executors: [EXECUTOR.publicKey],
            msglibs: [msgLibAccount],
            priceFeed: priceFeedAccount,
        });

        await sendAndConfirm(umi, ix, wallet);
        const config = await accounts.fetchExecutorConfig(umi, configAccount);
        assert.strictEqual(config.owner, wallet.publicKey);
        assert.strictEqual(config.admins[0], wallet.publicKey);
        assert.strictEqual(config.admins.length, 1);
        assert.strictEqual(config.msglibs.length, 1);
        assert.strictEqual(config.msglibs[0], msgLibAccount);
        assert.strictEqual(config.priceFeed, priceFeedAccount);
        assert.strictEqual(config.executors.length, 1);
        assert.strictEqual(config.executors[0], EXECUTOR.publicKey);
        assert.strictEqual(config.bump, bump);
    });
};
