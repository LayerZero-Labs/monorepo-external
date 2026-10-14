import { toWeb3JsPublicKey } from '@metaplex-foundation/umi-web3js-adapters';
import { assert } from 'vitest';
import { it } from 'vitest';

import { extractEventFromTransactionSignature } from '../../../src';
import { accounts, DVN, DVN_PROGRAM_ID, events } from '../../../src/dvn';
import { NotAdminError } from '../../../src/generated/dvn';
import { SolanaTestValidator } from '../../setup';
import { dvnPDA, sendAndConfirm, shouldBeRejected } from '../../utils';
import { HACKER } from '../../utils/constants';

export const testSuite = (validator: SolanaTestValidator): void => {
    const { umi, connection } = validator;
    const [configAccount] = dvnPDA.config();
    const defaultMultiplierBps = 13000;

    const wallet = umi.payer;
    const dvnSDK = new DVN(DVN_PROGRAM_ID);

    it('should failure with invalid admin', async function () {
        const ix = dvnSDK.setConfig(HACKER, {
            fields: [defaultMultiplierBps],
            __kind: 'DefaultMultiplierBps',
        });
        await shouldBeRejected(
            sendAndConfirm(umi, [ix], HACKER),
            new NotAdminError(dvnSDK.getProgram()),
        );
    });

    it('should success', async function () {
        const ix = dvnSDK.setConfig(wallet, {
            fields: [defaultMultiplierBps],
            __kind: 'DefaultMultiplierBps',
        });
        const { signature } = await sendAndConfirm(umi, [ix], wallet);

        const config = await accounts.fetchDvnConfig(umi, configAccount);
        assert.strictEqual(config.defaultMultiplierBps, defaultMultiplierBps);
        //check events
        const txEvents = await extractEventFromTransactionSignature(
            connection,
            toWeb3JsPublicKey(dvnSDK.programId),
            signature,
            events.getAdminConfigSetEventSerializer(),
            { commitment: 'confirmed', maxSupportedTransactionVersion: 1 },
        );

        if (txEvents === null) {
            throw new Error('txEvents is null');
        }
        const event: events.AdminConfigSetEvent = txEvents[0];
        assert.strictEqual(event.config.fields[0], defaultMultiplierBps);
    });
};
