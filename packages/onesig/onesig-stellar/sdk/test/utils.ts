import {
    Address,
    Asset,
    BASE_FEE,
    contract,
    hash,
    Horizon,
    Keypair,
    Operation,
    rpc,
    TransactionBuilder,
    xdr,
} from '@stellar/stellar-sdk';
import { randomBytes } from 'crypto';
import { Wallet } from 'ethers';
import { existsSync, readFileSync } from 'fs';
import { join } from 'path';
import { expect } from 'vitest';

import {
    encodeLeaf,
    getDigestToSign,
    makeOneSigTree,
    signOneSigTree,
} from '@layerzerolabs/onesig-core';

import { Client, StellarCall, StellarLeafData, stellarLeafGenerator } from '../src/index';

export interface IntegrationTestContext {
    oneSigId: bigint;
    oneSigClient: Client;
    oneSigContractId: string;
    deployerKeypair: Keypair;
    seed: Uint8Array;
    threshold: number;
    sortedSigners: Wallet[];
    rpcServer: rpc.Server;
    horizonServer: Horizon.Server;
    networkPassphrase: string;
}

// Local network configuration
export const RPC_URL = process.env.SOROBAN_RPC_URL || 'http://localhost:8586/soroban/rpc';
export const HORIZON_URL = process.env.HORIZON_URL || 'http://localhost:8586';
export const NETWORK_PASSPHRASE =
    process.env.SOROBAN_NETWORK_PASSPHRASE || 'Standalone Network ; February 2017';

/**
 * Wait for the Stellar network to be ready
 */
export async function waitForNetworkReady(rpcServer: rpc.Server, maxRetries = 30): Promise<void> {
    for (let i = 0; i < maxRetries; i++) {
        try {
            await rpcServer.getHealth();
            return;
        } catch (error) {
            if (i === maxRetries - 1) {
                throw new Error(`Network not ready after ${maxRetries} retries: ${error}`);
            }
            await new Promise((resolve) => setTimeout(resolve, 1000));
        }
    }
}

/**
 * Generate a funded keypair for testing
 *
 * Note: Friendbot requests are rate limited (see https://developers.stellar.org/docs/networks).
 * This function includes retry logic with exponential backoff to handle rate limiting.
 */
export async function generateFundedKeypair(rpcServer: rpc.Server): Promise<Keypair> {
    const keypair = Keypair.random();

    // Try to fund via friendbot first (most reliable for local networks)
    // Friendbot is rate limited, so we retry with exponential backoff
    const maxRetries = 8;
    let lastError: Error | null = null;

    for (let attempt = 0; attempt < maxRetries; attempt++) {
        try {
            const response = await fetch(`${HORIZON_URL}/friendbot?addr=${keypair.publicKey()}`);
            if (response.ok) {
                // Wait briefly for the account to be funded (reduced for local networks)
                await new Promise((resolve) => setTimeout(resolve, 500));
                return keypair;
            }

            // If we get a 502 (Bad Gateway) or 429 (Too Many Requests), retry
            if (response.status === 502 || response.status === 429) {
                const errorText = await response.text().catch(() => response.statusText);
                lastError = new Error(
                    `Friendbot rate limited or unavailable: ${response.status} ${errorText}`,
                );

                // Exponential backoff: wait 1s, 2s, 4s, 8s, 16s
                if (attempt < maxRetries - 1) {
                    const delay = Math.pow(2, attempt) * 1000;
                    await new Promise((resolve) => setTimeout(resolve, delay));
                    continue;
                }
            } else {
                // For other errors, throw immediately
                const errorText = await response.text().catch(() => response.statusText);
                throw new Error(
                    `Failed to fund account via friendbot: ${response.status} ${errorText}`,
                );
            }
        } catch (error) {
            // Network errors or other fetch failures - retry with backoff
            if (
                attempt < maxRetries - 1 &&
                (error instanceof TypeError || error instanceof Error)
            ) {
                lastError = error instanceof Error ? error : new Error(String(error));
                const delay = Math.pow(2, attempt) * 1000;
                await new Promise((resolve) => setTimeout(resolve, delay));
                continue;
            }
            // If this is the last attempt, fall through to RPC airdrop fallback
            lastError = error instanceof Error ? error : new Error(String(error));
            break;
        }
    }

    // If friendbot fails after retries, try RPC airdrop (if available)
    try {
        // Check if requestAirdrop method exists (optional method for local networks)
        // Use type guard to safely check for the method
        const server = rpcServer as rpc.Server & {
            requestAirdrop?: (address: string) => Promise<unknown>;
        };
        if (typeof server.requestAirdrop === 'function') {
            await server.requestAirdrop(keypair.publicKey());
            await new Promise((resolve) => setTimeout(resolve, 500));
            return keypair;
        } else {
            throw new Error('requestAirdrop method not available');
        }
    } catch (err) {
        const friendbotError = lastError instanceof Error ? lastError.message : String(lastError);
        const airdropError = err instanceof Error ? err.message : String(err);
        throw new Error(
            `Failed to fund account after ${maxRetries} retries. Friendbot error: ${friendbotError}. Airdrop error: ${airdropError}`,
        );
    }
}

