import type { Keypair } from '@stellar/stellar-sdk';
import { rpc } from '@stellar/stellar-sdk';
import { readFileSync } from 'fs';
import path from 'path';

import { createClient } from './client.js';
import { type DeployableContractClient, deployContract, uploadWasm } from './deploy.js';
import type { StellarTestEnv } from './env.js';
import { startStellarLocalnet, stopStellarLocalnet } from './localnet.js';

/** Vitest globalSetup context subset (avoids a hard vitest type dependency in src/). */
export type ProtocolGlobalSetupContext = {
    provide: (key: 'chainA' | 'chainB', value: ChainAddresses) => void;
};

type SigningTransaction = {
    signAndSend: () => Promise<unknown>;
};

/**
 * Generated Soroban clients expose asynchronous methods that construct a signable transaction.
 * Their method names and argument types remain owned by the generated SDK.
 */
type ProtocolClient = Record<string, (args: object) => Promise<SigningTransaction>>;

type ProtocolClientConstructor<TClient extends ProtocolClient> = new (options: {
    contractId: string;
    publicKey: string;
    signTransaction: (tx: string) => Promise<{ signedTxXdr: string; signerAddress: string }>;
    rpcUrl: string;
    networkPassphrase: string;
    allowHttp: boolean;
}) => TClient;

export interface ProtocolContractModule {
    /** The generated SDK Client constructor. Validated at the adapter boundary before use. */
    Client: unknown;
}

/**
 * Protocol contract modules from `@layerzerolabs/lz-v2-stellar-sdk`.
 * Injected by consumers to avoid a workspace cycle (test-utils ↔ sdk).
 */
export interface ProtocolStackModules {
    endpoint: ProtocolContractModule;
    treasury: ProtocolContractModule;
    uln302: ProtocolContractModule;
    sml: ProtocolContractModule;
    priceFeed: ProtocolContractModule;
    executorFeeLib: ProtocolContractModule;
    dvnFeeLib: ProtocolContractModule;
    dvn: ProtocolContractModule;
    executorHelper: ProtocolContractModule;
    executor: ProtocolContractModule;
}

/**
 * Addresses for a single chain's protocol contracts
 */
export interface ChainAddresses {
    eid: number;
    endpointV2: string;
    uln302: string;
    sml: string;
    treasury: string;
    executor: string;
    executorHelper: string;
    executorFeeLib: string;
    priceFeed: string;
    dvnFeeLib: string;
    dvn: string;
}

/**
 * Clients for a single chain's protocol contracts
 */
interface ChainClients {
    endpointClient: ProtocolClient;
    uln302Client: ProtocolClient;
    smlClient: ProtocolClient;
    treasuryClient: ProtocolClient;
    executorClient: ProtocolClient;
    executorHelperClient: ProtocolClient;
    executorFeeLibClient: ProtocolClient;
    priceFeedClient: ProtocolClient;
    dvnFeeLibClient: ProtocolClient;
    dvnClient: ProtocolClient;
}

/**
 * Complete chain setup with addresses and clients
 */
interface ChainSetup {
    addresses: ChainAddresses;
    clients: ChainClients;
}

interface WasmHashes {
    endpoint: string;
    treasury: string;
    uln302: string;
    sml: string;
    priceFeed: string;
    executorFeeLib: string;
    dvnFeeLib: string;
    dvn: string;
    executorHelper: string;
    executor: string;
}

function getProtocolClientConstructor<TClient extends ProtocolClient>(
    client: unknown,
    moduleName: string,
): ProtocolClientConstructor<TClient> {
    if (typeof client !== 'function') {
        throw new TypeError(`${moduleName}.Client must be a generated contract client constructor`);
    }
    return client as ProtocolClientConstructor<TClient>;
}

function getDeployableProtocolClient<TClient extends { options: { contractId: string } }>(
    client: unknown,
    moduleName: string,
): DeployableContractClient<TClient> {
    if (
        typeof client !== 'function' ||
        !('deploy' in client) ||
        typeof client.deploy !== 'function'
    ) {
        throw new TypeError(`${moduleName}.Client must expose a deploy method`);
    }
    return client as DeployableContractClient<TClient>;
}

function createProtocolClient(
    env: StellarTestEnv,
    client: unknown,
    contractId: string,
    moduleName: string,
): ProtocolClient {
    return createClient(
        env,
        getProtocolClientConstructor<ProtocolClient>(client, moduleName),
        contractId,
    );
}

