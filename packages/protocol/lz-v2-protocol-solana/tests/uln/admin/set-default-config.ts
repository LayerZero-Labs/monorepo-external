import { isSome, none, some } from '@metaplex-foundation/umi';
import { toWeb3JsPublicKey } from '@metaplex-foundation/umi-web3js-adapters';
import { assert, it } from 'vitest';

import { extractEventFromTransactionSignature } from '../../../src';
import { accounts, events, types, Uln, ULN_PROGRAM_ID } from '../../../src/uln';
import { SolanaTestValidator } from '../../setup';
import { ConstraintHasOne, sendAndConfirm, shouldBeRejected } from '../../utils';
import { DST_EID, executorPDA, HACKER, ulnPDA } from '../../utils/constants';

export const testSuite = (validator: SolanaTestValidator): void => {
    const { umi, connection } = validator;
    const wallet = umi.payer;
    const ulnSDK = new Uln(ULN_PROGRAM_ID);

    const [sendConfigAccount] = ulnPDA.defaultSendConfig(DST_EID);
    const [executorConfigAccount] = executorPDA.config();
    const maxMessageSize = 2048;
    const executorConfig: types.ExecutorConfig = {
        maxMessageSize,
        executor: executorConfigAccount,
    };

    it('should failure with invalid admin', async function () {
        const ix = await ulnSDK.initOrUpdateDefaultConfig(umi.rpc, HACKER, {
            remote: DST_EID,
            sendUlnConfig: none(),
            receiveUlnConfig: none(),
            executorConfig: some(executorConfig),
        });

        await shouldBeRejected(sendAndConfirm(umi, ix, HACKER), ConstraintHasOne);
    });

    it('should success', async function () {
        const ix = await ulnSDK.initOrUpdateDefaultConfig(umi.rpc, wallet, {
            remote: DST_EID,
            sendUlnConfig: none(),
            receiveUlnConfig: none(),
            executorConfig: some(executorConfig),
        });

        const { signature } = await sendAndConfirm(umi, ix, wallet);
        const sendConfigStore = await accounts.fetchSendConfig(umi, sendConfigAccount);
        assert.strictEqual(sendConfigStore.executor.maxMessageSize, maxMessageSize);
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
        assert.isNotNull(event.executorConfig);
        if (isSome(event.executorConfig)) {
            assert.deepStrictEqual(event.executorConfig.value, executorConfig);
        }
    });
};
