import { it } from 'vitest';

import { EndpointProgram, extractEventFromTransactionSignature } from '../../../src';
import { instructions, types } from '../../../src/endpoint';
import { SolanaTestValidator } from '../../setup';
import {
    assert,
    blockedMessageLibPDA,
    ConstraintHasOne,
    ConstraintSeeds,
    endpointPDA,
    expect,
    fakeReceiveMessageLibPDA,
    fakeSendMessageLibPDA,
    HACKER,
    sendAndConfirm,
    shouldBeRejected,
    simpleMessageLibPDA,
    ulnPDA,
} from '../../utils';

export const testSuite = (validator: SolanaTestValidator): void => {
    const { umi, connection } = validator;
    const wallet = umi.payer;
    const endpointSDK = new EndpointProgram.Endpoint(EndpointProgram.ENDPOINT_PROGRAM_ID);

    it('revert if not admin', async function () {
        const ix = endpointSDK.registerLibrary(HACKER, {
            messageLibProgram: blockedMessageLibPDA.program,
            libType: types.MessageLibType.SendAndReceive,
        });

        await shouldBeRejected(sendAndConfirm(umi, [ix], HACKER), ConstraintHasOne);
    });

    it('revert if msg-lib-info miss match with msg-lib-program', async function () {
        const randomMsgLibInfo = umi.eddsa.generateKeypair().publicKey;
        const ix = instructions.registerLibrary(
            { programs: endpointSDK.programRepo },
            {
                admin: wallet,
                endpoint: endpointSDK.pda.setting()[0],
                messageLibInfo: randomMsgLibInfo,
                eventAuthority: endpointSDK.eventAuthority,
                program: endpointSDK.programId,
                // params
                libProgram: blockedMessageLibPDA.program,
                libType: types.MessageLibType.SendAndReceive,
            },
        ).items[0];
        await shouldBeRejected(sendAndConfirm(umi, [ix], wallet), ConstraintSeeds);
    });

    it('success register message libs', async function () {
        const [blockedMessagePda, blockedMessageLibBump] = blockedMessageLibPDA.messageLib();
        const [blockedMessageLibInfo, blockedMessageLibInfoBump] =
            endpointPDA.messageLibraryInfo(blockedMessagePda);
        // const [eventAuthority] = new EventPDADeriver(EndpointProgram.PROGRAM_ID).eventAuthority()

        const blockedMsgLibIx = endpointSDK.registerLibrary(wallet, {
            messageLibProgram: blockedMessageLibPDA.program,
            libType: types.MessageLibType.SendAndReceive,
        });
        const [simpleMessagePda, simpleMessageLibBump] = simpleMessageLibPDA.messageLib();
        const [simpleMessageLibInfo, simpleMessageLibInfoBump] =
            endpointPDA.messageLibraryInfo(simpleMessagePda);
        const simpleMsgLibIx = endpointSDK.registerLibrary(wallet, {
            messageLibProgram: simpleMessageLibPDA.program,
            libType: types.MessageLibType.SendAndReceive,
        });

        const [ulnLib, ulnBump] = ulnPDA.messageLib();
        const [ulnLibInfo, ulnInfoBump] = endpointPDA.messageLibraryInfo(ulnLib);
        const ulnIx = endpointSDK.registerLibrary(wallet, {
            messageLibProgram: ulnPDA.program,
            libType: types.MessageLibType.SendAndReceive,
        });

        const [fakeSendMessagePda] = fakeSendMessageLibPDA.messageLib();
        const fakeSendMsgLibIx = endpointSDK.registerLibrary(wallet, {
            messageLibProgram: fakeSendMessageLibPDA.program,
            libType: types.MessageLibType.Send,
        });

        const [fakeReceiveMessagePda] = fakeReceiveMessageLibPDA.messageLib();
        const fakeReceiveMsgLibIx = endpointSDK.registerLibrary(wallet, {
            messageLibProgram: fakeReceiveMessageLibPDA.program,
            libType: types.MessageLibType.Receive,
        });

        const { signature } = await sendAndConfirm(
            umi,
            [blockedMsgLibIx, simpleMsgLibIx, ulnIx, fakeSendMsgLibIx, fakeReceiveMsgLibIx],
            wallet,
        );

        // Check state
        const blockedMessageLibInfoAccount = await EndpointProgram.accounts.fetchMessageLibInfo(
            umi,
            blockedMessageLibInfo,
        );
        assert.strictEqual(blockedMessageLibInfoAccount.messageLibBump, blockedMessageLibBump);
        assert.strictEqual(blockedMessageLibInfoAccount.bump, blockedMessageLibInfoBump);

        const simpleMessageLibInfoAccount = await EndpointProgram.accounts.fetchMessageLibInfo(
            umi,
            simpleMessageLibInfo,
        );
        assert.strictEqual(simpleMessageLibInfoAccount.messageLibBump, simpleMessageLibBump);
        assert.strictEqual(simpleMessageLibInfoAccount.bump, simpleMessageLibInfoBump);

        const ulnLibInfoAccount = await EndpointProgram.accounts.fetchMessageLibInfo(
            umi,
            ulnLibInfo,
        );
        assert.strictEqual(ulnLibInfoAccount.messageLibBump, ulnBump);
        assert.strictEqual(ulnLibInfoAccount.bump, ulnInfoBump);

        const events = await extractEventFromTransactionSignature(
            connection,
            endpointSDK.programId,
            signature,
            EndpointProgram.events.getLibraryRegisteredEventSerializer(),
            { commitment: 'confirmed', maxSupportedTransactionVersion: 1 },
        );
        assert.strictEqual(events?.length, 5);
        expect(events?.[0].newLib).to.be.equal(blockedMessagePda);
        expect(events?.[1].newLib).to.be.equal(simpleMessagePda);
        expect(events?.[2].newLib).to.be.equal(ulnLib);
        expect(events?.[3].newLib).to.be.equal(fakeSendMessagePda);
        expect(events?.[4].newLib).to.be.equal(fakeReceiveMessagePda);
    });

    it('revert if register same lib twice', async function () {
        const ix = endpointSDK.registerLibrary(wallet, {
            messageLibProgram: simpleMessageLibPDA.program,
            libType: types.MessageLibType.SendAndReceive,
        });
        await shouldBeRejected(sendAndConfirm(umi, [ix], wallet), 'already in use');
    });
};