/**
 * Upload all protocol WASM files once and return their hashes.
 */
async function uploadAllWasms(env: StellarTestEnv, wasmDir: string): Promise<WasmHashes> {
    const server = new rpc.Server(env.RPC_URL, { allowHttp: true });

    const wasmFiles = {
        endpoint: 'endpoint_v2.wasm',
        treasury: 'treasury.wasm',
        uln302: 'uln302.wasm',
        sml: 'simple_message_lib.wasm',
        priceFeed: 'price_feed.wasm',
        executorFeeLib: 'executor_fee_lib.wasm',
        dvnFeeLib: 'dvn_fee_lib.wasm',
        dvn: 'dvn.wasm',
        executorHelper: 'executor_helper.wasm',
        executor: 'executor.wasm',
    };

    const hashes: Record<string, string> = {};
    for (const [name, file] of Object.entries(wasmFiles)) {
        const wasmBuffer = readFileSync(path.join(wasmDir, file));
        console.log(`📤 Uploading ${name} WASM (${(wasmBuffer.length / 1024).toFixed(1)} KB)...`);
        hashes[name] = await uploadWasm(env, wasmBuffer, env.DEFAULT_DEPLOYER, server);
    }

    return hashes as unknown as WasmHashes;
}

/**
 * Deploy all protocol contracts for a single chain using pre-uploaded WASM hashes.
 * The deployer pays gas; contract ownership is always DEFAULT_DEPLOYER.
 */
