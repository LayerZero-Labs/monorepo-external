import { PublicKey } from '@metaplex-foundation/umi';
import { toWeb3JsPublicKey } from '@metaplex-foundation/umi-web3js-adapters';
import { assert } from 'vitest';
import { it } from 'vitest';

import { extractEventFromTransactionSignature } from '../../../src';
import { accounts, DVN, DVN_PROGRAM_ID, events } from '../../../src/dvn';
import { TooManyAdminsError } from '../../../src/generated/dvn';
import { SolanaTestValidator } from '../../setup';
import {
    dvnPDA,
    generateMaxAdmin,
    MAX_VERIFIER_SIGNERS,
    onChainExpiration,
    sendAndConfirm,
    shouldBeRejected,
} from '../../utils';
import { HACKER, SRC_EID } from '../../utils/constants';
import { DVNSigner } from '../../utils/dvnInvoke';

export const testSuite = (validator: SolanaTestValidator): void => {
    const { umi, connection } = validator;
    const wallet = umi.payer;
    const dvnSDK = new DVN(DVN_PROGRAM_ID);

    const [configAccount] = dvnPDA.config();

    it('should failure with too many admins', async function () {
        const [ix] = await dvnSDK.setMultisigConfig(
            umi.rpc,
            wallet,
            {
                vid: SRC_EID % 30000,
                expiration: await onChainExpiration(connection, 120),
                config: {
                    __kind: 'Admins',
                    fields: [[wallet.publicKey, ...generateMaxAdmin()]],
                },
            },
            new DVNSigner(MAX_VERIFIER_SIGNERS),
        );
        await shouldBeRejected(
            sendAndConfirm(umi, ix, wallet),
            new TooManyAdminsError(dvnSDK.getProgram()),
        );
    });

    it('should success', async function () {
        const [ix] = await dvnSDK.setMultisigConfig(
            umi.rpc,
            wallet,
            {
                vid: SRC_EID % 30000,
                expiration: await onChainExpiration(connection, 120),
                config: {
                    __kind: 'Admins',
                    fields: [[wallet.publicKey, HACKER.publicKey]],
                },
            },
            new DVNSigner(MAX_VERIFIER_SIGNERS),
        );
        const { signature } = await sendAndConfirm(umi, ix, wallet);
        let config = await accounts.fetchDvnConfig(umi, configAccount);
        assert.strictEqual(config.admins[1], HACKER.publicKey);
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
        const keys = event.config.fields[0] as PublicKey[];
        assert.strictEqual(keys[0], wallet.publicKey);
        assert.strictEqual(keys[1], HACKER.publicKey);

        const [resetIx] = await dvnSDK.setMultisigConfig(
            umi.rpc,
            wallet,
            {
                vid: SRC_EID % 30000,
                expiration: await onChainExpiration(connection, 120),
                config: {
                    __kind: 'Admins',
                    fields: [[wallet.publicKey]],
                },
            },
            new DVNSigner(MAX_VERIFIER_SIGNERS),
        );
        await sendAndConfirm(umi, resetIx, wallet);
        config = await accounts.fetchDvnConfig(umi, configAccount);
        assert.strictEqual(config.admins[0], wallet.publicKey);
        assert.strictEqual(config.admins.length, 1);
    });
};
