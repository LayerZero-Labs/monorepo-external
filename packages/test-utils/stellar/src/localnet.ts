import { BASE_FEE, Operation, rpc, TransactionBuilder } from '@stellar/stellar-sdk';
import { spawnSync } from 'node:child_process';

import { deployNativeSac, deployZroToken } from './deploy.js';
import type { StellarTestEnv } from './env.js';

export const DEFAULT_STELLAR_LOCALNET_IMAGE =
    '438003944538.dkr.ecr.us-east-1.amazonaws.com/layerzerolabs/stellar:2026-03-02';
const CONTAINER_PORT = 8000;
export const STELLAR_LOCALNET_OWNER_LABEL = 'com.layerzerolabs.test-utils-stellar=1';
const STELLAR_LOCALNET_OWNER_LABEL_KEY = STELLAR_LOCALNET_OWNER_LABEL.split('=')[0];

// Timeout configuration (in milliseconds)
const STARTUP_TIMEOUT_MS = 120_000; // 2 minutes
const REQUEST_TIMEOUT_MS = 5_000;
export const FUNDING_RETRY_INTERVAL_MS = 2_000;

/** Docker container names: alphanumeric start, then alnum / `_` / `.` / `-`. */
const DOCKER_NAME_RE = /^[a-zA-Z0-9][a-zA-Z0-9_.-]*$/;
const DOCKER_IMAGE_RE =
    /^(?!-)[a-z0-9][a-z0-9._/-]*(?::[a-zA-Z0-9][a-zA-Z0-9_.-]*)?(?:@[a-zA-Z0-9][a-zA-Z0-9_+.-]*:[a-fA-F0-9]{32,})?$/;

export interface DockerCommandResult {
    status: number;
    stdout: string;
    stderr: string;
}

/** Injectable so container lifecycle policy can be tested without a Docker daemon. */
export type DockerCommandRunner = (args: readonly string[]) => DockerCommandResult;

export interface LocalnetLifecycleOptions {
    env: StellarTestEnv;
    commandRunner?: DockerCommandRunner;
}

export type NamedContainerRemovalPolicy = 'absent' | 'remove' | 'reject';

export function assertDockerArgs(env: StellarTestEnv): void {
    if (!DOCKER_NAME_RE.test(env.CONTAINER_NAME)) {
        throw new Error(`Invalid docker container name: ${JSON.stringify(env.CONTAINER_NAME)}`);
    }
    if (!Number.isInteger(env.HOST_PORT) || env.HOST_PORT < 1 || env.HOST_PORT > 65535) {
        throw new Error(`Invalid docker host port: ${env.HOST_PORT}`);
    }
    const dockerImage = env.DOCKER_IMAGE ?? DEFAULT_STELLAR_LOCALNET_IMAGE;
    if (!DOCKER_IMAGE_RE.test(dockerImage)) {
        throw new Error(`Invalid docker image: ${JSON.stringify(dockerImage)}`);
    }
}

export function buildDockerRunArgs(env: StellarTestEnv): string[] {
    assertDockerArgs(env);
    return [
        'run',
        '-d',
        '--name',
        env.CONTAINER_NAME,
        '--label',
        STELLAR_LOCALNET_OWNER_LABEL,
        '-p',
        `127.0.0.1:${env.HOST_PORT}:${CONTAINER_PORT}`,
        env.DOCKER_IMAGE ?? DEFAULT_STELLAR_LOCALNET_IMAGE,
    ];
}

export function buildDockerContainerIdLookupArgs(containerName: string): string[] {
    return ['container', 'ls', '-aq', '--filter', `name=^/${containerName}$`];
}

export function buildDockerOwnershipLabelLookupArgs(containerId: string): string[] {
    return [
        'container',
        'inspect',
        '--format',
        `{{ index .Config.Labels "${STELLAR_LOCALNET_OWNER_LABEL_KEY}" }}`,
        containerId,
    ];
}

export function buildDockerRemoveArgs(containerId: string): string[] {
    return ['rm', '-f', containerId];
}

export function getNamedContainerRemovalPolicy(
    containerId: string | undefined,
    ownerLabel: string | undefined,
): NamedContainerRemovalPolicy {
    if (containerId == null) return 'absent';
    return ownerLabel === '1' ? 'remove' : 'reject';
}

const runDockerCommand: DockerCommandRunner = (args) => {
    const result = spawnSync('docker', args, { encoding: 'utf8' });
    if (result.error != null) {
        throw new Error(`Unable to run docker ${args[0]}: ${result.error.message}`, {
            cause: result.error,
        });
    }
    return {
        status: result.status ?? 1,
        stdout: result.stdout ?? '',
        stderr: result.stderr ?? '',
    };
};

function runDockerOrThrow(
    runner: DockerCommandRunner,
    args: readonly string[],
    action: string,
): DockerCommandResult {
    const result = runner(args);
    if (result.status !== 0) {
        throw new Error(
            `Docker ${action} failed (exit ${result.status}): ${result.stderr.trim() || result.stdout.trim()}`,
        );
    }
    return result;
}

