import {
    Address,
    Asset,
    BASE_FEE,
    contract,
    Horizon,
    Keypair,
    nativeToScVal,
    Operation,
    rpc,
    TransactionBuilder,
    xdr,
} from '@stellar/stellar-sdk';
import { randomBytes } from 'crypto';
import { Wallet } from 'ethers';
import { existsSync } from 'fs';
import { join } from 'path';
import { beforeAll, beforeEach, describe, expect, test } from 'vitest';

import { compareAddresses, encodeLeaf } from '@layerzerolabs/onesig-core';

import type { InvokerContractAuthEntry } from '../src/generated/index';
import {
    createSetSeedCall,
    createSetThresholdCall,
    StellarCall,
    stellarLeafGenerator,
} from '../src/index';
import { authEntryToRootCall, type ExecuteCallOptions, executeOnesigTx } from './onesigExecution';
import {
    arrayify,
    buildSingleTxMerkleData,
    callContract,
    deployContractFromHash,
    deployContractFromWasm,
    deployOneSig,
    deployStellarAssetContract,
    generateFundedKeypair,
    HORIZON_URL,
    IntegrationTestContext,
    NETWORK_PASSPHRASE,
    RPC_URL,
    uploadWasm,
    waitForNetworkReady,
} from './utils';

function assertTxSucceeded(sentTx: contract.SentTransaction<unknown>, contextLabel: string): void {
    const txResponse = sentTx.getTransactionResponse;
    if (!txResponse || txResponse.status !== rpc.Api.GetTransactionStatus.SUCCESS) {
        const status = txResponse ? txResponse.status : 'UNKNOWN';
        throw new Error(
            `Transaction ${contextLabel} failed with status ${status}. Response: ${JSON.stringify(txResponse)}`,
        );
    }
}

type TransactionResponseWithEvents =
    | rpc.Api.GetSuccessfulTransactionResponse
    | rpc.Api.GetFailedTransactionResponse;

function getTxEvents(sentTx: contract.SentTransaction<unknown>): xdr.ContractEvent[] {
    const txResponse = sentTx.getTransactionResponse;
    if (!txResponse || !('events' in txResponse)) {
        throw new Error('Transaction response missing or has no events');
    }
    const responseWithEvents = txResponse as TransactionResponseWithEvents;
    if (!responseWithEvents.events?.contractEventsXdr) {
        throw new Error('Transaction response has no contractEventsXdr');
    }
    return responseWithEvents.events.contractEventsXdr.flat();
}

function expectEventEmitted(sentTx: contract.SentTransaction<unknown>, eventName: string): void {
    const allEvents = getTxEvents(sentTx);
    const matchingEvents = allEvents.filter((event: xdr.ContractEvent) => {
        const topics = event.body().v0().topics();
        return topics && topics.length > 0 && topics[0].sym().toString() === eventName;
    });
    expect(matchingEvents.length).toBeGreaterThan(0);
}

/**
 * Manually encodes an InvokerContractAuthEntry::Contract(SubContractInvocation) as ScVal.
 * InvokerContractAuthEntry is a Soroban SDK XDR type (not contract-defined),
 * so the contract spec's nativeToScVal cannot serialize it.
 */
function buildInvokerContractAuthEntry(
    contractAddress: string,
    fnName: string,
    args: xdr.ScVal[],
    subInvocations: InvokerContractAuthEntry[],
): InvokerContractAuthEntry {
    const scMapEntry = (key: string, val: xdr.ScVal) =>
        new xdr.ScMapEntry({
            key: xdr.ScVal.scvSymbol(key),
            val,
        });

    // ContractContext { args, contract, fn_name } — fields alphabetically sorted
    const context = xdr.ScVal.scvMap([
        scMapEntry('args', xdr.ScVal.scvVec(args)),
        scMapEntry('contract', Address.fromString(contractAddress).toScVal()),
        scMapEntry('fn_name', xdr.ScVal.scvSymbol(fnName)),
    ]);

    // SubContractInvocation { context, sub_invocations }
    const subContractInvocation = xdr.ScVal.scvMap([
        scMapEntry('context', context),
        scMapEntry('sub_invocations', xdr.ScVal.scvVec(subInvocations)),
    ]);

    // InvokerContractAuthEntry::Contract(SubContractInvocation)
    return xdr.ScVal.scvVec([xdr.ScVal.scvSymbol('Contract'), subContractInvocation]);
}

/**
 * Manually encodes an InvokerContractAuthEntry::CreateContractWithCtorHostFn(...)
 * as ScVal. Used when the onesig needs to pre-authorize a contract deployment
 * performed by a factory contract on its behalf.
 */
function buildCreateContractWithCtorAuthEntry(
    wasmHash: Buffer,
    salt: Buffer,
    constructorArgs: xdr.ScVal[],
): InvokerContractAuthEntry {
    const scMapEntry = (key: string, val: xdr.ScVal) =>
        new xdr.ScMapEntry({
            key: xdr.ScVal.scvSymbol(key),
            val,
        });

    const executable = xdr.ScVal.scvVec([
        xdr.ScVal.scvSymbol('Wasm'),
        xdr.ScVal.scvBytes(wasmHash),
    ]);

    const contextMap = xdr.ScVal.scvMap([
        scMapEntry('constructor_args', xdr.ScVal.scvVec(constructorArgs)),
        scMapEntry('executable', executable),
        scMapEntry('salt', xdr.ScVal.scvBytes(salt)),
    ]);

    return xdr.ScVal.scvVec([xdr.ScVal.scvSymbol('CreateContractWithCtorHostFn'), contextMap]);
}

/**
 * Recursively converts a SorobanAuthorizedInvocation (XDR) to the ScVal
 * encoding of InvokerContractAuthEntry::Contract(SubContractInvocation).
 */
function sorobanInvocationToAuthEntryScVal(invocation: xdr.SorobanAuthorizedInvocation): xdr.ScVal {
    const fn = invocation.function();
    if (
        fn.switch() !== xdr.SorobanAuthorizedFunctionType.sorobanAuthorizedFunctionTypeContractFn()
    ) {
        throw new Error('Sub-invocation is not a contract function');
    }

    const contractFn = fn.contractFn();
    const contractAddress = Address.fromScAddress(contractFn.contractAddress());
    const fnName = contractFn.functionName().toString();
    const args = contractFn.args();

    const nestedSubInvocations = invocation.subInvocations().map(sorobanInvocationToAuthEntryScVal);

    const scMapEntry = (key: string, val: xdr.ScVal) =>
        new xdr.ScMapEntry({ key: xdr.ScVal.scvSymbol(key), val });

    const context = xdr.ScVal.scvMap([
        scMapEntry('args', xdr.ScVal.scvVec(args)),
        scMapEntry('contract', contractAddress.toScVal()),
        scMapEntry('fn_name', xdr.ScVal.scvSymbol(fnName)),
    ]);

    const subContractInvocation = xdr.ScVal.scvMap([
        scMapEntry('context', context),
        scMapEntry('sub_invocations', xdr.ScVal.scvVec(nestedSubInvocations)),
    ]);

    return xdr.ScVal.scvVec([xdr.ScVal.scvSymbol('Contract'), subContractInvocation]);
}

/**
 * Simulates a contract call and extracts the sub-invocations that the onesig
 * contract needs to pre-authorize.
 *
 * In the real execution flow, onesig invokes the target method directly
 * (via execute_transaction), which auto-satisfies the root-level require_auth.
 * Only nested calls (sub-invocations) need explicit pre-authorization via
 * InvokerContractAuthEntry. This function discovers those by simulating the
 * target call and extracting the auth tree for the onesig address.
 *
 * The simulation is run with the deployer as the transaction source (since
 * Stellar Account requires an Ed25519 public key, not a contract address).
 * The Soroban simulator auto-discovers all require_auth calls regardless of
 * the invoker, so we filter for the onesig address's auth entry and return
 * its rootInvocation.subInvocations.
 */
