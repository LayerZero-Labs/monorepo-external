/**
 * Off-chain workflow integration tests.
 *
 * The other integration suite (integration.test.ts) mostly goes through
 * `executeOnesigTx`, which builds an AssembledTransaction, simulates it, and then
 * *reverse-engineers* the leaf `Call` from the simulated auth entry before signing.
 * That is convenient for tests but is NOT how production works.
 *
 * The real off-chain workflow is the reverse direction:
 *   1. The caller already knows the calls it wants to run.
 *   2. Those calls are encoded into merkle leaves and a tree is built off-chain.
 *   3. Signers sign the tree root (EIP-712 digest).
 *   4. The calls are executed on-chain *with the proof + signatures* — the leaf is
 *      the source of truth, not something derived from a simulation.
 *
 * These tests follow that exact order: build calls -> build tree -> sign root ->
 * build the matching transaction -> attach proof/signatures via `signAndSendOnesigTx`,
 * across all three sender types (permissionless / executor / signer) and with both a
 * single self-call and a multicall (multiple token transfers in one execute_transaction).
 */
import { Address, Asset, contract, Horizon, nativeToScVal, rpc } from '@stellar/stellar-sdk';
import { randomBytes } from 'crypto';
import { Wallet } from 'ethers';
import { beforeAll, describe, expect, test } from 'vitest';

import { compareAddresses } from '@layerzerolabs/onesig-core';

import {
    Call,
    createExecuteTransactionCall,
    createSetExecutorRequiredCall,
    createSetSeedCall,
} from '../src/index';
import { buildCallTransaction, SenderConfig, signAndSendOnesigTx } from './onesigExecution';
import {
    arrayify,
    buildSingleTxMerkleData,
    callContract,
    deployOneSig,
    deployStellarAssetContract,
    generateFundedKeypair,
    HORIZON_URL,
    IntegrationTestContext,
    NETWORK_PASSPHRASE,
    RPC_URL,
    waitForNetworkReady,
} from './utils';

function assertTxSucceeded(sentTx: contract.SentTransaction<unknown>, label: string): void {
    const txResponse = sentTx.getTransactionResponse;
    if (!txResponse || txResponse.status !== rpc.Api.GetTransactionStatus.SUCCESS) {
        const status = txResponse ? txResponse.status : 'UNKNOWN';
        throw new Error(`Transaction ${label} failed with status ${status}`);
    }
}

