import {
    Address,
    Asset,
    AuthClawbackEnabledFlag,
    type AuthFlag,
    AuthRevocableFlag,
    BASE_FEE,
    Keypair,
    Operation,
    rpc,
    TransactionBuilder,
} from '@stellar/stellar-sdk';
import path from 'path';
import { beforeAll, describe, expect, it } from 'vitest';

import { getFullyQualifiedRepoRootPath } from '@layerzerolabs/common-node-utils';

import { Client as SACManagerClient } from '../src/generated/sac_manager';
import { DEFAULT_DEPLOYER, NETWORK_PASSPHRASE, RPC_URL } from './suites/constants';
import { deployAssetSac, deployContract } from './suites/deploy';
import { fundAccount } from './suites/localnet';
import { getTokenAuthorized, getTokenBalance } from './utils';

// ============================================================================
// Test Accounts
// ============================================================================

const TOKEN_ISSUER = Keypair.random();
const USER_A = Keypair.random();
const USER_B = Keypair.random();
const USER_C = Keypair.random();

// Token configuration
const TOKEN_CODE = 'RTKN';
let TOKEN_ASSET: Asset;

// Contract addresses
let sacTokenAddress = '';
let sacManagerAddress = '';

// Clients
let sacManagerClient: SACManagerClient;

// Initial token amounts
const INITIAL_TOKEN_AMOUNT = '1000'; // 1000 tokens
const MINT_AMOUNT = 100_0000000n; // 100 tokens (7 decimals)

// ============================================================================
// Helper Functions
// ============================================================================

/**
 * Creates a SACManagerClient with a specific signer
 */
function createClientWithSigner(contractId: string, signer: Keypair): SACManagerClient {
    return new SACManagerClient({
        contractId,
        publicKey: signer.publicKey(),
        signTransaction: async (tx: string) => {
            const transaction = TransactionBuilder.fromXDR(tx, NETWORK_PASSPHRASE);
            transaction.sign(signer);
            return {
                signedTxXdr: transaction.toXDR(),
                signerAddress: signer.publicKey(),
            };
        },
        rpcUrl: RPC_URL,
        networkPassphrase: NETWORK_PASSPHRASE,
        allowHttp: true,
    });
}

/**
 * Invokes a SAC contract function using raw transaction building
 */
async function invokeSacFunction(
    sacAddress: string,
    functionName: string,
    args: any[],
    signer: Keypair,
): Promise<void> {
    const server = new rpc.Server(RPC_URL, { allowHttp: true });
    const account = await server.getAccount(signer.publicKey());

    const tx = new TransactionBuilder(account, {
        fee: BASE_FEE,
        networkPassphrase: NETWORK_PASSPHRASE,
    })
        .addOperation(
            Operation.invokeContractFunction({
                contract: sacAddress,
                function: functionName,
                args,
            }),
        )
        .setTimeout(30)
        .build();

    const simulated = await server.simulateTransaction(tx);
    if (rpc.Api.isSimulationError(simulated)) {
        throw new Error(`Simulation failed: ${JSON.stringify(simulated)}`);
    }

    const preparedTx = rpc.assembleTransaction(tx, simulated).build();
    preparedTx.sign(signer);

    const sendResult = await server.sendTransaction(preparedTx);
    if (sendResult.status !== 'PENDING') {
        throw new Error(`Transaction failed to send: ${JSON.stringify(sendResult)}`);
    }

    const txResult = await server.pollTransaction(sendResult.hash);
    if (txResult.status !== 'SUCCESS') {
        throw new Error(`Transaction not successful: ${JSON.stringify(txResult)}`);
    }
}

// ============================================================================
// Test Suite
// ============================================================================

