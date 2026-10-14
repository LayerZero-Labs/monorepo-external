import { none, unwrapOption } from '@metaplex-foundation/umi';
import { assert, expect, it } from 'vitest';

import { EndpointProgram, extractEventFromTransactionSignature } from '../../../src';
import { errors } from '../../../src/endpoint';
import { SolanaTestValidator } from '../../setup';
import {
    blockedMessageLibPDA,
    ConstraintHasOne,
    DST_EID,
    endpointPDA,
    fakeSendMessageLibPDA,
    HACKER,
    sendAndConfirm,
    shouldBeRejected,
} from '../../utils';

export const testSuite = (validator: SolanaTestValidator): void => {
    const { umi, connection } = validator;
    const wallet = umi.payer;
    const endpointSDK = new EndpointProgram.Endpoint(EndpointProgram.ENDPOINT_PROGRAM_ID);

    // PDAs
    const [defaultReceiveLibraryConfig, bump] = endpointPDA.defaultReceiveLibraryConfig(DST_EID);
    const [messagePda] = blockedMessageLibPDA.messageLib();

    it('revert if not admin', async function () {
        const ix = endpointSDK.setDefaultReceiveLibraryTimeout(HACKER, {
            msgLibProgram: blockedMessageLibPDA.program,
            remote: DST_EID,
            expiry: 100,
        });

        await shouldBeRejected(sendAndConfirm(umi, [ix], HACKER), ConstraintHasOne);
    });

    it('revert if set send-lib-type as default receive-lib timeout', async function () {
        const slot = await umi.rpc.getSlot({ commitment: 'confirmed' });

        const ix = endpointSDK.setDefaultReceiveLibraryTimeout(wallet, {
            msgLibProgram: fakeSendMessageLibPDA.program,
            remote: DST_EID,
            expiry: slot + 100,
        });

        await shouldBeRejected(
            sendAndConfirm(umi, [ix], wallet),
            new errors.OnlyReceiveLibError(endpointSDK.getProgram()),
        );
    });

    it('revert if expiry lte current slot', async function () {
        const slot = await umi.rpc.getSlot({ commitment: 'confirmed' });

        const ix = endpointSDK.setDefaultReceiveLibraryTimeout(wallet, {
            msgLibProgram: blockedMessageLibPDA.program,
            remote: DST_EID,
            expiry: slot,
        });
        await shouldBeRejected(
            sendAndConfirm(umi, [ix], wallet),
            new errors.InvalidExpiryError(endpointSDK.getProgram()),
        );
    });

    it('success set timeout', async function () {
        const slot = await umi.rpc.getSlot({ commitment: 'confirmed' });

        const ix = endpointSDK.setDefaultReceiveLibraryTimeout(wallet, {
            msgLibProgram: blockedMessageLibPDA.program,
            remote: DST_EID,
            expiry: slot + 100,
        });
        // const resp = await sendAndConfirmWrappedInstruction(provider.connection, provider.wallet, [ix])
        const { signature } = await sendAndConfirm(umi, [ix], wallet);

        // Check
        const defaultReceiveLibraryConfigAccount =
            await EndpointProgram.accounts.fetchReceiveLibraryConfig(
                umi,
                defaultReceiveLibraryConfig,
            );
        const timeout = unwrapOption(defaultReceiveLibraryConfigAccount.timeout)!;
        assert.strictEqual(defaultReceiveLibraryConfigAccount.messageLib, messagePda);
        assert.strictEqual(defaultReceiveLibraryConfigAccount.bump, bump);
        assert.strictEqual(timeout.expiry, BigInt(slot + 100));
        assert.strictEqual(timeout.messageLib, messagePda);

        {
            const events = await extractEventFromTransactionSignature(
                connection,
                endpointSDK.programId,
                signature,
                EndpointProgram.events.getDefaultReceiveLibraryTimeoutSetEventSerializer(),
                { commitment: 'confirmed', maxSupportedTransactionVersion: 1 },
            );
            assert.strictEqual(events?.length, 1);
            const timeout = unwrapOption(events?.[0].timeout!)!;
            expect(timeout.expiry).to.be.equal(BigInt(slot + 100));
            expect(timeout.messageLib).to.be.equal(messagePda);
            expect(events?.[0].eid).to.be.equal(DST_EID);
        }
    });

    it('success clean timeout', async function () {
        const ix = endpointSDK.setDefaultReceiveLibraryTimeout(wallet, {
            msgLibProgram: blockedMessageLibPDA.program,
            remote: DST_EID,
            expiry: 0,
        });
        const { signature } = await sendAndConfirm(umi, [ix], wallet);

        // Check
        const defaultReceiveLibraryConfigAccount =
            await EndpointProgram.accounts.fetchReceiveLibraryConfig(
                umi,
                defaultReceiveLibraryConfig,
            );
        assert.strictEqual(defaultReceiveLibraryConfigAccount.messageLib, messagePda);
        assert.strictEqual(defaultReceiveLibraryConfigAccount.bump, bump);
        assert.strictEqual(defaultReceiveLibraryConfigAccount.timeout.__option, none().__option);

        const events = await extractEventFromTransactionSignature(
            connection,
            endpointSDK.programId,
            signature,
            EndpointProgram.events.getDefaultReceiveLibraryTimeoutSetEventSerializer(),
            { commitment: 'confirmed', maxSupportedTransactionVersion: 1 },
        );
        assert.strictEqual(events?.length, 1);
        assert.strictEqual(events?.[0].timeout.__option, none().__option);
        expect(events?.[0].eid).to.be.equal(DST_EID);
    });
};