async function deployChainContracts(
    env: StellarTestEnv,
    protocol: ProtocolStackModules,
    eid: number,
    chainLabel: string,
    deployer: Keypair,
    wasmDir: string,
    wasmHashes: WasmHashes,
): Promise<ChainAddresses> {
    const addresses: ChainAddresses = {
        eid,
        endpointV2: '',
        uln302: '',
        sml: '',
        treasury: '',
        executor: '',
        executorHelper: '',
        executorFeeLib: '',
        priceFeed: '',
        dvnFeeLib: '',
        dvn: '',
    };

    // 1. Deploy Endpoint
    console.log(`🚀 [${chainLabel}] Deploying Endpoint (EID: ${eid})...`);
    const deployedEndpoint = await deployContract<
        ProtocolClient & { options: { contractId: string } }
    >(
        env,
        getDeployableProtocolClient(protocol.endpoint.Client, 'endpoint'),
        path.join(wasmDir, 'endpoint_v2.wasm'),
        {
            eid,
            owner: env.DEFAULT_DEPLOYER.publicKey(),
            native_token: env.NATIVE_TOKEN_ADDRESS,
        },
        deployer,
        { wasmHash: wasmHashes.endpoint },
    );
    addresses.endpointV2 = deployedEndpoint.options.contractId;
    console.log(`✅ [${chainLabel}] Endpoint deployed:`, addresses.endpointV2);

    // 2. Deploy Treasury
    console.log(`🚀 [${chainLabel}] Deploying Treasury...`);
    const deployedTreasury = await deployContract<
        ProtocolClient & { options: { contractId: string } }
    >(
        env,
        getDeployableProtocolClient(protocol.treasury.Client, 'treasury'),
        path.join(wasmDir, 'treasury.wasm'),
        { owner: env.DEFAULT_DEPLOYER.publicKey() },
        deployer,
        { wasmHash: wasmHashes.treasury },
    );
    addresses.treasury = deployedTreasury.options.contractId;
    console.log(`✅ [${chainLabel}] Treasury deployed:`, addresses.treasury);

    // 3. Deploy ULN302
    console.log(`🚀 [${chainLabel}] Deploying ULN302...`);
    const deployedUln302 = await deployContract<
        ProtocolClient & { options: { contractId: string } }
    >(
        env,
        getDeployableProtocolClient(protocol.uln302.Client, 'uln302'),
        path.join(wasmDir, 'uln302.wasm'),
        {
            owner: env.DEFAULT_DEPLOYER.publicKey(),
            endpoint: addresses.endpointV2,
            treasury: addresses.treasury,
        },
        deployer,
        { wasmHash: wasmHashes.uln302 },
    );
    addresses.uln302 = deployedUln302.options.contractId;
    console.log(`✅ [${chainLabel}] ULN302 deployed:`, addresses.uln302);

    // 4. Deploy SML (SimpleMessageLib)
    console.log(`🚀 [${chainLabel}] Deploying SimpleMessageLib...`);
    const deployedSml = await deployContract<ProtocolClient & { options: { contractId: string } }>(
        env,
        getDeployableProtocolClient(protocol.sml.Client, 'sml'),
        path.join(wasmDir, 'simple_message_lib.wasm'),
        {
            owner: env.DEFAULT_DEPLOYER.publicKey(),
            endpoint: addresses.endpointV2,
            fee_recipient: env.DEFAULT_DEPLOYER.publicKey(),
        },
        deployer,
        { wasmHash: wasmHashes.sml },
    );
    addresses.sml = deployedSml.options.contractId;
    console.log(`✅ [${chainLabel}] SimpleMessageLib deployed:`, addresses.sml);

    // 5. Deploy Price Feed
    console.log(`🚀 [${chainLabel}] Deploying Price Feed...`);
    const deployedPriceFeed = await deployContract<
        ProtocolClient & { options: { contractId: string } }
    >(
        env,
        getDeployableProtocolClient(protocol.priceFeed.Client, 'priceFeed'),
        path.join(wasmDir, 'price_feed.wasm'),
        {
            owner: env.DEFAULT_DEPLOYER.publicKey(),
            price_updater: env.DEFAULT_DEPLOYER.publicKey(),
        },
        deployer,
        { wasmHash: wasmHashes.priceFeed },
    );
    addresses.priceFeed = deployedPriceFeed.options.contractId;
    console.log(`✅ [${chainLabel}] Price Feed deployed:`, addresses.priceFeed);

    // 6. Deploy Executor Fee Lib
    console.log(`🚀 [${chainLabel}] Deploying Executor Fee Lib...`);
    const deployedExecutorFeeLib = await deployContract<
        ProtocolClient & { options: { contractId: string } }
    >(
        env,
        getDeployableProtocolClient(protocol.executorFeeLib.Client, 'executorFeeLib'),
        path.join(wasmDir, 'executor_fee_lib.wasm'),
        { owner: env.DEFAULT_DEPLOYER.publicKey() },
        deployer,
        { wasmHash: wasmHashes.executorFeeLib },
    );
    addresses.executorFeeLib = deployedExecutorFeeLib.options.contractId;
    console.log(`✅ [${chainLabel}] Executor Fee Lib deployed:`, addresses.executorFeeLib);

    // 7. Deploy DVN Fee Lib
    console.log(`🚀 [${chainLabel}] Deploying DVN Fee Lib...`);
    const deployedDvnFeeLib = await deployContract<
        ProtocolClient & { options: { contractId: string } }
    >(
        env,
        getDeployableProtocolClient(protocol.dvnFeeLib.Client, 'dvnFeeLib'),
        path.join(wasmDir, 'dvn_fee_lib.wasm'),
        { owner: env.DEFAULT_DEPLOYER.publicKey() },
        deployer,
        { wasmHash: wasmHashes.dvnFeeLib },
    );
    addresses.dvnFeeLib = deployedDvnFeeLib.options.contractId;
    console.log(`✅ [${chainLabel}] DVN Fee Lib deployed:`, addresses.dvnFeeLib);

    // 8. Deploy DVN (same signer for both chains)
    console.log(`🚀 [${chainLabel}] Deploying DVN...`);
    const deployedDvn = await deployContract<ProtocolClient & { options: { contractId: string } }>(
        env,
        getDeployableProtocolClient(protocol.dvn.Client, 'dvn'),
        path.join(wasmDir, 'dvn.wasm'),
        {
            vid: env.DVN_VID,
            signers: [env.DVN_SIGNER.ethAddress],
            threshold: 1,
            admins: [env.DEFAULT_DEPLOYER.publicKey()],
            supported_msglibs: [addresses.uln302],
            price_feed: addresses.priceFeed,
            default_multiplier_bps: 10000,
            worker_fee_lib: addresses.dvnFeeLib,
            deposit_address: env.DEFAULT_DEPLOYER.publicKey(),
        },
        deployer,
        { wasmHash: wasmHashes.dvn },
    );
    addresses.dvn = deployedDvn.options.contractId;
    console.log(`✅ [${chainLabel}] DVN deployed:`, addresses.dvn);

    // 9. Deploy Executor Helper
    console.log(`🚀 [${chainLabel}] Deploying Executor Helper...`);
    const deployedExecutorHelper = await deployContract<
        ProtocolClient & { options: { contractId: string } }
    >(
        env,
        getDeployableProtocolClient(protocol.executorHelper.Client, 'executorHelper'),
        path.join(wasmDir, 'executor_helper.wasm'),
        undefined,
        deployer,
        { wasmHash: wasmHashes.executorHelper },
    );
    addresses.executorHelper = deployedExecutorHelper.options.contractId;
    console.log(`✅ [${chainLabel}] Executor Helper deployed:`, addresses.executorHelper);

    // 10. Deploy Executor (supports both ULN302 and SML)
    console.log(`🚀 [${chainLabel}] Deploying Executor...`);
    const deployedExecutor = await deployContract<
        ProtocolClient & { options: { contractId: string } }
    >(
        env,
        getDeployableProtocolClient(protocol.executor.Client, 'executor'),
        path.join(wasmDir, 'executor.wasm'),
        {
            owner: env.DEFAULT_DEPLOYER.publicKey(),
            endpoint: addresses.endpointV2,
            admins: [env.EXECUTOR_ADMIN.publicKey(), env.DEFAULT_DEPLOYER.publicKey()],
            message_libs: [addresses.uln302, addresses.sml],
            price_feed: addresses.priceFeed,
            default_multiplier_bps: 10000,
            worker_fee_lib: addresses.executorFeeLib,
            deposit_address: env.DEFAULT_DEPLOYER.publicKey(),
        },
        deployer,
        { wasmHash: wasmHashes.executor },
    );
    addresses.executor = deployedExecutor.options.contractId;
    console.log(`✅ [${chainLabel}] Executor deployed:`, addresses.executor);

    return addresses;
}

