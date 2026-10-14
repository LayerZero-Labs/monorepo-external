import { generateSigner, PublicKey } from '@metaplex-foundation/umi';
import { toWeb3JsPublicKey } from '@metaplex-foundation/umi-web3js-adapters';
import { assert } from 'vitest';
import { it } from 'vitest';

import { DVNProgram, extractEventFromTransactionSignature } from '../../../src';
import { accounts, DVN, DVN_PROGRAM_ID, events } from '../../../src/dvn';
import { NotAdminError } from '../../../src/generated/dvn';
import { InvalidSizeError } from '../../../src/generated/worker_interface';
import { SolanaTestValidator } from '../../setup';
import {
    dvnPDA,
    eddsa,
    generatePublicKeys,
    HACKER,
    MAX_VERIFIER_SIGNERS,
    maxMsgLibNum,
    onChainExpiration,
    sendAndConfirm,
    shouldBeRejected,
    SRC_EID,
    VERIFIER_SIGNER1,
    VERIFIER_SIGNER2,
} from '../../utils';
import { closeExecuteHash } from '../../utils/closeExecuteHash';
import { DVNSigner } from '../../utils/dvnInvoke';

// Don't import '@layerzerolabs/lz-utilities'
async function sleep(timeout: number): Promise<void> {
    await new Promise((resolve) => setTimeout(resolve, timeout));
}

export const testSuite = (validator: SolanaTestValidator): void => {
    const { umi, connection } = validator;
    const wallet = umi.payer;
    const dvnSDK = new DVN(DVN_PROGRAM_ID);

    const newMsglib = generateSigner({ eddsa });
    const args = {
        vid: SRC_EID % 30000,
        config: {
            __kind: 'Msglibs',
            fields: [[newMsglib.publicKey]],
        } satisfies DVNProgram.types.MultisigConfig,
    };

    it('should failure with invalid admins', async function () {
        const [ix] = await dvnSDK.setMultisigConfig(
            umi.rpc,
            HACKER,
            { ...args, expiration: await onChainExpiration(connection, 120) },
            new DVNSigner([VERIFIER_SIGNER1, VERIFIER_SIGNER2]),
        );
        await shouldBeRejected(
            sendAndConfirm(umi, ix, HACKER),
            new NotAdminError(dvnSDK.getProgram()),
        );
    });

    it('should failure with too large msg lib list', async function () {
        const keys = generatePublicKeys(maxMsgLibNum);
        const [ix] = await dvnSDK.setMultisigConfig(
            umi.rpc,
            wallet,
            {
                ...args,
                config: { __kind: 'Msglibs', fields: [keys] },
                expiration: await onChainExpiration(connection, 120),
            },
            new DVNSigner([VERIFIER_SIGNER1, VERIFIER_SIGNER2]),
        );
        await shouldBeRejected(
            sendAndConfirm(umi, ix, wallet),
            new InvalidSizeError(dvnSDK.getProgram()),
        );
    });

    it('should success', async function () {
        const [configAccount] = dvnPDA.config();
        const [ix, digestHash] = await dvnSDK.setMultisigConfig(
            umi.rpc,
            wallet,
            {
                ...args,
                expiration: await onChainExpiration(connection, 1),
            },
            new DVNSigner([VERIFIER_SIGNER1, VERIFIER_SIGNER2]),
        );
        const { signature } = await sendAndConfirm(umi, ix, wallet);

        // make sure execute hash account is expired, then close it
        await sleep(3000);
        // must close execute hash account, otherwise it will cause error in next test by init pda account twice
        await closeExecuteHash(umi, wallet, digestHash);
        let config = await accounts.fetchDvnConfig(umi, configAccount);
        // msglib already added in init DVN, so it will remove msglib this time
        assert.strictEqual(config.msglibs.length, 2);
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
        assert.strictEqual(keys[0], newMsglib.publicKey);

        const [resetIx] = await dvnSDK.setMultisigConfig(
            umi.rpc,
            wallet,
            { ...args, expiration: await onChainExpiration(connection, 120) },
            new DVNSigner(MAX_VERIFIER_SIGNERS),
        );
        await sendAndConfirm(umi, resetIx, wallet);
        config = await accounts.fetchDvnConfig(umi, configAccount);
        assert.strictEqual(config.msglibs.length, 1);
    });
};