describe('SAC Manager E2E Tests', async () => {
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

    const SAC_MANAGER_WASM_PATH = path.join(wasmDir, 'sac_manager.wasm');

    beforeAll(async () => {
        console.log('\n====================================');
        console.log('SAC Manager E2E Tests');
        console.log('====================================\n');

        console.log('Funding test accounts...');
        await Promise.all([
            fundAccount(TOKEN_ISSUER.publicKey()),
            fundAccount(USER_A.publicKey()),
            fundAccount(USER_B.publicKey()),
            fundAccount(USER_C.publicKey()),
        ]);
        console.log('Test accounts funded');

        TOKEN_ASSET = new Asset(TOKEN_CODE, TOKEN_ISSUER.publicKey());
    });

    // ========================================================================
    // Setup SAC Manager with SAC
    // ========================================================================

    describe('Setup SAC Manager with SAC', () => {
        it('Set AUTH_REVOCABLE and AUTH_CLAWBACK_ENABLED flags on issuer account', async () => {
            const server = new rpc.Server(RPC_URL, { allowHttp: true });
            const issuerAccount = await server.getAccount(TOKEN_ISSUER.publicKey());

            const authFlags = (AuthRevocableFlag | AuthClawbackEnabledFlag) as AuthFlag;
            const setOptionsTx = new TransactionBuilder(issuerAccount, {
                fee: BASE_FEE,
                networkPassphrase: NETWORK_PASSPHRASE,
            })
                .addOperation(
                    Operation.setOptions({
                        setFlags: authFlags,
                    }),
                )
                .setTimeout(30)
                .build();

            setOptionsTx.sign(TOKEN_ISSUER);

            const sendResult = await server.sendTransaction(setOptionsTx);
            if (sendResult.status !== 'PENDING') {
                throw new Error(`Failed to set auth flags: ${JSON.stringify(sendResult)}`);
            }

            const txResult = await server.pollTransaction(sendResult.hash);
            if (txResult.status !== 'SUCCESS') {
                throw new Error(`Failed to set auth flags: ${JSON.stringify(txResult)}`);
            }

            console.log('AUTH_REVOCABLE and AUTH_CLAWBACK_ENABLED flags set on issuer');
        });

        it('Deploy SAC with trustlines and issue tokens', async () => {
            const server = new rpc.Server(RPC_URL, { allowHttp: true });

            const issuerAccount = await server.getAccount(TOKEN_ISSUER.publicKey());
            const issueTx = new TransactionBuilder(issuerAccount, {
                fee: BASE_FEE,
                networkPassphrase: NETWORK_PASSPHRASE,
            })
                .addOperation(
                    Operation.changeTrust({
                        asset: TOKEN_ASSET,
                        source: DEFAULT_DEPLOYER.publicKey(),
                    }),
                )
                .addOperation(
                    Operation.changeTrust({
                        asset: TOKEN_ASSET,
                        source: USER_A.publicKey(),
                    }),
                )
                .addOperation(
                    Operation.changeTrust({
                        asset: TOKEN_ASSET,
                        source: USER_B.publicKey(),
                    }),
                )
                .addOperation(
                    Operation.changeTrust({
                        asset: TOKEN_ASSET,
                        source: USER_C.publicKey(),
                    }),
                )
                .addOperation(
                    Operation.payment({
                        asset: TOKEN_ASSET,
                        amount: INITIAL_TOKEN_AMOUNT,
                        destination: USER_A.publicKey(),
                    }),
                )
                .addOperation(
                    Operation.payment({
                        asset: TOKEN_ASSET,
                        amount: INITIAL_TOKEN_AMOUNT,
                        destination: USER_B.publicKey(),
                    }),
                )
                .setTimeout(30)
                .build();

            issueTx.sign(TOKEN_ISSUER, DEFAULT_DEPLOYER, USER_A, USER_B, USER_C);

            const sendResult = await server.sendTransaction(issueTx);
            if (sendResult.status !== 'PENDING') {
                throw new Error(`Failed to setup trustlines: ${JSON.stringify(sendResult)}`);
            }

            const txResult = await server.pollTransaction(sendResult.hash);
            if (txResult.status !== 'SUCCESS') {
                throw new Error(`Failed to setup trustlines: ${JSON.stringify(txResult)}`);
            }

            console.log('Trustlines created and tokens issued');

            sacTokenAddress = await deployAssetSac(TOKEN_ASSET);
            console.log('SAC deployed at:', sacTokenAddress);
        });

        it('Deploy SAC Manager contract', async () => {
            sacManagerClient = await deployContract<SACManagerClient>(
                SACManagerClient,
                SAC_MANAGER_WASM_PATH,
                {
                    sac_token: sacTokenAddress,
                    owner: DEFAULT_DEPLOYER.publicKey(),
                },
                DEFAULT_DEPLOYER,
            );

            sacManagerAddress = sacManagerClient.options.contractId;
            console.log('SAC Manager deployed at:', sacManagerAddress);
        });

        it('Grant all roles to owner', async () => {
            for (const role of [
                'ADMIN_MANAGER_ROLE',
                'MINTER_ROLE',
                'BLACKLISTER_ROLE',
                'CLAWBACK_ROLE',
            ]) {
                const assembledTx = await sacManagerClient.grant_role({
                    account: DEFAULT_DEPLOYER.publicKey(),
                    role,
                    caller: DEFAULT_DEPLOYER.publicKey(),
                });
                await assembledTx.signAndSend();
            }
            console.log('All roles granted to owner');
        });

        it('Set SAC admin to SAC Manager', async () => {
            await invokeSacFunction(
                sacTokenAddress,
                'set_admin',
                [Address.fromString(sacManagerAddress).toScVal()],
                TOKEN_ISSUER,
            );
            console.log('SAC admin set to SAC Manager');
        });

        it('Verify owner (DEFAULT_DEPLOYER) starts with zero balance', async () => {
            const ownerBalance = await getTokenBalance(
                DEFAULT_DEPLOYER.publicKey(),
                sacTokenAddress,
            );
            console.log('Owner (DEFAULT_DEPLOYER) balance:', ownerBalance.toString());
            expect(ownerBalance).toBe(0n);
        });
    });

    // ========================================================================
    // Blacklist Management
    // ========================================================================

    describe('Blacklist Management', () => {
        it('Verify all accounts start authorized', async () => {
            const [userAAuthorized, userBAuthorized, userCAuthorized] = await Promise.all([
                getTokenAuthorized(USER_A.publicKey(), sacTokenAddress),
                getTokenAuthorized(USER_B.publicKey(), sacTokenAddress),
                getTokenAuthorized(USER_C.publicKey(), sacTokenAddress),
            ]);

            expect(userAAuthorized).toBe(true);
            expect(userBAuthorized).toBe(true);
            expect(userCAuthorized).toBe(true);
            console.log('All users start authorized');
        });

        it('Blacklist USER_B via set_authorized', async () => {
            // operator: caller must have BLACKLISTER_ROLE (generated client will include operator after regeneration)
            const assembledTx = await (
                sacManagerClient.set_authorized as (args: {
                    id: string;
                    authorize: boolean;
                    operator: string;
                }) => ReturnType<typeof sacManagerClient.set_authorized>
            )({
                id: USER_B.publicKey(),
                authorize: false,
                operator: DEFAULT_DEPLOYER.publicKey(),
            });
            await assembledTx.signAndSend();
            console.log('USER_B blacklisted (authorized=false)');
        });

        it('Verify USER_B is blacklisted', async () => {
            const authorized = await getTokenAuthorized(USER_B.publicKey(), sacTokenAddress);
            expect(authorized).toBe(false);
            console.log('USER_B authorized:', authorized);
        });

        it('Non-admin cannot call set_authorized', async () => {
            const userClient = createClientWithSigner(sacManagerAddress, USER_A);
            // operator: USER_A does not have BLACKLISTER_ROLE (generated client will include operator after regeneration)
            const assembledTx = await (
                userClient.set_authorized as (args: {
                    id: string;
                    authorize: boolean;
                    operator: string;
                }) => ReturnType<typeof userClient.set_authorized>
            )({
                id: USER_C.publicKey(),
                authorize: false,
                operator: USER_A.publicKey(),
            });
            await expect(assembledTx.signAndSend()).rejects.toThrow();
            console.log('Non-admin correctly rejected from calling set_authorized');
        });

        it('Un-blacklist USER_B via set_authorized', async () => {
            // operator: caller must have BLACKLISTER_ROLE (generated client will include operator after regeneration)
            const assembledTx = await (
                sacManagerClient.set_authorized as (args: {
                    id: string;
                    authorize: boolean;
                    operator: string;
                }) => ReturnType<typeof sacManagerClient.set_authorized>
            )({
                id: USER_B.publicKey(),
                authorize: true,
                operator: DEFAULT_DEPLOYER.publicKey(),
            });
            await assembledTx.signAndSend();
            const authorized = await getTokenAuthorized(USER_B.publicKey(), sacTokenAddress);
            expect(authorized).toBe(true);
            console.log('USER_B un-blacklisted');
        });
    });

    // ========================================================================
    // Mint (operator must have MINTER_ROLE)
    // ========================================================================

    describe('Mint', () => {
        it('Verify initial balances', async () => {
            const [userABalance, userBBalance, userCBalance, ownerBalance] = await Promise.all([
                getTokenBalance(USER_A.publicKey(), sacTokenAddress),
                getTokenBalance(USER_B.publicKey(), sacTokenAddress),
                getTokenBalance(USER_C.publicKey(), sacTokenAddress),
                getTokenBalance(DEFAULT_DEPLOYER.publicKey(), sacTokenAddress),
            ]);

            console.log('\nInitial Balances:');
            console.log(`  USER_A: ${userABalance}`);
            console.log(`  USER_B: ${userBBalance}`);
            console.log(`  USER_C: ${userCBalance}`);
            console.log(`  Owner: ${ownerBalance}`);

            expect(userABalance).toBe(10000000000n);
            expect(userBBalance).toBe(10000000000n);
            expect(userCBalance).toBe(0n);
            expect(ownerBalance).toBe(0n);
        });

        it('Minter can mint to non-blacklisted address', async () => {
            const userCBalanceBefore = await getTokenBalance(USER_C.publicKey(), sacTokenAddress);

            const assembledTx = await sacManagerClient.mint({
                to: USER_C.publicKey(),
                amount: MINT_AMOUNT,
                operator: DEFAULT_DEPLOYER.publicKey(),
            });
            await assembledTx.signAndSend();

            const userCBalance = await getTokenBalance(USER_C.publicKey(), sacTokenAddress);
            console.log('\nAfter mint to USER_C:', userCBalance);
            expect(userCBalance).toBe(userCBalanceBefore + MINT_AMOUNT);
        });

        it('Non-minter cannot mint', async () => {
            const userClient = createClientWithSigner(sacManagerAddress, USER_A);
            const assembledTx = await userClient.mint({
                to: USER_C.publicKey(),
                amount: MINT_AMOUNT,
                operator: USER_A.publicKey(),
            });
            await expect(assembledTx.signAndSend()).rejects.toThrow();
            console.log('Non-minter correctly rejected');
        });
    });

    // ========================================================================
    // Final Summary
    // ========================================================================

    describe('Final Summary', () => {
        it('Print final balances', async () => {
            const [userABalance, userBBalance, userCBalance, ownerBalance] = await Promise.all([
                getTokenBalance(USER_A.publicKey(), sacTokenAddress),
                getTokenBalance(USER_B.publicKey(), sacTokenAddress),
                getTokenBalance(USER_C.publicKey(), sacTokenAddress),
                getTokenBalance(DEFAULT_DEPLOYER.publicKey(), sacTokenAddress),
            ]);

            console.log('\n========================================');
            console.log('Final Balance Summary');
            console.log('========================================');
            console.log(`  USER_A: ${userABalance}`);
            console.log(`  USER_B: ${userBBalance}`);
            console.log(`  USER_C: ${userCBalance}`);
            console.log(`  Owner: ${ownerBalance}`);
            console.log('========================================\n');
            console.log('SAC Manager E2E tests completed successfully!');
        });
    });
});
