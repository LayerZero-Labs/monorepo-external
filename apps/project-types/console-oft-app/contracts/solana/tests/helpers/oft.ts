/**
 * The OFT message lifecycle on a live validator, every step a Transaction V1:
 * quote → send → DVN verify + ULN commit → Executor-planned receive → Executor-planned compose.
 */

import { arrayify, hexlify } from '@ethersproject/bytes';
import {
    createNoopSigner,
    type Instruction,
    type KeypairSigner,
    type PublicKey,
    publicKey,
    publicKeyBytes,
} from '@metaplex-foundation/umi';
import {
    bytes,
    publicKey as publicKeySerializer,
    type Serializer,
    struct,
    u32,
    u64,
} from '@metaplex-foundation/umi/serializers';
import { toWeb3JsPublicKey } from '@metaplex-foundation/umi-web3js-adapters';
import { sign as secp256k1Sign, utils as secp256k1Utils } from '@noble/secp256k1';
import { type Connection, SYSVAR_CLOCK_PUBKEY } from '@solana/web3.js';

import { UMI } from '@layerzerolabs/lz-solana-sdk-v2';
import { EndpointProgram } from '@layerzerolabs/lz-v2-protocol-solana';
import { composeV3, executeV3 } from '@layerzerolabs/lz-v2-protocol-solana/v3';
import { Options, PacketSerializer, PacketV1Codec } from '@layerzerolabs/lz-v2-utilities';
import type { InfraEnv } from '@layerzerolabs/test-utils-solana';

import { instructions } from '../../sdk/oft';
import { DST_EID, DVN_SIGNERS, dvns, endpoint, executor, SRC_EID, uln } from '../constants';
import type { OftFixture } from './fixture';
import { ata } from './token';
import { decodeEvents, fetchV1Transaction, sendV1, simulateV1 } from './transaction-v1';
import { getTransferHookAccounts } from './transfer-hook-accounts';

export type PacketSentEvent = EndpointProgram.events.PacketSentEvent;
export type ComposeSentEvent = EndpointProgram.events.ComposeSentEvent;

const sendHelper = new UMI.SendHelper();

/**
 * Executor options every test message carries. The lzReceive value is also the Executor's fee
 * limit for the delivery transaction (post_execute rejects a payer that lost more), so it must cover
 * the rent delivery pays: a first-time recipient ATA and, for send-and-call, the Endpoint's
 * compose-message account.
 */
const LZ_RECEIVE_GAS = 200_000;
const LZ_RECEIVE_VALUE = 5_000_000;
const LZ_COMPOSE_GAS = 200_000;

function messageOptions(composeMsg: Uint8Array | undefined): Uint8Array {
    const options = Options.newOptions().addExecutorLzReceiveOption(
        LZ_RECEIVE_GAS,
        LZ_RECEIVE_VALUE,
    );
    return (
        composeMsg ? options.addExecutorComposeOption(0, LZ_COMPOSE_GAS, 0) : options
    ).toBytes();
}

/** Enforced-options PDA seed: SEND (1) or SEND_AND_CALL (2). */
const msgType = (composeMsg: Uint8Array | undefined) => (composeMsg ? 2 : 1);

async function quoteSend(
    oft: OftFixture,
    payer: PublicKey,
    to: PublicKey,
    amountLd: bigint,
    composeMsg?: Uint8Array,
): Promise<EndpointProgram.types.MessagingFee> {
    const quote = instructions
        .quoteSend(oft.umi, {
            oftStore: oft.oftStore,
            peer: oft.pda.peer(oft.oftStore, DST_EID),
            enforcedOptions: oft.pda.enforcedOptions(oft.oftStore, DST_EID, msgType(composeMsg)),
            feeConfig: oft.pda.feeConfig(oft.oftStore, DST_EID),
            dstEid: DST_EID,
            to: publicKeyBytes(to),
            amountLd,
            minAmountLd: amountLd,
            extraOptions: messageOptions(composeMsg),
            composeMsg: composeMsg ?? null,
            payInLzToken: false,
        })
        .addRemainingAccounts(
            await sendHelper.getQuoteAccounts(oft.umi.rpc, {
                payer,
                sender: oft.oftStore,
                dstEid: DST_EID,
                receiver: publicKeyBytes(oft.oftStore),
            }),
        ).items[0].instruction;
    return simulateV1(
        oft.connection,
        payer,
        [quote],
        oft.pda.programId,
        EndpointProgram.types.getMessagingFeeSerializer(),
    );
}

