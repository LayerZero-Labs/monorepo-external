import { Keypair, rpc } from '@stellar/stellar-sdk';
import { readFileSync } from 'fs';
import path from 'path';
import type { GlobalSetupContext } from 'vitest/node';

import { getFullyQualifiedRepoRootPath } from '@layerzerolabs/common-node-utils';

import { Client as DvnClient } from '../../src/generated/dvn';
import { Client as DvnFeeLibClient } from '../../src/generated/dvn_fee_lib';
import { Client as EndpointClient } from '../../src/generated/endpoint';
import { Client as ExecutorClient } from '../../src/generated/executor';
import { Client as ExecutorFeeLibClient } from '../../src/generated/executor_fee_lib';
import { Client as ExecutorHelperClient } from '../../src/generated/executor_helper';
import { Client as PriceFeedClient } from '../../src/generated/price_feed';
import { Client as SMLClient } from '../../src/generated/sml';
import { Client as TreasuryClient } from '../../src/generated/treasury';
import { Client as Uln302Client } from '../../src/generated/uln302';
import { createClient } from '../utils';
import {
    CHAIN_B_DEPLOYER,
    DEFAULT_DEPLOYER,
    DVN_SIGNER,
    DVN_VID,
    EID_A,
    EID_B,
    EXECUTOR_ADMIN,
    NATIVE_TOKEN_ADDRESS,
    RPC_URL,
    ZRO_TOKEN_ADDRESS,
} from './constants';
import { deployContract, uploadWasm } from './deploy';
import { startStellarLocalnet, stopStellarLocalnet } from './localnet';

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
    endpointClient: EndpointClient;
    uln302Client: Uln302Client;
    smlClient: SMLClient;
    treasuryClient: TreasuryClient;
    executorClient: ExecutorClient;
    executorHelperClient: ExecutorHelperClient;
    executorFeeLibClient: ExecutorFeeLibClient;
    priceFeedClient: PriceFeedClient;
    dvnFeeLibClient: DvnFeeLibClient;
    dvnClient: DvnClient;
}

/**
 * Complete chain setup with addresses and clients
 */
interface ChainSetup {
    addresses: ChainAddresses;
    clients: ChainClients;
}

// Declare the injection key type for vitest
declare module 'vitest' {
    export interface ProvidedContext {
        chainA: ChainAddresses;
        chainB: ChainAddresses;
    }
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

/**
 * Upload all protocol WASM files once and return their hashes.
 */
async function uploadAllWasms(wasmDir: string): Promise<WasmHashes> {
    const server = new rpc.Server(RPC_URL, { allowHttp: true });

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
        hashes[name] = await uploadWasm(wasmBuffer, DEFAULT_DEPLOYER, server);
    }

    return hashes as unknown as WasmHashes;
}

/**
 * Deploy all protocol contracts for a single chain using pre-uploaded WASM hashes.
 * The deployer pays gas; contract ownership is always DEFAULT_DEPLOYER.
 */
