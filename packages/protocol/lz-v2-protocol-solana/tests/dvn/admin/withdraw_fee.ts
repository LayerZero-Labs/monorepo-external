import { generateSigner, lamports } from '@metaplex-foundation/umi';
import { toWeb3JsPublicKey } from '@metaplex-foundation/umi-web3js-adapters';
import { assert } from 'vitest';
import { beforeAll as before, it } from 'vitest';

import { extractEventFromTransactionSignature } from '../../../src';
import { DVN, DVN_PROGRAM_ID, events } from '../../../src/dvn';
import { InvalidAmountError, NotAdminError } from '../../../src/generated/dvn';
import { SolanaTestValidator } from '../../setup';
import { eddsa, HACKER, sendAndConfirm, shouldBeRejected } from '../../utils';

export const testSuite = (validator: SolanaTestValidator): void => {
    const { umi, connection } = validator;
    const wallet = umi.payer;
    const dvnSDK = new DVN(DVN_PROGRAM_ID);

    const receiver = generateSigner({ eddsa });
    const [configAccount] = dvnSDK.pda.config();
    const withdrawAmount = BigInt(1e8);

    before(async function () {
        await umi.rpc.airdrop(configAccount, lamports(withdrawAmount));
    });

    it('should failure with invalid admin', async function () {
        const ix = dvnSDK.withdrawFee(HACKER, {
            receiver: receiver.publicKey,
            amount: withdrawAmount,
        });

        await shouldBeRejected(
            sendAndConfirm(umi, [ix], HACKER),
            new NotAdminError(dvnSDK.getProgram()),
        );
    });

    it('should failure with too large params.amount', async function () {
        const amount = withdrawAmount + 1n;

        const ix = dvnSDK.withdrawFee(wallet, { receiver: receiver.publicKey, amount });

        await shouldBeRejected(
            sendAndConfirm(umi, [ix], wallet),
            new InvalidAmountError(dvnSDK.getProgram()),
        );
    });

    it('should success', async function () {
        let accountInfo = await umi.rpc.getAccount(configAccount);
        if (!accountInfo.exists) {
            throw new Error('accountInfo is null');
        }
        const beforeConfigLamports = accountInfo.lamports;

        const ix = dvnSDK.withdrawFee(wallet, {
            receiver: receiver.publicKey,
            amount: withdrawAmount,
        });

        const { signature } = await sendAndConfirm(umi, [ix], wallet);
        accountInfo = await umi.rpc.getAccount(configAccount);

        if (!accountInfo.exists) {
            throw new Error('accountInfo is null');
        }
        const afterConfigLamports = accountInfo.lamports;
        const receiverAccountInfo = await umi.rpc.getAccount(receiver.publicKey);
        if (!receiverAccountInfo.exists) {
            throw new Error('receiverAccountInfo is null');
        }
        const afterReceiverLamports = receiverAccountInfo.lamports;
        assert.strictEqual(
            beforeConfigLamports.basisPoints - afterConfigLamports.basisPoints,
            withdrawAmount,
        );
        assert.strictEqual(afterReceiverLamports.basisPoints, withdrawAmount);
        //check events
        const txEvents = await extractEventFromTransactionSignature(
            connection,
            toWeb3JsPublicKey(dvnSDK.programId),
            signature,
            events.getFeeWithdrawnEventSerializer(),
            { commitment: 'confirmed', maxSupportedTransactionVersion: 1 },
        );

        if (txEvents === null) {
            throw new Error('txEvents is null');
        }
        const event: events.FeeWithdrawnEvent = txEvents[0];
        assert.strictEqual(event.receiver, receiver.publicKey);
        assert.strictEqual(event.amount, withdrawAmount);
    });
};
