import { assert, expect, it } from 'vitest';

import { EndpointProgram, extractEventFromTransactionSignature } from '../../../src';
import { errors, events } from '../../../src/endpoint';
import { SolanaTestValidator } from '../../setup';
import {
    blockedMessageLibPDA,
    ConstraintHasOne,
    DST_EID,
    fakeSendMessageLibPDA,
    HACKER,
    sendAndConfirm,
    shouldBeRejected,
} from '../../utils';

export const testSuite = (validator: SolanaTestValidator): void => {
    const { umi, connection } = validator;
    const wallet = umi.payer;
    const endpointSDK = new EndpointProgram.Endpoint(EndpointProgram.ENDPOINT_PROGRAM_ID);

    const [messagePda] = blockedMessageLibPDA.messageLib();
    const [defaultReceiveLibraryConfig, bump] =
        endpointSDK.pda.defaultReceiveLibraryConfig(DST_EID);

    it('should revert if not admin', async function () {
        const ix = await endpointSDK.setDefaultReceiveLibrary(umi.rpc, HACKER, {
            messageLibProgram: blockedMessageLibPDA.program,
            remote: DST_EID,
        });
        await shouldBeRejected(sendAndConfirm(umi, [ix], HACKER), ConstraintHasOne);
    });

    it('revert if set send-lib-type as default receive-lib', async function () {
        const ix = await endpointSDK.setDefaultReceiveLibrary(umi.rpc, wallet, {
            messageLibProgram: fakeSendMessageLibPDA.program,
            remote: DST_EID,
        });
        await shouldBeRejected(
            sendAndConfirm(umi, [ix], wallet),
            new errors.OnlyReceiveLibError(endpointSDK.getProgram()),
        );
    });

    it('should success', async function () {
        const ix = await endpointSDK.setDefaultReceiveLibrary(umi.rpc, wallet, {
            messageLibProgram: blockedMessageLibPDA.program,
            remote: DST_EID,
        });

        const { signature } = await sendAndConfirm(umi, [ix], wallet);

        // Check
        const defaultReceiveLibraryConfigAccount =
            await EndpointProgram.accounts.fetchReceiveLibraryConfig(
                umi,
                defaultReceiveLibraryConfig,
                { commitment: 'confirmed' },
            );
        assert.strictEqual(defaultReceiveLibraryConfigAccount.messageLib, messagePda);
        assert.strictEqual(defaultReceiveLibraryConfigAccount.bump, bump);

        // check event
        const event = await extractEventFromTransactionSignature(
            connection,
            endpointSDK.programId,
            signature,
            events.getDefaultReceiveLibrarySetEventSerializer(),
            { commitment: 'confirmed', maxSupportedTransactionVersion: 1 },
        );
        assert.strictEqual(event?.[0].eid, DST_EID);
        expect(event?.[0].newLib).to.eql(messagePda);
    });
};
