import { Address, nativeToScVal, StrKey, xdr } from '@stellar/stellar-sdk';
import path from 'path';
import { beforeAll, describe, expect, inject, it } from 'vitest';

import { getFullyQualifiedRepoRootPath } from '@layerzerolabs/common-node-utils';
import { Options, PacketSerializer, PacketV1Codec } from '@layerzerolabs/lz-v2-utilities';

import { Client as CounterClient } from '../src/generated/counter';
import { Client as DvnClient } from '../src/generated/dvn';
import { Client as ExecutorHelperClient } from '../src/generated/executor_helper';
import { Client as Uln302Client } from '../src/generated/uln302';
import {
    DEFAULT_DEPLOYER,
    DVN_SIGNER,
    DVN_VID,
    EID_A,
    EID_B,
    EXECUTOR_ADMIN,
    MSG_TYPE_COMPOSED_ABA,
    MSG_TYPE_VANILLA,
    NETWORK_PASSPHRASE,
} from './suites/constants';
import { deployContract } from './suites/deploy';
import type { ChainAddresses } from './suites/globalSetup';
import { PacketSentEvent, scanPacketSentEvents } from './suites/scan';
import {
    assertTransactionSucceeded,
    createClient,
    getNativeBalance,
    signAndSendWithExecutorAuth,
    signDvnAuthEntries,
} from './utils';

// Chain addresses (injected from globalSetup)
let chainA: ChainAddresses;
let chainB: ChainAddresses;

// Counter addresses (deployed per-chain)
let counterAAddress = '';
let counterBAddress = '';

// Chain A Clients
let uln302ClientA: Uln302Client;
let counterClientA: CounterClient;
let executorHelperClientA: ExecutorHelperClient;
let dvnClientA: DvnClient;

// Chain B Clients
let uln302ClientB: Uln302Client;
let counterClientB: CounterClient;
let executorHelperClientB: ExecutorHelperClient;
let dvnClientB: DvnClient;