/**
 * Register executor helper and create owner-signed clients for a chain.
 * Must be called sequentially (uses DEFAULT_DEPLOYER for signing).
 */
async function initChainClients(
    env: StellarTestEnv,
    protocol: ProtocolStackModules,
    addresses: ChainAddresses,
    chainLabel: string,
): Promise<ChainSetup> {
    // Register Executor Helper with Executor (needs owner-signed client)
    console.log(`🚀 [${chainLabel}] Registering Executor Helper with Executor...`);
    const executorClient = createProtocolClient(
        env,
        protocol.executor.Client,
        addresses.executor,
        'executor',
    );
    await (
        await executorClient.set_executor_helper({
            helper: addresses.executorHelper,
            allowed_functions: ['execute', 'compose'],
        })
    ).signAndSend();
    console.log(`✅ [${chainLabel}] Executor Helper registered`);

    const clients: ChainClients = {
        endpointClient: createProtocolClient(
            env,
            protocol.endpoint.Client,
            addresses.endpointV2,
            'endpoint',
        ),
        uln302Client: createProtocolClient(env, protocol.uln302.Client, addresses.uln302, 'uln302'),
        smlClient: createProtocolClient(env, protocol.sml.Client, addresses.sml, 'sml'),
        treasuryClient: createProtocolClient(
            env,
            protocol.treasury.Client,
            addresses.treasury,
            'treasury',
        ),
        executorClient,
        executorHelperClient: createProtocolClient(
            env,
            protocol.executorHelper.Client,
            addresses.executorHelper,
            'executorHelper',
        ),
        executorFeeLibClient: createProtocolClient(
            env,
            protocol.executorFeeLib.Client,
            addresses.executorFeeLib,
            'executorFeeLib',
        ),
        priceFeedClient: createProtocolClient(
            env,
            protocol.priceFeed.Client,
            addresses.priceFeed,
            'priceFeed',
        ),
        dvnFeeLibClient: createProtocolClient(
            env,
            protocol.dvnFeeLib.Client,
            addresses.dvnFeeLib,
            'dvnFeeLib',
        ),
        dvnClient: createProtocolClient(env, protocol.dvn.Client, addresses.dvn, 'dvn'),
    };

    return { addresses, clients };
}

/**
 * Wire a single chain's protocol contracts for cross-chain communication
 *
 * @param chain - The chain to wire (this chain)
 * @param otherChain - The other chain (for cross-references)
 * @param chainLabel - Label for logging
 */
