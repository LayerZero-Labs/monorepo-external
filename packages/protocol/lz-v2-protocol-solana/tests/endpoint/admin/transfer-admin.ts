import { afterAll, assert, it } from 'vitest';

import { EndpointProgram, extractEventFromTransactionSignature } from '../../../src';
import { SolanaTestValidator } from '../../setup';
import { ConstraintHasOne, HACKER, sendAndConfirm, shouldBeRejected } from '../../utils';

export const testSuite = (validator: SolanaTestValidator): void => {
    const { umi, connection } = validator;
    const wallet = umi.payer;
    const endpointSDK = new EndpointProgram.Endpoint(EndpointProgram.ENDPOINT_PROGRAM_ID);
    // PDAs
    const [setting] = endpointSDK.pda.setting();

    afterAll(async () => {
        // revert changes
        const ix = endpointSDK.transferAdmin(HACKER, wallet.publicKey);
        await sendAndConfirm(umi, [ix], HACKER);

        // Check
        const endpointSettings = await EndpointProgram.accounts.fetchEndpointSettings(umi, setting);
        assert.strictEqual(endpointSettings.admin, wallet.publicKey);
    });

    it('should revert if not admin', async function () {
        const ix = endpointSDK.transferAdmin(HACKER, HACKER.publicKey);
        await shouldBeRejected(sendAndConfirm(umi, [ix], HACKER), ConstraintHasOne);
    });

    it('should success transfer admin', async function () {
        const ix = endpointSDK.transferAdmin(wallet, HACKER.publicKey);
        const { signature } = await sendAndConfirm(umi, [ix], wallet);

        // Check
        const endpointSettings = await EndpointProgram.accounts.fetchEndpointSettings(umi, setting);
        assert.strictEqual(endpointSettings.admin, HACKER.publicKey);

        const event = await extractEventFromTransactionSignature(
            connection,
            endpointSDK.programId,
            signature,
            EndpointProgram.events.getAdminTransferredEventSerializer(),
            { commitment: 'confirmed', maxSupportedTransactionVersion: 1 },
        );
        assert.strictEqual(event?.[0].newAdmin, HACKER.publicKey);
    });
};
