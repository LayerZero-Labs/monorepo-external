import { isSome, some } from '@metaplex-foundation/umi';
import { toWeb3JsPublicKey } from '@metaplex-foundation/umi-web3js-adapters';
import { assert, it } from 'vitest';

import { extractEventFromTransactionSignature } from '../../../src';
import { accounts, events, types, Uln, ULN_PROGRAM_ID } from '../../../src/uln';
import { SolanaTestValidator } from '../../setup';
import { DST_EID, dvnPDA, executorPDA, ulnPDA } from '../../utils/constants';
import { sendAndConfirm } from '../../utils/util';

export const testSuite = (validator: SolanaTestValidator): void => {
    const { umi, connection } = validator;
    const wallet = umi.payer;
    const ulnSDK = new Uln(ULN_PROGRAM_ID);

    it('should success', async function () {
        const [sendConfigAccount, sendBump] = ulnPDA.defaultSendConfig(DST_EID);
        const [receiveConfigAccount, receiveBump] = ulnPDA.defaultReceiveConfig(DST_EID);
        const [dvnConfigAccount] = dvnPDA.config();
        const [executorConfigAccount] = executorPDA.config();
        const maxMessageSize = 1024;
        const sendUlnConfig: types.UlnConfig = {
            confirmations: 1n,
            requiredDvnCount: 1,
            optionalDvnCount: 0,
            optionalDvnThreshold: 0,
            requiredDvns: [dvnConfigAccount],
            optionalDvns: [],
        };
        const receiveUlnConfig: types.UlnConfig = {
            confirmations: 1n,
            requiredDvnCount: 1,
            optionalDvnCount: 0,
            optionalDvnThreshold: 0,
            requiredDvns: [dvnConfigAccount],
            optionalDvns: [],
        };
        const executorConfig: types.ExecutorConfig = {
            maxMessageSize,
            executor: executorConfigAccount,
        };
        const ix = await ulnSDK.initOrUpdateDefaultConfig(umi.rpc, wallet, {
            remote: DST_EID,
            sendUlnConfig: some(sendUlnConfig),
            receiveUlnConfig: some(receiveUlnConfig),
            executorConfig: some(executorConfig),
        });

        const { signature } = await sendAndConfirm(umi, ix, wallet);
        const sendConfigStore = await accounts.fetchSendConfig(umi, sendConfigAccount);
        const receiveConfigStore = await accounts.fetchReceiveConfig(umi, receiveConfigAccount);
        assert.deepStrictEqual(
            {
                confirmations: sendConfigStore.uln.confirmations,
                requiredDvnCount: sendConfigStore.uln.requiredDvnCount,
                optionalDvnCount: sendConfigStore.uln.optionalDvnCount,
                optionalDvnThreshold: sendConfigStore.uln.optionalDvnThreshold,
                requiredDvns: sendConfigStore.uln.requiredDvns,
                optionalDvns: sendConfigStore.uln.optionalDvns,
            },
            sendUlnConfig,
        );
        assert.strictEqual(sendConfigStore.bump, sendBump);
        assert.deepStrictEqual(
            {
                confirmations: sendConfigStore.uln.confirmations,
                requiredDvnCount: receiveConfigStore.uln.requiredDvnCount,
                optionalDvnCount: receiveConfigStore.uln.optionalDvnCount,
                optionalDvnThreshold: receiveConfigStore.uln.optionalDvnThreshold,
                requiredDvns: receiveConfigStore.uln.requiredDvns,
                optionalDvns: receiveConfigStore.uln.optionalDvns,
            },
            receiveUlnConfig,
        );
        assert.strictEqual(receiveConfigStore.bump, receiveBump);
        assert.deepStrictEqual(sendConfigStore.executor, executorConfig);
        //check events
        const txEvents = await extractEventFromTransactionSignature(
            connection,
            toWeb3JsPublicKey(ulnSDK.programId),
            signature,
            events.getDefaultConfigSetEventSerializer(),
            { commitment: 'confirmed', maxSupportedTransactionVersion: 1 },
        );

        if (txEvents === null) {
            throw new Error('txEvents is null');
        }
        const event: events.DefaultConfigSetEvent = txEvents[0];
        assert.strictEqual(event.eid, DST_EID);
        assert.isNotNull(event.sendUlnConfig);
        if (isSome(event.sendUlnConfig)) {
            const { confirmations, ...rest } = event.sendUlnConfig.value;
            assert.deepStrictEqual(
                {
                    confirmations: confirmations,
                    ...rest,
                },
                sendUlnConfig,
            );
        }
        assert.isNotNull(event.receiveUlnConfig);
        if (isSome(event.receiveUlnConfig)) {
            const { confirmations, ...rest } = event.receiveUlnConfig.value;
            assert.deepStrictEqual(
                {
                    confirmations: confirmations,
                    ...rest,
                },
                receiveUlnConfig,
            );
        }
        assert.isNotNull(event.executorConfig);
        if (isSome(event.executorConfig)) {
            assert.deepStrictEqual(event.executorConfig.value, executorConfig);
        }
    });
};
