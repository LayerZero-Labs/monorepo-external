import { assert, it } from 'vitest';

import { EndpointProgram } from '../../../src';
import { accounts } from '../../../src/endpoint';
import { SolanaTestValidator } from '../../setup';
import {
    ConstraintHasOne,
    DefaultMessageLib,
    DST_EID,
    EOAPP,
    EOAPP_DELEGATE,
    HACKER,
    sendAndConfirm,
    shouldBeRejected,
} from '../../utils';

export const testSuite = (validator: SolanaTestValidator): void => {
    const { umi } = validator;
    const endpointSDK = new EndpointProgram.Endpoint(EndpointProgram.ENDPOINT_PROGRAM_ID);
    const oapp = EOAPP;

    // PDAs
    const [sendLibraryConfig, bump] = endpointSDK.pda.sendLibraryConfig(oapp.publicKey, DST_EID);

    it('revert if not delegate', async function () {
        const ix = endpointSDK.initOAppSendLibrary(HACKER, {
            sender: oapp.publicKey,
            remote: DST_EID,
        });
        await shouldBeRejected(sendAndConfirm(umi, ix, HACKER), ConstraintHasOne);
    });

    it('should success', async function () {
        const ix = endpointSDK.initOAppSendLibrary(EOAPP_DELEGATE, {
            sender: oapp.publicKey,
            remote: DST_EID,
        });
        await sendAndConfirm(umi, ix, EOAPP_DELEGATE);

        // check accounts initialized
        const sendSetting = await accounts.fetchSendLibraryConfig(umi, sendLibraryConfig);
        assert.strictEqual(sendSetting.bump, bump);
        assert.strictEqual(sendSetting.messageLib, DefaultMessageLib);
    });
};