/**
 * Send `amountLd` from `sender`'s ATA to `to` on DST_EID. Slippage is pinned at the full amount,
 * so this helper only fits fee-free fixtures: remaining accounts are the source→escrow hook group
 * (when the mint has a hook) followed by the Endpoint send accounts, with no fee hook group.
 */
export async function send(
    oft: OftFixture,
    sender: KeypairSigner,
    to: PublicKey,
    amountLd: bigint,
    composeMsg?: Uint8Array,
): Promise<{ signature: string; packet: PacketSentEvent }> {
    const { umi, connection, pda, oftStore, mint, escrow } = oft;
    const tokenSource = ata(mint, sender.publicKey, oft.tokenProgram);
    const fee = await quoteSend(oft, sender.publicKey, to, amountLd, composeMsg);
    const w = toWeb3JsPublicKey;
    const lockHooks = (
        await getTransferHookAccounts(
            connection,
            w(mint),
            w(tokenSource),
            w(escrow),
            w(sender.publicKey),
            amountLd,
        )
    ).map((meta) => ({
        pubkey: publicKey(meta.pubkey),
        isSigner: meta.isSigner,
        isWritable: meta.isWritable,
    }));

    const sendIx = instructions
        .send(umi, {
            signer: sender,
            oftStore,
            peer: pda.peer(oftStore, DST_EID),
            enforcedOptions: pda.enforcedOptions(oftStore, DST_EID, msgType(composeMsg)),
            pauseConfig: pda.pauseConfig(oftStore, DST_EID),
            feeConfig: pda.feeConfig(oftStore, DST_EID),
            defaultRateLimit: pda.rateLimit(oftStore, 0),
            rateLimit: pda.rateLimit(oftStore, DST_EID),
            addressExemption: pda.rateLimitAddressExemption(oftStore, sender.publicKey),
            tokenSource,
            oftEscrow: escrow,
            feeDeposit: oft.feeDeposit,
            tokenMint: mint,
            tokenProgram: oft.tokenProgram,
            eventAuthority: pda.eventAuthority(),
            program: pda.programId,
            dstEid: DST_EID,
            to: publicKeyBytes(to),
            amountLd,
            minAmountLd: amountLd,
            extraOptions: messageOptions(composeMsg),
            composeMsg: composeMsg ?? null,
            nativeFee: fee.nativeFee,
            lzTokenFee: fee.lzTokenFee,
        })
        .addRemainingAccounts([
            ...lockHooks,
            ...(await sendHelper.getSendAccounts(umi.rpc, {
                payer: sender.publicKey,
                dstEid: DST_EID,
                sender: oftStore,
                receiver: publicKeyBytes(oftStore),
            })),
        ]);

    const signature = await sendV1(connection, sender, [sendIx]);
    const [packet] = await events(connection, signature, endpoint.programId, packetSentEvent);
    if (!packet) throw new Error(`No PacketSent event in ${signature}`);
    return { signature, packet };
}

/** The validator's Clock `unix_timestamp`, which DVN signature expiry is checked against. */
async function validatorUnixTime(connection: Connection): Promise<bigint> {
    const clock = await connection.getAccountInfo(SYSVAR_CLOCK_PUBKEY, 'confirmed');
    if (!clock) throw new Error('Clock sysvar missing');
    return clock.data.readBigInt64LE(32); // after slot, epoch_start_timestamp, epoch, leader_schedule_epoch
}

/** The snapshot DVN's quorum signers (deterministic secp256k1 keys) sign `message`. */
const signAsDvn = (message: Buffer) =>
    Promise.all(
        DVN_SIGNERS.map(async (key) => {
            const [signature, recoveryId] = await secp256k1Sign(
                message,
                secp256k1Utils.bytesToHex(key),
                {
                    canonical: true,
                    recovered: true,
                    der: false,
                },
            );
            return { signature, recoveryId };
        }),
    );

