import type { Keypair } from '@stellar/stellar-sdk';
import {
    Asset,
    BASE_FEE,
    hash,
    Operation,
    rpc,
    TransactionBuilder,
    xdr,
} from '@stellar/stellar-sdk';
import { readFileSync } from 'fs';

import type { StellarTestEnv } from './env.js';

export interface DeployableContractClient<T extends { options: { contractId: string } }> {
    deploy: (
        argsOrOptions: unknown,
        options?: unknown,
    ) => Promise<{ signAndSend: () => Promise<{ result: T }> }>;
}

/**
 * Query and display the TTL (Time To Live) of uploaded WASM code.
 *
 * @param env - Stellar test environment (RPC URL, etc.)
 * @param wasmHash - The hex-encoded SHA-256 hash of the WASM code
 * @param server - The Stellar RPC server instance
 */
async function queryWasmTtl(
    env: StellarTestEnv,
    wasmHash: string,
    server: rpc.Server,
): Promise<void> {
    try {
        const latestLedger = await server.getLatestLedger();
        const currentLedger = latestLedger.sequence;

        // Create the LedgerKey for contract code using XDR encoding
        const wasmHashBuffer = Buffer.from(wasmHash, 'hex');
        // Ensure hash is exactly 32 bytes
        const hashBytes =
            wasmHashBuffer.length === 32 ? wasmHashBuffer : wasmHashBuffer.slice(0, 32);
        // Create LedgerKeyContractCode with hash
        const ledgerKeyContractCode = new xdr.LedgerKeyContractCode({
            hash: hashBytes,
        });
        const ledgerKey = xdr.LedgerKey.contractCode(ledgerKeyContractCode);
        const ledgerKeyXdr = ledgerKey.toXDR('base64');

        // Query contract code entry using direct RPC call
        const response = await fetch(env.RPC_URL, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                jsonrpc: '2.0',
                id: 1,
                method: 'getLedgerEntries',
                params: {
                    keys: [ledgerKeyXdr],
                },
            }),
        });

        const result = (await response.json()) as any;
        if (result.error) {
            console.warn(`Warning: Could not retrieve WASM TTL: ${result.error.message}`);
        } else if (result.result?.entries?.[0]?.liveUntilLedgerSeq) {
            const liveUntilLedgerSeq = result.result.entries[0].liveUntilLedgerSeq;
            const ttlLedgers = liveUntilLedgerSeq - currentLedger;
            const ttlDays = (ttlLedgers * 5) / (24 * 3600); // ~5 seconds per ledger
            console.log(
                `⏰ WASM TTL: live until ledger ${liveUntilLedgerSeq} (${ttlLedgers} ledgers remaining, ~${ttlDays.toFixed(2)} days)`,
            );
        }
    } catch (error) {
        // If querying TTL fails, it might be because the code isn't indexed yet
        // This is non-fatal, so we just log a warning
        console.warn(
            `Warning: Could not retrieve WASM TTL: ${error instanceof Error ? error.message : String(error)}`,
        );
    }
}

export async function uploadWasm(
    env: StellarTestEnv,
    wasmBuffer: Buffer,
    keypair: Keypair,
    server: rpc.Server,
): Promise<string> {
    console.log(
        `📦 WASM buffer size: ${wasmBuffer.length} bytes (${(wasmBuffer.length / 1024).toFixed(2)} KB)`,
    );

    const account = await server.getAccount(keypair.publicKey());

    const uploadTx = new TransactionBuilder(account, {
        fee: BASE_FEE,
        networkPassphrase: env.NETWORK_PASSPHRASE,
    })
        .addOperation(Operation.uploadContractWasm({ wasm: wasmBuffer }))
        .setTimeout(30)
        .build();

    const simulated = await server.simulateTransaction(uploadTx);
    const preparedTx = rpc.assembleTransaction(uploadTx, simulated).build();

    console.log(
        `💰 Upload transaction fee: ${preparedTx.fee} stroops (${(Number(preparedTx.fee) / 10000000).toFixed(7)} XLM)`,
    );

    preparedTx.sign(keypair);

    const sendResult = await server.sendTransaction(preparedTx);

    if (sendResult.status !== 'PENDING') {
        throw new Error(`Transaction failed: ${JSON.stringify(sendResult)}`);
    }

    // Wait for transaction to be confirmed
    const txResult = await server.pollTransaction(sendResult.hash);

    if (txResult.status !== 'SUCCESS') {
        throw new Error(`Transaction not successful: ${JSON.stringify(txResult)}`);
    }

    // Compute the WASM hash (SHA-256 of the WASM bytes)
    const wasmHash = hash(wasmBuffer).toString('hex');

    // Query and display the WASM code TTL
    await queryWasmTtl(env, wasmHash, server);

    return wasmHash;
}

/**
 * Generic contract deployment helper that works with any contract Client
 *
 * @param ClientClass - The contract Client class (e.g., EndpointClient, SMLClient)
 * @param wasmFilePath - Path to the compiled WASM file
 * @param constructorArgs - Arguments for the contract's constructor
 * @param deployer - The keypair that will deploy the contract
 * @param options - Optional deployment options (salt, fee, timeout, etc.)
 * @returns The deployed contract's Client instance with the contractId
 */
