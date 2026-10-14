import { it } from 'vitest';

import { EndpointProgram, SimpleMessageLibProgram } from '../../../src';
import { SolanaTestValidator } from '../../setup';
import {
    assert,
    DST_EID,
    EOAPP,
    EOAPP_DELEGATE,
    sendAndConfirm,
    simpleMessageLibPDA,
} from '../../utils';

/// notice: the message lib pda must be initialized before this test

export const testSuite = (validator: SolanaTestValidator): void => {
    const { umi } = validator;
    const wallet = umi.payer;
    const simpleSdk = new SimpleMessageLibProgram.SimpleMessageLib(
        SimpleMessageLibProgram.SIMPLE_MESSAGELIB_PROGRAM_ID,
    );
    const endpointSDK = new EndpointProgram.Endpoint(EndpointProgram.ENDPOINT_PROGRAM_ID);
    const oAppKp = EOAPP;

    // PDAs
    const [sendConfigPda, sendConfigBump] = simpleMessageLibPDA.sendConfig(
        DST_EID,
        oAppKp.publicKey,
    );
    const [receiveConfigPda, receiveConfigBump] = simpleMessageLibPDA.receiveConfig(
        DST_EID,
        oAppKp.publicKey,
    );

    it('should init config simple-lib success', async function () {
        const ix = endpointSDK.initOAppConfig(
            { delegate: EOAPP_DELEGATE, payer: wallet.publicKey },
            {
                msgLibSDK: simpleSdk,
                oapp: oAppKp.publicKey,
                remote: DST_EID,
            },
        );
        await sendAndConfirm(umi, ix, [wallet, EOAPP_DELEGATE]);

        // check setting accounts initialized
        const sendSetting = await SimpleMessageLibProgram.accounts.fetchSendConfigStore(
            umi,
            sendConfigPda,
        );
        assert.strictEqual(sendSetting.bump, sendConfigBump);

        const receiveSetting = await SimpleMessageLibProgram.accounts.fetchReceiveConfigStore(
            umi,
            receiveConfigPda,
        );
        assert.strictEqual(receiveSetting.bump, receiveConfigBump);
    });
};
