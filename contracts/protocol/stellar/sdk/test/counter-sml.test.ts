import { StrKey } from '@stellar/stellar-sdk';
import path from 'path';
import { beforeAll, describe, expect, inject, it } from 'vitest';

import { getFullyQualifiedRepoRootPath } from '@layerzerolabs/common-node-utils';
import { Options, PacketSerializer, PacketV1Codec } from '@layerzerolabs/lz-v2-utilities';

import { Client as CounterClient } from '../src/generated/counter';
import { Client as EndpointClient } from '../src/generated/endpoint';
import { Client as ExecutorHelperClient } from '../src/generated/executor_helper';
import { Client as SMLClient } from '../src/generated/sml';
import {
    DEFAULT_DEPLOYER,
    EID_A,
    EID_B,
    EXECUTOR_ADMIN,
    MSG_TYPE_ABA,
    MSG_TYPE_VANILLA,
    NETWORK_PASSPHRASE,
} from './suites/constants';
import { deployContract } from './suites/deploy';
import type { ChainAddresses } from './suites/globalSetup';
import { PacketSentEvent, scanPacketSentEvents } from './suites/scan';
import { assertTransactionSucceeded, createClient, signAndSendWithExecutorAuth } from './utils';

// Chain addresses (injected from globalSetup)
let chainA: ChainAddresses;
let chainB: ChainAddresses;

// Counter addresses (deployed per-chain)
let counterAAddress = '';
let counterBAddress = '';

// Chain A Clients
let endpointClientA: EndpointClient;
let smlClientA: SMLClient;
let counterClientA: CounterClient;
let executorHelperClientA: ExecutorHelperClient;

// Chain B Clients
let endpointClientB: EndpointClient;
let smlClientB: SMLClient;
let counterClientB: CounterClient;
let executorHelperClientB: ExecutorHelperClient;