async function deployChainContracts(
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
    const deployedEndpoint = await deployContract<EndpointClient>(
        EndpointClient,
        path.join(wasmDir, 'endpoint_v2.wasm'),
        {
            eid: eid,
            owner: DEFAULT_DEPLOYER.publicKey(),
            native_token: NATIVE_TOKEN_ADDRESS,
        },
        deployer,
        { wasmHash: wasmHashes.endpoint },
    );
    addresses.endpointV2 = deployedEndpoint.options.contractId;
    console.log(`✅ [${chainLabel}] Endpoint deployed:`, addresses.endpointV2);

    // 2. Deploy Treasury
    console.log(`🚀 [${chainLabel}] Deploying Treasury...`);
    const deployedTreasury = await deployContract<TreasuryClient>(
        TreasuryClient,
        path.join(wasmDir, 'treasury.wasm'),
        { owner: DEFAULT_DEPLOYER.publicKey() },
        deployer,
        { wasmHash: wasmHashes.treasury },
    );
    addresses.treasury = deployedTreasury.options.contractId;
    console.log(`✅ [${chainLabel}] Treasury deployed:`, addresses.treasury);

    // 3. Deploy ULN302
    console.log(`🚀 [${chainLabel}] Deploying ULN302...`);
    const deployedUln302 = await deployContract<Uln302Client>(
        Uln302Client,
        path.join(wasmDir, 'uln302.wasm'),
        {
            owner: DEFAULT_DEPLOYER.publicKey(),
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
    const deployedSml = await deployContract<SMLClient>(
        SMLClient,
        path.join(wasmDir, 'simple_message_lib.wasm'),
        {
            owner: DEFAULT_DEPLOYER.publicKey(),
            endpoint: addresses.endpointV2,
            fee_recipient: DEFAULT_DEPLOYER.publicKey(),
        },
        deployer,
        { wasmHash: wasmHashes.sml },
    );
    addresses.sml = deployedSml.options.contractId;
    console.log(`✅ [${chainLabel}] SimpleMessageLib deployed:`, addresses.sml);

    // 5. Deploy Price Feed
    console.log(`🚀 [${chainLabel}] Deploying Price Feed...`);
    const deployedPriceFeed = await deployContract<PriceFeedClient>(
        PriceFeedClient,
        path.join(wasmDir, 'price_feed.wasm'),
        {
            owner: DEFAULT_DEPLOYER.publicKey(),
            price_updater: DEFAULT_DEPLOYER.publicKey(),
        },
        deployer,
        { wasmHash: wasmHashes.priceFeed },
    );
    addresses.priceFeed = deployedPriceFeed.options.contractId;
    console.log(`✅ [${chainLabel}] Price Feed deployed:`, addresses.priceFeed);

    // 6. Deploy Executor Fee Lib
    console.log(`🚀 [${chainLabel}] Deploying Executor Fee Lib...`);
    const deployedExecutorFeeLib = await deployContract<ExecutorFeeLibClient>(
        ExecutorFeeLibClient,
        path.join(wasmDir, 'executor_fee_lib.wasm'),
        { owner: DEFAULT_DEPLOYER.publicKey() },
        deployer,
        { wasmHash: wasmHashes.executorFeeLib },
    );
    addresses.executorFeeLib = deployedExecutorFeeLib.options.contractId;
    console.log(`✅ [${chainLabel}] Executor Fee Lib deployed:`, addresses.executorFeeLib);

    // 7. Deploy DVN Fee Lib
    console.log(`🚀 [${chainLabel}] Deploying DVN Fee Lib...`);
    const deployedDvnFeeLib = await deployContract<DvnFeeLibClient>(
        DvnFeeLibClient,
        path.join(wasmDir, 'dvn_fee_lib.wasm'),
        { owner: DEFAULT_DEPLOYER.publicKey() },
        deployer,
        { wasmHash: wasmHashes.dvnFeeLib },
    );
    addresses.dvnFeeLib = deployedDvnFeeLib.options.contractId;
    console.log(`✅ [${chainLabel}] DVN Fee Lib deployed:`, addresses.dvnFeeLib);

    // 8. Deploy DVN (same signer for both chains)
    console.log(`🚀 [${chainLabel}] Deploying DVN...`);
    const deployedDvn = await deployContract<DvnClient>(
        DvnClient,
        path.join(wasmDir, 'dvn.wasm'),
        {
            vid: DVN_VID,
            signers: [DVN_SIGNER.ethAddress],
            threshold: 1,
            admins: [DEFAULT_DEPLOYER.publicKey()],
            supported_msglibs: [addresses.uln302],
            price_feed: addresses.priceFeed,
            default_multiplier_bps: 10000,
            worker_fee_lib: addresses.dvnFeeLib,
            deposit_address: DEFAULT_DEPLOYER.publicKey(),
        },
        deployer,
        { wasmHash: wasmHashes.dvn },
    );
    addresses.dvn = deployedDvn.options.contractId;
    console.log(`✅ [${chainLabel}] DVN deployed:`, addresses.dvn);

    // 9. Deploy Executor Helper
    console.log(`🚀 [${chainLabel}] Deploying Executor Helper...`);
    const deployedExecutorHelper = await deployContract<ExecutorHelperClient>(
        ExecutorHelperClient,
        path.join(wasmDir, 'executor_helper.wasm'),
        undefined,
        deployer,
        { wasmHash: wasmHashes.executorHelper },
    );
    addresses.executorHelper = deployedExecutorHelper.options.contractId;
    console.log(`✅ [${chainLabel}] Executor Helper deployed:`, addresses.executorHelper);

    // 10. Deploy Executor (supports both ULN302 and SML)
    console.log(`🚀 [${chainLabel}] Deploying Executor...`);
    const deployedExecutor = await deployContract<ExecutorClient>(
        ExecutorClient,
        path.join(wasmDir, 'executor.wasm'),
        {
            owner: DEFAULT_DEPLOYER.publicKey(),
            endpoint: addresses.endpointV2,
            admins: [EXECUTOR_ADMIN.publicKey(), DEFAULT_DEPLOYER.publicKey()],
            message_libs: [addresses.uln302, addresses.sml],
            price_feed: addresses.priceFeed,
            default_multiplier_bps: 10000,
            worker_fee_lib: addresses.executorFeeLib,
            deposit_address: DEFAULT_DEPLOYER.publicKey(),
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
    addresses: ChainAddresses,
    chainLabel: string,
): Promise<ChainSetup> {
    // Register Executor Helper with Executor (needs owner-signed client)
    console.log(`🚀 [${chainLabel}] Registering Executor Helper with Executor...`);
    const executorClient = createClient(ExecutorClient, addresses.executor);
    await (
        await executorClient.set_executor_helper({
            helper: addresses.executorHelper,
            allowed_functions: ['execute', 'compose'],
        })
    ).signAndSend();
    console.log(`✅ [${chainLabel}] Executor Helper registered`);

    const clients: ChainClients = {
        endpointClient: createClient(EndpointClient, addresses.endpointV2),
        uln302Client: createClient(Uln302Client, addresses.uln302),
        smlClient: createClient(SMLClient, addresses.sml),
        treasuryClient: createClient(TreasuryClient, addresses.treasury),
        executorClient,
        executorHelperClient: createClient(ExecutorHelperClient, addresses.executorHelper),
        executorFeeLibClient: createClient(ExecutorFeeLibClient, addresses.executorFeeLib),
        priceFeedClient: createClient(PriceFeedClient, addresses.priceFeed),
        dvnFeeLibClient: createClient(DvnFeeLibClient, addresses.dvnFeeLib),
        dvnClient: createClient(DvnClient, addresses.dvn),
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
    await (await endpointClient.set_zro({ zro: ZRO_TOKEN_ADDRESS })).signAndSend();
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
            price_updater: DEFAULT_DEPLOYER.publicKey(),
            native_token_price_usd: 1000000000000000000n,
        })
    ).signAndSend();

    // Set prices for the other chain
    const NORMALIZED_OTHER_EID = otherEid % 30000;
    await (
        await priceFeedClient.set_price({
            price_updater: DEFAULT_DEPLOYER.publicKey(),
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
            admin: DEFAULT_DEPLOYER.publicKey(),
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
            admin: DEFAULT_DEPLOYER.publicKey(),
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

/**
 * Vitest Global Setup - runs ONCE before all test files
 * Deploys two complete protocol stacks (Chain A and Chain B) for cross-chain testing
 */
export default async function globalSetup({
    provide,
}: GlobalSetupContext): Promise<() => Promise<void>> {
    console.log('\n========================================');
    console.log('🌐 GLOBAL SETUP: Starting Stellar Localnet');
    console.log('========================================\n');

    await startStellarLocalnet();

    const repoRoot = await getFullyQualifiedRepoRootPath();
    const wasmDir = path.join(
        repoRoot,
        'contracts',
        'protocol',
        'stellar',
        'target',
        'wasm32v1-none',
        'release',
    );

    console.log('\n========================================');
    console.log('📤 GLOBAL SETUP: Uploading WASM (once)');
    console.log('========================================\n');

    const wasmHashes = await uploadAllWasms(wasmDir);

    console.log('\n========================================');
    console.log('📦 GLOBAL SETUP: Deploying Protocol Contracts (Two Chains in Parallel)');
    console.log('========================================\n');

    // Deploy both chains in parallel (each uses its own deployer key)
    const [addressesA, addressesB] = await Promise.all([
        deployChainContracts(EID_A, 'Chain A', DEFAULT_DEPLOYER, wasmDir, wasmHashes),
        deployChainContracts(EID_B, 'Chain B', CHAIN_B_DEPLOYER, wasmDir, wasmHashes),
    ]);

    // Register executor helpers and create clients sequentially (uses DEFAULT_DEPLOYER)
    const chainA = await initChainClients(addressesA, 'Chain A');
    const chainB = await initChainClients(addressesB, 'Chain B');

    console.log('\n========================================');
    console.log('🔗 GLOBAL SETUP: Wiring Protocol Contracts (Cross-Chain)');
    console.log('========================================\n');

    // Wire Chain A to communicate with Chain B
    await wireChainContracts(chainA, chainB, 'Chain A');

    // Wire Chain B to communicate with Chain A
    await wireChainContracts(chainB, chainA, 'Chain B');

    // Provide addresses for both chains to tests
    provide('chainA', chainA.addresses);
    provide('chainB', chainB.addresses);
    console.log('\n✅ Chain addresses provided to tests (in-memory)');
    console.log('   Chain A (EID ' + EID_A + '):', chainA.addresses.endpointV2);
    console.log('   Chain B (EID ' + EID_B + '):', chainB.addresses.endpointV2);

    console.log('\n========================================');
    console.log('✅ GLOBAL SETUP COMPLETE (Two-Chain Cross-Chain Ready)');
    console.log('========================================\n');

    // Return teardown function
    return async () => {
        console.log('\n========================================');
        console.log('🛑 GLOBAL TEARDOWN: Stopping Stellar Localnet');
        console.log('========================================\n');

        await stopStellarLocalnet();
    };
}
