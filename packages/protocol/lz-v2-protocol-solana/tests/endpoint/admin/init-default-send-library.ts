import { assert, expect, it } from 'vitest';

import { EndpointProgram, extractEventFromTransactionSignature } from '../../../src';
import { accounts, errors, events } from '../../../src/endpoint';
import { SolanaTestValidator } from '../../setup';
import {
    blockedMessageLibPDA,
    ConstraintHasOne,
    DST_EID,
    fakeReceiveMessageLibPDA,
    HACKER,
    sendAndConfirm,
    shouldBeRejected,
} from '../../utils';

export const testSuite = (validator: SolanaTestValidator): void => {
    const { umi, connection } = validator;
    const wallet = umi.payer;
    const endpointSDK = new EndpointProgram.Endpoint(EndpointProgram.ENDPOINT_PROGRAM_ID);

    it('revert if not admin', async function () {
        const ix = await endpointSDK.setDefaultSendLibrary(umi.rpc, HACKER, {
            messageLibProgram: blockedMessageLibPDA.program,
            remote: DST_EID,
        });
        await shouldBeRejected(sendAndConfirm(umi, [ix], HACKER), ConstraintHasOne);
    });

    it('revert if set receive-lib-type as default send-lib', async function () {
        const ix = await endpointSDK.setDefaultSendLibrary(umi.rpc, wallet, {
            messageLibProgram: fakeReceiveMessageLibPDA.program,
            remote: DST_EID,
        });
        await shouldBeRejected(
            sendAndConfirm(umi, [ix], wallet),
            new errors.OnlySendLibError(endpointSDK.getProgram()),
        );
    });

    it('should success', async function () {
        const [messagePda] = blockedMessageLibPDA.messageLib();
        const [defaultSendLibraryConfig, bump] = endpointSDK.pda.defaultSendLibraryConfig(DST_EID);

        const ix = await endpointSDK.setDefaultSendLibrary(umi.rpc, wallet, {
            messageLibProgram: blockedMessageLibPDA.program,
            remote: DST_EID,
        });
        const { signature } = await sendAndConfirm(umi, [ix], wallet);
        // const resp = await sendAndConfirmTx(provider.connection, provider.wallet, [ix])

        // Check
        const defaultSendLibraryConfigAccount = await accounts.fetchSendLibraryConfig(
            umi,
            defaultSendLibraryConfig,
        );
        assert.strictEqual(defaultSendLibraryConfigAccount.messageLib, messagePda);
        assert.strictEqual(defaultSendLibraryConfigAccount.bump, bump);

        // check event
        const event = await extractEventFromTransactionSignature(
            connection,
            endpointSDK.programId,
            signature,
            events.getDefaultSendLibrarySetEventSerializer(),
            { commitment: 'confirmed', maxSupportedTransactionVersion: 1 },
        );
        assert.strictEqual(event?.[0].eid, DST_EID);
        expect(event?.[0].newLib).to.eql(messagePda);
    });
};
