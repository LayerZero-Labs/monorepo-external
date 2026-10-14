import { none } from '@metaplex-foundation/umi';
import { assert, it } from 'vitest';

import { EndpointProgram, extractEventFromTransactionSignature } from '../../../src';
import { errors, instructions } from '../../../src/endpoint';
import { SolanaTestValidator } from '../../setup';
import {
    DefaultMessageLib,
    endpointPDA,
    EOAPP_DELEGATE,
    EOAPP_ULN,
    fakeSendMessageLibPDA,
    HACKER,
    sendAndConfirm,
    shouldBeRejected,
    SRC_EID,
    ulnPDA,
} from '../../utils';

export const testSuite = (validator: SolanaTestValidator): void => {
    const { umi, connection } = validator;
    const endpointSDK = new EndpointProgram.Endpoint(EndpointProgram.ENDPOINT_PROGRAM_ID);
    const oAppDelegateKp = EOAPP_DELEGATE;
    const oAppKp2 = EOAPP_ULN;

    // PDAs
    const [oappRegistryPda] = endpointPDA.oappRegistry(oAppKp2.publicKey);
    const [receiveLibraryConfig] = endpointPDA.receiveLibraryConfig(oAppKp2.publicKey, SRC_EID);
    const [messagePda] = ulnPDA.messageLib();

    it('revert if not authorized', async function () {
        const ix = endpointSDK.setOAppReceiveLibrary(HACKER, {
            receiver: oAppKp2.publicKey,
            remote: SRC_EID,
            msgLibProgram: ulnPDA.program,
            gracePeriod: 0,
        });
        await shouldBeRejected(
            sendAndConfirm(umi, ix, HACKER),
            new errors.UnauthorizedError(endpointSDK.getProgram()),
        );
    });

    it('revert if set send lib info to receive lib', async function () {
        const ix = endpointSDK.setOAppReceiveLibrary(oAppDelegateKp, {
            receiver: oAppKp2.publicKey,
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
                // args
                receiver: oAppKp2.publicKey,
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

    it('set uln as receive library should success', async function () {
        const ix = endpointSDK.setOAppReceiveLibrary(oAppDelegateKp, {
            receiver: oAppKp2.publicKey,
            remote: SRC_EID,
            msgLibProgram: ulnPDA.program,
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
        const event = await extractEventFromTransactionSignature(
            connection,
            endpointSDK.programId,
            signature,
            EndpointProgram.events.getReceiveLibraryTimeoutSetEventSerializer(),
            { commitment: 'confirmed', maxSupportedTransactionVersion: 1 },
        );
        assert.strictEqual(event?.[0]?.eid, SRC_EID);
        assert.strictEqual(event?.[0]?.receiver, oAppKp2.publicKey);
        assert.strictEqual(event?.[0]?.timeout.__option, none().__option);
    });

    it('revert if set uln-lib twice', async function () {
        const ix = endpointSDK.setOAppReceiveLibrary(oAppDelegateKp, {
            receiver: oAppKp2.publicKey,
            remote: SRC_EID,
            msgLibProgram: ulnPDA.program,
            gracePeriod: 0,
        });
        await shouldBeRejected(
            sendAndConfirm(umi, ix, oAppDelegateKp),
            new errors.SameValueError(endpointSDK.getProgram()),
        );
    });

    it('revert if new msg lib is default msg lib', async function () {
        const ix = endpointSDK.setOAppReceiveLibrary(oAppDelegateKp, {
            receiver: oAppKp2.publicKey,
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