async function wireChainContracts(
    env: StellarTestEnv,
    chain: ChainSetup,
    otherChain: ChainSetup,
    chainLabel: string,
): Promise<void> {
    const { addresses, clients } = chain;
    const { endpointClient, uln302Client, priceFeedClient, executorClient, dvnClient } = clients;

    const thisEid = addresses.eid;
    const otherEid = otherChain.addresses.eid;

    console.log(
        `\n🔗 [${chainLabel}] Wiring protocol contracts (EID: ${thisEid} ↔ ${otherEid})...`,
    );

    // Register libraries
    await (await endpointClient.register_library({ new_lib: addresses.uln302 })).signAndSend();
    await (await endpointClient.register_library({ new_lib: addresses.sml })).signAndSend();
    console.log(`✅ [${chainLabel}] Libraries registered (ULN302 + SML)`);

    // Set ZRO token
    await (await endpointClient.set_zro({ zro: env.ZRO_TOKEN_ADDRESS })).signAndSend();
    console.log(`✅ [${chainLabel}] ZRO token set`);

    // ========================================================================
    // Configure for SENDING to the other chain (dst_eid = otherEid)
    // ========================================================================

    // ULN302 executor config for sending to other chain
    await (
        await uln302Client.set_default_executor_configs({
            params: [
                {
                    dst_eid: otherEid,
                    config: { executor: addresses.executor, max_message_size: 10000 },
                },
            ],
        })
    ).signAndSend();
    console.log(`✅ [${chainLabel}] ULN302 executor config set for dst_eid=${otherEid}`);

    // ULN302 send config: when sending to otherEid, use THIS chain's DVN for fee quoting
    // (The DVN needs dst_config for the destination EID to calculate fees)
    await (
        await uln302Client.set_default_send_uln_configs({
            params: [
                {
                    eid: otherEid,
                    config: {
                        confirmations: 1n,
                        required_dvns: [addresses.dvn], // THIS chain's DVN (has dst_config for otherEid)
                        optional_dvns: [],
                        optional_dvn_threshold: 0,
                    },
                },
            ],
        })
    ).signAndSend();
    console.log(
        `✅ [${chainLabel}] ULN302 send config set for eid=${otherEid} (DVN: ${addresses.dvn})`,
    );

    // ========================================================================
    // Configure for RECEIVING from the other chain (src_eid = otherEid)
    // ========================================================================

    // ULN302 receive config: when receiving from otherEid, THIS chain's DVN verifies
    await (
        await uln302Client.set_default_receive_uln_configs({
            params: [
                {
                    eid: otherEid,
                    config: {
                        confirmations: 1n,
                        required_dvns: [addresses.dvn], // THIS chain's DVN verifies incoming
                        optional_dvns: [],
                        optional_dvn_threshold: 0,
                    },
                },
            ],
        })
    ).signAndSend();
    console.log(
        `✅ [${chainLabel}] ULN302 receive config set for eid=${otherEid} (DVN: ${addresses.dvn})`,
    );

    // Set default send/receive libraries for the other chain
    await (
        await endpointClient.set_default_send_library({
            dst_eid: otherEid,
            new_lib: addresses.uln302,
        })
    ).signAndSend();
    await (
        await endpointClient.set_default_receive_library({
            src_eid: otherEid,
            new_lib: addresses.uln302,
            grace_period: 0n,
        })
    ).signAndSend();
    console.log(`✅ [${chainLabel}] Default libraries set to ULN302 for eid=${otherEid}`);

    // ========================================================================
    // Configure Price Feed for both chains
    // ========================================================================

    await (
        await priceFeedClient.set_price_ratio_denominator({ denominator: 100000000000000000000n })
    ).signAndSend();
    await (
        await priceFeedClient.set_native_token_price_usd({
            price_updater: env.DEFAULT_DEPLOYER.publicKey(),
            native_token_price_usd: 1000000000000000000n,
        })
    ).signAndSend();

    // Set prices for the other chain
    const NORMALIZED_OTHER_EID = otherEid % 30000;
    await (
        await priceFeedClient.set_price({
            price_updater: env.DEFAULT_DEPLOYER.publicKey(),
            prices: [
                {
                    eid: NORMALIZED_OTHER_EID,
                    price: {
                        gas_per_byte: 1,
                        gas_price_in_unit: 1n,
                        price_ratio: 100000000000000000000n,
                    },
                },
            ],
        })
    ).signAndSend();
    console.log(`✅ [${chainLabel}] Price Feed configured for eid=${otherEid}`);

    // ========================================================================
    // Configure Executor for sending to other chain
    // ========================================================================

    await (
        await executorClient.set_dst_config({
            admin: env.DEFAULT_DEPLOYER.publicKey(),
            params: [
                {
                    dst_eid: otherEid,
                    dst_config: {
                        floor_margin_usd: 0n,
                        lz_compose_base_gas: 50000n,
                        lz_receive_base_gas: 100000n,
                        multiplier_bps: 10000,
                        native_cap: 1000000000000n,
                    },
                },
            ],
        })
    ).signAndSend();
    console.log(`✅ [${chainLabel}] Executor configured for dst_eid=${otherEid}`);

    // ========================================================================
    // Configure DVN for verifying packets going to other chain
    // ========================================================================

    await (
        await dvnClient.set_dst_config({
            admin: env.DEFAULT_DEPLOYER.publicKey(),
            params: [
                {
                    dst_eid: otherEid,
                    config: {
                        floor_margin_usd: 0n,
                        gas: 100000n,
                        multiplier_bps: 10000,
                    },
                },
            ],
        })
    ).signAndSend();
    console.log(`✅ [${chainLabel}] DVN configured for dst_eid=${otherEid}`);

    console.log(`🎉 [${chainLabel}] Protocol wiring complete!`);
}