/**
 * Upload WASM and get hash using Stellar SDK
 */
export async function uploadWasm(
    wasmPath: string,
    keypair: Keypair,
    rpcUrl: string,
    networkPassphrase: string,
): Promise<string> {
    const server = new rpc.Server(rpcUrl, { allowHttp: true });
    const wasmBuffer = readFileSync(wasmPath);

    const account = await server.getAccount(keypair.publicKey());

    const uploadTx = new TransactionBuilder(account, {
        fee: BASE_FEE,
        networkPassphrase: networkPassphrase,
    })
        .addOperation(Operation.uploadContractWasm({ wasm: wasmBuffer }))
        .setTimeout(30)
        .build();

    const simulated = await server.simulateTransaction(uploadTx);
    const preparedTx = rpc.assembleTransaction(uploadTx, simulated).build();
    preparedTx.sign(keypair);

    const sendResult = await server.sendTransaction(preparedTx);

    // Compute the WASM hash (SHA-256 of the WASM bytes)
    const wasmHash = hash(wasmBuffer).toString('hex');

    if (sendResult.status === 'DUPLICATE') {
        // WASM already uploaded — return the hash directly
        return wasmHash;
    }

    if (sendResult.status !== 'PENDING') {
        throw new Error(`Failed to upload WASM: ${JSON.stringify(sendResult)}`);
    }

    // Wait for transaction to be confirmed
    const txResult = await server.pollTransaction(sendResult.hash);

    if (txResult.status !== 'SUCCESS') {
        throw new Error(`WASM upload failed: ${JSON.stringify(txResult)}`);
    }

    return wasmHash;
}

/**
 * Deploy the OneSig contract
 */
export async function deployOneSig(
    deployerKeypair: Keypair,
    oneSigId: bigint,
    sortedSigners: Wallet[],
    threshold: number,
    seed: Uint8Array,
    networkPassphrase: string,
    rpcUrl: string,
): Promise<{ client: Client; contractId: string }> {
    // Load the WASM file
    // Note: Cargo workspace builds to package root target/, not contracts/onesig/target/
    const wasmPath = join(__dirname, '../../target/wasm32v1-none/release/onesig.wasm');

    if (!existsSync(wasmPath)) {
        throw new Error(
            `WASM file not found at: ${wasmPath}. Make sure to run 'pnpm build:contract' first.`,
        );
    }

    // Upload the contract WASM using Stellar SDK
    const wasmHash = await uploadWasm(wasmPath, deployerKeypair, rpcUrl, networkPassphrase);

    // Create signer
    const signer = contract.basicNodeSigner(deployerKeypair, networkPassphrase);

    // Prepare constructor arguments
    // Convert Ethereum addresses to 20-byte format
    const signersBytes: Buffer[] = [];
    for (const signerWallet of sortedSigners) {
        const addressBytes = Buffer.from(signerWallet.address.slice(2), 'hex');
        signersBytes.push(addressBytes); // Use 20-byte address directly
    }

    // Convert seed to BytesN<32>
    const seedBytes = Buffer.from(seed);

    // Deploy the contract with constructor arguments
    const deployTx = await Client.deploy(
        {
            onesig_id: oneSigId,
            seed: seedBytes,
            signers: signersBytes,
            threshold,
            executors: [Buffer.from(deployerKeypair.rawPublicKey())], // Use deployer as initial executor
            executor_required: false, // Allow permissionless execution for tests
        },
        {
            wasmHash,
            networkPassphrase,
            rpcUrl,
            allowHttp: true,
            publicKey: deployerKeypair.publicKey(),
            ...signer,
        },
    );

    const deployResult = await deployTx.signAndSend();
    const client = deployResult.result as Client;
    const contractId = client.options.contractId;

    if (!contractId) {
        throw new Error('Failed to deploy contract');
    }

    return { client, contractId };
}

