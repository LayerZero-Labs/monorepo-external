import { toWeb3JsPublicKey } from '@metaplex-foundation/umi-web3js-adapters';
import { assert } from 'vitest';
import { it } from 'vitest';

import { DVNProgram, extractEventFromTransactionSignature } from '../../../src';
import { accounts, DVN, DVN_PROGRAM_ID, events } from '../../../src/dvn';
import { InvalidQuorumError, NotAdminError } from '../../../src/generated/dvn';
import { SolanaTestValidator } from '../../setup';
import {
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
    const [configAccount] = dvnSDK.pda.config();

    const args = async (quorum: number) => {
        return {
            vid: SRC_EID % 30000,
            config: {
                __kind: 'Quorum',
                fields: [quorum],
            } satisfies DVNProgram.types.MultisigConfig,
            expiration: await onChainExpiration(connection, 120),
        };
    };

    it('should failure with invalid admins', async function () {
        const [ix] = await dvnSDK.setMultisigConfig(
            umi.rpc,
            HACKER,
            await args(2),
            new DVNSigner(MAX_VERIFIER_SIGNERS),
        );
        await shouldBeRejected(
            sendAndConfirm(umi, ix, HACKER),
            new NotAdminError(dvnSDK.getProgram()),
        );
    });

    it('should failure with zero quorum', async function () {
        const [ix] = await dvnSDK.setMultisigConfig(
            umi.rpc,
            wallet,
            await args(0),
            new DVNSigner(MAX_VERIFIER_SIGNERS),
        );
        await shouldBeRejected(
            sendAndConfirm(umi, ix, wallet),
            new InvalidQuorumError(dvnSDK.getProgram()),
        );
    });

    it('should failure with params.quorum greater than config verifiers num', async function () {
        const config = await accounts.fetchDvnConfig(umi, configAccount);
        const oldQuorum = config.multisig.signers.length;
        // const ix = dvnSDK.setQuorum(oldQuorum + 1)
        const [ix] = await dvnSDK.setMultisigConfig(
            umi.rpc,
            wallet,
            await args(oldQuorum + 1),
            new DVNSigner(MAX_VERIFIER_SIGNERS),
        );
        await shouldBeRejected(
            sendAndConfirm(umi, ix, wallet),
            new InvalidQuorumError(dvnSDK.getProgram()),
        );
    });

    it('should success', async function () {
        const [ix] = await dvnSDK.setMultisigConfig(
            umi.rpc,
            wallet,
            await args(2),
            new DVNSigner(MAX_VERIFIER_SIGNERS),
        );
        const { signature } = await sendAndConfirm(umi, ix, wallet);
        const config = await accounts.fetchDvnConfig(umi, configAccount);
        assert.strictEqual(config.multisig.quorum, 2);
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
        assert.strictEqual(event.config.fields[0], 2);
    });
};
