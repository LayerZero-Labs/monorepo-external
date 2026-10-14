import { sol } from '@metaplex-foundation/umi';
import { beforeAll, expect, it } from 'vitest';

import { EndpointProgram, extractEventFromTransactionSignature } from '../../../src';
import { errors } from '../../../src/endpoint';
import { SolanaTestValidator } from '../../setup';
import {
    ConstraintHasOne,
    endpointPDA,
    HACKER,
    sendAndConfirm,
    shouldBeRejected,
} from '../../utils';

export const testSuite = (validator: SolanaTestValidator): void => {
    const { umi, connection } = validator;
    const wallet = umi.payer;
    const endpointSDK = new EndpointProgram.Endpoint(EndpointProgram.ENDPOINT_PROGRAM_ID);

    // PDAs
    const [setting] = endpointPDA.setting();
    const receiverKp = umi.eddsa.generateKeypair();
    const airdropAmount = sol(10);

    beforeAll(async () => {
        await umi.rpc.airdrop(setting, airdropAmount);
    });

    it('revert if not admin', async function () {
        const ix = endpointSDK.withdrawRent(HACKER, {
            receiver: receiverKp.publicKey,
            amount: 1n,
        });
        await shouldBeRejected(sendAndConfirm(umi, [ix], HACKER), ConstraintHasOne);
    });

    it('revert if withdraw all balance', async function () {
        const balance = await umi.rpc.getBalance(setting);
        const ix = endpointSDK.withdrawRent(wallet, {
            receiver: receiverKp.publicKey,
            amount: balance.basisPoints,
        });
        await shouldBeRejected(
            sendAndConfirm(umi, [ix], wallet),
            new errors.InvalidAmountError(endpointSDK.getProgram()),
        );
    });

    it('should success', async function () {
        // check balance
        const balance = await umi.rpc.getBalance(setting);
        expect(balance.basisPoints >= airdropAmount.basisPoints);

        const ix = endpointSDK.withdrawRent(wallet, {
            receiver: receiverKp.publicKey,
            amount: airdropAmount.basisPoints,
        });
        const { signature } = await sendAndConfirm(umi, [ix], wallet);

        // Check
        const balanceAfter = await umi.rpc.getBalance(setting);
        expect(balanceAfter.basisPoints).to.eq(balance.basisPoints - airdropAmount.basisPoints);
        const receiverBalance = await umi.rpc.getBalance(receiverKp.publicKey);
        expect(receiverBalance.basisPoints).to.eq(airdropAmount.basisPoints);

        // check event
        const events = await extractEventFromTransactionSignature(
            connection,
            endpointSDK.programId,
            signature,
            EndpointProgram.events.getRentWithdrawnEventSerializer(),
            { commitment: 'confirmed', maxSupportedTransactionVersion: 1 },
        );
        expect(events?.length).to.eq(1);
        expect(events?.[0].amount).to.eq(airdropAmount.basisPoints);
        expect(events?.[0].receiver).to.eq(receiverKp.publicKey);
    });
};
