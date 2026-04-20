import {
    Address,
    Asset,
    BASE_FEE,
    Keypair,
    Operation,
    rpc,
    StrKey,
    TransactionBuilder,
} from '@stellar/stellar-sdk';
import path from 'path';
import { beforeAll, describe, expect, inject, it } from 'vitest';

import { getFullyQualifiedRepoRootPath } from '@layerzerolabs/common-node-utils';
import { PacketSerializer, PacketV1Codec } from '@layerzerolabs/lz-v2-utilities';

import { Client as EndpointClient } from '../src/generated/endpoint';
import { Client as ExecutorHelperClient } from '../src/generated/executor_helper';
import { Client as OFTClient, SendParam } from '../src/generated/oft';
import { Client as SACManagerClient } from '../src/generated/sac_manager';
import { Client as SMLClient } from '../src/generated/sml';
import {
    DEFAULT_DEPLOYER,
    EID_A,
    EID_B,
    EXECUTOR_ADMIN,
    NETWORK_PASSPHRASE,
    RPC_URL,
} from './suites/constants';
import { deployAssetSac, deployContract } from './suites/deploy';
import type { ChainAddresses } from './suites/globalSetup';
import { fundAccount } from './suites/localnet';
import { PacketSentEvent, scanPacketSentEvents } from './suites/scan';
import {
    assertTransactionSucceeded,
    createClient,
    getTokenBalance,
    signAndSendWithExecutorAuth,
} from './utils';

// Chain addresses (injected from globalSetup)
let chainA: ChainAddresses;
let chainB: ChainAddresses;

// OFT-specific addresses
let oftTokenAddress = '';
let sacManagerAddress = ''; // Mintable for Mint/Burn OFT (Chain B)
let lockUnlockOftAddress = ''; // Chain A
let mintBurnOftAddress = ''; // Chain B

// Chain A Clients
let endpointClientA: EndpointClient;
let smlClientA: SMLClient;
let executorHelperClientA: ExecutorHelperClient;
let lockUnlockOftClient: OFTClient;

// Chain B Clients
let endpointClientB: EndpointClient;
let smlClientB: SMLClient;
let executorHelperClientB: ExecutorHelperClient;
let mintBurnOftClient: OFTClient;

// Test accounts
const TOKEN_ISSUER = Keypair.random();

// Recipients for each direction
const RECIPIENT_A = Keypair.random(); // Receives tokens on Chain A (unlocked)
const RECIPIENT_B = Keypair.random(); // Receives tokens on Chain B (minted)

// OFT Token asset (custom token for testing)
const OFT_TOKEN_CODE = 'OFT';
let OFT_ASSET: Asset;

// Constants
const SHARED_DECIMALS = 6;
const INITIAL_TOKEN_AMOUNT = '1000'; // 1000 tokens
const SEND_AMOUNT = 100_0000000n; // 100 tokens in local decimals (7 decimals)