/** Every required DVN verifies `packet`, then the ULN commits it to the Endpoint as SRC_EID inbound. */
export async function verifyAndCommit(
    { umi, connection }: InfraEnv,
    packet: PacketSentEvent,
): Promise<void> {
    const packetBytes = packet.encodedPacket;
    const codec = PacketV1Codec.fromBytes(packetBytes);
    const receiver = publicKey(arrayify(codec.receiver()));
    const expiration = (await validatorUnixTime(connection)) + 120n;
    const invoke = (dvn: UMI.DVNProgram.DVN, instruction: Instruction) =>
        dvn.invoke(
            umi.rpc,
            umi.payer,
            { vid: DST_EID % 30000, instruction, expiration },
            { sign: signAsDvn },
        );

    for (const programId of dvns) {
        const dvn = new UMI.DVNProgram.DVN(programId);
        const [config] = dvn.pda.config();
        await sendV1(connection, umi.payer, [
            uln.initVerify(umi.payer, { dvn: config, packetBytes }),
            await invoke(
                dvn,
                uln.verify(createNoopSigner(config), { packetBytes, confirmations: 10 })
                    .instruction,
            ),
        ]);
    }

    await sendV1(connection, umi.payer, [
        endpoint.initVerify(umi.payer, {
            srcEid: SRC_EID,
            sender: arrayify(codec.sender()),
            receiver,
            nonce: BigInt(codec.nonce()),
        }),
        await uln.commitVerification(umi.rpc, packetBytes, endpoint.programId),
    ]);

    for (const programId of dvns) {
        const dvn = new UMI.DVNProgram.DVN(programId);
        const [config] = dvn.pda.config();
        await sendV1(connection, umi.payer, [
            await invoke(
                dvn,
                uln.closeVerify(createNoopSigner(config), { receiver, packetBytes }).instruction,
            ),
        ]);
    }
}

/**
 * Deliver a committed packet as the Executor would: resolve the plan on-chain through
 * `lz_receive_types_v3`, then submit it unmodified, `[pre_execute, ...plan, post_execute]`, as one
 * Transaction V1 paid by the snapshot's executor wallet.
 */
export async function receive(
    { umi, connection }: InfraEnv,
    packet: PacketSentEvent,
): Promise<{ signature: string; instructionCount: number }> {
    const lzReceive = Options.fromOptions(hexlify(packet.options)).decodeExecutorLzReceiveOption();
    const { instructions: planned, signers } = await executeV3(executor, umi.rpc, umi.payer, {
        packet: PacketSerializer.deserialize(packet.encodedPacket),
        extraData: new Uint8Array(2),
        value: lzReceive?.value,
    });
    const signature = await sendV1(connection, umi.payer, planned, { signers });
    return { signature, instructionCount: planned.length };
}

/** Execute an Endpoint compose message through the composer's `lz_compose_types_v3` plan. */
export async function compose(
    { umi, connection }: InfraEnv,
    event: ComposeSentEvent,
): Promise<string> {
    const { instructions: planned, signers } = await composeV3(executor, umi.rpc, umi.payer, {
        event,
        extraData: new Uint8Array(2),
    });
    return sendV1(connection, umi.payer, planned, { signers });
}

/** Decode `programId`'s events of one type from a landed V1 transaction. */
export const events = async <T>(
    connection: Connection,
    signature: string,
    programId: PublicKey,
    serializer: Serializer<T, T>,
): Promise<T[]> =>
    decodeEvents(await fetchV1Transaction(connection, signature), programId, serializer);

const packetSentEvent = EndpointProgram.events.getPacketSentEventSerializer();
export const composeSentEvent = EndpointProgram.events.getComposeSentEventSerializer();

// console_oft events; descriptions are the Rust struct names, which select the discriminators.
export const oftReceivedEvent = struct<{
    guid: Uint8Array;
    srcEid: number;
    to: PublicKey;
    amountReceivedLd: bigint;
    oftStore: PublicKey;
}>(
    [
        ['guid', bytes({ size: 32 })],
        ['srcEid', u32()],
        ['to', publicKeySerializer()],
        ['amountReceivedLd', u64()],
        ['oftStore', publicKeySerializer()],
    ],
    { description: 'OFTReceived' },
);

export const creditRedirectedEvent = struct<{
    oftStore: PublicKey;
    guid: Uint8Array;
    recipient: PublicKey;
    tokenDest: PublicKey;
    redirectEscrow: PublicKey;
    amountLd: bigint;
}>(
    [
        ['oftStore', publicKeySerializer()],
        ['guid', bytes({ size: 32 })],
        ['recipient', publicKeySerializer()],
        ['tokenDest', publicKeySerializer()],
        ['redirectEscrow', publicKeySerializer()],
        ['amountLd', u64()],
    ],
    { description: 'CreditRedirected' },
);

/** The amount in an OFT compose payload: [nonce:8][src_eid:4][amount_ld:8][compose_from:32][msg]. */
export const composedAmountLd = (event: ComposeSentEvent): bigint =>
    Buffer.from(event.message).readBigUInt64BE(12);
