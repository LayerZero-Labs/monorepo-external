import { assert, it } from 'vitest';

import { SimpleMessageLibProgram } from '../../../src';
import { accounts } from '../../../src/simple-message-lib';
import { SolanaTestValidator } from '../../setup';
import { endpointPDA, sendAndConfirm, simpleMessageLibPDA, SRC_EID } from '../../utils';

export const testSuite = (validator: SolanaTestValidator): void => {
    const { umi } = validator;
    const wallet = validator.umi.payer;
    const simpleSdk = new SimpleMessageLibProgram.SimpleMessageLib(
        SimpleMessageLibProgram.SIMPLE_MESSAGELIB_PROGRAM_ID,
    );

    it('should success', async function () {
        // PDAs
        const [messagePda, bump] = simpleMessageLibPDA.messageLib();
        const [messageLibAuthority] = endpointPDA.messageLibraryInfo(messagePda);

        const fee = 2000000;
        const ix = simpleSdk.initSimpleMessageLib(wallet, {
            eid: SRC_EID,
            endpointProgram: endpointPDA.program,
            admin: wallet.publicKey,
            nativeFee: fee,
            lzTokenFee: fee,
        });
        await sendAndConfirm(umi, [ix], wallet);

        // Check
        const messageLibConfig = await accounts.fetchMessageLib(umi, messagePda);
        assert.strictEqual(messageLibConfig.eid, SRC_EID);
        assert.strictEqual(messageLibConfig.admin.toString(), wallet.publicKey.toString());
        assert.strictEqual(messageLibConfig.endpoint, messageLibAuthority);
        assert.strictEqual(messageLibConfig.fee.toString(), `${fee}`);
        assert.strictEqual(messageLibConfig.lzTokenFee.toString(), `${fee}`);
        assert.strictEqual(messageLibConfig.bump, bump);
    });
};