function removeOwnedContainerIfPresent(
    env: StellarTestEnv,
    commandRunner: DockerCommandRunner,
): void {
    const containerId = runDockerOrThrow(
        commandRunner,
        buildDockerContainerIdLookupArgs(env.CONTAINER_NAME),
        `container lookup for ${env.CONTAINER_NAME}`,
    ).stdout.trim();
    const normalizedContainerId = containerId === '' ? undefined : containerId;

    if (normalizedContainerId == null) return;

    const ownerLabel = runDockerOrThrow(
        commandRunner,
        buildDockerOwnershipLabelLookupArgs(normalizedContainerId),
        `ownership lookup for ${env.CONTAINER_NAME}`,
    ).stdout.trim();
    const policy = getNamedContainerRemovalPolicy(normalizedContainerId, ownerLabel);
    if (policy === 'reject') {
        throw new Error(
            `Refusing to remove existing container ${env.CONTAINER_NAME}: it is not owned by ${STELLAR_LOCALNET_OWNER_LABEL}`,
        );
    }
    runDockerOrThrow(
        commandRunner,
        buildDockerRemoveArgs(normalizedContainerId),
        `removal of ${env.CONTAINER_NAME}`,
    );
}

function dockerRunLocalnet(env: StellarTestEnv, commandRunner: DockerCommandRunner): void {
    runDockerOrThrow(commandRunner, buildDockerRunArgs(env), 'localnet start');
}

export async function startStellarLocalnet({
    env,
    commandRunner = runDockerCommand,
}: LocalnetLifecycleOptions): Promise<void> {
    assertDockerArgs(env);
    console.log('🚀 Starting Stellar localnet...');

    removeOwnedContainerIfPresent(env, commandRunner);
    dockerRunLocalnet(env, commandRunner);

    // Container is up; if any startup step fails, tear it down before rethrowing.
    // globalSetup only registers its teardown once startup fully succeeds, so
    // without this a failed startup (e.g. a funding flake) would leak the container.
    try {
        console.log('⏳ Waiting for Stellar RPC to be healthy...');
        await waitForRpcHealth(env);
        console.log('✅ Stellar RPC is healthy');

        await fundTestAccounts(env);
        await deployNativeSac(env);
        await deployZroToken(env);
    } catch (err) {
        await stopStellarLocalnet({ env, commandRunner });
        throw err;
    }
}

// Serialization queue for fundAccount — the junk wallet can only have one pending tx at a time.
// Chaining onto this promise ensures concurrent calls are sequenced correctly.
let fundAccountQueue: Promise<void> = Promise.resolve();

/**
 * Fund a single account from the junk wallet (for ad-hoc test accounts).
 * Calls are serialized to avoid sequence number conflicts on the junk wallet.
 */
export function fundAccount(env: StellarTestEnv, publicKey: string): Promise<void> {
    const result = fundAccountQueue.then(() => fundAccountInternal(env, publicKey));
    fundAccountQueue = result.catch(() => {}); // keep queue alive if this call fails
    return result;
}

async function fundAccountInternal(env: StellarTestEnv, publicKey: string): Promise<void> {
    const MAX_RETRIES = 5;
    let lastError: unknown;

    for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
        let transactionSubmitted = false;
        let getDestinationAccount: ((accountId: string) => Promise<unknown>) | undefined;
        try {
            const server = new rpc.Server(env.RPC_URL, { allowHttp: true });
            getDestinationAccount = (accountId) => server.getAccount(accountId);
            // Re-fetch account on every attempt to get the latest sequence number
            const junkAccount = await server.getAccount(env.JUNK_WALLET.publicKey());

            const tx = new TransactionBuilder(junkAccount, {
                fee: BASE_FEE,
                networkPassphrase: env.NETWORK_PASSPHRASE,
            })
                .addOperation(
                    Operation.createAccount({
                        destination: publicKey,
                        startingBalance: '100',
                    }),
                )
                .setTimeout(30)
                .build();

            tx.sign(env.JUNK_WALLET);

            const sendResult = await server.sendTransaction(tx);
            if (sendResult.status !== 'PENDING') {
                throw new Error(
                    `Failed to fund account ${publicKey}: ${JSON.stringify(sendResult)}`,
                );
            }
            transactionSubmitted = true;

            const txResult = await server.pollTransaction(sendResult.hash);
            if (txResult.status !== 'SUCCESS') {
                throw new Error(
                    `Account funding failed for ${publicKey}: ${JSON.stringify(txResult)}`,
                );
            }

            return; // success
        } catch (err) {
            lastError = err;
            if (
                transactionSubmitted &&
                getDestinationAccount != null &&
                (await accountExists(getDestinationAccount, publicKey))
            ) {
                return;
            }
            if (attempt < MAX_RETRIES) {
                await new Promise((resolve) => setTimeout(resolve, FUNDING_RETRY_INTERVAL_MS));
            }
        }
    }

    throw new Error(
        `Failed to fund account ${publicKey} after ${MAX_RETRIES} attempts: ${lastError instanceof Error ? lastError.message : String(lastError)}`,
    );
}