async function simulateSubInvocations(
    deployerKeypair: Keypair,
    onesigContractId: string,
    targetContract: string,
    functionName: string,
    args: xdr.ScVal[],
    rpcUrl: string,
    networkPassphrase: string,
): Promise<xdr.ScVal[]> {
    const server = new rpc.Server(rpcUrl, { allowHttp: true });
    const account = await server.getAccount(deployerKeypair.publicKey());

    const tx = new TransactionBuilder(account, {
        fee: BASE_FEE,
        networkPassphrase,
    })
        .addOperation(
            Operation.invokeContractFunction({
                contract: targetContract,
                function: functionName,
                args,
            }),
        )
        .setTimeout(30)
        .build();

    const simResult = await server.simulateTransaction(tx);
    if (rpc.Api.isSimulationError(simResult)) {
        throw new Error(`Simulation failed: ${simResult.error}`);
    }
    if (!rpc.Api.isSimulationSuccess(simResult)) {
        throw new Error('Simulation did not succeed');
    }

    const authEntries = simResult.result?.auth ?? [];

    for (const entry of authEntries) {
        const credentials = entry.credentials();
        if (credentials.switch() !== xdr.SorobanCredentialsType.sorobanCredentialsAddress()) {
            continue;
        }

        const credAddress = Address.fromScAddress(credentials.address().address());
        if (credAddress.toString() !== onesigContractId) {
            continue;
        }

        // The rootInvocation is the target call itself (auto-satisfied when onesig
        // invokes it directly). Only nested sub-invocations need pre-authorization.
        return entry.rootInvocation().subInvocations().map(sorobanInvocationToAuthEntryScVal);
    }

    return [];
}

async function expectTxToFail<T>(
    context: IntegrationTestContext,
    assembledTx: contract.AssembledTransaction<T>,
    options: ExecuteCallOptions & { expectedErrorSubstring?: string } = {},
) {
    const { expectedErrorSubstring, ...rest } = options;
    const expected = expectedErrorSubstring ?? 'Error(Contract';
    await expect(
        executeOnesigTx(context, assembledTx, { ...rest, skipResimulate: true }),
    ).rejects.toThrow(expected);
}

async function readContractState(context: IntegrationTestContext) {
    const [thresholdTx, signersTx, executorRequiredTx, executorsTx, seedTx] = await Promise.all([
        context.oneSigClient.threshold(),
        context.oneSigClient.get_signers(),
        context.oneSigClient.executor_required(),
        context.oneSigClient.get_executors(),
        context.oneSigClient.seed(),
    ]);
    return {
        threshold: Number(thresholdTx.result),
        signers: (signersTx.result as Buffer[]).map((buf) => buf.toString('hex')),
        executorRequired: Boolean(executorRequiredTx.result),
        executors: (executorsTx.result as Buffer[]).map((buf) => buf.toString('hex')),
        seed: Buffer.from(seedTx.result as Buffer),
    };
}

async function ensureThreshold(
    context: IntegrationTestContext,
    desired: number,
    currentThreshold: number,
) {
    if (currentThreshold === desired) {
        return;
    }
    const adminSigner = context.sortedSigners[0];
    const tx = await context.oneSigClient.set_threshold({ threshold: desired });
    await executeOnesigTx(context, tx, {
        signerCount: currentThreshold,
        senderType: 'signer',
        signerWallet: adminSigner,
    });
}

async function ensureSigners(context: IntegrationTestContext, currentSigners: string[]) {
    const desiredSignerMap = new Map(
        context.sortedSigners.map((wallet) => [wallet.address.slice(2).toLowerCase(), wallet]),
    );
    const signerCount = context.threshold;

    for (const signerHex of currentSigners) {
        if (!desiredSignerMap.has(signerHex)) {
            const tx = await context.oneSigClient.set_signer({
                signer: Buffer.from(signerHex, 'hex'),
                active: false,
            });
            await executeOnesigTx(context, tx, {
                signerCount,
                senderType: 'executor',
                executorKeypair: context.deployerKeypair,
            });
        }
    }

    for (const [signerHex, wallet] of desiredSignerMap.entries()) {
        if (!currentSigners.includes(signerHex)) {
            const tx = await context.oneSigClient.set_signer({
                signer: Buffer.from(wallet.address.slice(2), 'hex'),
                active: true,
            });
            await executeOnesigTx(context, tx, {
                signerCount,
                senderType: 'executor',
                executorKeypair: context.deployerKeypair,
            });
        }
    }
}

async function ensureSeed(context: IntegrationTestContext, currentSeed: Buffer) {
    const desiredSeed = Buffer.from(context.seed);
    if (currentSeed.equals(desiredSeed)) {
        return;
    }
    const adminSigner = context.sortedSigners[0];
    const tx = await context.oneSigClient.set_seed({ seed: desiredSeed });
    await executeOnesigTx(context, tx, { senderType: 'signer', signerWallet: adminSigner });
}

async function resetContractState(context: IntegrationTestContext) {
    const state = await readContractState(context);

    await ensureThreshold(context, context.threshold, state.threshold);
    await ensureSigners(context, state.signers);
    await ensureExecutorRequired(context, false, state.executorRequired);
    await ensureExecutors(context, state.executors);
    await ensureSeed(context, state.seed);
}

async function ensureExecutorRequired(
    context: IntegrationTestContext,
    desired: boolean,
    currentExecutorRequired?: boolean,
) {
    const current =
        currentExecutorRequired ?? Boolean((await context.oneSigClient.executor_required()).result);
    if (current === desired) {
        return;
    }
    const adminSigner = context.sortedSigners[0];
    const tx = await context.oneSigClient.set_executor_required({ required: desired });
    await executeOnesigTx(context, tx, { senderType: 'signer', signerWallet: adminSigner });
}

async function ensureExecutors(context: IntegrationTestContext, preReadExecutors?: string[]) {
    const adminSigner = context.sortedSigners[0];
    const desiredExecutorHex = Buffer.from(context.deployerKeypair.rawPublicKey()).toString('hex');
    const currentExecutors =
        preReadExecutors ??
        ((await context.oneSigClient.get_executors()).result as Buffer[]).map((buf) =>
            buf.toString('hex'),
        );

    for (const executorHex of currentExecutors) {
        if (executorHex !== desiredExecutorHex) {
            const tx = await context.oneSigClient.set_executor({
                executor: Buffer.from(executorHex, 'hex'),
                active: false,
            });
            await executeOnesigTx(context, tx, { senderType: 'signer', signerWallet: adminSigner });
        }
    }

    if (!currentExecutors.includes(desiredExecutorHex)) {
        const tx = await context.oneSigClient.set_executor({
            executor: Buffer.from(desiredExecutorHex, 'hex'),
            active: true,
        });
        await executeOnesigTx(context, tx, { senderType: 'signer', signerWallet: adminSigner });
    }
}

async function removeAllExecutors(context: IntegrationTestContext) {
    const adminSigner = context.sortedSigners[0];
    const executorsTx = await context.oneSigClient.get_executors();
    const currentExecutors = executorsTx.result as Buffer[];
    for (const executor of currentExecutors) {
        const tx = await context.oneSigClient.set_executor({ executor, active: false });
        await executeOnesigTx(context, tx, { senderType: 'signer', signerWallet: adminSigner });
    }
}

async function restoreDefaultExecutorState(context: IntegrationTestContext, signerWallet: Wallet) {
    const tx1 = await context.oneSigClient.set_executor_required({ required: false });
    await executeOnesigTx(context, tx1, { senderType: 'signer', signerWallet });

    const tx2 = await context.oneSigClient.set_executor({
        executor: Buffer.from(context.deployerKeypair.rawPublicKey()),
        active: true,
    });
    await executeOnesigTx(context, tx2, { senderType: 'signer', signerWallet });
}

