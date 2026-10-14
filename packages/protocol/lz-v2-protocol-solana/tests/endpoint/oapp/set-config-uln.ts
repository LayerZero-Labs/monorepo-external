import { assert, it } from 'vitest';

import {
    EndpointProgram,
    extractEventFromTransactionSignature,
    SetConfigType,
    UlnProgram,
} from '../../../src';
import { SolanaTestValidator } from '../../setup';
import {
    confirmations,
    ConstraintSeeds,
    DST_EID,
    dvnPDA,
    EOAPP_DELEGATE,
    EOAPP_ULN,
    executorPDA,
    FAKE_SENDLIB_PROGRAM,
    HACKER,
    optionalDvnCount,
    optionalDvns,
    optionalDvnThreshold,
    requiredDvnCount,
    requiredDvns,
    sendAndConfirm,
    shouldBeRejected,
} from '../../utils';

export const testSuite = (validator: SolanaTestValidator): void => {
    const { umi, connection } = validator;
    const wallet = umi.payer;
    const endpointSDK = new EndpointProgram.Endpoint(EndpointProgram.ENDPOINT_PROGRAM_ID);
    const ulnSDK = new UlnProgram.Uln(UlnProgram.ULN_PROGRAM_ID);
    const oAppKp2 = EOAPP_ULN;
    const oAppDelegateKp = EOAPP_DELEGATE;

    const [sendConfigAccount] = ulnSDK.pda.sendConfig(DST_EID, oAppKp2.publicKey);
    const [receiveConfigAccount] = ulnSDK.pda.receiveConfig(DST_EID, oAppKp2.publicKey);
    const [dvnConfigAccount] = dvnPDA.config();
    const maxMessageSize = 1000;

    it('revert if not authorized', async function () {
        const sendIx = await endpointSDK.setOAppConfig(umi.rpc, HACKER, {
            oapp: oAppKp2.publicKey,
            eid: DST_EID,
            msgLibProgram: ulnSDK.programId,
            msgLibVersion: { major: 3n, minor: 0, endpointVersion: 2 },
            config: {
                configType: SetConfigType.SEND_ULN,
                value: {
                    confirmations: confirmations,
                    requiredDvnCount,
                    optionalDvnCount,
                    optionalDvnThreshold,
                    requiredDvns,
                    optionalDvns: optionalDvns,
                },
            },
        });

        const receiveIx = await endpointSDK.setOAppConfig(umi.rpc, HACKER, {
            oapp: oAppKp2.publicKey,
            eid: DST_EID,
            msgLibProgram: ulnSDK.programId,
            msgLibVersion: { major: 3n, minor: 0, endpointVersion: 2 },
            config: {
                configType: SetConfigType.RECEIVE_ULN,
                value: {
                    confirmations: confirmations,
                    requiredDvnCount,
                    optionalDvnCount,
                    optionalDvnThreshold,
                    requiredDvns,
                    optionalDvns: optionalDvns,
                },
            },
        });

        const executorIx = await endpointSDK.setOAppConfig(umi.rpc, HACKER, {
            oapp: oAppKp2.publicKey,
            eid: DST_EID,
            msgLibProgram: ulnSDK.programId,
            msgLibVersion: { major: 3n, minor: 0, endpointVersion: 2 },
            config: {
                configType: SetConfigType.EXECUTOR,
                value: {
                    executor: executorPDA.config()[0],
                    maxMessageSize,
                },
            },
        });

        await shouldBeRejected(
            sendAndConfirm(umi, [sendIx, receiveIx, executorIx], [wallet, HACKER]),
            new EndpointProgram.errors.UnauthorizedError(endpointSDK.getProgram()),
        );
    });

    it('revert if wrong message lib', async function () {
        const sendIx = await endpointSDK.setOAppConfig(umi.rpc, oAppKp2, {
            oapp: oAppKp2.publicKey,
            eid: DST_EID,
            msgLibProgram: ulnSDK.programId,
            msgLibVersion: { major: 3n, minor: 0, endpointVersion: 2 },
            config: {
                configType: SetConfigType.SEND_ULN,
                value: {
                    confirmations: confirmations,
                    requiredDvnCount,
                    optionalDvnCount,
                    optionalDvnThreshold,
                    requiredDvns,
                    optionalDvns: optionalDvns,
                },
            },
        });
        sendIx.instruction.keys[4].pubkey = FAKE_SENDLIB_PROGRAM.publicKey; // Change the message lib program to the fake one

        const receiveIx = await endpointSDK.setOAppConfig(umi.rpc, oAppKp2, {
            oapp: oAppKp2.publicKey,
            eid: DST_EID,
            msgLibProgram: ulnSDK.programId,
            msgLibVersion: { major: 3n, minor: 0, endpointVersion: 2 },
            config: {
                configType: SetConfigType.RECEIVE_ULN,
                value: {
                    confirmations: confirmations,
                    requiredDvnCount,
                    optionalDvnCount,
                    optionalDvnThreshold,
                    requiredDvns,
                    optionalDvns: optionalDvns,
                },
            },
        });
        receiveIx.instruction.keys[4].pubkey = FAKE_SENDLIB_PROGRAM.publicKey; // Change the message lib program to the fake one

        const executorIx = await endpointSDK.setOAppConfig(umi.rpc, oAppKp2, {
            oapp: oAppKp2.publicKey,
            eid: DST_EID,
            msgLibProgram: ulnSDK.programId,
            msgLibVersion: { major: 3n, minor: 0, endpointVersion: 2 },
            config: {
                configType: SetConfigType.EXECUTOR,
                value: {
                    executor: executorPDA.config()[0],
                    maxMessageSize,
                },
            },
        });

        await shouldBeRejected(
            sendAndConfirm(umi, [sendIx, receiveIx, executorIx], [wallet, oAppKp2]),
            ConstraintSeeds,
        );
    });

    it('set uln config should success', async function () {
        const sendIx = await endpointSDK.setOAppConfig(umi.rpc, oAppDelegateKp, {
            oapp: oAppKp2.publicKey,
            eid: DST_EID,
            msgLibProgram: ulnSDK.programId,
            config: {
                configType: SetConfigType.SEND_ULN,
                value: {
                    confirmations: confirmations,
                    requiredDvnCount,
                    optionalDvnCount,
                    optionalDvnThreshold,
                    requiredDvns,
                    optionalDvns: optionalDvns,
                },
            },
        });
        const receiveIx = await endpointSDK.setOAppConfig(umi.rpc, oAppDelegateKp, {
            oapp: oAppKp2.publicKey,
            eid: DST_EID,
            msgLibProgram: ulnSDK.programId,
            config: {
                configType: SetConfigType.RECEIVE_ULN,
                value: {
                    confirmations: confirmations,
                    requiredDvnCount,
                    optionalDvnCount,
                    optionalDvnThreshold,
                    requiredDvns,
                    optionalDvns: optionalDvns,
                },
            },
        });
        const executorIx = await endpointSDK.setOAppConfig(umi.rpc, oAppDelegateKp, {
            oapp: oAppKp2.publicKey,
            eid: DST_EID,
            msgLibProgram: ulnSDK.programId,
            config: {
                configType: SetConfigType.EXECUTOR,
                value: {
                    executor: executorPDA.config()[0],
                    maxMessageSize,
                },
            },
        });
        const { signature } = await sendAndConfirm(
            umi,
            [sendIx, receiveIx, executorIx],
            [wallet, oAppDelegateKp],
        );

        const sendConfig = await UlnProgram.accounts.fetchSendConfig(umi, sendConfigAccount);
        const receiveConfig = await UlnProgram.accounts.fetchReceiveConfig(
            umi,
            receiveConfigAccount,
        );

        assert.strictEqual(sendConfig.uln.requiredDvns[0], dvnConfigAccount);
        assert.strictEqual(sendConfig.uln.confirmations, 1n);
        assert.strictEqual(sendConfig.uln.requiredDvnCount, 1);
        assert.strictEqual(sendConfig.executor.maxMessageSize, maxMessageSize);
        assert.strictEqual(sendConfig.executor.executor, executorPDA.config()[0]);

        assert.strictEqual(receiveConfig.uln.requiredDvns[0], dvnConfigAccount);
        assert.strictEqual(receiveConfig.uln.confirmations, 1n);
        assert.strictEqual(receiveConfig.uln.requiredDvnCount, 1);
        // Check event
        const signatureEvents =
            await extractEventFromTransactionSignature<UlnProgram.events.ConfigSetEvent>(
                connection,
                ulnSDK.programId,
                signature,
                UlnProgram.events.getConfigSetEventSerializer(),
                { commitment: 'confirmed', maxSupportedTransactionVersion: 1 },
            );
        assert.strictEqual(signatureEvents?.length, 3);
        assert.strictEqual(signatureEvents?.[0].eid, DST_EID);
        assert.strictEqual(signatureEvents?.[0].oapp, oAppKp2.publicKey);
    });
};