describe('Counter Cross-Chain Testing (ULN302)', async () => {
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
        console.log('  ULN302:', chainA.uln302);
        console.log('  DVN:', chainA.dvn);
        console.log('  Executor:', chainA.executor);

        console.log('\n📋 Chain B addresses (EID: ' + EID_B + ')');
        console.log('  Endpoint:', chainB.endpointV2);
        console.log('  ULN302:', chainB.uln302);
        console.log('  DVN:', chainB.dvn);
        console.log('  Executor:', chainB.executor);

        // Create clients for Chain A protocol contracts
        uln302ClientA = createClient(Uln302Client, chainA.uln302);
        executorHelperClientA = createClient(ExecutorHelperClient, chainA.executorHelper);
        dvnClientA = createClient(DvnClient, chainA.dvn);

        // Create clients for Chain B protocol contracts
        uln302ClientB = createClient(Uln302Client, chainB.uln302);
        executorHelperClientB = createClient(ExecutorHelperClient, chainB.executorHelper);
        dvnClientB = createClient(DvnClient, chainB.dvn);
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

    describe('Counter Increment with Composed ABA and Native Drop (A → B → A)', async () => {
        let incrementLedger = 0;
        let packetSentEvent: PacketSentEvent;
        let guid: Buffer;
        let message: Buffer;
        let packetHeader: Buffer;
        let payloadHash: Buffer;
        let composeValue: bigint;

        // Native drop receiver - use DEFAULT_DEPLOYER as the receiver
        const NATIVE_DROP_AMOUNT = 1000000n; // 0.1 XLM (in stroops)
        let nativeDropReceiver: Buffer;

        it('Counter A Increment (Composed ABA with Native Drop) - sends to Chain B', async () => {
            // Get the native drop receiver address (32 bytes)
            nativeDropReceiver = Buffer.from(
                StrKey.decodeEd25519PublicKey(DEFAULT_DEPLOYER.publicKey()),
            );
            const nativeDropReceiverHex = '0x' + nativeDropReceiver.toString('hex');

            // Quote the return fee (for Counter B to send response back to Chain A)
            const returnOptions = Options.newOptions().addExecutorLzReceiveOption(200000n, 0n);

            const { result: returnFee } = await counterClientB.quote({
                dst_eid: EID_A,
                msg_type: MSG_TYPE_VANILLA,
                options: Buffer.from(returnOptions.toBytes()),
                pay_in_zro: false,
            });
            console.log('✅ Return fee for ComposedABA (B→A):', returnFee);

            // Add 1% buffer to the return fee
            const returnFeeWithBuffer = (returnFee.native_fee * 101n) / 100n;
            composeValue = returnFeeWithBuffer;

            // Build type 3 options with:
            // 1. lz_receive option (gas only, no value)
            // 2. native_drop option (amount + receiver)
            // 3. lz_compose option (index + gas + value for return message)
            const composedAbaOptions = Options.newOptions()
                .addExecutorLzReceiveOption(200000n, 0n)
                .addExecutorNativeDropOption(NATIVE_DROP_AMOUNT, nativeDropReceiverHex)
                .addExecutorComposeOption(0, 200000n, returnFeeWithBuffer);

            const optionsBuffer = Buffer.from(composedAbaOptions.toBytes());

            const { result: fee } = await counterClientA.quote({
                dst_eid: EID_B,
                msg_type: MSG_TYPE_COMPOSED_ABA,
                options: optionsBuffer,
                pay_in_zro: false,
            });
            console.log('✅ ComposedABA Fee (A→B):', fee);

            const assembledTx = await counterClientA.increment({
                caller: DEFAULT_DEPLOYER.publicKey(),
                dst_eid: EID_B,
                msg_type: MSG_TYPE_COMPOSED_ABA,
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
            console.log(
                '✅ Counter A incremented (Composed ABA to B), outbound count:',
                outboundCount,
            );
        });

        it('Scan PacketSent Events (A → B)', async () => {
            const packetSentEvents = await scanPacketSentEvents(chainA.endpointV2, incrementLedger);
            expect(packetSentEvents.length).toBeGreaterThan(0);
            packetSentEvent = packetSentEvents[0];
            console.log(
                `✅ PacketSent events scanned from Chain A. Found ${packetSentEvents.length} events`,
            );
        });

        it('Extract Packet Header and Payload Hash (A → B)', async () => {
            const packet = PacketSerializer.deserialize(packetSentEvent.encoded_packet);
            guid = Buffer.from(packet.guid.replace('0x', ''), 'hex');
            message = Buffer.from(packet.message.replace('0x', ''), 'hex');

            const codec = PacketV1Codec.from(packet);
            packetHeader = Buffer.from(codec.header().replace('0x', ''), 'hex');
            payloadHash = Buffer.from(codec.payloadHash().replace('0x', ''), 'hex');

            console.log('✅ Packet header extracted, length:', packetHeader.length);
            console.log(
                '✅ Payload hash extracted:',
                payloadHash.toString('hex').slice(0, 16) + '...',
            );
        });

        it('DVN B Verifies Message on Chain B (from Chain A)', async () => {
            // DVN calls execute_transaction to invoke uln302.verify externally
            const verifyTx = await dvnClientB.execute_transaction({
                calls: [
                    {
                        to: chainB.uln302,
                        func: 'verify',
                        args: [
                            nativeToScVal(Address.fromString(chainB.dvn), { type: 'address' }),
                            nativeToScVal(packetHeader, { type: 'bytes' }),
                            nativeToScVal(payloadHash, { type: 'bytes' }),
                            xdr.ScVal.scvU64(new xdr.Uint64(BigInt(1))),
                        ],
                    },
                ],
            });

            await signDvnAuthEntries(
                chainB.dvn,
                DVN_VID,
                DEFAULT_DEPLOYER,
                [DVN_SIGNER],
                verifyTx,
                NETWORK_PASSPHRASE,
            );

            await verifyTx.signAndSend();
            console.log('✅ DVN B verified message on Chain B');

            const { result: isVerifiable } = await uln302ClientB.verifiable({
                packet_header: packetHeader,
                payload_hash: payloadHash,
            });
            expect(isVerifiable).toBe(true);
        });

        it('Commit Verification on Chain B', async () => {
            const commitTx = await uln302ClientB.commit_verification({
                packet_header: packetHeader,
                payload_hash: payloadHash,
            });
            await commitTx.signAndSend();
            console.log('✅ Verification committed to endpoint on Chain B');
        });

        it('Execute native_drop on Chain B', async () => {
            const origin = {
                nonce: 1n,
                sender: Buffer.from(StrKey.decodeContract(counterAAddress)),
                src_eid: EID_A,
            };

            // Get the balance before native drop
            const balanceBefore = await getNativeBalance(DEFAULT_DEPLOYER.publicKey());
            console.log('💰 Balance before native drop:', balanceBefore);

            const assembledTx = await executorHelperClientB.native_drop(
                {
                    executor: chainB.executor,
                    admin: EXECUTOR_ADMIN.publicKey(),
                    origin,
                    dst_eid: EID_B,
                    oapp: counterBAddress,
                    params: [
                        {
                            receiver: DEFAULT_DEPLOYER.publicKey(),
                            amount: NATIVE_DROP_AMOUNT,
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

            // Verify native drop was received
            const balanceAfter = await getNativeBalance(DEFAULT_DEPLOYER.publicKey());
            console.log('💰 Balance after native drop:', balanceAfter);
            const balanceIncrease = balanceAfter - balanceBefore;
            expect(balanceIncrease).toBe(NATIVE_DROP_AMOUNT);
            console.log('✅ Native drop received:', NATIVE_DROP_AMOUNT, 'stroops');
        });

        it('Execute lz_receive on Chain B', async () => {
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

            assertTransactionSucceeded(txResult, 'lz_receive on Chain B');

            // Verify Counter B received the message
            const { result: inboundCount } = await counterClientB.inbound_count({
                eid: EID_A,
            });
            expect(inboundCount).toBe(1n);
            console.log('✅ Counter B inbound count from EID_A:', inboundCount);
        });

        // Variables for tracking the return message
        let composeLedger = 0;
        let returnPacketSentEvent: PacketSentEvent;
        let returnGuid: Buffer;
        let returnMessage: Buffer;
        let returnPacketHeader: Buffer;
        let returnPayloadHash: Buffer;

        it('Execute lz_compose on Chain B (sends response to Chain A)', async () => {
            // Execute the compose message that was queued by lz_receive
            const assembledTx = await executorHelperClientB.compose(
                {
                    executor: chainB.executor,
                    params: {
                        from: counterBAddress,
                        to: counterBAddress,
                        guid,
                        index: 0,
                        message,
                        extra_data: Buffer.from([]),
                        value: composeValue,
                        gas_limit: 0n,
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

            assertTransactionSucceeded(txResult, 'lz_compose on Chain B');

            if ('ledger' in txResult) {
                composeLedger = txResult.ledger;
            }

            // Verify composed count increased
            const { result: composedCount } = await counterClientB.composed_count();
            expect(composedCount).toBe(1n);
            console.log('✅ Counter B composed count:', composedCount);

            // Verify outbound count increased (response message sent to Chain A)
            const { result: outboundCount } = await counterClientB.outbound_count({
                eid: EID_A,
            });
            expect(outboundCount).toBe(1n);
            console.log('✅ Counter B outbound count (response to A):', outboundCount);
        });

        it('Scan Return PacketSent Events (B → A)', async () => {
            const packetSentEvents = await scanPacketSentEvents(chainB.endpointV2, composeLedger);
            expect(packetSentEvents.length).toBeGreaterThan(0);
            returnPacketSentEvent = packetSentEvents[0];
            console.log(
                `✅ Return PacketSent events scanned from Chain B. Found ${packetSentEvents.length} events`,
            );
        });

        it('Extract Return Packet Header and Payload Hash (B → A)', async () => {
            const packet = PacketSerializer.deserialize(returnPacketSentEvent.encoded_packet);
            returnGuid = Buffer.from(packet.guid.replace('0x', ''), 'hex');
            returnMessage = Buffer.from(packet.message.replace('0x', ''), 'hex');

            const codec = PacketV1Codec.from(packet);
            returnPacketHeader = Buffer.from(codec.header().replace('0x', ''), 'hex');
            returnPayloadHash = Buffer.from(codec.payloadHash().replace('0x', ''), 'hex');

            console.log('✅ Return packet header extracted, length:', returnPacketHeader.length);
            console.log(
                '✅ Return payload hash extracted:',
                returnPayloadHash.toString('hex').slice(0, 16) + '...',
            );
        });

        it('DVN A Verifies Return Message on Chain A (from Chain B)', async () => {
            // DVN calls execute_transaction to invoke uln302.verify externally
            const verifyTx = await dvnClientA.execute_transaction({
                calls: [
                    {
                        to: chainA.uln302,
                        func: 'verify',
                        args: [
                            nativeToScVal(Address.fromString(chainA.dvn), { type: 'address' }),
                            nativeToScVal(returnPacketHeader, { type: 'bytes' }),
                            nativeToScVal(returnPayloadHash, { type: 'bytes' }),
                            xdr.ScVal.scvU64(new xdr.Uint64(BigInt(1))),
                        ],
                    },
                ],
            });

            await signDvnAuthEntries(
                chainA.dvn,
                DVN_VID,
                DEFAULT_DEPLOYER,
                [DVN_SIGNER],
                verifyTx,
                NETWORK_PASSPHRASE,
            );

            await verifyTx.signAndSend();
            console.log('✅ DVN A verified return message on Chain A');

            const { result: isVerifiable } = await uln302ClientA.verifiable({
                packet_header: returnPacketHeader,
                payload_hash: returnPayloadHash,
            });
            expect(isVerifiable).toBe(true);
        });

        it('Commit Verification on Chain A (Return Message)', async () => {
            const commitTx = await uln302ClientA.commit_verification({
                packet_header: returnPacketHeader,
                payload_hash: returnPayloadHash,
            });
            await commitTx.signAndSend();
            console.log('✅ Verification committed for return message on Chain A');
        });

        it('Receive Return Message on Chain A (lz_receive)', async () => {
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
                        guid: returnGuid,
                        message: returnMessage,
                        origin,
                        receiver: counterAAddress,
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

            assertTransactionSucceeded(txResult, 'lz_receive on Chain A (Return Message)');

            // Verify final counter state
            const { result: count } = await counterClientA.count();
            expect(count).toBe(1n);
            console.log('✅ Final counter A count:', count);

            const { result: inboundCount } = await counterClientA.inbound_count({
                eid: EID_B,
            });
            expect(inboundCount).toBe(1n);
            console.log('✅ Counter A inbound count from EID_B:', inboundCount);

            console.log(
                '\n🎉 Counter Cross-Chain Composed ABA with Native Drop - Full Round Trip!',
            );
            console.log('   Chain A → Chain B: ComposedABA with native_drop');
            console.log('   DVN B verifies → Commit → native_drop → lz_receive → lz_compose');
            console.log('   Chain B → Chain A: Response (Vanilla)');
            console.log('   DVN A verifies → Commit → lz_receive');
        });
    });
});
