import { none } from '@metaplex-foundation/umi';
import { assert, it } from 'vitest';

import { EndpointProgram, extractEventFromTransactionSignature } from '../../../src';
import { errors, instructions } from '../../../src/endpoint';
import { SolanaTestValidator } from '../../setup';
import {
    blockedMessageLibPDA,
    DefaultMessageLib,
    EOAPP,
    EOAPP_DELEGATE,
    fakeSendMessageLibPDA,
    HACKER,
    sendAndConfirm,
    shouldBeRejected,
    simpleMessageLibPDA,
    SRC_EID,
} from '../../utils';

export const testSuite = (validator: SolanaTestValidator): void => {
    const { umi, connection } = validator;
    const endpointSDK = new EndpointProgram.Endpoint(EndpointProgram.ENDPOINT_PROGRAM_ID);
    const oAppKp = EOAPP;
    const oAppDelegateKp = EOAPP_DELEGATE;

    // PDAs
    const [oappRegistryPda] = endpointSDK.pda.oappRegistry(oAppKp.publicKey);
    const [receiveLibraryConfig] = endpointSDK.pda.receiveLibraryConfig(oAppKp.publicKey, SRC_EID);
    const [messagePda] = simpleMessageLibPDA.messageLib();

    it('revert if not authorized', async function () {
        const ix = endpointSDK.setOAppReceiveLibrary(HACKER, {
            receiver: oAppKp.publicKey,
            remote: SRC_EID,
            msgLibProgram: simpleMessageLibPDA.program,
            gracePeriod: 0,
        });
        await shouldBeRejected(
            sendAndConfirm(umi, ix, HACKER),
            new errors.UnauthorizedError(endpointSDK.getProgram()),
        );
    });

    it('revert if set send lib info to receive lib', async function () {
        const ix = endpointSDK.setOAppReceiveLibrary(oAppDelegateKp, {
            receiver: oAppKp.publicKey,
            remote: SRC_EID,
            msgLibProgram: fakeSendMessageLibPDA.program,
            gracePeriod: 0,
        });
        await shouldBeRejected(
            sendAndConfirm(umi, ix, oAppDelegateKp),
            new errors.OnlyReceiveLibError(endpointSDK.getProgram()),
        );
    });

    it('revert if set simple-lib with message_lib_info undefined', async function () {
        const ix = instructions.setReceiveLibrary(
            { programs: endpointSDK.programRepo },
            {
                signer: oAppDelegateKp,
                oappRegistry: oappRegistryPda,
                messageLibInfo: undefined,
                receiveLibraryConfig: receiveLibraryConfig,
                eventAuthority: endpointSDK.eventAuthority,
                program: endpointSDK.programId,

                receiver: oAppKp.publicKey,
                eid: SRC_EID,
                newLib: messagePda,
                gracePeriod: 0,
            },
        ).items[0];
        await shouldBeRejected(
            sendAndConfirm(umi, ix, oAppDelegateKp),
            new errors.AccountNotFoundError(endpointSDK.getProgram()),
        );
    });

    it('success to set blocked-lib', async function () {
        const [blockedMessagePda] = blockedMessageLibPDA.messageLib();

        const ix = endpointSDK.setOAppReceiveLibrary(oAppDelegateKp, {
            receiver: oAppKp.publicKey,
            remote: SRC_EID,
            msgLibProgram: blockedMessageLibPDA.program,
            gracePeriod: 0,
        });
        const { signature } = await sendAndConfirm(umi, ix, oAppDelegateKp);

        // check
        const config = await EndpointProgram.accounts.fetchReceiveLibraryConfig(
            umi,
            receiveLibraryConfig,
        );
        assert.strictEqual(config.messageLib, blockedMessagePda);

        // check event
        const event =
            await extractEventFromTransactionSignature<EndpointProgram.events.ReceiveLibrarySetEvent>(
                connection,
                endpointSDK.programId,
                signature,
                EndpointProgram.events.getReceiveLibrarySetEventSerializer(),
                { commitment: 'confirmed', maxSupportedTransactionVersion: 1 },
            );
        assert.strictEqual(event?.[0]?.eid, SRC_EID);
        assert.strictEqual(event?.[0]?.receiver, oAppKp.publicKey);
        assert.strictEqual(event?.[0]?.newLib, blockedMessagePda);

        // check event
        const events =
            await extractEventFromTransactionSignature<EndpointProgram.events.ReceiveLibraryTimeoutSetEvent>(
                connection,
                endpointSDK.programId,
                signature,
                EndpointProgram.events.getReceiveLibraryTimeoutSetEventSerializer(),
                { commitment: 'confirmed', maxSupportedTransactionVersion: 1 },
            );
        assert.strictEqual(events?.[0]?.eid, SRC_EID);
        assert.strictEqual(events?.[0]?.receiver, oAppKp.publicKey);
        assert.strictEqual(events?.[0]?.timeout.__option, none().__option);
    });

    it('success to set back to default', async function () {
        const ix = endpointSDK.setOAppReceiveLibrary(oAppDelegateKp, {
            receiver: oAppKp.publicKey,
            remote: SRC_EID,
            msgLibProgram: DefaultMessageLib,
            gracePeriod: 0,
        });
        await sendAndConfirm(umi, ix, oAppDelegateKp);

        // check
        const config = await EndpointProgram.accounts.fetchReceiveLibraryConfig(
            umi,
            receiveLibraryConfig,
        );
        assert.strictEqual(config.messageLib, DefaultMessageLib);
    });

    it('success set simple-lib', async function () {
        const ix = endpointSDK.setOAppReceiveLibrary(oAppDelegateKp, {
            receiver: oAppKp.publicKey,
            remote: SRC_EID,
            msgLibProgram: simpleMessageLibPDA.program,
            gracePeriod: 0,
        });
        const { signature } = await sendAndConfirm(umi, ix, oAppDelegateKp);

        // check
        const config = await EndpointProgram.accounts.fetchReceiveLibraryConfig(
            umi,
            receiveLibraryConfig,
        );
        assert.strictEqual(config.messageLib, messagePda);

        // check event
        const event =
            await extractEventFromTransactionSignature<EndpointProgram.events.ReceiveLibraryTimeoutSetEvent>(
                connection,
                endpointSDK.programId,
                signature,
                EndpointProgram.events.getReceiveLibraryTimeoutSetEventSerializer(),
                { commitment: 'confirmed', maxSupportedTransactionVersion: 1 },
            );
        assert.strictEqual(event?.[0]?.eid, SRC_EID);
        assert.strictEqual(event?.[0]?.receiver, oAppKp.publicKey);
        assert.strictEqual(event?.[0]?.timeout.__option, none().__option);
    });

    it('revert if set simple-lib twice', async function () {
        const ix = endpointSDK.setOAppReceiveLibrary(oAppDelegateKp, {
            receiver: oAppKp.publicKey,
            remote: SRC_EID,
            msgLibProgram: simpleMessageLibPDA.program,
            gracePeriod: 0,
        });
        await shouldBeRejected(
            sendAndConfirm(umi, ix, oAppDelegateKp),
            new errors.SameValueError(endpointSDK.getProgram()),
        );
    });

    it('revert if new msg lib is default msg lib', async function () {
        const ix = endpointSDK.setOAppReceiveLibrary(oAppDelegateKp, {
            receiver: oAppKp.publicKey,
            remote: SRC_EID,
            msgLibProgram: DefaultMessageLib,
            gracePeriod: 100,
        });
        await shouldBeRejected(
            sendAndConfirm(umi, ix, oAppDelegateKp),
            new errors.OnlyNonDefaultLibError(endpointSDK.getProgram()),
        );
    });
};