describe('Stellar OneSig — off-chain workflow', () => {
    let context: IntegrationTestContext;
    let tokenContractId: string;
    let recipientContractId: string;

    const sortedSigners = Array.from({ length: 20 }, () => Wallet.createRandom()).sort((a, b) =>
        compareAddresses(a.address, b.address),
    );

    /** Read an address's balance of the test token (parses the i128 return value). */
    async function getTokenBalance(address: string): Promise<bigint> {
        const result = await callContract(
            tokenContractId,
            'balance',
            [nativeToScVal(Address.fromString(address), { type: 'address' })],
            context.deployerKeypair,
            RPC_URL,
            NETWORK_PASSPHRASE,
        );
        const scVal = result.returnValue;
        if (!scVal || scVal.switch().name !== 'scvI128') return 0n;
        const i128 = scVal.i128();
        return BigInt(i128.lo().toString()) + (BigInt(i128.hi().toString()) << 64n);
    }

    /**
     * Run a multicall (several token transfers) through the off-chain workflow with the
     * given sender. The whole batch is a SINGLE execute_transaction self-call (one leaf),
     * with the transfers carried in its args — built by `createExecuteTransactionCall`.
     */
    async function runOffchainMultiTransfer(
        senderConfig: SenderConfig,
        amounts: bigint[],
    ): Promise<contract.SentTransaction<unknown>> {
        const transferArgs = (to: string, amount: bigint) => [
            nativeToScVal(Address.fromString(context.oneSigContractId), { type: 'address' }),
            nativeToScVal(Address.fromString(to), { type: 'address' }),
            nativeToScVal(amount, { type: 'i128' }),
        ];
        const innerCalls: Call[] = amounts.map((amount) => ({
            to: tokenContractId,
            func: 'transfer',
            args: transferArgs(recipientContractId, amount),
            sub_invocations: [],
        }));

        // Off-chain: one execute_transaction self-call wrapping all transfers -> one leaf.
        const stellarCall = createExecuteTransactionCall(context.oneSigContractId, innerCalls);
        const { merkleData, proof } = await buildSingleTxMerkleData(
            context,
            context.threshold,
            stellarCall,
        );

        // On-chain: replay that same StellarCall as the invocation. Its auth-entry root
        // invocation matches the signed leaf by construction (no separate typed binding).
        const assembledTx = await buildCallTransaction(context, stellarCall);

        return signAndSendOnesigTx(context, { merkleData, proof }, assembledTx, senderConfig);
    }

    beforeAll(async () => {
        const rpcServer = new rpc.Server(RPC_URL, { allowHttp: true });
        const horizonServer = new Horizon.Server(HORIZON_URL, { allowHttp: true });

        await waitForNetworkReady(rpcServer);

        const deployerKeypair = await generateFundedKeypair(rpcServer);
        const seed = arrayify(randomBytes(32));
        const oneSigId = 40161n; // Stellar chain ID
        const threshold = 2;

        const { client, contractId } = await deployOneSig(
            deployerKeypair,
            oneSigId,
            sortedSigners,
            threshold,
            seed,
            NETWORK_PASSPHRASE,
            RPC_URL,
        );

        context = {
            oneSigId,
            oneSigClient: client,
            oneSigContractId: contractId,
            deployerKeypair,
            seed,
            threshold,
            sortedSigners,
            rpcServer,
            horizonServer,
            networkPassphrase: NETWORK_PASSPHRASE,
        };

        // A second OneSig acts as the transfer recipient — a contract address can hold
        // SAC balances without a trustline, and it is not the asset issuer.
        const recipient = await deployOneSig(
            deployerKeypair,
            oneSigId,
            sortedSigners,
            threshold,
            seed,
            NETWORK_PASSPHRASE,
            RPC_URL,
        );
        recipientContractId = recipient.contractId;

        // Deploy a Stellar Asset Contract issued by the deployer and mint to the OneSig.
        const tokenAsset = new Asset('OFFCHN', deployerKeypair.publicKey());
        tokenContractId = await deployStellarAssetContract(
            tokenAsset,
            deployerKeypair,
            RPC_URL,
            NETWORK_PASSPHRASE,
        );
        await callContract(
            tokenContractId,
            'mint',
            [
                nativeToScVal(Address.fromString(contractId), { type: 'address' }),
                nativeToScVal(1_000_000_000_000n, { type: 'i128' }),
            ],
            deployerKeypair,
            RPC_URL,
            NETWORK_PASSPHRASE,
        );
    });

    describe('permissionless sender (executor_required = false)', () => {
        test('executes set_seed from known calls, built tree, signed root, and proof', async () => {
            // 1. Decide the call up front — off-chain input, not derived from simulation.
            const newSeed = Buffer.from(randomBytes(32));
            const call = createSetSeedCall(newSeed, context.oneSigContractId);

            // 2. Build the leaf/tree and have the threshold signers sign the root.
            const nonceBefore = BigInt((await context.oneSigClient.nonce()).result);
            const { merkleData, proof } = await buildSingleTxMerkleData(
                context,
                context.threshold,
                call,
            );

            // 3. Replay the same StellarCall as the on-chain invocation.
            const assembledTx = await buildCallTransaction(context, call);

            // 4. Execute directly with the pre-built proof + signatures.
            const sent = await signAndSendOnesigTx(context, { merkleData, proof }, assembledTx, {
                senderType: 'permissionless',
            });
            assertTxSucceeded(sent, 'off-chain set_seed');

            // 5. The seed changed on-chain and the nonce advanced by one.
            const onchainSeed = Buffer.from((await context.oneSigClient.seed()).result as Buffer);
            expect(onchainSeed.equals(newSeed)).toBe(true);
            const nonceAfter = BigInt((await context.oneSigClient.nonce()).result);
            expect(nonceAfter).toBe(nonceBefore + 1n);
        }, 60000);

        test('executes a multicall of two token transfers in one execute_transaction', async () => {
            const amounts = [30_000_000n, 20_000_000n];
            const total = amounts.reduce((a, b) => a + b, 0n);

            const oneSigBefore = await getTokenBalance(context.oneSigContractId);
            const recipientBefore = await getTokenBalance(recipientContractId);

            const sent = await runOffchainMultiTransfer(
                { senderType: 'permissionless' },
                amounts,
            );
            assertTxSucceeded(sent, 'off-chain permissionless multicall');

            expect(await getTokenBalance(context.oneSigContractId)).toBe(oneSigBefore - total);
            expect(await getTokenBalance(recipientContractId)).toBe(recipientBefore + total);
        }, 60000);
    });

    describe('executor & signer senders (executor_required = true)', () => {
        beforeAll(async () => {
            // Flip executor_required on. While it is still false this self-call can be
            // executed permissionlessly through the same off-chain workflow.
            const call = createSetExecutorRequiredCall(true, context.oneSigContractId);
            const { merkleData, proof } = await buildSingleTxMerkleData(
                context,
                context.threshold,
                call,
            );
            const tx = await buildCallTransaction(context, call);
            const sent = await signAndSendOnesigTx(context, { merkleData, proof }, tx, {
                senderType: 'permissionless',
            });
            assertTxSucceeded(sent, 'enable executor_required');

            expect((await context.oneSigClient.executor_required()).result).toBe(true);
        }, 60000);

        test('executor sender executes a multicall of token transfers', async () => {
            const amounts = [11_000_000n, 9_000_000n];
            const total = amounts.reduce((a, b) => a + b, 0n);

            const oneSigBefore = await getTokenBalance(context.oneSigContractId);
            const recipientBefore = await getTokenBalance(recipientContractId);

            // The deployer keypair is the OneSig's initial registered executor.
            const sent = await runOffchainMultiTransfer(
                { senderType: 'executor', executorKeypair: context.deployerKeypair },
                amounts,
            );
            assertTxSucceeded(sent, 'off-chain executor multicall');

            expect(await getTokenBalance(context.oneSigContractId)).toBe(oneSigBefore - total);
            expect(await getTokenBalance(recipientContractId)).toBe(recipientBefore + total);
        }, 60000);

        test('signer sender executes a multicall of token transfers', async () => {
            const amounts = [7_000_000n, 3_000_000n];
            const total = amounts.reduce((a, b) => a + b, 0n);

            const oneSigBefore = await getTokenBalance(context.oneSigContractId);
            const recipientBefore = await getTokenBalance(recipientContractId);

            // A registered signer acts as executor via the signer-as-executor flow;
            // delegate defaults to the deployer keypair (the Stellar tx submitter).
            const sent = await runOffchainMultiTransfer(
                { senderType: 'signer', signerWallet: context.sortedSigners[0] },
                amounts,
            );
            assertTxSucceeded(sent, 'off-chain signer multicall');

            expect(await getTokenBalance(context.oneSigContractId)).toBe(oneSigBefore - total);
            expect(await getTokenBalance(recipientContractId)).toBe(recipientBefore + total);
        }, 60000);
    });
});
