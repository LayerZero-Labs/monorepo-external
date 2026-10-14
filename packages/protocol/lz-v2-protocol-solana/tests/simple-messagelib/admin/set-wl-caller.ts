import { assert, it } from 'vitest';

import { SimpleMessageLibProgram } from '../../../src';
import { accounts } from '../../../src/simple-message-lib';
import { SolanaTestValidator } from '../../setup';
import { sendAndConfirm } from '../../utils';
import { simpleMessageLibPDA } from '../../utils/constants';

export const testSuite = (validator: SolanaTestValidator): void => {
    const { umi } = validator;
    const wallet = umi.payer;
    const simpleSdk = new SimpleMessageLibProgram.SimpleMessageLib(
        SimpleMessageLibProgram.SIMPLE_MESSAGELIB_PROGRAM_ID,
    );

    it('should success', async function () {
        // PDAs
        const [messagePda] = simpleMessageLibPDA.messageLib();

        const ix = simpleSdk.setWhitelistCaller(wallet, wallet.publicKey);
        await sendAndConfirm(umi, [ix], wallet);

        // Check
        const messageLibConfig = await accounts.fetchMessageLib(umi, messagePda);
        assert.strictEqual(messageLibConfig.wlCaller, wallet.publicKey);
    });
};
