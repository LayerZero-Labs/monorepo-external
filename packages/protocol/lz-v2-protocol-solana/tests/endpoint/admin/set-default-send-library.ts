import { assert, expect, it } from 'vitest';

import { EndpointProgram, extractEventFromTransactionSignature } from '../../../src';
import { errors, events } from '../../../src/endpoint';
import { SolanaTestValidator } from '../../setup';
import {
    blockedMessageLibPDA,
    ConstraintHasOne,
    DST_EID,
    endpointPDA,
    fakeReceiveMessageLibPDA,
    HACKER,
    sendAndConfirm,
    shouldBeRejected,
    simpleMessageLibPDA,
} from '../../utils';

export const testSuite = (validator: SolanaTestValidator): void => {
    const { umi, connection } = validator;
    const wallet = umi.payer;
    const endpointSDK = new EndpointProgram.Endpoint(EndpointProgram.ENDPOINT_PROGRAM_ID);

    // PDAs
    const [defaultSendLibraryConfig, bump] = endpointPDA.defaultSendLibraryConfig(DST_EID);
    const [simpleMessagePda] = simpleMessageLibPDA.messageLib();

    it('revert if not admin', async function () {
        const ix = await endpointSDK.setDefaultSendLibrary(umi.rpc, HACKER, {
            messageLibProgram: simpleMessageLibPDA.program,
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

    it('success to set simple-lib as default send-lib', async function () {
        const ix = await endpointSDK.setDefaultSendLibrary(umi.rpc, wallet, {
            messageLibProgram: simpleMessageLibPDA.program,
            remote: DST_EID,
        });
        const { signature } = await sendAndConfirm(umi, [ix], wallet);

        // Check
        const defaultSendLibraryConfigAccount =
            await EndpointProgram.accounts.fetchSendLibraryConfig(umi, defaultSendLibraryConfig);
        assert.strictEqual(defaultSendLibraryConfigAccount.messageLib, simpleMessagePda);
        assert.strictEqual(defaultSendLibraryConfigAccount.bump, bump);

        // Check event
        const event = await extractEventFromTransactionSignature(
            connection,
            endpointSDK.programId,
            signature,
            events.getDefaultSendLibrarySetEventSerializer(),
            { commitment: 'confirmed', maxSupportedTransactionVersion: 1 },
        );
        assert.strictEqual(event?.length, 1);
        expect(event?.[0].eid).to.equal(DST_EID);
        expect(event?.[0].newLib).to.equal(simpleMessagePda);
    });

    it('revert if set simple-lib twice', async function () {
        const ix = await endpointSDK.setDefaultSendLibrary(umi.rpc, wallet, {
            messageLibProgram: simpleMessageLibPDA.program,
            remote: DST_EID,
        });

        await shouldBeRejected(
            sendAndConfirm(umi, [ix], wallet),
            new errors.SameValueError(endpointSDK.getProgram()),
        );
    });

    it('success to set blocked-lib as default send-lib', async function () {
        const [messagePda] = blockedMessageLibPDA.messageLib();

        const ix = await endpointSDK.setDefaultSendLibrary(umi.rpc, wallet, {
            messageLibProgram: blockedMessageLibPDA.program,
            remote: DST_EID,
        });
        const { signature } = await sendAndConfirm(umi, [ix], wallet);

        // Check
        const defaultSendLibraryConfigAccount =
            await EndpointProgram.accounts.fetchSendLibraryConfig(umi, defaultSendLibraryConfig);
        assert.strictEqual(defaultSendLibraryConfigAccount.messageLib, messagePda);
        assert.strictEqual(defaultSendLibraryConfigAccount.bump, bump);

        // Check event
        const event = await extractEventFromTransactionSignature(
            connection,
            endpointSDK.programId,
            signature,
            events.getDefaultSendLibrarySetEventSerializer(),
            { commitment: 'confirmed', maxSupportedTransactionVersion: 1 },
        );
        assert.strictEqual(event?.length, 1);
        expect(event?.[0].eid).to.equal(DST_EID);
        expect(event?.[0].newLib).to.equal(messagePda);
    });
};
