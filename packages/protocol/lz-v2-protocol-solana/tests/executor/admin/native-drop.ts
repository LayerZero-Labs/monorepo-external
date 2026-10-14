import { generateSigner, publicKeyBytes } from '@metaplex-foundation/umi';
import { toWeb3JsPublicKey } from '@metaplex-foundation/umi-web3js-adapters';
import { assert, it } from 'vitest';

import { extractEventFromTransactionSignature } from '../../../src';
import { errors, events, Executor, EXECUTOR_PROGRAM_ID, instructions } from '../../../src/executor';
import { SolanaTestValidator } from '../../setup';
import {
    DST_EID,
    eddsa,
    EOAPP,
    EXECUTOR,
    executorPDA,
    HACKER,
    sendAndConfirm,
    shouldBeRejected,
    SRC_EID,
} from '../../utils';

export const testSuite = (validator: SolanaTestValidator): void => {
    const { umi, connection } = validator;
    const executorSdk = new Executor(EXECUTOR_PROGRAM_ID);

    const alice = generateSigner({ eddsa }).publicKey;
    const bob = generateSigner({ eddsa }).publicKey;

    const receiveAccounts = [
        {
            pubkey: alice,
            isSigner: false,
            isWritable: true,
        },
        {
            pubkey: bob,
            isSigner: false,
            isWritable: true,
        },
    ];

    it('revert if executor not exists', async function () {
        const ix = executorSdk.nativeDrop(HACKER, {
            dstEid: DST_EID,
            sender: publicKeyBytes(EOAPP.publicKey),
            nonce: 1n,
            oapp: EOAPP.publicKey,
            srcEid: SRC_EID,
            nativeDropRequests: [
                {
                    receiver: alice,
                    amount: 100000000n,
                },
                {
                    receiver: bob,
                    amount: 200000000n,
                },
            ],
        });

        await shouldBeRejected(
            sendAndConfirm(umi, ix, HACKER),
            new errors.NotExecutorError(executorSdk.getProgram()),
        );
    });

    it('revert if the length of nativeDropRequests is not equal to the length of anchorRemainingAccounts', async function () {
        const [configAccount] = executorPDA.config();

        const ix = instructions
            .nativeDrop(
                { programs: executorSdk.programRepo },
                {
                    executor: EXECUTOR,
                    config: configAccount,
                    eventAuthority: executorSdk.eventAuthority,
                    program: executorSdk.programId,
                    dstEid: DST_EID,
                    sender: publicKeyBytes(EOAPP.publicKey),
                    nonce: 1,
                    oapp: EOAPP.publicKey,
                    srcEid: SRC_EID,
                    nativeDropRequests: [
                        {
                            receiver: alice,
                            amount: 100000000,
                        },
                    ],
                },
            )
            .addRemainingAccounts(receiveAccounts).items[0];

        await shouldBeRejected(
            sendAndConfirm(umi, ix, EXECUTOR),
            new errors.InvalidNativeDropRequestsLengthError(executorSdk.getProgram()),
        );
    });

    it('revert if native drop receiver not exists', async function () {
        const [configAccount] = executorPDA.config();
        const ix = instructions
            .nativeDrop(
                { programs: executorSdk.programRepo },
                {
                    executor: EXECUTOR,
                    config: configAccount,
                    eventAuthority: executorSdk.eventAuthority,
                    program: executorSdk.programId,
                    dstEid: DST_EID,
                    sender: publicKeyBytes(EOAPP.publicKey),
                    nonce: 1,
                    oapp: EOAPP.publicKey,
                    srcEid: SRC_EID,
                    nativeDropRequests: [
                        {
                            receiver: generateSigner({ eddsa }).publicKey,
                            amount: 100000000,
                        },
                        {
                            receiver: bob,
                            amount: 200000000,
                        },
                    ],
                },
            )
            .addRemainingAccounts(receiveAccounts).items[0];

        await shouldBeRejected(
            sendAndConfirm(umi, ix, EXECUTOR),
            new errors.InvalidNativeDropReceiverError(executorSdk.getProgram()),
        );
    });

    it('should success', async function () {
        const ix = executorSdk.nativeDrop(EXECUTOR, {
            dstEid: DST_EID,
            sender: publicKeyBytes(EOAPP.publicKey),
            nonce: 1,
            oapp: EOAPP.publicKey,
            srcEid: SRC_EID,
            nativeDropRequests: [
                {
                    receiver: alice,
                    amount: 100000000,
                },
                {
                    receiver: bob,
                    amount: 200000000,
                },
            ],
        });

        const { signature } = await sendAndConfirm(umi, ix, EXECUTOR);

        const aliceBalance = await umi.rpc.getBalance(alice);
        const bobBalance = await umi.rpc.getBalance(bob);
        assert.equal(aliceBalance.basisPoints, 100000000n);
        assert.equal(bobBalance.basisPoints, 200000000n);

        // check event

        const event = await extractEventFromTransactionSignature(
            connection,
            toWeb3JsPublicKey(executorSdk.programId),
            signature,
            events.getNativeDropAppliedEventSerializer(),
            { commitment: 'confirmed', maxSupportedTransactionVersion: 1 },
        );

        assert.strictEqual(event?.[0]?.srcEid, SRC_EID);
        assert.strictEqual(event?.[0]?.dstEid, DST_EID);
        assert.strictEqual(Number(event?.[0]?.nonce), 1);
        assert.strictEqual(
            event?.[0]?.sender.toString(),
            publicKeyBytes(EOAPP.publicKey).toString(),
        );
        assert.strictEqual(event?.[0]?.oapp, EOAPP.publicKey);
        assert.strictEqual(event?.[0]?.nativeDropRequests.length, 2);
        assert.strictEqual(event?.[0]?.nativeDropRequests[0].receiver, alice);
        assert.strictEqual(Number(event?.[0]?.nativeDropRequests[0].amount), 100000000);
        assert.strictEqual(event?.[0]?.nativeDropRequests[1].receiver, bob);
        assert.strictEqual(Number(event?.[0]?.nativeDropRequests[1].amount), 200000000);
        assert.strictEqual(event?.[0]?.successes.length, 2);
        assert.strictEqual(event?.[0]?.successes[0], true);
        assert.strictEqual(event?.[0]?.successes[1], true);
    });
};
