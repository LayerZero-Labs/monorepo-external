import { PublicKey } from '@metaplex-foundation/umi';
import { toWeb3JsPublicKey } from '@metaplex-foundation/umi-web3js-adapters';
import { assert } from 'vitest';
import { it } from 'vitest';

import { extractEventFromTransactionSignature } from '../../../src';
import { accounts, DVN, DVN_PROGRAM_ID, events } from '../../../src/dvn';
import { NotAdminError, TooManyAdminsError } from '../../../src/generated/dvn';
import { SolanaTestValidator } from '../../setup';
import {
    dvnPDA,
    generateMaxAdmin,
    HACKER,
    revertIx,
    revertTxError,
    sendAndConfirm,
    shouldBeRejected,
} from '../../utils';

export const testSuite = (validator: SolanaTestValidator): void => {
    const { umi, connection } = validator;
    const [configAccount] = dvnPDA.config();
    const wallet = umi.payer;
    const dvnSDK = new DVN(DVN_PROGRAM_ID);

    it('should failure with invalid admin', async function () {
        const ix = dvnSDK.setConfig(HACKER, {
            fields: [[wallet.publicKey, HACKER.publicKey]],
            __kind: 'Admins',
        });
        await shouldBeRejected(
            sendAndConfirm(umi, [ix], wallet),
            new NotAdminError(dvnSDK.getProgram()),
        );
    });

    it('should failure with too many admins', async function () {
        const ix = dvnSDK.setConfig(wallet, {
            fields: [[wallet.publicKey, ...generateMaxAdmin()]],
            __kind: 'Admins',
        });
        await shouldBeRejected(
            sendAndConfirm(umi, [ix], wallet),
            new TooManyAdminsError(dvnSDK.getProgram()),
        );
    });

    it('should failure with zero admins', async function () {
        // because signers can set admins again
        const ix = dvnSDK.setConfig(wallet, {
            fields: [[]],
            __kind: 'Admins',
        });
        await shouldBeRejected(sendAndConfirm(umi, [ix, revertIx()], wallet), revertTxError());
    });

    it('should success', async function () {
        const ix = dvnSDK.setConfig(wallet, {
            fields: [[wallet.publicKey, HACKER.publicKey]],
            __kind: 'Admins',
        });
        const { signature } = await sendAndConfirm(umi, [ix], wallet);
        let config = await accounts.fetchDvnConfig(umi, configAccount);
        assert.strictEqual(config.admins[1], HACKER.publicKey);
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
        const keys = event.config.fields[0] as PublicKey[];
        assert.strictEqual(keys[0], wallet.publicKey);
        assert.strictEqual(keys[1], HACKER.publicKey);

        // reset admins to [wallet]
        const resetIx = dvnSDK.setConfig(wallet, {
            fields: [[wallet.publicKey]],
            __kind: 'Admins',
        });
        await sendAndConfirm(umi, [resetIx], wallet);
        config = await accounts.fetchDvnConfig(umi, configAccount);
        assert.strictEqual(config.admins[0], wallet.publicKey);
        assert.strictEqual(config.admins.length, 1);
    });
};
