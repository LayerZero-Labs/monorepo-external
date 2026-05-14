import { BASE_FEE, Operation, rpc, TransactionBuilder } from '@stellar/stellar-sdk';
import { execSync } from 'node:child_process';

import {
    CHAIN_B_DEPLOYER,
    DEFAULT_DEPLOYER,
    EXECUTOR_ADMIN,
    JUNK_WALLET,
    NETWORK_PASSPHRASE,
    RPC_URL,
    ZRO_DISTRIBUTOR,
} from './constants.js';
import { deployNativeSac, deployZroToken } from './deploy.js';

const CONTAINER_NAME = 'stellar-protocol-sdk';
const ECR_IMAGE = '438003944538.dkr.ecr.us-east-1.amazonaws.com/layerzerolabs/stellar:2026-03-02';
const CONTAINER_PORT = 8000;
const HOST_PORT = 8086;

// Timeout configuration (in milliseconds)
const STARTUP_TIMEOUT_MS = 120_000; // 2 minutes
const REQUEST_TIMEOUT_MS = 5_000;
const RETRY_INTERVAL_MS = 2_000;

export async function startStellarLocalnet(): Promise<void> {
    console.log('🚀 Starting Stellar localnet...');

    // Remove any existing container and start fresh from the ECR snapshot
    try {
        execSync(`docker rm -f ${CONTAINER_NAME}`, { stdio: 'ignore' });
    } catch {
        // Container didn't exist — ignore
    }

    execSync(
        `docker run -d --name ${CONTAINER_NAME} -p ${HOST_PORT}:${CONTAINER_PORT} ${ECR_IMAGE}`,
        { stdio: 'inherit' },
    );

    console.log('⏳ Waiting for Stellar RPC to be healthy...');
    await waitForRpcHealth();
    console.log('✅ Stellar RPC is healthy');

    await fundTestAccounts();
    await deployNativeSac();
    await deployZroToken();
}

// Serialization queue for fundAccount — the junk wallet can only have one pending tx at a time.
// Chaining onto this promise ensures concurrent calls are sequenced correctly.
let fundAccountQueue: Promise<void> = Promise.resolve();

/**
 * Fund a single account from the junk wallet (for ad-hoc test accounts).
 * Calls are serialized to avoid sequence number conflicts on the junk wallet.
 */
export function fundAccount(publicKey: string): Promise<void> {
    const result = fundAccountQueue.then(() => fundAccountInternal(publicKey));
    fundAccountQueue = result.catch(() => {}); // keep queue alive if this call fails
    return result;
}

async function fundAccountInternal(publicKey: string): Promise<void> {
    const MAX_RETRIES = 5;
    let lastError: unknown;

    for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
        try {
            const server = new rpc.Server(RPC_URL, { allowHttp: true });
            // Re-fetch account on every attempt to get the latest sequence number
            const junkAccount = await server.getAccount(JUNK_WALLET.publicKey());

            const tx = new TransactionBuilder(junkAccount, {
                fee: BASE_FEE,
                networkPassphrase: NETWORK_PASSPHRASE,
            })
                .addOperation(
                    Operation.createAccount({
                        destination: publicKey,
                        startingBalance: '100',
                    }),
                )
                .setTimeout(30)
                .build();

            tx.sign(JUNK_WALLET);

            const sendResult = await server.sendTransaction(tx);
            if (sendResult.status !== 'PENDING') {
                throw new Error(
                    `Failed to fund account ${publicKey}: ${JSON.stringify(sendResult)}`,
                );
            }

            const txResult = await server.pollTransaction(sendResult.hash);
            if (txResult.status !== 'SUCCESS') {
                throw new Error(
                    `Account funding failed for ${publicKey}: ${JSON.stringify(txResult)}`,
                );
            }

            return; // success
        } catch (err) {
            lastError = err;
            if (attempt < MAX_RETRIES) {
                await new Promise((resolve) => setTimeout(resolve, RETRY_INTERVAL_MS));
            }
        }
    }

    throw new Error(
        `Failed to fund account ${publicKey} after ${MAX_RETRIES} attempts: ${lastError instanceof Error ? lastError.message : String(lastError)}`,
    );
}

async function waitForRpcHealth(): Promise<void> {
    const startTime = Date.now();
    while (Date.now() - startTime < STARTUP_TIMEOUT_MS) {
        try {
            const response = await fetch(RPC_URL, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'getHealth' }),
                signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
            });
            const data = (await response.json()) as { result?: { status?: string } };
            if (data.result?.status === 'healthy') return;
        } catch {
            // Not ready yet
        }
        await new Promise((resolve) => setTimeout(resolve, RETRY_INTERVAL_MS));
    }
    throw new Error(
        `Stellar RPC failed to become healthy within ${STARTUP_TIMEOUT_MS / 1000} seconds`,
    );
}

async function fundTestAccounts(): Promise<void> {
    console.log('💰 Funding test accounts from junk wallet...');
    const server = new rpc.Server(RPC_URL, { allowHttp: true });
    const junkAccount = await server.getAccount(JUNK_WALLET.publicKey());

    const tx = new TransactionBuilder(junkAccount, {
        fee: BASE_FEE,
        networkPassphrase: NETWORK_PASSPHRASE,
    })
        .addOperation(
            Operation.createAccount({
                destination: DEFAULT_DEPLOYER.publicKey(),
                startingBalance: '2000',
            }),
        )
        .addOperation(
            Operation.createAccount({
                destination: ZRO_DISTRIBUTOR.publicKey(),
                startingBalance: '2000',
            }),
        )
        .addOperation(
            Operation.createAccount({
                destination: EXECUTOR_ADMIN.publicKey(),
                startingBalance: '2000',
            }),
        )
        .addOperation(
            Operation.createAccount({
                destination: CHAIN_B_DEPLOYER.publicKey(),
                startingBalance: '2000',
            }),
        )
        .setTimeout(30)
        .build();

    tx.sign(JUNK_WALLET);

    const sendResult = await server.sendTransaction(tx);
    if (sendResult.status !== 'PENDING') {
        throw new Error(`Failed to fund test accounts: ${JSON.stringify(sendResult)}`);
    }

    const txResult = await server.pollTransaction(sendResult.hash);
    if (txResult.status !== 'SUCCESS') {
        throw new Error(`Account funding transaction failed: ${JSON.stringify(txResult)}`);
    }

    console.log('✅ All test accounts funded');
}

export async function stopStellarLocalnet(): Promise<void> {
    execSync(`docker rm -f ${CONTAINER_NAME}`, { stdio: 'ignore' });
    console.log('✅ Stellar localnet stopped');
}