describe('Counter Cross-Chain Testing (SML)', async () => {
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

    const COUNTER_WASM_PATH = path.join(wasmDir, 'counter.wasm');

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
    });

    describe('Deploy Counters on Both Chains', () => {
        it('Deploy Counter A on Chain A', async () => {
            counterClientA = await deployContract<CounterClient>(
                CounterClient,
                COUNTER_WASM_PATH,
                {
                    owner: DEFAULT_DEPLOYER.publicKey(),
                    endpoint: chainA.endpointV2,
                    delegate: DEFAULT_DEPLOYER.publicKey(),
                },
                DEFAULT_DEPLOYER,
            );

            counterAAddress = counterClientA.options.contractId;
            console.log('✅ Counter A deployed on Chain A:', counterAAddress);
        });

        it('Deploy Counter B on Chain B', async () => {
            counterClientB = await deployContract<CounterClient>(
                CounterClient,
                COUNTER_WASM_PATH,
                {
                    owner: DEFAULT_DEPLOYER.publicKey(),
                    endpoint: chainB.endpointV2,
                    delegate: DEFAULT_DEPLOYER.publicKey(),
                },
                DEFAULT_DEPLOYER,
            );

            counterBAddress = counterClientB.options.contractId;
            console.log('✅ Counter B deployed on Chain B:', counterBAddress);
        });
    });

    describe('Wire Counters to use SML (Cross-Chain)', () => {
        it('Set Counter A Send Library to SML (for sending to Chain B)', async () => {
            const assembledTx = await endpointClientA.set_send_library({
                caller: DEFAULT_DEPLOYER.publicKey(),
                sender: counterAAddress,
                dst_eid: EID_B,
                new_lib: chainA.sml,
            });
            await assembledTx.signAndSend();

            const { result: sendLib } = await endpointClientA.get_send_library({
                sender: counterAAddress,
                dst_eid: EID_B,
            });
            expect(sendLib.lib).toBe(chainA.sml);
            console.log('✅ Counter A send library set to SML for EID_B');
        });

        it('Set Counter A Receive Library to SML (for receiving from Chain B)', async () => {
            const assembledTx = await endpointClientA.set_receive_library({
                caller: DEFAULT_DEPLOYER.publicKey(),
                receiver: counterAAddress,
                src_eid: EID_B,
                new_lib: chainA.sml,
                grace_period: 0n,
            });
            await assembledTx.signAndSend();

            const { result: receiveLib } = await endpointClientA.get_receive_library({
                receiver: counterAAddress,
                src_eid: EID_B,
            });
            expect(receiveLib.lib).toBe(chainA.sml);
            console.log('✅ Counter A receive library set to SML for EID_B');
        });

        it('Set Counter B Send Library to SML (for sending to Chain A)', async () => {
            const assembledTx = await endpointClientB.set_send_library({
                caller: DEFAULT_DEPLOYER.publicKey(),
                sender: counterBAddress,
                dst_eid: EID_A,
                new_lib: chainB.sml,
            });
            await assembledTx.signAndSend();

            const { result: sendLib } = await endpointClientB.get_send_library({
                sender: counterBAddress,
                dst_eid: EID_A,
            });
            expect(sendLib.lib).toBe(chainB.sml);
            console.log('✅ Counter B send library set to SML for EID_A');
        });

        it('Set Counter B Receive Library to SML (for receiving from Chain A)', async () => {
            const assembledTx = await endpointClientB.set_receive_library({
                caller: DEFAULT_DEPLOYER.publicKey(),
                receiver: counterBAddress,
                src_eid: EID_A,
                new_lib: chainB.sml,
                grace_period: 0n,
            });
            await assembledTx.signAndSend();

            const { result: receiveLib } = await endpointClientB.get_receive_library({
                receiver: counterBAddress,
                src_eid: EID_A,
            });
            expect(receiveLib.lib).toBe(chainB.sml);
            console.log('✅ Counter B receive library set to SML for EID_A');
        });

        it('Set Counter A Peer to Counter B', async () => {
            const peerBBytes = StrKey.decodeContract(counterBAddress);

            const assembledTx = await counterClientA.set_peer({
                eid: EID_B,
                peer: Buffer.from(peerBBytes),
                operator: DEFAULT_DEPLOYER.publicKey(),
            });
            await assembledTx.signAndSend();

            const { result: peer } = await counterClientA.peer({
                eid: EID_B,
            });
            expect(peer?.toString()).toBe(Buffer.from(peerBBytes).toString());
            console.log('✅ Counter A peer set to Counter B for EID_B');
        });

        it('Set Counter B Peer to Counter A', async () => {
            const peerABytes = StrKey.decodeContract(counterAAddress);

            const assembledTx = await counterClientB.set_peer({
                eid: EID_A,
                peer: Buffer.from(peerABytes),
                operator: DEFAULT_DEPLOYER.publicKey(),
            });
            await assembledTx.signAndSend();

            const { result: peer } = await counterClientB.peer({
                eid: EID_A,
            });
            expect(peer?.toString()).toBe(Buffer.from(peerABytes).toString());
            console.log('✅ Counter B peer set to Counter A for EID_A');
        });
    });

    describe('Cross-Chain ABA Messaging (A → B → A)', async () => {
        let incrementLedger = 0;
        let responseLedger = 0;
        let packetSentEvent: PacketSentEvent;
        let responsePacketSentEvent: PacketSentEvent;
        let guid: Buffer;
        let message: Buffer;
        let responseGuid: Buffer;
        let responseMessage: Buffer;
        let abaReturnFee: bigint;

        it('Counter A Increment (ABA) - sends to Chain B', async () => {
            // Quote the return fee (for Counter B to send response back to Chain A)
            const returnOptions = Options.newOptions().addExecutorLzReceiveOption(200000n, 0n);

            const { result: returnFee } = await counterClientB.quote({
                dst_eid: EID_A,
                msg_type: MSG_TYPE_VANILLA,
                options: Buffer.from(returnOptions.toBytes()),
                pay_in_zro: false,
            });
            console.log('✅ Return fee for ABA (B→A):', returnFee);

            // Add 1% buffer to the return fee
            abaReturnFee = (returnFee.native_fee * 101n) / 100n;

            // Build ABA options with lzReceive gas + value for return message fee
            const abaOptions = Options.newOptions().addExecutorLzReceiveOption(
                200000n,
                abaReturnFee,
            );
            const optionsBuffer = Buffer.from(abaOptions.toBytes());

            const { result: fee } = await counterClientA.quote({
                dst_eid: EID_B,
                msg_type: MSG_TYPE_ABA,
                options: optionsBuffer,
                pay_in_zro: true,
            });
            console.log('✅ ABA Fee (A→B):', fee);

            const assembledTx = await counterClientA.increment({
                caller: DEFAULT_DEPLOYER.publicKey(),
                dst_eid: EID_B,
                msg_type: MSG_TYPE_ABA,
                options: optionsBuffer,
                fee: fee,
            });
            const sentTx = await assembledTx.signAndSend();

            const txResponse = sentTx.getTransactionResponse;
            if (txResponse && 'ledger' in txResponse) {
                incrementLedger = txResponse.ledger;
            }

            const { result: outboundCount } = await counterClientA.outbound_count({
                eid: EID_B,
            });
            expect(outboundCount).toBe(1n);
            console.log('✅ Counter A incremented (ABA to B), outbound count:', outboundCount);
        });

        it('Scan PacketSent Events (A → B)', async () => {
            const packetSentEvents = await scanPacketSentEvents(chainA.endpointV2, incrementLedger);
            expect(packetSentEvents.length).toBeGreaterThan(0);
            packetSentEvent = packetSentEvents[0];
            console.log(
                `✅ PacketSent events scanned from Chain A. Found ${packetSentEvents.length} events`,
            );
        });

        it('Verify Counter Message on Chain B (via SML)', async () => {
            const packet = PacketSerializer.deserialize(packetSentEvent.encoded_packet);
            guid = Buffer.from(packet.guid.replace('0x', ''), 'hex');
            message = Buffer.from(packet.message.replace('0x', ''), 'hex');
            const codec = PacketV1Codec.from(packet);
            const packetHeader = codec.header();
            const payloadHash = codec.payloadHash();

            // Validate on Chain B's SML
            const assembledTx = await smlClientB.validate_packet({
                header_bytes: Buffer.from(packetHeader.replace('0x', ''), 'hex'),
                payload_hash: Buffer.from(payloadHash.replace('0x', ''), 'hex'),
            });
            await assembledTx.signAndSend();
            console.log('✅ ABA request packet validated on Chain B');
        });

        it('Execute native_drop on Chain B', async () => {
            const origin = {
                nonce: 1n,
                sender: Buffer.from(StrKey.decodeContract(counterAAddress)),
                src_eid: EID_A,
            };

            const assembledTx = await executorHelperClientB.native_drop(
                {
                    executor: chainB.executor,
                    admin: EXECUTOR_ADMIN.publicKey(),
                    origin,
                    dst_eid: EID_B,
                    oapp: counterBAddress,
                    params: [
                        {
                            receiver: counterBAddress,
                            amount: 100n,
                        },
                    ],
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

            assertTransactionSucceeded(txResult, 'native_drop on Chain B');
        });

        it('Receive Counter Message on Chain B (ABA - triggers response to A)', async () => {
            const origin = {
                nonce: 1n,
                sender: Buffer.from(StrKey.decodeContract(counterAAddress)),
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
                        receiver: counterBAddress,
                        value: abaReturnFee,
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

            assertTransactionSucceeded(txResult, 'LzReceive on Chain B (ABA)');

            if ('ledger' in txResult) {
                responseLedger = txResult.ledger;
            }

            // Verify Counter B received the message
            const { result: inboundCount } = await counterClientB.inbound_count({
                eid: EID_A,
            });
            expect(inboundCount).toBe(1n);

            // Verify Counter B sent the response back to Chain A
            const { result: outboundCount } = await counterClientB.outbound_count({
                eid: EID_A,
            });
            expect(outboundCount).toBe(1n);
            console.log(
                '✅ Counter B received ABA message and sent response, outbound count:',
                outboundCount,
            );
        });

        it('Scan ABA Response PacketSent Events (B → A)', async () => {
            const packetSentEvents = await scanPacketSentEvents(chainB.endpointV2, responseLedger);
            expect(packetSentEvents.length).toBeGreaterThan(0);
            responsePacketSentEvent = packetSentEvents[0];
            console.log(
                `✅ ABA response PacketSent events scanned from Chain B. Found ${packetSentEvents.length} events`,
            );
        });

        it('Verify ABA Response Message on Chain A (via SML)', async () => {
            const packet = PacketSerializer.deserialize(responsePacketSentEvent.encoded_packet);
            responseGuid = Buffer.from(packet.guid.replace('0x', ''), 'hex');
            responseMessage = Buffer.from(packet.message.replace('0x', ''), 'hex');
            const codec = PacketV1Codec.from(packet);
            const packetHeader = codec.header();
            const payloadHash = codec.payloadHash();

            // Validate on Chain A's SML
            const assembledTx = await smlClientA.validate_packet({
                header_bytes: Buffer.from(packetHeader.replace('0x', ''), 'hex'),
                payload_hash: Buffer.from(payloadHash.replace('0x', ''), 'hex'),
            });
            await assembledTx.signAndSend();
            console.log('✅ ABA response packet validated on Chain A');
        });

        it('Receive ABA Response Message on Chain A', async () => {
            const origin = {
                nonce: 1n,
                sender: Buffer.from(StrKey.decodeContract(counterBAddress)),
                src_eid: EID_B,
            };

            // Execute on Chain A using Chain A's executor
            const assembledTx = await executorHelperClientA.execute(
                {
                    executor: chainA.executor,
                    params: {
                        extra_data: Buffer.from([]),
                        gas_limit: 0n,
                        guid: responseGuid,
                        message: responseMessage,
                        origin,
                        receiver: counterAAddress,
                        value: 10n,
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

            assertTransactionSucceeded(txResult, 'LzReceive on Chain A (ABA Response)');

            // Verify Counter A received the response
            const { result: inboundCount } = await counterClientA.inbound_count({
                eid: EID_B,
            });
            expect(inboundCount).toBe(1n);
            console.log('✅ Counter A received ABA response, inbound count:', inboundCount);

            console.log('\n🎉 Cross-chain ABA round-trip completed successfully!');
            console.log('   Request:  Counter A (Chain A) → Counter B (Chain B) [ABA]');
            console.log('   Response: Counter B (Chain B) → Counter A (Chain A) [Vanilla]');
        });
    });
});
