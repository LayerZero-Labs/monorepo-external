import { it } from 'vitest';

import { EndpointProgram } from '../../../src';
import { SolanaTestValidator } from '../../setup';
import { assert, endpointPDA, sendAndConfirm, shouldBeRejected, SRC_EID } from '../../utils';

export const testSuite = (validator: SolanaTestValidator): void => {
    const { umi } = validator;
    const wallet = umi.payer;
    const endpointSDK = new EndpointProgram.Endpoint(EndpointProgram.ENDPOINT_PROGRAM_ID);

    it('should success', async function () {
        const ix = endpointSDK.initEndpoint(wallet, { eid: SRC_EID, admin: wallet.publicKey });
        await sendAndConfirm(umi, [ix], wallet);

        // Check
        const [endpoint, bump] = endpointPDA.setting();
        const endpointSetting = await EndpointProgram.accounts.fetchEndpointSettings(umi, endpoint);
        assert.strictEqual(endpointSetting.eid, SRC_EID);
        assert.strictEqual(endpointSetting.admin.toString(), wallet.publicKey.toString());
        assert.strictEqual(endpointSetting.bump, bump);
    });

    it('should revert if init twice', async function () {
        const ix = endpointSDK.initEndpoint(wallet, { eid: SRC_EID, admin: wallet.publicKey });
        await shouldBeRejected(sendAndConfirm(umi, [ix], wallet), 'already in use');
    });
};