export async function deployContract<T extends { options: { contractId: string } }>(
    env: StellarTestEnv,
    ClientClass: DeployableContractClient<T>,
    wasmFilePath: string,
    constructorArgs: unknown,
    deployer: Keypair,
    options: {
        salt?: Buffer;
        wasmHash?: string;
        rpcUrl?: string;
        networkPassphrase?: string;
        allowHttp?: boolean;
    } = {},
): Promise<T> {
    const {
        rpcUrl = env.RPC_URL,
        networkPassphrase = env.NETWORK_PASSPHRASE,
        allowHttp = true,
        salt,
    } = options;

    const server = new rpc.Server(rpcUrl, {
        allowHttp: allowHttp,
    });

    let wasmHash = options.wasmHash;
    if (wasmHash) {
        console.log('📦 Using pre-uploaded WASM hash:', wasmHash);
    } else {
        // Step 1: Read WASM file
        console.log('📖 Reading WASM file from:', wasmFilePath);
        const wasmBuffer = readFileSync(wasmFilePath);

        // Step 2: Upload WASM and get hash
        console.log('📤 Uploading WASM...');
        wasmHash = await uploadWasm(env, wasmBuffer, deployer, server);
        console.log('✅ WASM uploaded, hash:', wasmHash);
    }

    // Step 3: Deploy the contract
    console.log('🚀 Deploying contract...');
    const deployOptions = {
        wasmHash,
        publicKey: deployer.publicKey(),
        signTransaction: async (tx: string) => {
            const transaction = TransactionBuilder.fromXDR(tx, networkPassphrase);
            transaction.sign(deployer);
            return {
                signedTxXdr: transaction.toXDR(),
                signerAddress: deployer.publicKey(),
            };
        },
        rpcUrl,
        networkPassphrase,
        allowHttp,
        salt,
    };
    const deployTx =
        constructorArgs == null
            ? await ClientClass.deploy(deployOptions)
            : await ClientClass.deploy(constructorArgs, deployOptions);

    // Step 4: Sign and send
    const sentTx = await deployTx.signAndSend();

    // Step 5: Extract contract ID from result
    const contractClient = sentTx.result;
    const contractId = contractClient.options.contractId;
    console.log('✅ Contract deployed at:', contractId);

    return contractClient;
}

export async function deployNativeSac(env: StellarTestEnv): Promise<void> {
    await deployAssetSac(env, Asset.native());
    console.log('✅ Native SAC deployed');
}

export async function deployZroToken(env: StellarTestEnv): Promise<void> {
    const server = new rpc.Server(env.RPC_URL, {
        allowHttp: true,
    });

    // First, issue the ZRO token.
    // We can't changeTrust of Issuer account, because the Issuer can't hold the asset.
    const account = await server.getAccount(env.DEFAULT_DEPLOYER.publicKey());
    const transaction = new TransactionBuilder(account, {
        fee: BASE_FEE,
        networkPassphrase: env.NETWORK_PASSPHRASE,
    })
        .addOperation(
            Operation.changeTrust({
                asset: env.ZRO_ASSET,
                source: env.ZRO_DISTRIBUTOR.publicKey(),
            }),
        )
        .addOperation(
            Operation.payment({
                asset: env.ZRO_ASSET,
                amount: '10000',
                destination: env.ZRO_DISTRIBUTOR.publicKey(),
            }),
        )
        .setTimeout(10)
        .build();
    transaction.sign(env.DEFAULT_DEPLOYER, env.ZRO_DISTRIBUTOR);

    const sendResult = await server.sendTransaction(transaction);
    if (sendResult.status !== 'PENDING') {
        throw new Error(`Failed to issue ZRO token: ${JSON.stringify(sendResult)}`);
    }
    const txResult = await server.pollTransaction(sendResult.hash);
    if (txResult.status !== 'SUCCESS') {
        throw new Error(`Failed to issue ZRO token: ${JSON.stringify(txResult)}`);
    }
    console.log('✅ ZRO asset issued');

    // Deploy the Stellar Asset Contract (SAC)
    await deployAssetSac(env, env.ZRO_ASSET);
    console.log('✅ ZRO SAC deployed');
}

/**
 * Deploy SAC for a custom asset using TypeScript
 */
export async function deployAssetSac(env: StellarTestEnv, asset: Asset): Promise<string> {
    console.log('Deploying SAC for asset:', asset.toString());

    const server = new rpc.Server(env.RPC_URL, { allowHttp: true });
    const account = await server.getAccount(env.DEFAULT_DEPLOYER.publicKey());

    // Build transaction with createStellarAssetContract operation
    const deployTx = new TransactionBuilder(account, {
        fee: BASE_FEE,
        networkPassphrase: env.NETWORK_PASSPHRASE,
    })
        .addOperation(
            Operation.createStellarAssetContract({
                asset: asset,
            }),
        )
        .setTimeout(30)
        .build();

    // Simulate transaction first (required for contract operations)
    const simulated = await server.simulateTransaction(deployTx);

    // Check if simulation was successful
    if (rpc.Api.isSimulationError(simulated)) {
        // Soroban returns ExistingValue when the contract is already deployed.
        // This is expected on container reuse (local dev reruns).
        if (simulated.error?.includes('ExistingValue')) {
            console.log(`SAC for ${asset.toString()} already deployed, skipping`);
            return asset.contractId(env.NETWORK_PASSPHRASE);
        }
        throw new Error(`Transaction simulation failed: ${JSON.stringify(simulated)}`);
    }

    const preparedTx = rpc.assembleTransaction(deployTx, simulated).build();

    // Sign and send
    preparedTx.sign(env.DEFAULT_DEPLOYER);
    const sendResult = await server.sendTransaction(preparedTx);
    if (sendResult.status !== 'PENDING') {
        throw new Error(`Failed to deploy SAC: ${JSON.stringify(sendResult)}`);
    }
    const txResult = await server.pollTransaction(sendResult.hash);
    if (txResult.status !== 'SUCCESS') {
        throw new Error(`SAC deployment not successful: ${JSON.stringify(txResult)}`);
    }
    return asset.contractId(env.NETWORK_PASSPHRASE);
}
