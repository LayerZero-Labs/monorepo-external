import { assert, it } from 'vitest';

import { EndpointProgram } from '../../../src';
import { accounts } from '../../../src/endpoint';
import { SolanaTestValidator } from '../../setup';
import {
    ConstraintHasOne,
    DefaultMessageLib,
    DST_EID,
    endpointPDA,
    EOAPP,
    EOAPP_DELEGATE,
    HACKER,
    sendAndConfirm,
    shouldBeRejected,
    SRC_EID,
} from '../../utils';

export const testSuite = (validator: SolanaTestValidator): void => {
    const { umi } = validator;
    const endpointSDK = new EndpointProgram.Endpoint(EndpointProgram.ENDPOINT_PROGRAM_ID);
    const oapp = EOAPP;

    // PDAs
    const [receiveLibraryConfig, bump] = endpointPDA.receiveLibraryConfig(oapp.publicKey, DST_EID);

    it('revert if not delegate', async function () {
        const ix = endpointSDK.initOAppReceiveLibrary(HACKER, {
            receiver: oapp.publicKey,
            remote: SRC_EID,
        });
        await shouldBeRejected(sendAndConfirm(umi, ix, HACKER), ConstraintHasOne);
    });

    it('should success', async function () {
        const ix = endpointSDK.initOAppReceiveLibrary(EOAPP_DELEGATE, {
            receiver: oapp.publicKey,
            remote: SRC_EID,
        });
        await sendAndConfirm(umi, ix, EOAPP_DELEGATE);

        // check accounts initialized
        const receiveSetting = await accounts.fetchReceiveLibraryConfig(umi, receiveLibraryConfig);
        assert.strictEqual(receiveSetting.bump, bump);
        assert.strictEqual(receiveSetting.messageLib, DefaultMessageLib);
    });
};
