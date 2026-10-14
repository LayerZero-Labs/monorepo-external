import { it } from 'vitest';

import { EndpointProgram, UlnProgram } from '../../../src';
import { SolanaTestValidator } from '../../setup';
import { assert, DST_EID, EOAPP_DELEGATE, EOAPP_ULN, sendAndConfirm } from '../../utils';

/// notice: the message lib pda must be initialized before this test

export const testSuite = (validator: SolanaTestValidator): void => {
    const { umi } = validator;
    const wallet = umi.payer;
    const endpointSDK = new EndpointProgram.Endpoint(EndpointProgram.ENDPOINT_PROGRAM_ID);
    const ulnSdk = new UlnProgram.Uln(UlnProgram.ULN_PROGRAM_ID);
    const oAppKp2 = EOAPP_ULN;

    it('uln init config should success', async function () {
        const ix = endpointSDK.initOAppConfig(
            { delegate: EOAPP_DELEGATE, payer: wallet.publicKey },
            {
                msgLibSDK: ulnSdk,
                oapp: oAppKp2.publicKey,
                remote: DST_EID,
            },
        );
        await sendAndConfirm(umi, ix, [wallet, EOAPP_DELEGATE]);

        const [sendConfigAccount, sendConfigBump] = ulnSdk.pda.sendConfig(
            DST_EID,
            oAppKp2.publicKey,
        );
        const [receiveConfigAccount, receiveConfigBump] = ulnSdk.pda.receiveConfig(
            DST_EID,
            oAppKp2.publicKey,
        );
        const sendConfig = await UlnProgram.accounts.fetchSendConfig(umi, sendConfigAccount);
        assert.strictEqual(sendConfig.bump, sendConfigBump);
        const receiveConfigStore = await UlnProgram.accounts.fetchReceiveConfig(
            umi,
            receiveConfigAccount,
        );
        assert.strictEqual(receiveConfigStore.bump, receiveConfigBump);
    });
};