describe('OFT Cross-Chain E2E Testing with SAC (SML)', async () => {
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

    const OFT_WASM_PATH = path.join(wasmDir, 'oft.wasm');
    const SAC_MANAGER_WASM_PATH = path.join(wasmDir, 'sac_manager.wasm');

    beforeAll(async () => {
        // Inject chain addresses from globalSetup
        chainA = inject('chainA');
        chainB = inject('chainB');

        console.log('\n📋 Chain A addresses (EID: ' + EID_A + ')');
        console.log('  Endpoint:', chainA.endpointV2);
        console.log('  SML:', chainA.sml);
        console.log('  Executor:', chainA.executor);

        console.log('\n📋 Chain B addresses (EID: ' + EID_B + ')');
        console.log('  Endpoint:', chainB.endpointV2);
        console.log('  SML:', chainB.sml);
        console.log('  Executor:', chainB.executor);

        // Create clients for Chain A protocol contracts
        endpointClientA = createClient(EndpointClient, chainA.endpointV2);
        smlClientA = createClient(SMLClient, chainA.sml);
        executorHelperClientA = createClient(ExecutorHelperClient, chainA.executorHelper);

        // Create clients for Chain B protocol contracts
        endpointClientB = createClient(EndpointClient, chainB.endpointV2);
        smlClientB = createClient(SMLClient, chainB.sml);
        executorHelperClientB = createClient(ExecutorHelperClient, chainB.executorHelper);

        // Fund test accounts in parallel
        await Promise.all([
            fundAccount(TOKEN_ISSUER.publicKey()),
            fundAccount(RECIPIENT_A.publicKey()),
            fundAccount(RECIPIENT_B.publicKey()),
        ]);

        // Create the OFT asset (TOKEN_ISSUER is the issuer)
        OFT_ASSET = new Asset(OFT_TOKEN_CODE, TOKEN_ISSUER.publicKey());
    });

    describe('Deploy OFT Contracts on Both Chains', () => {
        it('Deploy OFT Token SAC', async () => {
            const server = new rpc.Server(RPC_URL, { allowHttp: true });

            // Step 1: Issue the OFT token to DEFAULT_DEPLOYER and set up trustlines for recipients
            const issuerAccount = await server.getAccount(TOKEN_ISSUER.publicKey());
            const issueTx = new TransactionBuilder(issuerAccount, {
                fee: BASE_FEE,
                networkPassphrase: NETWORK_PASSPHRASE,
            })
                // Trustline for DEFAULT_DEPLOYER (sender)
                .addOperation(
                    Operation.changeTrust({
                        asset: OFT_ASSET,
                        source: DEFAULT_DEPLOYER.publicKey(),
                    }),
                )
                // Trustline for RECIPIENT_A (receives unlocked tokens)
                .addOperation(
                    Operation.changeTrust({
                        asset: OFT_ASSET,
                        source: RECIPIENT_A.publicKey(),
                    }),
                )
                // Trustline for RECIPIENT_B (receives minted tokens)
                .addOperation(
                    Operation.changeTrust({
                        asset: OFT_ASSET,
                        source: RECIPIENT_B.publicKey(),
                    }),
                )
                // Issue tokens to DEFAULT_DEPLOYER
                .addOperation(
                    Operation.payment({
                        asset: OFT_ASSET,
                        amount: INITIAL_TOKEN_AMOUNT,
                        destination: DEFAULT_DEPLOYER.publicKey(),
                    }),
                )
                .setTimeout(30)
                .build();

            issueTx.sign(TOKEN_ISSUER, DEFAULT_DEPLOYER, RECIPIENT_A, RECIPIENT_B);
            const sendResult = await server.sendTransaction(issueTx);
            if (sendResult.status !== 'PENDING') {
                throw new Error(`Failed to issue OFT token: ${JSON.stringify(sendResult)}`);
            }
            const txResult = await server.pollTransaction(sendResult.hash);
            if (txResult.status !== 'SUCCESS') {
                throw new Error(`Failed to issue OFT token: ${JSON.stringify(txResult)}`);
            }
            console.log('✅ OFT token issued to DEFAULT_DEPLOYER');

            // Step 2: Deploy the SAC for the OFT token
            oftTokenAddress = await deployAssetSac(OFT_ASSET);
            console.log('✅ OFT Token SAC deployed:', oftTokenAddress);
        });

        it('Deploy SAC Manager and set SAC admin (mintable for Mint/Burn OFT)', async () => {
            const sacManagerClient = await deployContract<SACManagerClient>(
                SACManagerClient,
                SAC_MANAGER_WASM_PATH,
                {
                    sac_token: oftTokenAddress,
                    owner: DEFAULT_DEPLOYER.publicKey(),
                },
                DEFAULT_DEPLOYER,
            );
            sacManagerAddress = sacManagerClient.options.contractId;
            console.log('✅ SAC Manager deployed:', sacManagerAddress);

            const server = new rpc.Server(RPC_URL, { allowHttp: true });
            const account = await server.getAccount(TOKEN_ISSUER.publicKey());
            const setAdminTx = new TransactionBuilder(account, {
                fee: BASE_FEE,
                networkPassphrase: NETWORK_PASSPHRASE,
            })
                .addOperation(
                    Operation.invokeContractFunction({
                        contract: oftTokenAddress,
                        function: 'set_admin',
                        args: [Address.fromString(sacManagerAddress).toScVal()],
                    }),
                )
                .setTimeout(30)
                .build();

            const simulated = await server.simulateTransaction(setAdminTx);
            if (rpc.Api.isSimulationError(simulated)) {
                throw new Error(`Simulation failed: ${JSON.stringify(simulated)}`);
            }
            const preparedTx = rpc.assembleTransaction(setAdminTx, simulated).build();
            preparedTx.sign(TOKEN_ISSUER);

            const sendResult = await server.sendTransaction(preparedTx);
            if (sendResult.status !== 'PENDING') {
                throw new Error(`Failed to set admin: ${JSON.stringify(sendResult)}`);
            }
            const txResult = await server.pollTransaction(sendResult.hash);
            if (txResult.status !== 'SUCCESS') {
                throw new Error(`Failed to set admin: ${JSON.stringify(txResult)}`);
            }
            console.log('✅ SAC admin set to SAC Manager');
        });

        it('Deploy Lock/Unlock OFT on Chain A', async () => {
            lockUnlockOftClient = await deployContract<OFTClient>(
                OFTClient,
                OFT_WASM_PATH,
                {
                    token: oftTokenAddress,
                    owner: DEFAULT_DEPLOYER.publicKey(),
                    endpoint: chainA.endpointV2, // Chain A endpoint
                    delegate: DEFAULT_DEPLOYER.publicKey(),
                    shared_decimals: SHARED_DECIMALS,
                    oft_type: { tag: 'LockUnlock' },
                },
                DEFAULT_DEPLOYER,
            );

            lockUnlockOftAddress = lockUnlockOftClient.options.contractId;
            console.log('✅ Lock/Unlock OFT deployed on Chain A:', lockUnlockOftAddress);

            const { result: oftType } = await lockUnlockOftClient.oft_type();
            expect(oftType.tag).toEqual('LockUnlock');
        });

        it('Deploy Mint/Burn OFT on Chain B', async () => {
            mintBurnOftClient = await deployContract<OFTClient>(
                OFTClient,
                OFT_WASM_PATH,
                {
                    token: oftTokenAddress,
                    owner: DEFAULT_DEPLOYER.publicKey(),
                    endpoint: chainB.endpointV2, // Chain B endpoint
                    delegate: DEFAULT_DEPLOYER.publicKey(),
                    shared_decimals: SHARED_DECIMALS,
                    oft_type: { tag: 'MintBurn', values: [sacManagerAddress] },
                },
                DEFAULT_DEPLOYER,
            );

            mintBurnOftAddress = mintBurnOftClient.options.contractId;
            console.log('✅ Mint/Burn OFT deployed on Chain B:', mintBurnOftAddress);

            const { result: oftType } = await mintBurnOftClient.oft_type();
            expect(oftType.tag).toEqual('MintBurn');
        });
    });

    describe('Wire OFT Contracts to use SML (Cross-Chain)', () => {
        it('Set Lock/Unlock OFT (Chain A) Send Library to SML for Chain B', async () => {
            const assembledTx = await endpointClientA.set_send_library({
                caller: DEFAULT_DEPLOYER.publicKey(),
                sender: lockUnlockOftAddress,
                dst_eid: EID_B,
                new_lib: chainA.sml,
            });
            await assembledTx.signAndSend();

            const { result: sendLib } = await endpointClientA.get_send_library({
                sender: lockUnlockOftAddress,
                dst_eid: EID_B,
            });
            expect(sendLib.lib).toBe(chainA.sml);
            console.log('✅ Lock/Unlock OFT (Chain A) send library set to SML for EID_B');
        });

        it('Set Lock/Unlock OFT (Chain A) Receive Library to SML for Chain B', async () => {
            const assembledTx = await endpointClientA.set_receive_library({
                caller: DEFAULT_DEPLOYER.publicKey(),
                receiver: lockUnlockOftAddress,
                src_eid: EID_B,
                new_lib: chainA.sml,
                grace_period: 0n,
            });
            await assembledTx.signAndSend();

            const { result: receiveLib } = await endpointClientA.get_receive_library({
                receiver: lockUnlockOftAddress,
                src_eid: EID_B,
            });
            expect(receiveLib.lib).toBe(chainA.sml);
            console.log('✅ Lock/Unlock OFT (Chain A) receive library set to SML for EID_B');
        });

        it('Set Mint/Burn OFT (Chain B) Send Library to SML for Chain A', async () => {
            const assembledTx = await endpointClientB.set_send_library({
                caller: DEFAULT_DEPLOYER.publicKey(),
                sender: mintBurnOftAddress,
                dst_eid: EID_A,
                new_lib: chainB.sml,
            });
            await assembledTx.signAndSend();

            const { result: sendLib } = await endpointClientB.get_send_library({
                sender: mintBurnOftAddress,
                dst_eid: EID_A,
            });
            expect(sendLib.lib).toBe(chainB.sml);
            console.log('✅ Mint/Burn OFT (Chain B) send library set to SML for EID_A');
        });

        it('Set Mint/Burn OFT (Chain B) Receive Library to SML for Chain A', async () => {
            const assembledTx = await endpointClientB.set_receive_library({
                caller: DEFAULT_DEPLOYER.publicKey(),
                receiver: mintBurnOftAddress,
                src_eid: EID_A,
                new_lib: chainB.sml,
                grace_period: 0n,
            });
            await assembledTx.signAndSend();

            const { result: receiveLib } = await endpointClientB.get_receive_library({
                receiver: mintBurnOftAddress,
                src_eid: EID_A,
            });
            expect(receiveLib.lib).toBe(chainB.sml);
            console.log('✅ Mint/Burn OFT (Chain B) receive library set to SML for EID_A');
        });

        it('Set Lock/Unlock OFT (Chain A) Peer to Mint/Burn OFT (Chain B)', async () => {
            const mintBurnPeerBytes = StrKey.decodeContract(mintBurnOftAddress);

            const assembledTx = await lockUnlockOftClient.set_peer({
                eid: EID_B,
                peer: Buffer.from(mintBurnPeerBytes),
                operator: DEFAULT_DEPLOYER.publicKey(),
            });
            await assembledTx.signAndSend();

            const { result: peer } = await lockUnlockOftClient.peer({
                eid: EID_B,
            });
            expect(peer?.toString()).toBe(Buffer.from(mintBurnPeerBytes).toString());
            console.log('✅ Lock/Unlock OFT (Chain A) peer set to Mint/Burn OFT for EID_B');
        });

        it('Set Mint/Burn OFT (Chain B) Peer to Lock/Unlock OFT (Chain A)', async () => {
            const lockUnlockPeerBytes = StrKey.decodeContract(lockUnlockOftAddress);

            const assembledTx = await mintBurnOftClient.set_peer({
                eid: EID_A,
                peer: Buffer.from(lockUnlockPeerBytes),
                operator: DEFAULT_DEPLOYER.publicKey(),
            });
            await assembledTx.signAndSend();

            const { result: peer } = await mintBurnOftClient.peer({
                eid: EID_A,
            });
            expect(peer?.toString()).toBe(Buffer.from(lockUnlockPeerBytes).toString());
            console.log('✅ Mint/Burn OFT (Chain B) peer set to Lock/Unlock OFT for EID_A');
        });

        it('Grant MINTER_ROLE to Mint/Burn OFT on SAC Manager (for receive/mint)', async () => {
            const sacManagerClient = new SACManagerClient({
                contractId: sacManagerAddress,
                publicKey: DEFAULT_DEPLOYER.publicKey(),
                signTransaction: async (tx: string) => {
                    const transaction = TransactionBuilder.fromXDR(tx, NETWORK_PASSPHRASE);
                    transaction.sign(DEFAULT_DEPLOYER);
                    return {
                        signedTxXdr: transaction.toXDR(),
                        signerAddress: DEFAULT_DEPLOYER.publicKey(),
                    };
                },
                rpcUrl: RPC_URL,
                networkPassphrase: NETWORK_PASSPHRASE,
                allowHttp: true,
            });
            const assembledTx = await sacManagerClient.grant_role({
                account: mintBurnOftAddress,
                role: 'MINTER_ROLE',
                caller: DEFAULT_DEPLOYER.publicKey(),
            });
            await assembledTx.signAndSend();
            console.log('✅ MINTER_ROLE granted to Mint/Burn OFT on SAC Manager');
        });
    });

    describe('Send: Chain A (Lock) → Chain B (Mint)', () => {
        let sendLedger = 0;
        let packetSentEvent: PacketSentEvent;
        let guid: Buffer;
        let message: Buffer;

        it('Verify initial balances', async () => {
            const [senderBalance, recipientBBalance] = await Promise.all([
                getTokenBalance(DEFAULT_DEPLOYER.publicKey(), oftTokenAddress),
                getTokenBalance(RECIPIENT_B.publicKey(), oftTokenAddress),
            ]);
            console.log('📊 Initial Balances:');
            console.log(`  - Sender (DEFAULT_DEPLOYER): ${senderBalance} (expected: 10000000000)`);
            console.log(`  - RECIPIENT_B (Chain B): ${recipientBBalance} (expected: 0)`);

            expect(senderBalance).toBe(10000000000n);
            expect(recipientBBalance).toBe(0n);
        });

        it('Quote OFT send (A → B)', async () => {
            const receiverBytes = StrKey.decodeEd25519PublicKey(RECIPIENT_B.publicKey());
            const sendParam: SendParam = {
                dst_eid: EID_B,
                to: Buffer.from(receiverBytes),
                amount_ld: SEND_AMOUNT,
                min_amount_ld: SEND_AMOUNT,
                extra_options: Buffer.from([]),
                compose_msg: Buffer.from([]),
                oft_cmd: Buffer.from([]),
            };

            const { result: quoteResult } = await lockUnlockOftClient.quote_oft({
                from: DEFAULT_DEPLOYER.publicKey(),
                send_param: sendParam,
            });
            const [limit, feeDetails, receipt] = quoteResult;
            console.log('📊 OFT Quote (A → B):');
            console.log('  Limit:', limit);
            console.log('  Fee Details:', feeDetails);
            console.log('  Receipt:', receipt);

            expect(receipt.amount_sent_ld).toBe(SEND_AMOUNT);
        });

        it('Send tokens from Chain A to Chain B (Lock → Mint)', async () => {
            const receiverBytes = StrKey.decodeEd25519PublicKey(RECIPIENT_B.publicKey());
            const sendParam: SendParam = {
                dst_eid: EID_B,
                to: Buffer.from(receiverBytes),
                amount_ld: SEND_AMOUNT,
                min_amount_ld: SEND_AMOUNT,
                extra_options: Buffer.from([]),
                compose_msg: Buffer.from([]),
                oft_cmd: Buffer.from([]),
            };

            const { result: fee } = await lockUnlockOftClient.quote_send({
                from: DEFAULT_DEPLOYER.publicKey(),
                send_param: sendParam,
                pay_in_zro: true,
            });
            console.log('📊 Messaging Fee (A → B):', fee);

            const assembledTx = await lockUnlockOftClient.send({
                from: DEFAULT_DEPLOYER.publicKey(),
                send_param: sendParam,
                fee: fee,
                refund_address: DEFAULT_DEPLOYER.publicKey(),
            });

            const sentTx = await assembledTx.signAndSend();

            const txResponse = sentTx.getTransactionResponse;
            if (txResponse && 'ledger' in txResponse) {
                sendLedger = txResponse.ledger;
            }

            if (txResponse) {
                assertTransactionSucceeded(txResponse, 'OFT Send (A → B)');
            }
            console.log('✅ Tokens sent from Chain A, ledger:', sendLedger);
        });

        it('Scan PacketSent events (A → B)', async () => {
            const packetSentEvents = await scanPacketSentEvents(chainA.endpointV2, sendLedger);
            expect(packetSentEvents.length).toBeGreaterThan(0);
            packetSentEvent = packetSentEvents[0];
            console.log(
                `✅ PacketSent events scanned from Chain A. Found ${packetSentEvents.length} events`,
            );
        });

        it('Validate packet via SML on Chain B', async () => {
            const packet = PacketSerializer.deserialize(packetSentEvent.encoded_packet);
            guid = Buffer.from(packet.guid.replace('0x', ''), 'hex');
            message = Buffer.from(packet.message.replace('0x', ''), 'hex');
            const codec = PacketV1Codec.from(packet);
            const packetHeader = codec.header();
            const payloadHash = codec.payloadHash();

            const assembledTx = await smlClientB.validate_packet({
                header_bytes: Buffer.from(packetHeader.replace('0x', ''), 'hex'),
                payload_hash: Buffer.from(payloadHash.replace('0x', ''), 'hex'),
            });
            await assembledTx.signAndSend();
            console.log('✅ Packet validated via SML on Chain B');
        });

        it('Receive tokens on Chain B (mint)', async () => {
            const lockUnlockPeerBytes = StrKey.decodeContract(lockUnlockOftAddress);
            const origin = {
                nonce: 1n,
                sender: Buffer.from(lockUnlockPeerBytes),
                src_eid: EID_A,
            };

            const assembledTx = await executorHelperClientB.execute(
                {
                    executor: chainB.executor,
                    params: {
                        extra_data: Buffer.from([]),
                        gas_limit: 0n,
                        guid,
                        message,
                        origin,
                        receiver: mintBurnOftAddress,
                        value: 0n,
                    },
                    value_payer: EXECUTOR_ADMIN.publicKey(),
                },
                {
                    simulate: false,
                },
            );

            const txResult = await signAndSendWithExecutorAuth(
                chainB.executor,
                EXECUTOR_ADMIN,
                assembledTx,
                NETWORK_PASSPHRASE,
            );

            assertTransactionSucceeded(txResult, 'LzReceive on Chain B (Mint)');

            console.log('✅ Tokens received and minted on Chain B');
        });

        it('Verify balances after forward send (A → B)', async () => {
            const [senderBalance, lockUnlockOftBalance, recipientBBalance] = await Promise.all([
                getTokenBalance(DEFAULT_DEPLOYER.publicKey(), oftTokenAddress),
                getTokenBalance(lockUnlockOftAddress, oftTokenAddress),
                getTokenBalance(RECIPIENT_B.publicKey(), oftTokenAddress),
            ]);

            console.log('📊 Balances after forward send (A → B):');
            console.log(`  - Sender (DEFAULT_DEPLOYER): ${senderBalance} (expected: 9000000000)`);
            console.log(
                `  - Lock/Unlock OFT (Chain A, locked): ${lockUnlockOftBalance} (expected: 1000000000)`,
            );
            console.log(
                `  - RECIPIENT_B (Chain B, minted): ${recipientBBalance} (expected: 1000000000)`,
            );

            expect(senderBalance).toBe(9000000000n);
            expect(lockUnlockOftBalance).toBe(1000000000n);
            expect(recipientBBalance).toBe(1000000000n);
        });
    });

    describe('Send: Chain B (Burn) → Chain A (Unlock)', () => {
        let sendLedger = 0;
        let packetSentEvent: PacketSentEvent;
        let guid: Buffer;
        let message: Buffer;
        const REVERSE_SEND_AMOUNT = 50_0000000n;

        it('Quote OFT send (B → A)', async () => {
            const receiverBytes = StrKey.decodeEd25519PublicKey(RECIPIENT_A.publicKey());
            const sendParam: SendParam = {
                dst_eid: EID_A,
                to: Buffer.from(receiverBytes),
                amount_ld: REVERSE_SEND_AMOUNT,
                min_amount_ld: REVERSE_SEND_AMOUNT,
                extra_options: Buffer.from([]),
                compose_msg: Buffer.from([]),
                oft_cmd: Buffer.from([]),
            };

            const { result: quoteResult } = await mintBurnOftClient.quote_oft({
                from: DEFAULT_DEPLOYER.publicKey(),
                send_param: sendParam,
            });
            const [limit, feeDetails, receipt] = quoteResult;
            console.log('📊 Reverse OFT Quote (B → A):');
            console.log('  Limit:', limit);
            console.log('  Fee Details:', feeDetails);
            console.log('  Receipt:', receipt);

            expect(receipt.amount_sent_ld).toBe(REVERSE_SEND_AMOUNT);
        });

        it('Send tokens from Chain B to Chain A (Burn → Unlock)', async () => {
            const receiverBytes = StrKey.decodeEd25519PublicKey(RECIPIENT_A.publicKey());
            const sendParam: SendParam = {
                dst_eid: EID_A,
                to: Buffer.from(receiverBytes),
                amount_ld: REVERSE_SEND_AMOUNT,
                min_amount_ld: REVERSE_SEND_AMOUNT,
                extra_options: Buffer.from([]),
                compose_msg: Buffer.from([]),
                oft_cmd: Buffer.from([]),
            };

            const { result: fee } = await mintBurnOftClient.quote_send({
                from: DEFAULT_DEPLOYER.publicKey(),
                send_param: sendParam,
                pay_in_zro: true,
            });
            console.log('📊 Reverse Messaging Fee (B → A):', fee);

            const assembledTx = await mintBurnOftClient.send({
                from: DEFAULT_DEPLOYER.publicKey(),
                send_param: sendParam,
                fee: fee,
                refund_address: DEFAULT_DEPLOYER.publicKey(),
            });

            const sentTx = await assembledTx.signAndSend();

            const txResponse = sentTx.getTransactionResponse;
            if (txResponse && 'ledger' in txResponse) {
                sendLedger = txResponse.ledger;
            }

            if (txResponse) {
                assertTransactionSucceeded(txResponse, 'OFT Reverse Send (B → A)');
            }
            console.log('✅ Tokens sent from Chain B (reverse), ledger:', sendLedger);
        });

        it('Scan PacketSent events (B → A)', async () => {
            const packetSentEvents = await scanPacketSentEvents(chainB.endpointV2, sendLedger);
            expect(packetSentEvents.length).toBeGreaterThan(0);
            packetSentEvent = packetSentEvents[0];
            console.log(
                `✅ PacketSent events scanned from Chain B (reverse). Found ${packetSentEvents.length} events`,
            );
        });

        it('Validate packet via SML on Chain A (reverse)', async () => {
            const packet = PacketSerializer.deserialize(packetSentEvent.encoded_packet);
            guid = Buffer.from(packet.guid.replace('0x', ''), 'hex');
            message = Buffer.from(packet.message.replace('0x', ''), 'hex');
            const codec = PacketV1Codec.from(packet);
            const packetHeader = codec.header();
            const payloadHash = codec.payloadHash();

            const assembledTx = await smlClientA.validate_packet({
                header_bytes: Buffer.from(packetHeader.replace('0x', ''), 'hex'),
                payload_hash: Buffer.from(payloadHash.replace('0x', ''), 'hex'),
            });
            await assembledTx.signAndSend();
            console.log('✅ Packet validated via SML on Chain A (reverse)');
        });

        it('Receive tokens on Chain A (unlock)', async () => {
            const mintBurnPeerBytes = StrKey.decodeContract(mintBurnOftAddress);
            const origin = {
                nonce: 1n,
                sender: Buffer.from(mintBurnPeerBytes),
                src_eid: EID_B,
            };

            const assembledTx = await executorHelperClientA.execute(
                {
                    executor: chainA.executor,
                    params: {
                        extra_data: Buffer.from([]),
                        gas_limit: 0n,
                        guid,
                        message,
                        origin,
                        receiver: lockUnlockOftAddress,
                        value: 0n,
                    },
                    value_payer: EXECUTOR_ADMIN.publicKey(),
                },
                {
                    simulate: false,
                },
            );

            const txResult = await signAndSendWithExecutorAuth(
                chainA.executor,
                EXECUTOR_ADMIN,
                assembledTx,
                NETWORK_PASSPHRASE,
            );

            assertTransactionSucceeded(txResult, 'LzReceive on Chain A (Unlock)');

            console.log('✅ Tokens received and unlocked on Chain A');
        });

        it('Verify final balances', async () => {
            const [senderBalance, lockUnlockOftBalance, recipientABalance, recipientBBalance] =
                await Promise.all([
                    getTokenBalance(DEFAULT_DEPLOYER.publicKey(), oftTokenAddress),
                    getTokenBalance(lockUnlockOftAddress, oftTokenAddress),
                    getTokenBalance(RECIPIENT_A.publicKey(), oftTokenAddress),
                    getTokenBalance(RECIPIENT_B.publicKey(), oftTokenAddress),
                ]);

            console.log('\n📊 Final Balance Summary:');
            console.log(`  - Sender (DEFAULT_DEPLOYER): ${senderBalance} (expected: 8500000000)`);
            console.log(
                `  - Lock/Unlock OFT (Chain A, locked): ${lockUnlockOftBalance} (expected: 500000000)`,
            );
            console.log(
                `  - RECIPIENT_A (Chain A, unlocked): ${recipientABalance} (expected: 500000000)`,
            );
            console.log(
                `  - RECIPIENT_B (Chain B, minted): ${recipientBBalance} (expected: 1000000000)`,
            );

            expect(senderBalance).toBe(8500000000n);
            expect(lockUnlockOftBalance).toBe(500000000n);
            expect(recipientABalance).toBe(500000000n);
            expect(recipientBBalance).toBe(1000000000n);

            console.log('\n🎉 OFT Cross-Chain E2E test completed successfully!');
            console.log(
                '   Chain A (Lock/Unlock) → Chain B (Mint/Burn): 100 tokens locked, 100 minted',
            );
            console.log(
                '   Chain B (Mint/Burn) → Chain A (Lock/Unlock): 50 tokens burned, 50 unlocked',
            );
        });
    });
});