/** Returns true when a destination account was created despite an ambiguous transaction poll. */
export async function accountExists(
    getAccount: (accountId: string) => Promise<unknown>,
    accountId: string,
): Promise<boolean> {
    try {
        await getAccount(accountId);
        return true;
    } catch {
        return false;
    }
}

/**
 * Back off between fundTestAccounts rebuilds so a lagging localnet can confirm
 * the previous attempt before we burn another try.
 */
export async function pauseBeforeFundingRetry(
    attempt: number,
    maxAttempts: number,
    sleep: (ms: number) => Promise<void> = (ms) =>
        new Promise((resolve) => setTimeout(resolve, ms)),
    intervalMs: number = FUNDING_RETRY_INTERVAL_MS,
): Promise<void> {
    if (attempt < maxAttempts) {
        await sleep(intervalMs);
    }
}

async function waitForRpcHealth(env: StellarTestEnv): Promise<void> {
    const startTime = Date.now();
    while (Date.now() - startTime < STARTUP_TIMEOUT_MS) {
        try {
            const response = await fetch(env.RPC_URL, {
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
        await new Promise((resolve) => setTimeout(resolve, FUNDING_RETRY_INTERVAL_MS));
    }
    throw new Error(
        `Stellar RPC failed to become healthy within ${STARTUP_TIMEOUT_MS / 1000} seconds`,
    );
}

async function fundTestAccounts(env: StellarTestEnv): Promise<void> {
    console.log('💰 Funding test accounts from junk wallet...');
    const server = new rpc.Server(env.RPC_URL, { allowHttp: true });

    // A funded DEFAULT_DEPLOYER is the signal that funding already landed — lets us
    // short-circuit when a prior attempt's tx confirmed after the poll gave up.
    const alreadyFunded = async (): Promise<boolean> => {
        try {
            await server.getAccount(env.DEFAULT_DEPLOYER.publicKey());
            return true;
        } catch {
            return false;
        }
    };

    // Running localnets concurrently makes the chain lag, so a funding tx can outrun
    // the poll window or expire (NOT_FOUND). Use a longer validity + poll window, and
    // rebuild-and-retry a bounded number of times before giving up.
    const FUNDING_ATTEMPTS = 3;
    for (let attempt = 1; attempt <= FUNDING_ATTEMPTS; attempt++) {
        const junkAccount = await server.getAccount(env.JUNK_WALLET.publicKey());
        const tx = new TransactionBuilder(junkAccount, {
            fee: BASE_FEE,
            networkPassphrase: env.NETWORK_PASSPHRASE,
        })
            .addOperation(
                Operation.createAccount({
                    destination: env.DEFAULT_DEPLOYER.publicKey(),
                    startingBalance: '2000',
                }),
            )
            .addOperation(
                Operation.createAccount({
                    destination: env.ZRO_DISTRIBUTOR.publicKey(),
                    startingBalance: '2000',
                }),
            )
            .addOperation(
                Operation.createAccount({
                    destination: env.EXECUTOR_ADMIN.publicKey(),
                    startingBalance: '2000',
                }),
            )
            .addOperation(
                Operation.createAccount({
                    destination: env.CHAIN_B_DEPLOYER.publicKey(),
                    startingBalance: '2000',
                }),
            )
            .setTimeout(120)
            .build();

        tx.sign(env.JUNK_WALLET);

        const sendResult = await server.sendTransaction(tx);
        if (sendResult.status === 'PENDING') {
            const txResult = await server.pollTransaction(sendResult.hash, { attempts: 60 });
            if (txResult.status === 'SUCCESS') {
                console.log('✅ All test accounts funded');
                return;
            }
        }

        // Send rejected or poll didn't confirm — but on a lagging chain the tx may
        // have landed anyway. If the accounts now exist, funding is effectively done.
        if (await alreadyFunded()) {
            console.log('✅ All test accounts funded (confirmed after poll window)');
            return;
        }

        console.warn(
            `⚠️  Funding attempt ${attempt}/${FUNDING_ATTEMPTS} did not confirm; retrying…`,
        );
        // Match fundAccountInternal: give a lagging localnet time to confirm before
        // rebuilding/retrying, otherwise we can burn all attempts while the first tx lands.
        await pauseBeforeFundingRetry(attempt, FUNDING_ATTEMPTS);
    }

    throw new Error(`Account funding failed to confirm after ${FUNDING_ATTEMPTS} attempts`);
}

export async function stopStellarLocalnet({
    env,
    commandRunner = runDockerCommand,
}: LocalnetLifecycleOptions): Promise<void> {
    // Guarded (like the startup docker rm -f) so a cleanup failure never throws —
    // otherwise it would mask the original error when called from a startup catch.
    try {
        assertDockerArgs(env);
        removeOwnedContainerIfPresent(env, commandRunner);
        console.log('✅ Stellar localnet stopped');
    } catch (err) {
        console.warn(`⚠️  Failed to remove container ${env.CONTAINER_NAME}:`, err);
    }
}