describe('Stellar Onesig Integration Tests', () => {
    let context: IntegrationTestContext;
    let rpcServer: rpc.Server;
    let horizonServer: Horizon.Server;
    let fundedKeypairA: Keypair;
    let fundedKeypairB: Keypair;

    const sortedSigners = Array.from({ length: 20 }, () => Wallet.createRandom()).sort((a, b) => {
        return compareAddresses(a.address, b.address);
    });

    beforeAll(async () => {
        rpcServer = new rpc.Server(RPC_URL, { allowHttp: true });
        horizonServer = new Horizon.Server(HORIZON_URL, { allowHttp: true });

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

        // Pre-generate reusable funded keypairs (state is reset between Group C tests)
        [fundedKeypairA, fundedKeypairB] = await Promise.all([
            generateFundedKeypair(rpcServer),
            generateFundedKeypair(rpcServer),
        ]);
    });

    // =========================================================================
    // Group A: Read-only & revert tests — NO beforeEach reset
    // =========================================================================
    describe('Read-only & revert tests', () => {
        test('Deploy Contract: check constructor arguments', async () => {
            const [thresholdTx, signersTx, totalSignersTx, oneSigIdTx] = await Promise.all([
                context.oneSigClient.threshold(),
                context.oneSigClient.get_signers(),
                context.oneSigClient.total_signers(),
                context.oneSigClient.onesig_id(),
            ]);

            expect(Number(thresholdTx.result)).toBe(context.threshold);

            const signers = signersTx.result as Buffer[];
            expect(signers.length).toBe(context.sortedSigners.length);

            expect(Number(totalSignersTx.result)).toBe(context.sortedSigners.length);

            expect(BigInt(oneSigIdTx.result)).toBe(context.oneSigId);
        });

        test('test encode leaf with single call', async () => {
            const nonceTx = await context.oneSigClient.nonce();
            const nonce = BigInt(nonceTx.result);

            const call: StellarCall = createSetSeedCall(
                Buffer.from(randomBytes(32)),
                context.oneSigContractId,
            );
            const stellarGen = stellarLeafGenerator([
                {
                    nonce,
                    oneSigId: context.oneSigId,
                    targetOneSigAddress: context.oneSigContractId,
                    calls: [call],
                },
            ]);
            const leaf = encodeLeaf(stellarGen, 0);

            const expectedLeaf = await context.oneSigClient
                .encode_leaf({
                    nonce,
                    call: {
                        to: call.contractAddress,
                        func: call.functionName,
                        args: call.args,
                        sub_invocations: [],
                    },
                })
                .then((result) => {
                    const contractResult = result.result as Buffer;
                    return `0x${contractResult.toString('hex')}`.toLowerCase();
                });

            const leafHex = leaf.toLowerCase();

            expect(leafHex).toBe(expectedLeaf);
        });

        test('test verify signatures', async () => {
            const nonceTx = await context.oneSigClient.nonce();
            const currentNonce = BigInt(nonceTx.result);

            const call = createSetSeedCall(Buffer.from(randomBytes(32)), context.oneSigContractId);
            const { merkleData } = await buildSingleTxMerkleData(
                context,
                context.threshold,
                call,
                currentNonce,
            );

            const verifyTx = await context.oneSigClient.verify_signatures({
                digest: merkleData.digest,
                signatures: merkleData.signatures,
            });
            expect(() => verifyTx.result).not.toThrow();
        });

        test('should fail with expired merkle root', async () => {
            const tx = await context.oneSigClient.set_seed({
                seed: Buffer.from(randomBytes(32)),
            });
            const expiredTimestamp = BigInt(Math.floor(Date.now() / 1000) - 3600); // 1 hour ago
            await expectTxToFail(context, tx, {
                expectedErrorSubstring: 'Error(Auth, InvalidAction)',
                merkleDataOverride: () => ({ merkleData: { expiry: expiredTimestamp } }),
            });
        });

        test('should fail with invalid merkle proof', async () => {
            const tx = await context.oneSigClient.set_seed({
                seed: Buffer.from(randomBytes(32)),
            });
            const invalidProof = [Buffer.from(randomBytes(32)), Buffer.from(randomBytes(32))];
            await expectTxToFail(context, tx, {
                expectedErrorSubstring: 'Error(Auth, InvalidAction)',
                merkleDataOverride: () => ({ proof: invalidProof }),
            });
        });

        test('should fail with insufficient signatures', async () => {
            const tx = await context.oneSigClient.set_seed({
                seed: Buffer.from(randomBytes(32)),
            });
            await expectTxToFail(context, tx, {
                signerCount: 1,
                expectedErrorSubstring: 'Error(Auth, InvalidAction)',
            });
        });

        test('should fail with invalid signature format (wrong length)', async () => {
            const tx = await context.oneSigClient.set_seed({
                seed: Buffer.from(randomBytes(32)),
            });
            const invalidSignatures = [Buffer.from(randomBytes(32)), Buffer.from(randomBytes(32))];
            await expectTxToFail(context, tx, {
                expectedErrorSubstring: 'expected 65 bytes',
                merkleDataOverride: () => ({ merkleData: { signatures: invalidSignatures } }),
            });
        });

        test('should fail with unauthorized signer', async () => {
            const tx = await context.oneSigClient.set_seed({
                seed: Buffer.from(randomBytes(32)),
            });
            const unauthorizedSigners = [Wallet.createRandom(), Wallet.createRandom()].sort(
                (a, b) => {
                    const addrA = BigInt(a.address);
                    const addrB = BigInt(b.address);
                    return addrA < addrB ? -1 : addrA > addrB ? 1 : 0;
                },
            );

            await expectTxToFail(context, tx, {
                expectedErrorSubstring: 'Error(Auth, InvalidAction)',
                merkleDataOverride: async (data) => {
                    const invalidSignatures = await Promise.all(
                        unauthorizedSigners.map(async (signer) => {
                            const sig = await signer._signTypedData(
                                {
                                    name: 'OneSig',
                                    version: '0.0.1',
                                    chainId: 1,
                                    verifyingContract: '0x000000000000000000000000000000000000dEaD',
                                },
                                {
                                    SignMerkleRoot: [
                                        { name: 'seed', type: 'bytes32' },
                                        { name: 'merkleRoot', type: 'bytes32' },
                                        { name: 'expiry', type: 'uint256' },
                                    ],
                                },
                                {
                                    seed: context.seed,
                                    expiry: Number(data.merkleData.expiry),
                                    merkleRoot: data.merkleData.merkleRoot,
                                },
                            );
                            return Buffer.from(sig.slice(2), 'hex');
                        }),
                    );
                    return { merkleData: { signatures: invalidSignatures } };
                },
            });
        });

        test('should fail with unsorted signatures', async () => {
            const tx = await context.oneSigClient.set_seed({
                seed: Buffer.from(randomBytes(32)),
            });
            await expectTxToFail(context, tx, {
                expectedErrorSubstring: 'Error(Auth, InvalidAction)',
                merkleDataOverride: (data) => ({
                    merkleData: { signatures: [...data.merkleData.signatures].reverse() },
                }),
            });
        });

        test('should fail to add a duplicate signer', async () => {
            const existingSigner = context.sortedSigners[0];
            const signerBytes = Buffer.from(existingSigner.address.slice(2), 'hex');

            const tx = await context.oneSigClient.set_signer({
                signer: signerBytes,
                active: true,
            });
            await expectTxToFail(context, tx, {
                expectedErrorSubstring: 'Error(Contract, #1064)', //  MultisigError::SignerAlreadyExists
            });
        });

        test('should fail to remove a non-existent signer', async () => {
            const nonExistentWallet = Wallet.createRandom();
            const signerBytes = Buffer.from(nonExistentWallet.address.slice(2), 'hex');

            const tx = await context.oneSigClient.set_signer({
                signer: signerBytes,
                active: false,
            });
            await expectTxToFail(context, tx, {
                expectedErrorSubstring: 'Error(Contract, #1065)', //  MultisigError::SignerNotFound
            });
        });

        test('should fail to add invalid signer (zero address)', async () => {
            const zeroSigner = Buffer.alloc(20, 0);

            const tx = await context.oneSigClient.set_signer({
                signer: zeroSigner,
                active: true,
            });
            await expectTxToFail(context, tx, {
                expectedErrorSubstring: 'Error(Contract, #1062)', // MultisigError::InvalidSigner
            });
        });

        test('should fail to set threshold to zero', async () => {
            const tx = await context.oneSigClient.set_threshold({ threshold: 0 });
            await expectTxToFail(context, tx, {
                expectedErrorSubstring: 'Error(Contract, #1068)', // MultisigError::ZeroThreshold
            });
        });

        test('should fail to set threshold higher than number of signers', async () => {
            const totalSignersTx = await context.oneSigClient.total_signers();
            const numSigners = Number(totalSignersTx.result);

            const tx = await context.oneSigClient.set_threshold({ threshold: numSigners + 1 });
            await expectTxToFail(context, tx, {
                expectedErrorSubstring: 'Error(Contract, #1066)', // MultisigError::TotalSignersLessThanThreshold
            });
        });

        test('test verify_n_signatures with custom threshold', async () => {
            const nonceTx = await context.oneSigClient.nonce();
            const currentNonce = BigInt(nonceTx.result);

            const call = createSetSeedCall(Buffer.from(randomBytes(32)), context.oneSigContractId);

            const customThreshold = Math.min(context.sortedSigners.length, 5);
            const { merkleData } = await buildSingleTxMerkleData(
                context,
                customThreshold,
                call,
                currentNonce,
            );
            const { signatures, digest } = merkleData;

            const lowerThreshold = 2;
            const verifyTx = await context.oneSigClient.verify_n_signatures({
                digest,
                signatures,
                threshold: lowerThreshold,
            });
            expect(() => verifyTx.result).not.toThrow();

            const verifyTx2 = await context.oneSigClient.verify_n_signatures({
                digest,
                signatures,
                threshold: customThreshold,
            });
            expect(() => verifyTx2.result).not.toThrow();
        });
    });

    // =========================================================================
    // Group B: Self-restoring tests — NO beforeEach reset
    // =========================================================================
    describe('Self-restoring tests', () => {
        test('test set threshold', async () => {
            const newThreshold = 3;
            const tx = await context.oneSigClient.set_threshold({ threshold: newThreshold });
            const sentTx = await executeOnesigTx(context, tx);

            assertTxSucceeded(sentTx, 'set threshold');

            const thresholdTx = await context.oneSigClient.threshold();
            expect(Number(thresholdTx.result)).toBe(newThreshold);

            expectEventEmitted(sentTx, 'threshold_set');

            // Reset threshold back
            const resetTx = await context.oneSigClient.set_threshold({
                threshold: context.threshold,
            });
            await executeOnesigTx(context, resetTx, { signerCount: newThreshold });
        });

        test('test set executor required', async () => {
            const executorKey = Buffer.from(fundedKeypairA.rawPublicKey());

            // Add executor first
            const addTx = await context.oneSigClient.set_executor({
                executor: executorKey,
                active: true,
            });
            const sentAddTx = await executeOnesigTx(context, addTx, {
                senderType: 'executor',
                executorKeypair: context.deployerKeypair,
            });

            assertTxSucceeded(sentAddTx, 'set executor required (add executor)');

            // Set executor required
            const reqTx = await context.oneSigClient.set_executor_required({ required: true });
            const sentReqTx = await executeOnesigTx(context, reqTx, {
                senderType: 'executor',
                executorKeypair: context.deployerKeypair,
            });

            assertTxSucceeded(sentReqTx, 'set executor required (set required)');

            const executorRequiredTx = await context.oneSigClient.executor_required();
            expect(executorRequiredTx.result).toBe(true);

            expectEventEmitted(sentReqTx, 'executor_required_set');

            // Reset executor required
            const resetTx = await context.oneSigClient.set_executor_required({ required: false });
            await executeOnesigTx(context, resetTx, { executorKeypair: fundedKeypairA });

            // Remove added executor to leave clean state
            const removeExecTx = await context.oneSigClient.set_executor({
                executor: executorKey,
                active: false,
            });
            await executeOnesigTx(context, removeExecTx, {
                senderType: 'executor',
                executorKeypair: context.deployerKeypair,
            });
        });

        test('signer can execute transaction when executor required', async () => {
            const signerWallet = context.sortedSigners[0];

            // Disable executor requirement and remove all executors
            await ensureExecutorRequired(context, false);
            await removeAllExecutors(context);

            try {
                // Enable executor requirement using signer auth
                const reqTx = await context.oneSigClient.set_executor_required({ required: true });
                await executeOnesigTx(context, reqTx, { senderType: 'signer', signerWallet });

                const newSeed = Buffer.from(randomBytes(32));
                const seedTx = await context.oneSigClient.set_seed({ seed: newSeed });
                const sentTx = await executeOnesigTx(context, seedTx, {
                    senderType: 'signer',
                    signerWallet,
                });

                assertTxSucceeded(sentTx, 'signer execute transaction');
                const seedResult = await context.oneSigClient.seed();
                expect(Buffer.from(seedResult.result)).toEqual(newSeed);
            } finally {
                await restoreDefaultExecutorState(context, signerWallet);
            }
        });

        test('non-signer cannot execute when executor required', async () => {
            await ensureExecutorRequired(context, false);
            await removeAllExecutors(context);

            const signerWallet = context.sortedSigners[0];
            try {
                const reqTx = await context.oneSigClient.set_executor_required({ required: true });
                await executeOnesigTx(context, reqTx, { senderType: 'signer', signerWallet });

                const unauthorizedSigner = Wallet.createRandom();
                const seedTx = await context.oneSigClient.set_seed({
                    seed: Buffer.from(randomBytes(32)),
                });
                await expectTxToFail(context, seedTx, {
                    senderType: 'signer',
                    signerWallet: unauthorizedSigner,
                    expectedErrorSubstring: 'Error(Auth, InvalidAction)',
                });
            } finally {
                await restoreDefaultExecutorState(context, signerWallet);
            }
        });

        test('expired signer execution proof is rejected', async () => {
            await ensureExecutorRequired(context, false);
            await removeAllExecutors(context);

            const signerWallet = context.sortedSigners[0];
            try {
                const reqTx = await context.oneSigClient.set_executor_required({ required: true });
                await executeOnesigTx(context, reqTx, { senderType: 'signer', signerWallet });

                // Signer produces a proof with an expiry already in the past — the
                // contract must reject it via SignerExecutionProofExpired before recovering
                // the signer key. Confirms the proof `expiry` flows end-to-end.
                const seedTx = await context.oneSigClient.set_seed({
                    seed: Buffer.from(randomBytes(32)),
                });
                await expectTxToFail(context, seedTx, {
                    senderType: 'signer',
                    signerWallet,
                    expiryOverride: BigInt(Math.floor(Date.now() / 1000) - 1),
                });
            } finally {
                await restoreDefaultExecutorState(context, signerWallet);
            }
        });

        test('can execute transaction for signer when executor required', async () => {
            const signerWallet = context.sortedSigners[0];
            const signerBytes = Buffer.from(signerWallet.address.slice(2), 'hex');

            await ensureExecutorRequired(context, false);
            await removeAllExecutors(context);

            try {
                const reqTx = await context.oneSigClient.set_executor_required({ required: true });
                await executeOnesigTx(context, reqTx, { senderType: 'signer', signerWallet });

                const canExecuteTx = await context.oneSigClient.can_execute_transaction({
                    sender: { tag: 'Signer', values: [signerBytes] },
                });
                expect(canExecuteTx.result).toBe(true);
            } finally {
                await restoreDefaultExecutorState(context, signerWallet);
            }
        });

        test('test execute multiple sequential calls', async () => {
            const newSeed = Buffer.from(randomBytes(32));
            const newThreshold = 3;

            const seedTx = await context.oneSigClient.set_seed({ seed: newSeed });
            const sentSeedTx = await executeOnesigTx(context, seedTx);
            assertTxSucceeded(sentSeedTx, 'set seed');
            expectEventEmitted(sentSeedTx, 'seed_set');

            const thresholdTx = await context.oneSigClient.set_threshold({
                threshold: newThreshold,
            });
            const sentThresholdTx = await executeOnesigTx(context, thresholdTx);
            assertTxSucceeded(sentThresholdTx, 'set threshold');
            expectEventEmitted(sentThresholdTx, 'threshold_set');

            const seedResult = await context.oneSigClient.seed();
            expect(Buffer.from(seedResult.result)).toEqual(newSeed);

            const thresholdResult = await context.oneSigClient.threshold();
            expect(Number(thresholdResult.result)).toBe(newThreshold);

            // Reset threshold
            const resetTx = await context.oneSigClient.set_threshold({
                threshold: context.threshold,
            });
            await executeOnesigTx(context, resetTx, { signerCount: newThreshold });
        });
    });

    // =========================================================================
    // Group C1: Simple write tests — NO beforeEach reset
    // These only change seed/nonce which buildSingleTxMerkleData always reads
    // from chain, so they work regardless of prior state.
    // =========================================================================
    describe('Simple write tests', () => {
        test('test verify merkle root', async () => {
            const tx = await context.oneSigClient.set_seed({
                seed: Buffer.from(randomBytes(32)),
            });
            const sentTx = await executeOnesigTx(context, tx);
            assertTxSucceeded(sentTx, 'verify merkle root');
        });

        test('test execute transaction', async () => {
            const tx = await context.oneSigClient.set_seed({
                seed: Buffer.from(randomBytes(32)),
            });
            const sentTx = await executeOnesigTx(context, tx);
            assertTxSucceeded(sentTx, 'execute transaction');
        });

        test('test set seed', async () => {
            const newSeed = Buffer.from(randomBytes(32));
            const tx = await context.oneSigClient.set_seed({ seed: newSeed });
            const sentTx = await executeOnesigTx(context, tx);

            assertTxSucceeded(sentTx, 'set seed');

            const seedTx = await context.oneSigClient.seed();
            const seedBuffer = Buffer.from(seedTx.result);
            expect(seedBuffer).toEqual(newSeed);

            expectEventEmitted(sentTx, 'seed_set');
        });

        test('test nonce increment', async () => {
            const initialNonceTx = await context.oneSigClient.nonce();
            const initialNonce = BigInt(initialNonceTx.result);

            const tx = await context.oneSigClient.set_seed({
                seed: Buffer.from(randomBytes(32)),
            });
            const sentTx = await executeOnesigTx(context, tx);

            assertTxSucceeded(sentTx, 'nonce increment');

            const newNonceTx = await context.oneSigClient.nonce();
            const newNonce = BigInt(newNonceTx.result);
            expect(newNonce).toBe(initialNonce + 1n);

            expectEventEmitted(sentTx, 'transaction_executed');
        });
    });

    // =========================================================================
    // Group C2: State-mutating tests — WITH beforeEach reset
    // =========================================================================
    describe('State-mutating tests', () => {
        beforeEach(async () => {
            if (context) {
                await resetContractState(context);
            }
        });

        test('test set signer', async () => {
            const newSigner = Wallet.createRandom();
            const signerBytes = Buffer.from(newSigner.address.slice(2), 'hex');

            const tx = await context.oneSigClient.set_signer({
                signer: signerBytes,
                active: true,
            });
            const sentTx = await executeOnesigTx(context, tx);

            assertTxSucceeded(sentTx, 'set signer');

            const isSignerTx = await context.oneSigClient.is_signer({ signer: signerBytes });
            expect(isSignerTx.result).toBe(true);

            expectEventEmitted(sentTx, 'signer_set');
        });

        test('should fail with wrong nonce in proof', async () => {
            const nonceTx = await context.oneSigClient.nonce();
            const currentNonce = BigInt(nonceTx.result);

            const call = createSetSeedCall(Buffer.from(randomBytes(32)), context.oneSigContractId);
            const customPackage = await buildSingleTxMerkleData(
                context,
                context.threshold,
                call,
                currentNonce,
            );

            // Execute a dummy tx to increment nonce
            const dummyTx = await context.oneSigClient.set_seed({
                seed: Buffer.from(randomBytes(32)),
            });
            await executeOnesigTx(context, dummyTx, { nonce: currentNonce });

            // Now try with stale merkle data
            const tx = await context.oneSigClient.set_seed({
                seed: Buffer.from(randomBytes(32)),
            });
            await expectTxToFail(context, tx, {
                expectedErrorSubstring: 'Error(Auth, InvalidAction)',
                customMerkleData: customPackage,
            });
        });

        test('should fail when seed changes after signing', async () => {
            const nonceTx = await context.oneSigClient.nonce();
            const currentNonce = BigInt(nonceTx.result);

            const call = createSetThresholdCall(3, context.oneSigContractId);
            const originalMerkleData = await buildSingleTxMerkleData(
                context,
                context.threshold,
                call,
                currentNonce,
            );

            // Change seed
            const seedTx = await context.oneSigClient.set_seed({
                seed: Buffer.from(randomBytes(32)),
            });
            await executeOnesigTx(context, seedTx);

            // Try with old merkle data (signed with old seed)
            const tx = await context.oneSigClient.set_threshold({ threshold: 3 });
            await expectTxToFail(context, tx, {
                expectedErrorSubstring: 'Error(Auth, InvalidAction)',
                customMerkleData: originalMerkleData,
            });
        });

        test('should fail to remove a signer if it would violate threshold', async () => {
            const totalSignersTx = await context.oneSigClient.total_signers();
            const numSigners = Number(totalSignersTx.result);

            // Set threshold to max signers first
            const thresholdTx = await context.oneSigClient.set_threshold({
                threshold: numSigners,
            });
            await executeOnesigTx(context, thresholdTx);

            const signerToRemove = context.sortedSigners[0];
            const signerBytes = Buffer.from(signerToRemove.address.slice(2), 'hex');

            const tx = await context.oneSigClient.set_signer({
                signer: signerBytes,
                active: false,
            });
            await expectTxToFail(context, tx, {
                signerCount: numSigners,
                expectedErrorSubstring: 'Error(Contract, #1066)', // MultisigError::TotalSignersLessThanThreshold
            });
        });

        test('test set executor', async () => {
            const executorKey = Buffer.from(fundedKeypairA.rawPublicKey());

            const tx = await context.oneSigClient.set_executor({
                executor: executorKey,
                active: true,
            });
            const sentTx = await executeOnesigTx(context, tx);

            assertTxSucceeded(sentTx, 'set executor');

            const isExecutorTx = await context.oneSigClient.is_executor({
                executor: executorKey,
            });
            expect(isExecutorTx.result).toBe(true);

            expectEventEmitted(sentTx, 'executor_set');
        });

        test('test can execute transaction', async () => {
            const executorKey = Buffer.from(fundedKeypairA.rawPublicKey());

            const tx = await context.oneSigClient.set_executor({
                executor: executorKey,
                active: true,
            });
            const sentTx = await executeOnesigTx(context, tx);

            assertTxSucceeded(sentTx, 'can execute transaction');

            const canExecuteTx = await context.oneSigClient.can_execute_transaction({
                sender: {
                    tag: 'Executor',
                    values: [executorKey],
                },
            });
            expect(canExecuteTx.result).toBe(true);
        });

        test('cannot execute transaction for non-executor when executor required', async () => {
            await ensureExecutorRequired(context, true);

            let nonExecutor = fundedKeypairA;
            const defaultExecutorHex = Buffer.from(context.deployerKeypair.rawPublicKey()).toString(
                'hex',
            );
            if (Buffer.from(nonExecutor.rawPublicKey()).toString('hex') === defaultExecutorHex) {
                nonExecutor = fundedKeypairB;
            }

            const canExecuteTx = await context.oneSigClient.can_execute_transaction({
                sender: {
                    tag: 'Executor',
                    values: [Buffer.from(nonExecutor.rawPublicKey())],
                },
            });
            expect(canExecuteTx.result).toBe(false);
        });

        test('cannot execute transaction for non-signer when executor required', async () => {
            await ensureExecutorRequired(context, true);

            const nonSigner = Wallet.createRandom();
            const nonSignerBytes = Buffer.from(nonSigner.address.slice(2), 'hex');
            const canExecuteTx = await context.oneSigClient.can_execute_transaction({
                sender: {
                    tag: 'Signer',
                    values: [nonSignerBytes],
                },
            });
            expect(canExecuteTx.result).toBe(false);
        });

        test('should fail to add a duplicate executor', async () => {
            const executorKey = Buffer.from(fundedKeypairA.rawPublicKey());

            // Add executor first
            const addTx = await context.oneSigClient.set_executor({
                executor: executorKey,
                active: true,
            });
            await executeOnesigTx(context, addTx, {
                senderType: 'executor',
                executorKeypair: context.deployerKeypair,
            });

            // Try to add same executor again
            const dupTx = await context.oneSigClient.set_executor({
                executor: executorKey,
                active: true,
            });
            await expectTxToFail(context, dupTx, {
                expectedErrorSubstring: 'Error(Contract, #1)', // OneSigError::ExecutorAlreadyExists
                senderType: 'executor',
                executorKeypair: context.deployerKeypair,
            });
        });

        test('should fail to remove a non-existent executor', async () => {
            const nonExistentExecutorKey = Buffer.from(fundedKeypairA.rawPublicKey());

            const tx = await context.oneSigClient.set_executor({
                executor: nonExistentExecutorKey,
                active: false,
            });
            await expectTxToFail(context, tx, {
                expectedErrorSubstring: 'Error(Contract, #3)', // OneSigError::ExecutorNotFound
                senderType: 'executor',
                executorKeypair: context.deployerKeypair,
            });
        });

        test('can remove last executor when executor_required is true', async () => {
            const executorKey = Buffer.from(fundedKeypairA.rawPublicKey());
            const adminSigner = context.sortedSigners[0];

            // Add new executor
            const addTx = await context.oneSigClient.set_executor({
                executor: executorKey,
                active: true,
            });
            await executeOnesigTx(context, addTx, {
                senderType: 'executor',
                executorKeypair: context.deployerKeypair,
            });

            // Remove default executor
            const defaultExecutor = Buffer.from(context.deployerKeypair.rawPublicKey());
            const removeTx = await context.oneSigClient.set_executor({
                executor: defaultExecutor,
                active: false,
            });
            await executeOnesigTx(context, removeTx, {
                senderType: 'signer',
                signerWallet: adminSigner,
            });

            // Enable executor required
            const reqTx = await context.oneSigClient.set_executor_required({ required: true });
            await executeOnesigTx(context, reqTx, {
                senderType: 'signer',
                signerWallet: adminSigner,
            });

            // Remove last executor (should work - signer can still execute)
            const removalTx = await context.oneSigClient.set_executor({
                executor: executorKey,
                active: false,
            });
            const sentRemovalTx = await executeOnesigTx(context, removalTx, {
                senderType: 'signer',
                signerWallet: adminSigner,
            });

            assertTxSucceeded(sentRemovalTx, 'remove last executor');
            const executorsAfter = await context.oneSigClient.get_executors();
            expect((executorsAfter.result as Buffer[]).length).toBe(0);
        });

        test('should fail when replaying the same merkle proof', async () => {
            const nonceTx = await context.oneSigClient.nonce();
            const currentNonce = BigInt(nonceTx.result);

            // Use the same seed for merkle data and actual transactions
            const seed = Buffer.from(randomBytes(32));
            const call = createSetSeedCall(seed, context.oneSigContractId);
            const merklePackage = await buildSingleTxMerkleData(
                context,
                context.threshold,
                call,
                currentNonce,
            );

            // First tx with matching seed succeeds
            const tx1 = await context.oneSigClient.set_seed({ seed });
            await executeOnesigTx(context, tx1, {
                nonce: currentNonce,
                senderType: 'permissionless',
                customMerkleData: merklePackage,
            });

            // Try to replay with the same merkle proof (should fail - nonce already consumed)
            const tx2 = await context.oneSigClient.set_seed({ seed });
            await expectTxToFail(context, tx2, {
                expectedErrorSubstring: 'Error(Auth, InvalidAction)',
                senderType: 'permissionless',
                customMerkleData: merklePackage,
            });
        });

        test('should fail with invalid executor signature when executor_required is true', async () => {
            const executorKey = Buffer.from(fundedKeypairA.rawPublicKey());

            // Add executor
            const addTx = await context.oneSigClient.set_executor({
                executor: executorKey,
                active: true,
            });
            await executeOnesigTx(context, addTx, {
                senderType: 'executor',
                executorKeypair: context.deployerKeypair,
            });

            // Enable executor required
            const reqTx = await context.oneSigClient.set_executor_required({ required: true });
            await executeOnesigTx(context, reqTx, {
                senderType: 'executor',
                executorKeypair: context.deployerKeypair,
            });

            // Try with wrong executor
            const wrongExecutor = fundedKeypairB;
            const tx = await context.oneSigClient.set_seed({
                seed: Buffer.from(randomBytes(32)),
            });
            await expectTxToFail(context, tx, {
                executorKeypair: wrongExecutor,
                senderType: 'executor',
                expectedErrorSubstring: 'Error(Auth, InvalidAction)',
            });
        });

        // =================================================================
        // Multi-Call Integration Tests (Vault + Token Transfer)
        // =================================================================
        describe('Multi-Call Tests', () => {
            let vaultContractId: string;
            let tokenContractId: string;
            let tokenAsset: Asset;

            beforeAll(async () => {
                // Deploy mock vault contract (reusing existing OneSig from parent context)
                const vaultWasmPath = join(
                    __dirname,
                    '../../../contracts/stellar/target/wasm32v1-none/release/mock_vault.wasm',
                );
                if (!existsSync(vaultWasmPath)) {
                    throw new Error(
                        `Mock vault WASM not found at: ${vaultWasmPath}. Run 'pnpm build:mocks' first.`,
                    );
                }

                // Deploy vault without constructor args (will initialize later)
                vaultContractId = await deployContractFromWasm(
                    vaultWasmPath,
                    [],
                    context.deployerKeypair,
                    RPC_URL,
                    NETWORK_PASSPHRASE,
                );

                // Create a custom asset for testing
                tokenAsset = new Asset('TESTTKN', context.deployerKeypair.publicKey());

                // Deploy Stellar Asset Contract for the token
                tokenContractId = await deployStellarAssetContract(
                    tokenAsset,
                    context.deployerKeypair,
                    RPC_URL,
                    NETWORK_PASSPHRASE,
                );

                // Initialize vault with token address
                await callContract(
                    vaultContractId,
                    'initialize',
                    [nativeToScVal(Address.fromString(tokenContractId), { type: 'address' })],
                    context.deployerKeypair,
                    RPC_URL,
                    NETWORK_PASSPHRASE,
                );

                // Mint tokens to the OneSig contract
                await callContract(
                    tokenContractId,
                    'mint',
                    [
                        nativeToScVal(Address.fromString(context.oneSigContractId), {
                            type: 'address',
                        }),
                        nativeToScVal(BigInt(1_000_000_000_000), { type: 'i128' }),
                    ],
                    context.deployerKeypair,
                    RPC_URL,
                    NETWORK_PASSPHRASE,
                );
            }, 60000);

            test('should execute two token transfers through a single execute_transaction call', async () => {
                // The contract supports exactly one self-call auth context per leaf.
                // execute_transaction IS that single self-call, and it can carry any number
                // of external calls in its `calls` argument. The external calls do not
                // themselves require OneSig auth separately — the runtime authorizes them
                // because the OneSig contract is the direct invoker.
                //
                // We use the vault contract as recipient for both transfers because it is a
                // contract address (no trustline needed for SAC) and is not the asset issuer
                // (whose balance is always i64::MAX).
                const transferAmount1 = BigInt(30_000_000);
                const transferAmount2 = BigInt(20_000_000);
                const totalTransfer = transferAmount1 + transferAmount2;

                async function getTokenBalance(address: string): Promise<bigint> {
                    const result = await callContract(
                        tokenContractId,
                        'balance',
                        [nativeToScVal(Address.fromString(address), { type: 'address' })],
                        context.deployerKeypair,
                        RPC_URL,
                        NETWORK_PASSPHRASE,
                    );
                    if (!result.returnValue) return BigInt(0);
                    const scVal = result.returnValue;
                    if (scVal.switch().name === 'scvI128') {
                        const i128 = scVal.i128();
                        return BigInt(i128.lo().toString()) + (BigInt(i128.hi().toString()) << 64n);
                    }
                    return BigInt(0);
                }

                // 1. Get initial balances
                const oneSigBalanceBefore = await getTokenBalance(context.oneSigContractId);
                const vaultBalanceBefore = await getTokenBalance(vaultContractId);

                // 2. Build execute_transaction with 2 transfers.
                //    Both token.transfer calls are executed by the OneSig contract itself,
                //    so they are authorized by the single execute_transaction auth context.
                const transferArg = (to: string, amount: bigint) => [
                    nativeToScVal(Address.fromString(context.oneSigContractId), {
                        type: 'address',
                    }),
                    nativeToScVal(Address.fromString(to), { type: 'address' }),
                    nativeToScVal(amount, { type: 'i128' }),
                ];

                const assembledTx = await context.oneSigClient.execute_transaction({
                    calls: [
                        {
                            to: tokenContractId,
                            func: 'transfer',
                            args: transferArg(vaultContractId, transferAmount1),
                            sub_invocations: [],
                        },
                        {
                            to: tokenContractId,
                            func: 'transfer',
                            args: transferArg(vaultContractId, transferAmount2),
                            sub_invocations: [],
                        },
                    ],
                });

                // 3. Verify the auth entry root is a single self-call to execute_transaction
                const simulation = assembledTx.simulation;
                const authEntries =
                    (simulation as { result?: { auth?: xdr.SorobanAuthorizationEntry[] } })?.result
                        ?.auth ?? [];
                expect(authEntries.length).toBeGreaterThan(0);

                const rootCall = authEntryToRootCall(authEntries[0]);
                expect(rootCall.contractAddress).toBe(context.oneSigContractId);
                expect(rootCall.functionName).toBe('execute_transaction');

                // 4. Execute through OneSig
                const result = await executeOnesigTx(
                    context,
                    assembledTx as contract.AssembledTransaction<unknown>,
                    { senderType: 'permissionless' },
                );
                assertTxSucceeded(result, 'two token transfers via execute_transaction');

                // 5. Verify both transfers landed correctly
                const oneSigBalanceAfter = await getTokenBalance(context.oneSigContractId);
                const vaultBalanceAfter = await getTokenBalance(vaultContractId);
                expect(oneSigBalanceAfter).toBe(oneSigBalanceBefore - totalTransfer);
                expect(vaultBalanceAfter).toBe(vaultBalanceBefore + totalTransfer);
            }, 60000);

            test('should execute vault deposit with sub_invocations for nested token transfer', async () => {
                const depositAmount = BigInt(50_000_000);

                async function getTokenBalance(address: string): Promise<bigint> {
                    const result = await callContract(
                        tokenContractId,
                        'balance',
                        [nativeToScVal(Address.fromString(address), { type: 'address' })],
                        context.deployerKeypair,
                        RPC_URL,
                        NETWORK_PASSPHRASE,
                    );
                    if (!result.returnValue) return BigInt(0);
                    const scVal = result.returnValue;
                    if (scVal.switch().name === 'scvI128') {
                        const i128 = scVal.i128();
                        return BigInt(i128.lo().toString()) + (BigInt(i128.hi().toString()) << 64n);
                    }
                    return BigInt(0);
                }

                async function getVaultBalance(address: string): Promise<bigint> {
                    const result = await callContract(
                        vaultContractId,
                        'balance',
                        [nativeToScVal(Address.fromString(address), { type: 'address' })],
                        context.deployerKeypair,
                        RPC_URL,
                        NETWORK_PASSPHRASE,
                    );
                    if (!result.returnValue) return BigInt(0);
                    const scVal = result.returnValue;
                    if (scVal.switch().name === 'scvI128') {
                        const i128 = scVal.i128();
                        return BigInt(i128.lo().toString()) + (BigInt(i128.hi().toString()) << 64n);
                    }
                    return BigInt(0);
                }

                const oneSigBalanceBefore = await getTokenBalance(context.oneSigContractId);
                const vaultTokenBalanceBefore = await getTokenBalance(vaultContractId);
                const vaultDepositBefore = await getVaultBalance(context.oneSigContractId);

                // Simulate vault.deposit(onesig, amount) to discover the nested
                // token.transfer sub-invocation that onesig needs to pre-authorize.
                const depositArgs = [
                    nativeToScVal(Address.fromString(context.oneSigContractId), {
                        type: 'address',
                    }),
                    nativeToScVal(depositAmount, { type: 'i128' }),
                ];
                const transferSubInvocations = await simulateSubInvocations(
                    context.deployerKeypair,
                    context.oneSigContractId,
                    vaultContractId,
                    'deposit',
                    depositArgs,
                    RPC_URL,
                    NETWORK_PASSPHRASE,
                );
                expect(transferSubInvocations.length).toBe(1);

                // Manually built unused auth entry to test that extra entries don't cause problems
                const transferAuthEntryUnused = buildInvokerContractAuthEntry(
                    tokenContractId,
                    'transfer',
                    [
                        nativeToScVal(Address.fromString(context.oneSigContractId), {
                            type: 'address',
                        }),
                        nativeToScVal(Address.fromString(vaultContractId), {
                            type: 'address',
                        }),
                        nativeToScVal(BigInt(20_000_000), { type: 'i128' }),
                    ],
                    [],
                );

                const assembledTx = await context.oneSigClient.execute_transaction({
                    calls: [
                        {
                            to: vaultContractId,
                            func: 'deposit',
                            args: depositArgs,
                            // Unused auth entry first to test that order does not matter (matching by content, not position)
                            sub_invocations: xdr.ScVal.scvVec([
                                transferAuthEntryUnused,
                                ...transferSubInvocations,
                            ]) as unknown as InvokerContractAuthEntry[],
                        },
                        {
                            to: vaultContractId,
                            func: 'deposit',
                            args: depositArgs,
                            sub_invocations: xdr.ScVal.scvVec(
                                transferSubInvocations,
                            ) as unknown as InvokerContractAuthEntry[],
                        },
                    ],
                });

                const result = await executeOnesigTx(
                    context,
                    assembledTx as contract.AssembledTransaction<unknown>,
                    { senderType: 'permissionless' },
                );
                assertTxSucceeded(result, 'vault deposit with sub_invocations');

                const oneSigBalanceAfter = await getTokenBalance(context.oneSigContractId);
                const vaultTokenBalanceAfter = await getTokenBalance(vaultContractId);
                const vaultDepositAfter = await getVaultBalance(context.oneSigContractId);

                expect(oneSigBalanceAfter).toBe(oneSigBalanceBefore - 2n * depositAmount);
                expect(vaultTokenBalanceAfter).toBe(vaultTokenBalanceBefore + 2n * depositAmount);
                expect(vaultDepositAfter).toBe(vaultDepositBefore + 2n * depositAmount);
            }, 60000);

            test('should succeed with out-of-order sub_invocations auth entries', async () => {
                const amount1 = BigInt(30_000_000);
                const amount2 = BigInt(20_000_000);

                async function getTokenBalance(address: string): Promise<bigint> {
                    const result = await callContract(
                        tokenContractId,
                        'balance',
                        [nativeToScVal(Address.fromString(address), { type: 'address' })],
                        context.deployerKeypair,
                        RPC_URL,
                        NETWORK_PASSPHRASE,
                    );
                    if (!result.returnValue) return BigInt(0);
                    const scVal = result.returnValue;
                    if (scVal.switch().name === 'scvI128') {
                        const i128 = scVal.i128();
                        return BigInt(i128.lo().toString()) + (BigInt(i128.hi().toString()) << 64n);
                    }
                    return BigInt(0);
                }

                const oneSigBalanceBefore = await getTokenBalance(context.oneSigContractId);
                const vaultBalanceBefore = await getTokenBalance(vaultContractId);

                // Build auth entries for two transfers with DIFFERENT amounts
                const authTransfer1 = buildInvokerContractAuthEntry(
                    tokenContractId,
                    'transfer',
                    [
                        nativeToScVal(Address.fromString(context.oneSigContractId), {
                            type: 'address',
                        }),
                        nativeToScVal(Address.fromString(vaultContractId), { type: 'address' }),
                        nativeToScVal(amount1, { type: 'i128' }),
                    ],
                    [],
                );
                const authTransfer2 = buildInvokerContractAuthEntry(
                    tokenContractId,
                    'transfer',
                    [
                        nativeToScVal(Address.fromString(context.oneSigContractId), {
                            type: 'address',
                        }),
                        nativeToScVal(Address.fromString(vaultContractId), { type: 'address' }),
                        nativeToScVal(amount2, { type: 'i128' }),
                    ],
                    [],
                );

                // Pass auth entries in REVERSE order: [amount2, amount1]
                // Vault internally calls transfer(amount1) first, then transfer(amount2).
                // If matching is by content (not position), this should still work.
                const assembledTx = await context.oneSigClient.execute_transaction({
                    calls: [
                        {
                            to: vaultContractId,
                            func: 'deposit_double',
                            args: [
                                nativeToScVal(Address.fromString(context.oneSigContractId), {
                                    type: 'address',
                                }),
                                nativeToScVal(amount1, { type: 'i128' }),
                                nativeToScVal(amount2, { type: 'i128' }),
                            ],
                            // Deliberately reversed: amount2 auth first, amount1 auth second
                            sub_invocations: xdr.ScVal.scvVec([
                                authTransfer2,
                                authTransfer1,
                            ]) as unknown as InvokerContractAuthEntry[],
                        },
                    ],
                });

                const result = await executeOnesigTx(
                    context,
                    assembledTx as contract.AssembledTransaction<unknown>,
                    { senderType: 'permissionless' },
                );
                assertTxSucceeded(result, 'deposit_double with reversed auth order');

                const oneSigBalanceAfter = await getTokenBalance(context.oneSigContractId);
                const vaultBalanceAfter = await getTokenBalance(vaultContractId);

                expect(oneSigBalanceAfter).toBe(oneSigBalanceBefore - amount1 - amount2);
                expect(vaultBalanceAfter).toBe(vaultBalanceBefore + amount1 + amount2);
            }, 60000);
        });

        describe('Deploy via Factory Tests', () => {
            let factoryContractId: string;
            let mockVaultWasmHash: string;

            beforeAll(async () => {
                const factoryWasmPath = join(
                    __dirname,
                    '../../../contracts/stellar/target/wasm32v1-none/release/mock_factory.wasm',
                );
                if (!existsSync(factoryWasmPath)) {
                    throw new Error(
                        `Mock factory WASM not found at: ${factoryWasmPath}. Run 'pnpm build:mocks' first.`,
                    );
                }

                factoryContractId = await deployContractFromWasm(
                    factoryWasmPath,
                    [],
                    context.deployerKeypair,
                    RPC_URL,
                    NETWORK_PASSPHRASE,
                );

                const vaultWasmPath = join(
                    __dirname,
                    '../../../contracts/stellar/target/wasm32v1-none/release/mock_vault.wasm',
                );
                mockVaultWasmHash = await uploadWasm(
                    vaultWasmPath,
                    context.deployerKeypair,
                    RPC_URL,
                    NETWORK_PASSPHRASE,
                );
            }, 60000);

            test('should deploy a contract via factory through execute_transaction', async () => {
                const salt = randomBytes(32);
                const wasmHashBytes = Buffer.from(mockVaultWasmHash, 'hex');

                const deployAuthEntry = buildCreateContractWithCtorAuthEntry(
                    wasmHashBytes,
                    salt,
                    [],
                );

                const assembledTx = await context.oneSigClient.execute_transaction({
                    calls: [
                        {
                            to: factoryContractId,
                            func: 'deploy',
                            args: [
                                nativeToScVal(Address.fromString(context.oneSigContractId), {
                                    type: 'address',
                                }),
                                xdr.ScVal.scvBytes(wasmHashBytes),
                                xdr.ScVal.scvBytes(salt),
                            ],
                            sub_invocations: xdr.ScVal.scvVec([
                                deployAuthEntry,
                            ]) as unknown as InvokerContractAuthEntry[],
                        },
                    ],
                });

                const result = await executeOnesigTx(
                    context,
                    assembledTx as contract.AssembledTransaction<unknown>,
                    { senderType: 'permissionless' },
                );
                assertTxSucceeded(result, 'deploy via factory through execute_transaction');
            }, 60000);
        });

        describe('Deep Sub-Invocation Tests', () => {
            // Deploy 6 instances of MockChain: A, B, C and A1, B1, C1
            let chainA: string;
            let chainB: string;
            let chainC: string;
            let chainA1: string;
            let chainB1: string;
            let chainC1: string;

            beforeAll(async () => {
                const chainWasmPath = join(
                    __dirname,
                    '../../../contracts/stellar/target/wasm32v1-none/release/mock_chain.wasm',
                );
                if (!existsSync(chainWasmPath)) {
                    throw new Error(
                        `Mock chain WASM not found at: ${chainWasmPath}. Run 'pnpm build:mocks' first.`,
                    );
                }

                // Upload WASM once, then deploy 6 instances from the hash
                const wasmHash = await uploadWasm(
                    chainWasmPath,
                    context.deployerKeypair,
                    RPC_URL,
                    NETWORK_PASSPHRASE,
                );
                const contracts: string[] = [];
                for (let i = 0; i < 6; i++) {
                    contracts.push(
                        await deployContractFromHash(
                            wasmHash,
                            [],
                            context.deployerKeypair,
                            RPC_URL,
                            NETWORK_PASSPHRASE,
                        ),
                    );
                }
                [chainA, chainB, chainC, chainA1, chainB1, chainC1] = contracts;
            }, 120000);

            test('should execute deep 3-level sub-invocation chains (A→B→C and A1→B1→C1)', async () => {
                const onesigAddr = context.oneSigContractId;
                const addrScVal = (addr: string) =>
                    nativeToScVal(Address.fromString(addr), { type: 'address' });
                const addrVecScVal = (...addrs: string[]) =>
                    nativeToScVal(
                        addrs.map((a) => Address.fromString(a)),
                        {
                            type: { type: 'vec', element: { type: 'address' } },
                        },
                    );

                // Auth tree for chain A → B → C.
                // A's require_auth is auto-satisfied (onesig calls A directly).
                // We only need to authorize B and C (sub-invocations of A).
                const authC = buildInvokerContractAuthEntry(
                    chainC,
                    'call_deep',
                    [addrScVal(onesigAddr), addrVecScVal()],
                    [],
                );
                const authB = buildInvokerContractAuthEntry(
                    chainB,
                    'call_deep',
                    [addrScVal(onesigAddr), addrVecScVal(chainC)],
                    [authC],
                );

                // Auth tree for chain A1 → B1 → C1 (same pattern)
                const authC1 = buildInvokerContractAuthEntry(
                    chainC1,
                    'call_deep',
                    [addrScVal(onesigAddr), addrVecScVal()],
                    [],
                );
                const authB1 = buildInvokerContractAuthEntry(
                    chainB1,
                    'call_deep',
                    [addrScVal(onesigAddr), addrVecScVal(chainC1)],
                    [authC1],
                );

                // Execute both chains in a single execute_transaction call
                const assembledTx = await context.oneSigClient.execute_transaction({
                    calls: [
                        {
                            to: chainA,
                            func: 'call_deep',
                            args: [addrScVal(onesigAddr), addrVecScVal(chainB, chainC)],
                            sub_invocations: xdr.ScVal.scvVec([
                                authB,
                            ]) as unknown as InvokerContractAuthEntry[],
                        },
                        {
                            to: chainA1,
                            func: 'call_deep',
                            args: [addrScVal(onesigAddr), addrVecScVal(chainB1, chainC1)],
                            sub_invocations: xdr.ScVal.scvVec([
                                authB1,
                            ]) as unknown as InvokerContractAuthEntry[],
                        },
                    ],
                });

                const result = await executeOnesigTx(
                    context,
                    assembledTx as contract.AssembledTransaction<unknown>,
                    { senderType: 'permissionless' },
                );
                assertTxSucceeded(result, 'deep 3-level sub-invocation chains A→B→C and A1→B1→C1');

                // Verify each contract in both chains was called exactly once
                async function getCount(contractId: string): Promise<number> {
                    const res = await callContract(
                        contractId,
                        'count',
                        [],
                        context.deployerKeypair,
                        RPC_URL,
                        NETWORK_PASSPHRASE,
                    );
                    return res.returnValue ? res.returnValue.u32() : 0;
                }

                // Chain 1: A → B → C
                expect(await getCount(chainA)).toBe(1);
                expect(await getCount(chainB)).toBe(1);
                expect(await getCount(chainC)).toBe(1);
                // Chain 2: A1 → B1 → C1
                expect(await getCount(chainA1)).toBe(1);
                expect(await getCount(chainB1)).toBe(1);
                expect(await getCount(chainC1)).toBe(1);
            }, 60000);
        });
    });
});
