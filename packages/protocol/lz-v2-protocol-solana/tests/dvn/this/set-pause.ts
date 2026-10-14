import { toWeb3JsPublicKey } from '@metaplex-foundation/umi-web3js-adapters';
import { assert } from 'vitest';
import { it } from 'vitest';

import { DVNProgram, extractEventFromTransactionSignature } from '../../../src';
import { accounts, DVN, DVN_PROGRAM_ID, events } from '../../../src/dvn';
import { NotAdminError } from '../../../src/generated/dvn';
import { SolanaTestValidator } from '../../setup';
import {
    dvnPDA,
    HACKER,
    MAX_VERIFIER_SIGNERS,
    onChainExpiration,
    sendAndConfirm,
    shouldBeRejected,
    SRC_EID,
} from '../../utils';
import { DVNSigner } from '../../utils/dvnInvoke';

export const testSuite = (validator: SolanaTestValidator): void => {
    const { umi, connection } = validator;
    const wallet = umi.payer;
    const dvnSDK = new DVN(DVN_PROGRAM_ID);

    const args = {
        vid: SRC_EID % 30000,
        config: { __kind: 'Paused', fields: [true] } satisfies DVNProgram.types.MultisigConfig,
    };

    it('should failure with invalid admins', async function () {
        const [ix] = await dvnSDK.setMultisigConfig(
            umi.rpc,
            HACKER,
            { ...args, expiration: await onChainExpiration(connection, 120) },
            new DVNSigner(MAX_VERIFIER_SIGNERS),
        );
        await shouldBeRejected(
            sendAndConfirm(umi, ix, HACKER),
            new NotAdminError(dvnSDK.getProgram()),
        );
    });

    it('should success', async function () {
        const [configAccount] = dvnPDA.config();
        const [ix] = await dvnSDK.setMultisigConfig(
            umi.rpc,
            wallet,
            { ...args, expiration: await onChainExpiration(connection, 120) },
            new DVNSigner(MAX_VERIFIER_SIGNERS),
        );
        const { signature } = await sendAndConfirm(umi, ix, wallet);
        let config = await accounts.fetchDvnConfig(umi, configAccount);
        assert.strictEqual(config.paused, true);
        //check events
        const txEvents = await extractEventFromTransactionSignature(
            connection,
            toWeb3JsPublicKey(dvnSDK.programId),
            signature,
            events.getMultisigConfigSetEventSerializer(),
            { commitment: 'confirmed', maxSupportedTransactionVersion: 1 },
        );

        if (txEvents === null) {
            throw new Error('txEvents is null');
        }
        const event: events.MultisigConfigSetEvent = txEvents[0];
        assert.strictEqual(event.config.fields[0], true);

        const [resetIx] = await dvnSDK.setMultisigConfig(
            umi.rpc,
            wallet,
            {
                ...args,
                config: { __kind: 'Paused', fields: [false] },
                expiration: await onChainExpiration(connection, 120),
            },
            new DVNSigner(MAX_VERIFIER_SIGNERS),
        );
        await sendAndConfirm(umi, resetIx, wallet);
        config = await accounts.fetchDvnConfig(umi, configAccount);
        assert.strictEqual(config.paused, false);
    });
};
