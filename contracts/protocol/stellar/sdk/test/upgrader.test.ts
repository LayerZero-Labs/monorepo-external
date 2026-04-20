import { BASE_FEE, Contract, scValToNative, TransactionBuilder, xdr } from '@stellar/stellar-sdk';
import * as rpc from '@stellar/stellar-sdk/rpc';
import { readFileSync } from 'fs';
import path from 'path';
import { describe, expect, it } from 'vitest';

import { getFullyQualifiedRepoRootPath } from '@layerzerolabs/common-node-utils';

import { Client as DvnClient } from '../src/generated/dvn';
import { Client as UpgraderClient } from '../src/generated/upgrader';
import {
    DEFAULT_DEPLOYER,
    DVN_SIGNER,
    DVN_VID,
    NETWORK_PASSPHRASE,
    RPC_URL,
} from './suites/constants';
import { deployContract, uploadWasm } from './suites/deploy';
import { signDvnAuthEntries } from './utils';

let upgraderClient: UpgraderClient;
let dvnClient: DvnClient;
let testContractAddress: string;

// Test data paths
let TEST_CONTRACT_V1_WASM_PATH: string;
let TEST_CONTRACT_V2_WASM_PATH: string;

describe('Upgrader Contract Testing', async () => {
    const repoRoot = await getFullyQualifiedRepoRootPath();
    const upgraderWasmDir = path.join(
        repoRoot,
        'contracts',
        'protocol',
        'stellar',
        'target',
        'wasm32v1-none',
        'release',
    );
    const testDataDir = path.join(
        repoRoot,
        'contracts',
        'protocol',
        'stellar',
        'sdk',
        'test',
        'test_data',
    );

    const UPGRADER_WASM_PATH = path.join(upgraderWasmDir, 'upgrader.wasm');
    TEST_CONTRACT_V1_WASM_PATH = path.join(upgraderWasmDir, 'dvn.wasm');
    TEST_CONTRACT_V2_WASM_PATH = path.join(testDataDir, 'test_upgradeable_dvn.wasm');

    describe('Contract Deployments', () => {
        it('Deploy Upgrader Contract', async () => {
            // Deploy upgrader contract using the helper (no constructor args needed)
            upgraderClient = await deployContract<UpgraderClient>(
                UpgraderClient,
                UPGRADER_WASM_PATH,
                undefined,
                DEFAULT_DEPLOYER,
            );

            console.log('✅ Upgrader deployed at:', upgraderClient.options.contractId);
            expect(upgraderClient.options.contractId).toBeDefined();
        });

        it('Deploy DVN Contract V1', async () => {
            console.log('📖 Reading Test Contract V1 WASM file from:', TEST_CONTRACT_V1_WASM_PATH);
            dvnClient = await deployContract<DvnClient>(
                DvnClient,
                TEST_CONTRACT_V1_WASM_PATH,
                {
                    vid: DVN_VID,
                    signers: [DVN_SIGNER.ethAddress],
                    threshold: 1,
                    admins: [DEFAULT_DEPLOYER.publicKey()],
                    supported_msglibs: [],
                    price_feed: DEFAULT_DEPLOYER.publicKey(),
                    default_multiplier_bps: 10000,
                    worker_fee_lib: DEFAULT_DEPLOYER.publicKey(),
                    deposit_address: DEFAULT_DEPLOYER.publicKey(),
                },
                DEFAULT_DEPLOYER,
            );
            testContractAddress = dvnClient.options.contractId;

            console.log('✅ Test Contract V1 deployed at:', testContractAddress);
            expect(testContractAddress).toBeDefined();
        });

        it('Verify Test Contract V1 VID', async () => {
            const { result } = await dvnClient.vid();
            console.log('✅ Test Contract V1 vid value:', result);
            expect(result).toBe(DVN_VID);
        });
    });

    describe('Upgrade Workflow', () => {
        let newWasmHash: string;

        it('Upload Test Contract V2 WASM', async () => {
            console.log('📖 Reading Test Contract V2 WASM file from:', TEST_CONTRACT_V2_WASM_PATH);

            const server = new rpc.Server(RPC_URL, { allowHttp: true });

            // Read and upload WASM for V2
            const wasmBuffer = readFileSync(TEST_CONTRACT_V2_WASM_PATH);
            newWasmHash = await uploadWasm(wasmBuffer, DEFAULT_DEPLOYER, server);
            console.log('✅ Test Contract V2 WASM uploaded, hash:', newWasmHash);
            expect(newWasmHash).toBeDefined();
        });

        it('Set Upgrader on DVN', async () => {
            const setUpgraderTx = await dvnClient.set_upgrader({
                upgrader: upgraderClient.options.contractId,
            });

            await signDvnAuthEntries(
                testContractAddress,
                DVN_VID,
                DEFAULT_DEPLOYER,
                [DVN_SIGNER],
                setUpgraderTx,
                NETWORK_PASSPHRASE,
            );

            await setUpgraderTx.signAndSend();
            console.log('✅ Upgrader set on DVN to:', upgraderClient.options.contractId);

            const { result: upgrader } = await dvnClient.upgrader();
            expect(upgrader).toBe(upgraderClient.options.contractId);
        });

        it('Test Upgrader Contract Can Upgrade DVN with Multisig Auth', async () => {
            console.log('🔄 Testing upgrader contract call...');
            console.log('   Contract address:', testContractAddress);
            console.log('   New WASM hash:', newWasmHash);

            const upgradeTx = await upgraderClient.upgrade_and_migrate({
                contract_address: testContractAddress,
                wasm_hash: Buffer.from(newWasmHash, 'hex'),
                migration_data: xdr.ScVal.scvVoid().toXDR(),
                operator: undefined,
            });

            await signDvnAuthEntries(
                testContractAddress,
                DVN_VID,
                DEFAULT_DEPLOYER,
                [DVN_SIGNER],
                upgradeTx,
                NETWORK_PASSPHRASE,
            );

            await upgradeTx.signAndSend();
            console.log('✅ Upgrade transaction completed');
        });

        it('Verify Test Contract V2 test_upgrade_version After Upgrade', async () => {
            const server = new rpc.Server(RPC_URL, { allowHttp: true });
            const account = await server.getAccount(DEFAULT_DEPLOYER.publicKey());
            const contract = new Contract(testContractAddress);
            const tx = new TransactionBuilder(account, {
                fee: BASE_FEE,
                networkPassphrase: NETWORK_PASSPHRASE,
            })
                .addOperation(contract.call('test_upgrade_version'))
                .setTimeout(30)
                .build();

            const simulated = await server.simulateTransaction(tx);
            if (rpc.Api.isSimulationError(simulated)) {
                throw new Error(
                    `test_upgrade_version simulation failed: ${JSON.stringify(simulated)}`,
                );
            }

            if (!simulated.result?.retval) {
                throw new Error('No return value from test_upgrade_version');
            }

            const result = scValToNative(simulated.result.retval) as number;
            console.log('✅ Test Contract V2 test_upgrade_version value:', result);
            expect(result).toBe(2);
        });

        it('Verify Test Contract V1 Methods Still Work After Upgrade', async () => {
            const { result } = await dvnClient.vid();
            console.log('✅ Test Contract V2 vid value (from V1):', result);
            expect(result).toBe(DVN_VID);
        });
    });
});
