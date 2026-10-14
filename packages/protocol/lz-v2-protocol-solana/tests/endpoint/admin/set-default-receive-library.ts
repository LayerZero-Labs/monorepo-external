import { none, unwrapOption } from '@metaplex-foundation/umi';
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
    simpleMessageLibPDA,
} from '../../utils';

export const testSuite = (validator: SolanaTestValidator): void => {
    const { umi, connection } = validator;
    const wallet = umi.payer;
    const endpointSDK = new EndpointProgram.Endpoint(EndpointProgram.ENDPOINT_PROGRAM_ID);

    // PDAs
    const [defaultReceiveLibraryConfig, bump] =
        endpointSDK.pda.defaultReceiveLibraryConfig(DST_EID);
    const [simpleMessagePda] = simpleMessageLibPDA.messageLib();

    it('revert if not admin', async function () {
        const ix = await endpointSDK.setDefaultReceiveLibrary(umi.rpc, HACKER, {
            messageLibProgram: simpleMessageLibPDA.program,
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

    it('success to set simple-lib as default with gracePeriod 0', async function () {
        const ix = await endpointSDK.setDefaultReceiveLibrary(umi.rpc, wallet, {
            messageLibProgram: simpleMessageLibPDA.program,
            remote: DST_EID,
        });
        const { signature } = await sendAndConfirm(umi, [ix], wallet);

        // Check
        const defaultReceiveLibraryConfigAccount =
            await EndpointProgram.accounts.fetchReceiveLibraryConfig(
                umi,
                defaultReceiveLibraryConfig,
            );
        assert.strictEqual(defaultReceiveLibraryConfigAccount.messageLib, simpleMessagePda);
        assert.strictEqual(defaultReceiveLibraryConfigAccount.bump, bump);

        {
            // check DefaultReceiveLibrarySetEvent
            const event = await extractEventFromTransactionSignature(
                connection,
                endpointSDK.programId,
                signature,
                events.getDefaultReceiveLibrarySetEventSerializer(),
                { commitment: 'confirmed', maxSupportedTransactionVersion: 1 },
            );
            assert.strictEqual(event?.[0].eid, DST_EID);
            expect(event?.[0].newLib).to.eql(simpleMessagePda);
        }

        {
            // check DefaultReceiveLibraryTimeoutSetEvent
            const event = await extractEventFromTransactionSignature(
                connection,
                endpointSDK.programId,
                signature,
                EndpointProgram.events.getDefaultReceiveLibraryTimeoutSetEventSerializer(),
                { commitment: 'confirmed', maxSupportedTransactionVersion: 1 },
            );
            assert.strictEqual(event?.length, 1);
            assert.strictEqual(event?.[0].timeout.__option, none().__option);
            expect(event?.[0].eid).to.be.equal(DST_EID);
        }
    });

    it('success to set simple-lib as default with gracePeriod > 0', async function () {
        // set to blocked msg first
        const [blockedMessagePda] = blockedMessageLibPDA.messageLib();
        const setBlockedMsgLibIx = await endpointSDK.setDefaultReceiveLibrary(umi.rpc, wallet, {
            messageLibProgram: blockedMessageLibPDA.program,
            remote: DST_EID,
            gracePeriod: 0,
        });

        // set to simple msg with gracePeriod > 0
        const ix = await endpointSDK.setDefaultReceiveLibrary(umi.rpc, wallet, {
            messageLibProgram: simpleMessageLibPDA.program,
            remote: DST_EID,
            gracePeriod: 100,
        });
        const slot = await umi.rpc.getSlot({ commitment: 'confirmed' });
        const { signature } = await sendAndConfirm(umi, [setBlockedMsgLibIx, ix], wallet);

        // Check
        const defaultReceiveLibraryConfigAccount =
            await EndpointProgram.accounts.fetchReceiveLibraryConfig(
                umi,
                defaultReceiveLibraryConfig,
            );
        assert.strictEqual(defaultReceiveLibraryConfigAccount.messageLib, simpleMessagePda);
        assert.strictEqual(defaultReceiveLibraryConfigAccount.bump, bump);

        // check DefaultReceiveLibrarySetEvent
        const event = await extractEventFromTransactionSignature(
            connection,
            endpointSDK.programId,
            signature,
            events.getDefaultReceiveLibrarySetEventSerializer(),
            { commitment: 'confirmed', maxSupportedTransactionVersion: 1 },
        );
        assert.strictEqual(event?.[0].eid, DST_EID);
        expect(event?.[0].newLib).to.eql(blockedMessagePda);
        expect(event?.[1].newLib).to.eql(simpleMessagePda);

        {
            const event = await extractEventFromTransactionSignature(
                connection,
                endpointSDK.programId,
                signature,
                EndpointProgram.events.getDefaultReceiveLibraryTimeoutSetEventSerializer(),
                { commitment: 'confirmed', maxSupportedTransactionVersion: 1 },
            );
            assert.strictEqual(event?.length, 2);
            const timeout = unwrapOption(event?.[1].timeout!)!;
            expect(timeout.messageLib).to.eq(blockedMessagePda);
            expect(Number(timeout.expiry)).to.closeTo(slot + 100, 2);

            expect(event?.[1].eid).to.be.equal(DST_EID);
            expect(event?.[0].timeout.__option).to.be.equal(none().__option);
        }
    });

    it('revert if set the same library', async function () {
        const ix = await endpointSDK.setDefaultReceiveLibrary(umi.rpc, wallet, {
            messageLibProgram: simpleMessageLibPDA.program,
            remote: DST_EID,
            gracePeriod: 0,
        });
        await shouldBeRejected(
            sendAndConfirm(umi, [ix], wallet),
            new errors.SameValueError(endpointSDK.getProgram()),
        );
    });

    it('success to set blocked-lib as default with gracePeriod 0', async function () {
        const [blockedMessagePda] = blockedMessageLibPDA.messageLib();

        const ix = await endpointSDK.setDefaultReceiveLibrary(umi.rpc, wallet, {
            messageLibProgram: blockedMessageLibPDA.program,
            remote: DST_EID,
            gracePeriod: 0,
        });
        const { signature } = await sendAndConfirm(umi, [ix], wallet);

        // Check
        const defaultReceiveLibraryConfigAccount =
            await EndpointProgram.accounts.fetchReceiveLibraryConfig(
                umi,
                defaultReceiveLibraryConfig,
            );
        assert.strictEqual(defaultReceiveLibraryConfigAccount.messageLib, blockedMessagePda);

        // check DefaultReceiveLibrarySetEvent
        const event = await extractEventFromTransactionSignature(
            connection,
            endpointSDK.programId,
            signature,
            EndpointProgram.events.getDefaultReceiveLibrarySetEventSerializer(),
            { commitment: 'confirmed', maxSupportedTransactionVersion: 1 },
        );
        assert.strictEqual(event?.[0].eid, DST_EID);
        expect(event?.[0].newLib).to.eql(blockedMessagePda);

        // check DefaultReceiveLibraryTimeoutSetEvent
        const events = await extractEventFromTransactionSignature(
            connection,
            endpointSDK.programId,
            signature,
            EndpointProgram.events.getDefaultReceiveLibraryTimeoutSetEventSerializer(),
            { commitment: 'confirmed', maxSupportedTransactionVersion: 1 },
        );
        assert.strictEqual(events?.length, 1);
        expect(events?.[0].timeout.__option).to.be.equal(none().__option);
        expect(events?.[0].eid).to.be.equal(DST_EID);
    });
};