export interface ProtocolStackGlobalSetupOptions {
    /**
     * Directory containing protocol WASM artifacts, or an async resolver.
     * Consumers typically resolve via getFullyQualifiedRepoRootPath.
     */
    wasmDir: string | (() => string | Promise<string>);
    /**
     * Protocol contract modules from `@layerzerolabs/lz-v2-stellar-sdk`.
     * Passed by the consumer to avoid a workspace dependency cycle.
     */
    protocol: ProtocolStackModules;
}

/**
 * Returns a Vitest globalSetup that deploys two protocol stacks and wires them.
 */
export function createProtocolStackGlobalSetup(
    env: StellarTestEnv,
    options: ProtocolStackGlobalSetupOptions,
): (ctx: ProtocolGlobalSetupContext) => Promise<() => Promise<void>> {
    return async function globalSetup({
        provide,
    }: ProtocolGlobalSetupContext): Promise<() => Promise<void>> {
        console.log('\n========================================');
        console.log('🌐 GLOBAL SETUP: Starting Stellar Localnet');
        console.log('========================================\n');

        await startStellarLocalnet({ env });

        try {
            const wasmDir =
                typeof options.wasmDir === 'function' ? await options.wasmDir() : options.wasmDir;

            console.log('\n========================================');
            console.log('📤 GLOBAL SETUP: Uploading WASM (once)');
            console.log('========================================\n');

            const wasmHashes = await uploadAllWasms(env, wasmDir);

            console.log('\n========================================');
            console.log('📦 GLOBAL SETUP: Deploying Protocol Contracts (Two Chains in Parallel)');
            console.log('========================================\n');

            const { protocol } = options;

            const [addressesA, addressesB] = await Promise.all([
                deployChainContracts(
                    env,
                    protocol,
                    env.EID_A,
                    'Chain A',
                    env.DEFAULT_DEPLOYER,
                    wasmDir,
                    wasmHashes,
                ),
                deployChainContracts(
                    env,
                    protocol,
                    env.EID_B,
                    'Chain B',
                    env.CHAIN_B_DEPLOYER,
                    wasmDir,
                    wasmHashes,
                ),
            ]);

            const chainA = await initChainClients(env, protocol, addressesA, 'Chain A');
            const chainB = await initChainClients(env, protocol, addressesB, 'Chain B');

            console.log('\n========================================');
            console.log('🔗 GLOBAL SETUP: Wiring Protocol Contracts (Cross-Chain)');
            console.log('========================================\n');

            await wireChainContracts(env, chainA, chainB, 'Chain A');
            await wireChainContracts(env, chainB, chainA, 'Chain B');

            provide('chainA', chainA.addresses);
            provide('chainB', chainB.addresses);
            console.log('\n✅ Chain addresses provided to tests (in-memory)');
            console.log('   Chain A (EID ' + env.EID_A + '):', chainA.addresses.endpointV2);
            console.log('   Chain B (EID ' + env.EID_B + '):', chainB.addresses.endpointV2);

            console.log('\n========================================');
            console.log('✅ GLOBAL SETUP COMPLETE (Two-Chain Cross-Chain Ready)');
            console.log('========================================\n');
        } catch (error) {
            await stopStellarLocalnet({ env });
            throw error;
        }

        return async () => {
            console.log('\n========================================');
            console.log('🛑 GLOBAL TEARDOWN: Stopping Stellar Localnet');
            console.log('========================================\n');

            await stopStellarLocalnet({ env });
        };
    };
}
