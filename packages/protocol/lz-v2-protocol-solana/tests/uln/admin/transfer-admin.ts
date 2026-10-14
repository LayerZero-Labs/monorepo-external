import { toWeb3JsPublicKey } from '@metaplex-foundation/umi-web3js-adapters';
import { assert, it } from 'vitest';

import { extractEventFromTransactionSignature } from '../../../src';
import { accounts, events, Uln, ULN_PROGRAM_ID } from '../../../src/uln';
import { SolanaTestValidator } from '../../setup';
import { ConstraintHasOne, sendAndConfirm, shouldBeRejected } from '../../utils';
import { HACKER, ulnPDA } from '../../utils/constants';

export const testSuite = (validator: SolanaTestValidator): void => {
    const { umi, connection } = validator;
    const wallet = umi.payer;
    const ulnSDK = new Uln(ULN_PROGRAM_ID);

    const [ulnSettingAccount] = ulnPDA.setting();

    it('should failure with invalid admin', async function () {
        const ix = ulnSDK.transferAdmin(HACKER, HACKER.publicKey);

        await shouldBeRejected(sendAndConfirm(umi, ix, HACKER), ConstraintHasOne);
    });

    it('should success', async function () {
        const ix = ulnSDK.transferAdmin(wallet, HACKER.publicKey);

        const { signature } = await sendAndConfirm(umi, ix, wallet);
        let ulnSetting = await accounts.fetchUlnSettings(umi, ulnSettingAccount);
        assert.strictEqual(ulnSetting.admin, HACKER.publicKey);

        // Check event
        const signatureEvents = await extractEventFromTransactionSignature(
            connection,
            toWeb3JsPublicKey(ulnSDK.programId),
            signature,
            events.getAdminTransferredEventSerializer(),
            { commitment: 'confirmed', maxSupportedTransactionVersion: 1 },
        );

        assert.strictEqual(signatureEvents?.length, 1);
        assert.strictEqual(signatureEvents?.[0].newAdmin, HACKER.publicKey);

        const resetIx = ulnSDK.transferAdmin(HACKER, wallet.publicKey);
        await sendAndConfirm(umi, resetIx, HACKER);
        ulnSetting = await accounts.fetchUlnSettings(umi, ulnSettingAccount);
        assert.strictEqual(ulnSetting.admin, wallet.publicKey);
    });
};