/**
 * Submit an operation to the network (simulate, sign, send, poll)
 * Generic helper used by all contract deployment and call functions
 */
async function submitOperation(
    operation: xdr.Operation,
    keypair: Keypair,
    rpcUrl: string,
    networkPassphrase: string,
    errorContext: string,
): Promise<rpc.Api.GetSuccessfulTransactionResponse> {
    const server = new rpc.Server(rpcUrl, { allowHttp: true });
    const account = await server.getAccount(keypair.publicKey());

    const tx = new TransactionBuilder(account, {
        fee: BASE_FEE,
        networkPassphrase,
    })
        .addOperation(operation)
        .setTimeout(60)
        .build();

    const simulated = await server.simulateTransaction(tx);
    const prepared = rpc.assembleTransaction(tx, simulated).build();
    prepared.sign(keypair);

    const sendResult = await server.sendTransaction(prepared);
    if (sendResult.status !== 'PENDING') {
        throw new Error(`Failed to ${errorContext}: ${JSON.stringify(sendResult)}`);
    }

    const txResult = await server.pollTransaction(sendResult.hash);
    if (txResult.status !== 'SUCCESS') {
        throw new Error(`${errorContext} failed: ${JSON.stringify(txResult)}`);
    }

    return txResult as rpc.Api.GetSuccessfulTransactionResponse;
}

/**
 * Deploy a contract instance from an already-uploaded WASM hash
 */
export async function deployContractFromHash(
    wasmHash: string,
    constructorArgs: xdr.ScVal[],
    keypair: Keypair,
    rpcUrl: string,
    networkPassphrase: string,
): Promise<string> {
    const operation = Operation.createCustomContract({
        address: Address.fromString(keypair.publicKey()),
        wasmHash: Buffer.from(wasmHash, 'hex'),
        constructorArgs,
    });

    const result = await submitOperation(
        operation,
        keypair,
        rpcUrl,
        networkPassphrase,
        'deploy contract',
    );
    if (!result.returnValue) {
        throw new Error('No return value from contract deployment');
    }
    return Address.fromScVal(result.returnValue).toString();
}

/**
 * Deploy a contract from WASM file (upload + deploy in one step)
 */
export async function deployContractFromWasm(
    wasmPath: string,
    constructorArgs: xdr.ScVal[],
    keypair: Keypair,
    rpcUrl: string,
    networkPassphrase: string,
): Promise<string> {
    const wasmHash = await uploadWasm(wasmPath, keypair, rpcUrl, networkPassphrase);

    const operation = Operation.createCustomContract({
        address: Address.fromString(keypair.publicKey()),
        wasmHash: Buffer.from(wasmHash, 'hex'),
        constructorArgs,
    });

    const result = await submitOperation(
        operation,
        keypair,
        rpcUrl,
        networkPassphrase,
        'deploy contract',
    );
    if (!result.returnValue) {
        throw new Error('No return value from contract deployment');
    }
    return Address.fromScVal(result.returnValue).toString();
}

/**
 * Deploy the Stellar Asset Contract (SAC) for an asset
 */
export async function deployStellarAssetContract(
    asset: Asset,
    keypair: Keypair,
    rpcUrl: string,
    networkPassphrase: string,
): Promise<string> {
    const operation = Operation.createStellarAssetContract({ asset });
    await submitOperation(operation, keypair, rpcUrl, networkPassphrase, 'deploy SAC');
    return asset.contractId(networkPassphrase);
}

/**
 * Call a contract function
 */
export async function callContract(
    contractId: string,
    functionName: string,
    args: xdr.ScVal[],
    keypair: Keypair,
    rpcUrl: string,
    networkPassphrase: string,
): Promise<rpc.Api.GetSuccessfulTransactionResponse> {
    const operation = Operation.invokeContractFunction({
        contract: contractId,
        function: functionName,
        args,
    });
    return submitOperation(operation, keypair, rpcUrl, networkPassphrase, `call ${functionName}`);
}

