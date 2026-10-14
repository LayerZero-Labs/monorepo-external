import { assert, it } from 'vitest';

import { EndpointProgram, extractEventFromTransactionSignature } from '../../../src';
import { errors, instructions } from '../../../src/endpoint';
import { SolanaTestValidator } from '../../setup';
import {
    DST_EID,
    endpointPDA,
    EOAPP_DELEGATE,
    EOAPP_ULN,
    fakeReceiveMessageLibPDA,
    HACKER,
    sendAndConfirm,
    shouldBeRejected,
    ulnPDA,
} from '../../utils/';

export const testSuite = (validator: SolanaTestValidator): void => {
    const { umi, connection } = validator;
    const endpointSDK = new EndpointProgram.Endpoint(EndpointProgram.ENDPOINT_PROGRAM_ID);
    const oAppKp2 = EOAPP_ULN;
    const oAppDelegateKp = EOAPP_DELEGATE;

    const [oappRegistryPda] = endpointPDA.oappRegistry(oAppKp2.publicKey);
    const [sendLibraryConfig] = endpointPDA.sendLibraryConfig(oAppKp2.publicKey, DST_EID);
    const [messageLib] = ulnPDA.messageLib();

    it('revert if not authorized', async function () {
        const ix = endpointSDK.setOAppSendLibrary(HACKER, {
            sender: oAppKp2.publicKey,
            remote: DST_EID,
            msgLibProgram: ulnPDA.program,
        });

        await shouldBeRejected(
            sendAndConfirm(umi, ix, HACKER),
            new errors.UnauthorizedError(endpointSDK.getProgram()),
        );
    });

    it('revert if set receive-lib-type for send', async function () {
        const ix = endpointSDK.setOAppSendLibrary(oAppDelegateKp, {
            sender: oAppKp2.publicKey,
            remote: DST_EID,
            msgLibProgram: fakeReceiveMessageLibPDA.program,
        });

        await shouldBeRejected(
            sendAndConfirm(umi, ix, oAppDelegateKp),
            new errors.OnlySendLibError(endpointSDK.getProgram()),
        );
    });

    it('revert if set uln-lib with message_lib_info undefined', async function () {
        const ix = instructions.setSendLibrary(
            { programs: endpointSDK.programRepo },
            {
                signer: oAppDelegateKp,
                oappRegistry: oappRegistryPda,
                messageLibInfo: undefined,
                sendLibraryConfig: sendLibraryConfig,
                eventAuthority: endpointSDK.eventAuthority,
                program: endpointSDK.programId,

                sender: oAppKp2.publicKey,
                eid: DST_EID,
                newLib: messageLib,
            },
        ).items[0];
        await shouldBeRejected(
            sendAndConfirm(umi, ix, oAppDelegateKp),
            new errors.AccountNotFoundError(endpointSDK.getProgram()),
        );
    });

    it('set uln as send library should success', async function () {
        const ix = endpointSDK.setOAppSendLibrary(oAppDelegateKp, {
            sender: oAppKp2.publicKey,
            remote: DST_EID,
            msgLibProgram: ulnPDA.program,
        });
        const { signature } = await sendAndConfirm(umi, ix, oAppDelegateKp);

        const sendConfig = await EndpointProgram.accounts.fetchSendLibraryConfig(
            umi,
            sendLibraryConfig,
        );
        assert.strictEqual(sendConfig.messageLib, messageLib);

        const event = await extractEventFromTransactionSignature(
            connection,
            endpointSDK.programId,
            signature,
            EndpointProgram.events.getSendLibrarySetEventSerializer(),
            { commitment: 'confirmed', maxSupportedTransactionVersion: 1 },
        );
        assert.strictEqual(event?.[0]?.eid, DST_EID);
        assert.strictEqual(event?.[0]?.newLib, messageLib);
        assert.strictEqual(event?.[0]?.sender, oAppKp2.publicKey);
    });
};
