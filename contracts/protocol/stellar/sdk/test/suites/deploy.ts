import {
    Asset,
    BASE_FEE,
    hash,
    Keypair,
    Operation,
    rpc,
    TransactionBuilder,
    xdr,
} from '@stellar/stellar-sdk';
import { readFileSync } from 'fs';

import {
    DEFAULT_DEPLOYER,
    NETWORK_PASSPHRASE,
    RPC_URL,
    ZRO_ASSET,
    ZRO_DISTRIBUTOR,
} from './constants';

/**
 * Query and display the TTL (Time To Live) of uploaded WASM code
 *
 * @param wasmHash - The hex-encoded SHA-256 hash of the WASM code
 * @param server - The Stellar RPC server instance
 * @param rpcUrl - Optional RPC URL (defaults to RPC_URL constant)
 */
async function queryWasmTtl(wasmHash: string, server: rpc.Server, rpcUrl?: string): Promise<void> {
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
        const rpcEndpoint = rpcUrl || (server as any).serverURL || RPC_URL;
        const response = await fetch(rpcEndpoint, {
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

        const result = await response.json();
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
        networkPassphrase: NETWORK_PASSPHRASE,
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
    await queryWasmTtl(wasmHash, server);

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
    ClientClass: {
        deploy: (
            argsOrOptions: any,
            options?: any,
        ) => Promise<{ signAndSend: () => Promise<{ result: T }> }>;
    },
    wasmFilePath: string,
    constructorArgs: any | undefined,
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
        rpcUrl = RPC_URL,
        networkPassphrase = NETWORK_PASSPHRASE,
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
        wasmHash = await uploadWasm(wasmBuffer, deployer, server);
        console.log('✅ WASM uploaded, hash:', wasmHash);
    }

    // Step 3: Deploy the contract
    console.log('🚀 Deploying contract...');
    const deployOptions = {
        wasmHash: wasmHash,
        publicKey: deployer.publicKey(),
        signTransaction: async (tx: string) => {
            const transaction = TransactionBuilder.fromXDR(tx, networkPassphrase);
            transaction.sign(deployer);
            return {
                signedTxXdr: transaction.toXDR(),
                signerAddress: deployer.publicKey(),
            };
        },
        rpcUrl: rpcUrl,
        networkPassphrase: networkPassphrase,
        allowHttp: allowHttp,
        salt: salt,
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

export async function deployNativeSac(): Promise<void> {
    await deployAssetSac(Asset.native());
    console.log('✅ Native SAC deployed');
}

export async function deployZroToken(): Promise<void> {
    const server = new rpc.Server(RPC_URL, {
        allowHttp: true,
    });

    // First, issue the ZRO token.
    // We can't changeTrust of Issuer account, because the Issuer can't hold the asset.
    const account = await server.getAccount(DEFAULT_DEPLOYER.publicKey());
    const transaction = new TransactionBuilder(account, {
        fee: BASE_FEE,
        networkPassphrase: NETWORK_PASSPHRASE,
    })
        .addOperation(
            Operation.changeTrust({ asset: ZRO_ASSET, source: ZRO_DISTRIBUTOR.publicKey() }),
        )
        .addOperation(
            Operation.payment({
                asset: ZRO_ASSET,
                amount: '10000',
                destination: ZRO_DISTRIBUTOR.publicKey(),
            }),
        )
        .setTimeout(10)
        .build();
    transaction.sign(DEFAULT_DEPLOYER, ZRO_DISTRIBUTOR);

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
    await deployAssetSac(ZRO_ASSET);
    console.log('✅ ZRO SAC deployed');
}

/**
 * Deploy SAC for a custom asset using TypeScript
 */
export async function deployAssetSac(asset: Asset): Promise<string> {
    console.log('Deploying SAC for asset:', asset.toString());

    const server = new rpc.Server(RPC_URL, { allowHttp: true });
    const account = await server.getAccount(DEFAULT_DEPLOYER.publicKey());

    // Build transaction with createStellarAssetContract operation
    const deployTx = new TransactionBuilder(account, {
        fee: BASE_FEE,
        networkPassphrase: NETWORK_PASSPHRASE,
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
            return asset.contractId(NETWORK_PASSPHRASE);
        }
        throw new Error(`Transaction simulation failed: ${JSON.stringify(simulated)}`);
    }

    const preparedTx = rpc.assembleTransaction(deployTx, simulated).build();

    // Sign and send
    preparedTx.sign(DEFAULT_DEPLOYER);
    const sendResult = await server.sendTransaction(preparedTx);
    if (sendResult.status !== 'PENDING') {
        throw new Error(`Failed to deploy SAC: ${JSON.stringify(sendResult)}`);
    }
    const txResult = await server.pollTransaction(sendResult.hash);
    if (txResult.status !== 'SUCCESS') {
        throw new Error(`SAC deployment not successful: ${JSON.stringify(txResult)}`);
    }
    return asset.contractId(NETWORK_PASSPHRASE);
}
