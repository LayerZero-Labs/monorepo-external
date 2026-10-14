import { assert, it } from 'vitest';

import { accounts, Uln, ULN_PROGRAM_ID } from '../../../src/uln';
import { SolanaTestValidator } from '../../setup';
import { endpointPDA, SRC_EID, ulnPDA } from '../../utils/constants';
import { sendAndConfirm } from '../../utils/util';

export const testSuite = (validator: SolanaTestValidator): void => {
    const { umi } = validator;
    const wallet = validator.umi.payer;
    const ulnSDK = new Uln(ULN_PROGRAM_ID);

    it('should success', async function () {
        const [messageLib, bump] = ulnPDA.messageLib();
        const [endpointPda] = endpointPDA.messageLibraryInfo(messageLib);
        const ix = ulnSDK.initUln(wallet, {
            eid: SRC_EID,
            endpointProgram: endpointPDA.program,
            admin: wallet.publicKey,
        });
        await sendAndConfirm(umi, ix, wallet);
        const settings = await accounts.fetchUlnSettings(umi, ulnPDA.setting()[0]);
        assert.strictEqual(settings.endpoint, endpointPda);
        assert.strictEqual(settings.admin, wallet.publicKey);
        assert.strictEqual(settings.eid, SRC_EID);
        assert.strictEqual(settings.bump, bump);
    });
};