/**
 * Build Merkle data for a single transaction
 */
export interface OneSigMerkleData {
    merkleRoot: Buffer;
    expiry: bigint;
    signatures: Buffer[];
    digest: Buffer;
    /** 32-byte hash of the single leaf the onesig contract will execute. */
    leafHash: Buffer;
}

export async function buildSingleTxMerkleData(
    context: IntegrationTestContext,
    threshold: number,
    calls: StellarCall[],
    nonce?: bigint,
    expiryOffset = 1000,
    seed?: Uint8Array,
): Promise<{ merkleData: OneSigMerkleData; proof: Buffer[] }> {
    // Always read the current seed and nonce from the contract to ensure they're in sync
    // This prevents race conditions where the nonce or seed changes between reading them
    const [seedTx, nonceTx] = await Promise.all([
        context.oneSigClient.seed(),
        context.oneSigClient.nonce(),
    ]);
    const seedBuffer = Buffer.from(seedTx.result);
    const newSeed = seed ? arrayify(seed) : arrayify(seedBuffer);
    const actualNonce = nonce ?? BigInt(nonceTx.result);
    // Update context.seed to keep it in sync
    if (!seed) {
        context.seed = newSeed;
    }

    const leafData: StellarLeafData = {
        nonce: actualNonce,
        oneSigId: context.oneSigId,
        targetOneSigAddress: context.oneSigContractId,
        calls,
    };

    const leafGenerator = stellarLeafGenerator([leafData]);
    const merkleTree = makeOneSigTree([leafGenerator]);
    const merkleRoot = Buffer.from(merkleTree.getRoot());
    const expiryNumber = Math.floor(Date.now() / 1000) + expiryOffset;
    const expiry = BigInt(expiryNumber);

    // Get the signers we'll use for signing (first threshold signers)
    const signingSigners = context.sortedSigners.slice(0, threshold);

    const signatureResult = await signOneSigTree(
        merkleTree,
        signingSigners,
        {
            seed: newSeed,
            expiry: expiryNumber,
        },
        'signature',
    );

    // Get the signature bytes from the Signature object
    const signaturesBytes = signatureResult.get();

    // Format signatures as Buffer array (Stellar expects Array<Buffer>)
    const signatures: Buffer[] = [];
    for (let i = 0; i < threshold; i++) {
        const signature = signaturesBytes.subarray(i * 65, (i + 1) * 65);
        signatures.push(Buffer.from(signature));
    }

    const digestBigInt = BigInt(
        getDigestToSign(merkleTree, { seed: newSeed, expiry: expiryNumber }),
    );
    const digestHex = digestBigInt.toString(16).padStart(64, '0');
    const digestBuffer = Buffer.from(digestHex, 'hex');
    const leafEncoded = encodeLeaf(leafGenerator, 0);
    const proof = merkleTree.getHexProof(leafEncoded).map((p) => Buffer.from(p.slice(2), 'hex'));

    return {
        merkleData: {
            merkleRoot,
            expiry,
            signatures,
            digest: digestBuffer,
            leafHash: Buffer.from(leafEncoded.slice(2), 'hex'),
        },
        proof,
    };
}

/**
 * Reset OneSig contract state (set new seed to invalidate pending transactions)
 */
export async function resetOneSig(
    context: IntegrationTestContext,
    newSeed?: Uint8Array,
): Promise<void> {
    const seed = newSeed ?? arrayify(randomBytes(32));
    const seedBytes = Buffer.from(seed);
    const setSeedTx = await context.oneSigClient.set_seed({
        seed: seedBytes,
    });
    await setSeedTx.signAndSend();
    context.seed = seed;
}

/**
 * Helper to convert hex string to Uint8Array
 */
export function arrayify(value: string | Uint8Array): Uint8Array {
    if (typeof value === 'string') {
        return Buffer.from(value.slice(2), 'hex');
    }
    return value;
}

/**
 * Expect a Stellar contract error
 */
export async function expectStellarError(
    call: () => Promise<unknown>,
    expectedError?: string,
): Promise<void> {
    try {
        await call();
        expect(true).toBe(false); // Should have thrown
    } catch (error) {
        if (expectedError) {
            const errorMessage = error instanceof Error ? error.message : String(error);
            expect(errorMessage).toContain(expectedError);
        }
    }
}
