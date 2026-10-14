import { none, unwrapOption } from '@metaplex-foundation/umi';
import { assert, expect, it } from 'vitest';

import { EndpointProgram, extractEventFromTransactionSignature } from '../../../src';
import { errors } from '../../../src/endpoint';
import { SolanaTestValidator } from '../../setup';
import {
    DefaultMessageLib,
    endpointPDA,
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
    // const wallet = provider.wallet as Wallet
    const oAppKp = EOAPP;
    const oAppDelegateKp = EOAPP_DELEGATE;

    // PDAs
    const [receiveLibraryConfig] = endpointPDA.receiveLibraryConfig(oAppKp.publicKey, SRC_EID);
    const [messagePda] = simpleMessageLibPDA.messageLib();

    it('revert if not authorized', async function () {
        const slot = await umi.rpc.getSlot({ commitment: 'confirmed' });
        const ix = endpointSDK.setOAppReceiveLibraryTimeout(HACKER, {
            receiver: oAppKp.publicKey,
            remote: SRC_EID,
            msgLibProgram: simpleMessageLibPDA.program,
            expiry: slot + 100,
        });
        await shouldBeRejected(
            sendAndConfirm(umi, ix, HACKER),
            new errors.UnauthorizedError(endpointSDK.getProgram()),
        );
    });

    it('revert if set send-lib-type for receive-lib timeout', async function () {
        const ix = endpointSDK.setOAppReceiveLibraryTimeout(oAppDelegateKp, {
            receiver: oAppKp.publicKey,
            remote: SRC_EID,
            msgLibProgram: fakeSendMessageLibPDA.program,
            expiry: 100,
        });
        await shouldBeRejected(
            sendAndConfirm(umi, ix, oAppDelegateKp),
            new errors.OnlyReceiveLibError(endpointSDK.getProgram()),
        );
    });

    it('revert if expiry lte current slot', async function () {
        const slot = await umi.rpc.getSlot({ commitment: 'confirmed' });
        const ix = endpointSDK.setOAppReceiveLibraryTimeout(oAppDelegateKp, {
            receiver: oAppKp.publicKey,
            remote: SRC_EID,
            msgLibProgram: simpleMessageLibPDA.program,
            expiry: slot,
        });
        await shouldBeRejected(
            sendAndConfirm(umi, ix, oAppDelegateKp),
            new errors.InvalidExpiryError(endpointSDK.getProgram()),
        );
    });

    it('success set timeout', async function () {
        const slot = await umi.rpc.getSlot({ commitment: 'confirmed' });
        const ix = endpointSDK.setOAppReceiveLibraryTimeout(oAppDelegateKp, {
            receiver: oAppKp.publicKey,
            remote: SRC_EID,
            msgLibProgram: simpleMessageLibPDA.program,
            expiry: slot + 100,
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
        assert.strictEqual(event?.[0]?.receiver, oAppKp.publicKey);
        const timeout = unwrapOption(event?.[0].timeout!)!;
        expect(timeout.expiry).to.equal(BigInt(slot + 100));
        expect(timeout.messageLib).to.equal(messagePda);
    });

    it('success clear timeout', async function () {
        const ix = endpointSDK.setOAppReceiveLibraryTimeout(oAppDelegateKp, {
            receiver: oAppKp.publicKey,
            remote: SRC_EID,
            msgLibProgram: simpleMessageLibPDA.program,
            expiry: 0,
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
        assert.strictEqual(event?.[0]?.receiver, oAppKp.publicKey);
        assert.strictEqual(event?.[0].timeout.__option, none().__option);
    });

    it('revert if set timeout on default-lib', async function () {
        // set default-lib
        const setToDefaultIX = endpointSDK.setOAppReceiveLibrary(oAppDelegateKp, {
            receiver: oAppKp.publicKey,
            remote: SRC_EID,
            msgLibProgram: DefaultMessageLib,
            gracePeriod: 0,
        });

        // set simple-lib as timeout
        const setTimeoutIx = endpointSDK.setOAppReceiveLibraryTimeout(oAppDelegateKp, {
            receiver: oAppKp.publicKey,
            remote: SRC_EID,
            msgLibProgram: simpleMessageLibPDA.program,
            expiry: 100,
        });

        await shouldBeRejected(
            sendAndConfirm(umi, [setToDefaultIX, setTimeoutIx], oAppDelegateKp),
            new errors.OnlyNonDefaultLibError(endpointSDK.getProgram()),
        );
    });
};
