import { assert, it } from 'vitest';

import { EndpointProgram, extractEventFromTransactionSignature } from '../../../src';
import { errors, instructions } from '../../../src/endpoint';
import { SolanaTestValidator } from '../../setup';
import {
    blockedMessageLibPDA,
    DefaultMessageLib,
    DST_EID,
    EOAPP,
    EOAPP_DELEGATE,
    fakeReceiveMessageLibPDA,
    HACKER,
    sendAndConfirm,
    shouldBeRejected,
    simpleMessageLibPDA,
} from '../../utils/';

export const testSuite = (validator: SolanaTestValidator): void => {
    const { umi, connection } = validator;
    const endpointSDK = new EndpointProgram.Endpoint(EndpointProgram.ENDPOINT_PROGRAM_ID);
    const oAppKp = EOAPP;
    const oAppDelegateKp = EOAPP_DELEGATE;
    // PDAs
    const [oappRegistryPda] = endpointSDK.pda.oappRegistry(oAppKp.publicKey);
    const [sendLibraryConfig] = endpointSDK.pda.sendLibraryConfig(oAppKp.publicKey, DST_EID);
    const [messagePda] = simpleMessageLibPDA.messageLib();

    it('revert if not authorized', async function () {
        const ix = endpointSDK.setOAppSendLibrary(HACKER, {
            sender: oAppKp.publicKey,
            remote: DST_EID,
            msgLibProgram: simpleMessageLibPDA.program,
        });

        await shouldBeRejected(
            sendAndConfirm(umi, ix, HACKER),
            new errors.UnauthorizedError(endpointSDK.getProgram()),
        );
    });

    it('revert if set receive-lib-type for send', async function () {
        const ix = endpointSDK.setOAppSendLibrary(oAppDelegateKp, {
            sender: oAppKp.publicKey,
            remote: DST_EID,
            msgLibProgram: fakeReceiveMessageLibPDA.program,
        });
        await shouldBeRejected(
            sendAndConfirm(umi, ix, oAppDelegateKp),
            new errors.OnlySendLibError(endpointSDK.getProgram()),
        );
    });

    it('revert if set simple-lib with message_lib_info undefined', async function () {
        const ix = instructions.setSendLibrary(
            { programs: endpointSDK.programRepo },
            {
                signer: oAppDelegateKp,
                oappRegistry: oappRegistryPda,
                messageLibInfo: undefined,
                sendLibraryConfig: sendLibraryConfig,
                eventAuthority: endpointSDK.eventAuthority,
                program: endpointSDK.programId,

                sender: oAppKp.publicKey,
                eid: DST_EID,
                newLib: messagePda,
            },
        ).items[0];
        await shouldBeRejected(
            sendAndConfirm(umi, ix, oAppDelegateKp),
            new errors.AccountNotFoundError(endpointSDK.getProgram()),
        );
    });

    it('success to set blocked-lib', async function () {
        const [messagePda] = blockedMessageLibPDA.messageLib();
        const ix = endpointSDK.setOAppSendLibrary(oAppDelegateKp, {
            sender: oAppKp.publicKey,
            remote: DST_EID,
            msgLibProgram: blockedMessageLibPDA.program,
        });
        await sendAndConfirm(umi, ix, oAppDelegateKp);

        // check
        const config = await EndpointProgram.accounts.fetchSendLibraryConfig(
            umi,
            sendLibraryConfig,
        );
        assert.strictEqual(config.messageLib, messagePda);
    });

    it('success set back to default', async function () {
        const ix = endpointSDK.setOAppSendLibrary(oAppDelegateKp, {
            sender: oAppKp.publicKey,
            remote: DST_EID,
            msgLibProgram: DefaultMessageLib,
        });
        await sendAndConfirm(umi, ix, oAppDelegateKp);

        // check state
        const config = await EndpointProgram.accounts.fetchSendLibraryConfig(
            umi,
            sendLibraryConfig,
        );
        assert.strictEqual(config.messageLib, DefaultMessageLib);
    });

    it('success set to simple-lib', async function () {
        const ix = endpointSDK.setOAppSendLibrary(oAppDelegateKp, {
            sender: oAppKp.publicKey,
            remote: DST_EID,
            msgLibProgram: simpleMessageLibPDA.program,
        });
        const { signature } = await sendAndConfirm(umi, ix, oAppDelegateKp);

        // check
        const config = await EndpointProgram.accounts.fetchSendLibraryConfig(
            umi,
            sendLibraryConfig,
        );
        assert.strictEqual(config.messageLib, messagePda);

        // check event
        const event =
            await extractEventFromTransactionSignature<EndpointProgram.events.SendLibrarySetEvent>(
                connection,
                endpointSDK.programId,
                signature,
                EndpointProgram.events.getSendLibrarySetEventSerializer(),
                { commitment: 'confirmed', maxSupportedTransactionVersion: 1 },
            );
        assert.strictEqual(event?.[0]?.eid, DST_EID);
        assert.strictEqual(event?.[0]?.newLib, messagePda);
        assert.strictEqual(event?.[0]?.sender, oAppKp.publicKey);
    });

    it('revert if set simple-lib twice', async function () {
        const ix = endpointSDK.setOAppSendLibrary(oAppDelegateKp, {
            sender: oAppKp.publicKey,
            remote: DST_EID,
            msgLibProgram: simpleMessageLibPDA.program,
        });
        await shouldBeRejected(
            sendAndConfirm(umi, ix, oAppDelegateKp),
            new errors.SameValueError(endpointSDK.getProgram()),
        );
    });
};
