import { expect, it } from 'vitest';

import { EndpointProgram, SetConfigType, SimpleMessageLibProgram } from '../../../src';
import { SolanaTestValidator } from '../../setup';
import {
    ConstraintSeeds,
    DST_EID,
    endpointPDA,
    EOAPP,
    EOAPP_DELEGATE,
    FAKE_SENDLIB_PROGRAM,
    HACKER,
    sendAndConfirm,
    shouldBeRejected,
    SIMPLE_CONFIG_TYPE_SEND,
    simpleMessageLibPDA,
} from '../../utils';

export const testSuite = (validator: SolanaTestValidator): void => {
    const { umi } = validator;
    const wallet = umi.payer;
    const endpointSDK = new EndpointProgram.Endpoint(EndpointProgram.ENDPOINT_PROGRAM_ID);
    const simpleSdk = new SimpleMessageLibProgram.SimpleMessageLib(
        SimpleMessageLibProgram.SIMPLE_MESSAGELIB_PROGRAM_ID,
    );
    const oAppKp = EOAPP;

    // PDAs
    const [messagePda] = simpleMessageLibPDA.messageLib();
    const [messageLibInfo] = endpointPDA.messageLibraryInfo(messagePda);
    const [oappRegistryPda] = endpointPDA.oappRegistry(oAppKp.publicKey);
    const [sendConfigPda] = simpleMessageLibPDA.sendConfig(DST_EID, oAppKp.publicKey);

    it('revert if not authorized', async function () {
        const ix = await endpointSDK.setOAppConfig(umi.rpc, HACKER, {
            oapp: oAppKp.publicKey,
            eid: DST_EID,
            config: {
                configType: SetConfigType.EXECUTOR,
                value: { maxMessageSize: 0, executor: oAppKp.publicKey },
            },
            msgLibProgram: simpleSdk.programId,
        });
        await shouldBeRejected(
            sendAndConfirm(umi, ix, [wallet, HACKER]),
            new EndpointProgram.errors.UnauthorizedError(endpointSDK.getProgram()),
        );
    });

    it('revert if wrong message lib', async function () {
        const accounts = simpleSdk.getSetConfigIXAccountMetaForCPI(oAppKp.publicKey, DST_EID);
        const ix = EndpointProgram.instructions
            .setConfig(
                { programs: endpointSDK.programRepo },
                {
                    oappRegistry: oappRegistryPda,
                    messageLib: messagePda,
                    messageLibInfo,
                    signer: oAppKp,
                    messageLibProgram: FAKE_SENDLIB_PROGRAM.publicKey,

                    oapp: oAppKp.publicKey,
                    eid: DST_EID,
                    config: Buffer.from('abc'),
                    configType: SIMPLE_CONFIG_TYPE_SEND,
                },
            )
            .addRemainingAccounts(accounts).items[0];
        await shouldBeRejected(sendAndConfirm(umi, ix, [wallet, oAppKp]), ConstraintSeeds);
    });

    it('should success', async function () {
        const ix = await endpointSDK.setOAppConfig(umi.rpc, EOAPP_DELEGATE, {
            oapp: oAppKp.publicKey,
            eid: DST_EID,
            config: {
                configType: SetConfigType.EXECUTOR,
                value: { maxMessageSize: 0, executor: oAppKp.publicKey },
            },
            msgLibProgram: simpleSdk.programId,
        });
        await sendAndConfirm(umi, ix, EOAPP_DELEGATE);

        // check
        const sendSetting = await SimpleMessageLibProgram.accounts.fetchSendConfigStore(
            umi,
            sendConfigPda,
        );
        expect(sendSetting.data.toString()).to.eq(new Uint8Array(10).fill(0).toString());
    });
};
