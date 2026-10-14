import {
    Commitment,
    createNoopSigner,
    generateSigner,
    none,
    PublicKey,
    publicKey,
    RpcConfirmTransactionResult,
    Signer,
    some,
    TransactionBuilder,
    Umi,
    WrappedInstruction,
} from '@metaplex-foundation/umi';
import { base58, Serializer } from '@metaplex-foundation/umi/serializers';
import {
    fromWeb3JsInstruction,
    toWeb3JsInstruction,
    toWeb3JsKeypair,
    toWeb3JsPublicKey,
} from '@metaplex-foundation/umi-web3js-adapters';
import {
    Account,
    createMint,
    getAccount,
    getAssociatedTokenAddress,
    getOrCreateAssociatedTokenAccount,
    mintTo,
} from '@solana/spl-token';
import * as web3 from '@solana/web3.js';
import { assert, expect } from 'vitest';

import { hexToBytes } from '@layerzerolabs/common-encoding-utils';
import { SolanaSigner } from '@layerzerolabs/lz-corekit-solana';
import { HashSigner, secp256k1, Secp256k1Signer } from '@layerzerolabs/lz-foundation';
import { arrayify } from '@layerzerolabs/lz-utilities';
import {
    addressToBytes32,
    calculateGuid,
    ExecutorOptionType,
    Packet,
    PacketHeader,
    PacketV1Codec,
} from '@layerzerolabs/lz-v2-utilities';

import {
    EndpointProgram,
    MessageLibInterface,
    SimpleMessageLibProgram,
    simulateWeb3JsTransaction,
    SolanaPacketPath,
} from '../../src';
import { types } from '../../src/dvn';
import { OnlyRevertError } from '../../src/generated/simple_messagelib';
import { SIMPLE_MESSAGELIB_PROGRAM_ID, SimpleMessageLib } from '../../src/simple-message-lib';
import { maxAdminNum, maxExecutorsLen, maxMsgLibsLen, maxSignerNum, maxUpdaterNum } from './config';
import { DST_EID, eddsa, EOAPP, LZ_TOKEN_ADMIN, SRC_EID } from './constants';
import {
    getFakeLzTokenMint,
    getLzTokenMint,
    oAppInBoundNonce,
    setFakeLzTokenMint,
    setLzTokenMint,
} from './state';

export { assert, expect };

export async function simulateTx<From, To extends From = From>(
    connection: web3.Connection,
    ix: WrappedInstruction | WrappedInstruction[],
    signer: Signer[] | Signer, // the first one is the payer,
    serializer: Serializer<From, To>,
    computeUnitsLimit = 2000000,
    commitment: Commitment = 'confirmed',
): Promise<To> {
    const computeUnitsBudgetIX = web3.ComputeBudgetProgram.setComputeUnitLimit({
        units: computeUnitsLimit,
    });
    const signers = Array.isArray(signer) ? signer : [signer];
    const ixs = Array.isArray(ix)
        ? ix.map((x) => toWeb3JsInstruction(x.instruction))
        : [toWeb3JsInstruction(ix.instruction)];

    const { programId } = ixs[ixs.length - 1];
    return simulateWeb3JsTransaction(
        connection,
        [computeUnitsBudgetIX, ...ixs],
        programId,
        toWeb3JsPublicKey(signers[0].publicKey),
        serializer,
        commitment,
    );
}

export async function createLzTokenAccount(
    connection: web3.Connection,
    payer: web3.Keypair,
    mintToAddress: web3.PublicKey,
): Promise<void> {
    return airdropLzToken(connection, payer, mintToAddress, 0);
}

export async function createFakeLzTokenAccount(
    connection: web3.Connection,
    payer: web3.Keypair,
    mintToAddress: web3.PublicKey,
): Promise<void> {
    return airdropFakeLzToken(connection, payer, mintToAddress, 0);
}

export async function airdropLzToken(
    connection: web3.Connection,
    payer: web3.Keypair,
    mintToAddress: web3.PublicKey,
    amount = 1000000000000,
): Promise<void> {
    const mint = getLzTokenMint();

    if (!mint) {
        throw new Error('Lz token mint not initialized');
    }

    return airdropToken(connection, payer, mint, mintToAddress, amount);
}

export async function airdropFakeLzToken(
    connection: web3.Connection,
    payer: web3.Keypair,
    mintToAddress: web3.PublicKey,
    amount = 1000000000000,
): Promise<void> {
    const mint = getFakeLzTokenMint();

    if (!mint) {
        throw new Error('fake lzToken mint not initialized');
    }

    await airdropToken(connection, payer, mint, mintToAddress, amount);
}

export async function airdropToken(
    connection: web3.Connection,
    payer: web3.Keypair,
    tokenMint: web3.PublicKey,
    mintToAddress: web3.PublicKey,
    amount = 1000000000000,
): Promise<void> {
    const walletTokenAddr = await getOrCreateAssociatedTokenAccount(
        connection,
        payer,
        tokenMint,
        mintToAddress,
        true,
    );
    if (amount > 0) {
        await mintTo(
            connection,
            payer,
            tokenMint,
            walletTokenAddr.address,
            toWeb3JsKeypair(LZ_TOKEN_ADMIN),
            amount,
            [toWeb3JsKeypair(LZ_TOKEN_ADMIN)],
        );
    }
}

export async function getAssociatedLzTokenAddress(owner: web3.PublicKey): Promise<web3.PublicKey> {
    const mint = getLzTokenMint();

    if (!mint) {
        throw new Error('Lz token mint not initialized');
    }
    return getAssociatedTokenAddress(mint, owner, true);
}

export async function getAssociatedFakeLzTokenAddress(
    owner: web3.PublicKey,
): Promise<web3.PublicKey> {
    const mint = getFakeLzTokenMint();

    if (!mint) {
        throw new Error('fake lzToken mint not initialized');
    }
    return getAssociatedTokenAddress(mint, owner, true);
}

export async function getLzTokenAssociatedAccount(
    connection: web3.Connection,
    address: web3.PublicKey,
): Promise<Account> {
    return getAccount(connection, await getAssociatedLzTokenAddress(address));
}

export async function getFakeLzTokenAssociatedAccount(
    connection: web3.Connection,
    address: web3.PublicKey,
): Promise<Account> {
    return getAccount(connection, await getAssociatedFakeLzTokenAddress(address));
}

export async function quote(
    umi: Umi,
    endpoint: EndpointProgram.Endpoint,
    payer: Signer,
    msgLib: MessageLibInterface,
    path: SolanaPacketPath,
    args: EndpointProgram.instructions.QuoteInstructionDataArgs,
): Promise<WrappedInstruction> {
    const accounts = await endpoint.getQuoteIXAccountMetaForCPI(umi.rpc, payer.publicKey, {
        path,
        msgLibProgram: msgLib,
    });
    return {
        instruction: {
            keys: accounts.slice(1),
            data: EndpointProgram.instructions.getQuoteInstructionDataSerializer().serialize(args),
            programId: endpoint.programId,
        },
        signers: [payer],
        bytesCreatedOnChain: 0,
    } satisfies WrappedInstruction;
}

export async function send(
    umi: Umi,
    endpoint: EndpointProgram.Endpoint,
    payer: Signer,
    msgLib: MessageLibInterface,
    path: SolanaPacketPath,
    args: EndpointProgram.instructions.SendInstructionDataArgs,
): Promise<WrappedInstruction> {
    const accounts = await endpoint.getSendIXAccountMetaForCPI(umi.rpc, payer.publicKey, {
        path,
        msgLibProgram: msgLib,
    });
    accounts[1].isSigner = true;
    return {
        instruction: {
            keys: accounts.slice(1),
            data: EndpointProgram.instructions.getSendInstructionDataSerializer().serialize(args),
            programId: endpoint.programId,
        },
        signers: [createNoopSigner(path.sender)],
        bytesCreatedOnChain: 0,
    } satisfies WrappedInstruction;
}

export async function sendWithLzToken(
    umi: Umi,
    endpoint: EndpointProgram.Endpoint,
    accounts: {
        payer: Signer;
        tokenMint: PublicKey;
        tokenSource: PublicKey;
        lzTokenTreasury?: PublicKey;
    },
    msgLib: MessageLibInterface,
    path: SolanaPacketPath,
    args: EndpointProgram.instructions.SendInstructionDataArgs,
): Promise<WrappedInstruction> {
    const keys = await endpoint.getSendIXAccountMetaForCPI(
        umi.rpc,
        {
            ...accounts,
            payer: accounts.payer.publicKey,
        },
        {
            path,
            msgLibProgram: msgLib,
        },
    );
    keys[1].isSigner = true;
    if (accounts.lzTokenTreasury) {
        keys[16].pubkey = accounts.lzTokenTreasury;
    }
    return {
        instruction: {
            keys: keys.slice(1),
            data: EndpointProgram.instructions.getSendInstructionDataSerializer().serialize(args),
            programId: endpoint.programId,
        },
        signers: [createNoopSigner(path.sender)],
        bytesCreatedOnChain: 0,
    } satisfies WrappedInstruction;
}

export function newNextInPacket(): Packet {
    const oAppKp = EOAPP;
    const nonce = oAppInBoundNonce() + 1n;
    const packetHeader: PacketHeader = {
        sender: oAppKp.publicKey,
        srcEid: SRC_EID,
        receiver: oAppKp.publicKey,
        dstEid: DST_EID,
        nonce: nonce.toString(),
        version: 1,
    };
    const packet: Packet = {
        message: `0x${Buffer.from('hello world').toString('hex')}`,
        guid: calculateGuid(packetHeader),
        ...packetHeader,
        payload: '', // will be calculated in the program
    };
    return packet;
}

export async function verifyBySimpleMsgLib(
    umi: Umi,
    endpointSDK: EndpointProgram.Endpoint,
    simpleSdk: SimpleMessageLibProgram.SimpleMessageLib,
    payer: Signer,
    packet: Packet,
): Promise<WrappedInstruction[]> {
    const sender = addressToBytes32(packet.sender);
    const receiver = publicKey(addressToBytes32(packet.sender));
    const { srcEid } = packet;
    const nonce = Number(packet.nonce);
    const [payloadHash] = endpointSDK.pda.payloadHash(receiver, srcEid, sender, nonce);
    const payloadHashInfo = await umi.rpc.getAccount(payloadHash, { commitment: 'confirmed' });
    const ixs: WrappedInstruction[] = [];
    if (!payloadHashInfo.exists) {
        const ix = endpointSDK.initVerify(payer, {
            srcEid,
            sender: sender,
            receiver: receiver,
            nonce: nonce,
        });
        ixs.push(ix);
    }
    ixs.push(simpleSdk.validatePacket(payer, PacketV1Codec.encodeBytes(packet)));
    return ixs;
}

export function clear(delegate: Signer, packet: Packet): WrappedInstruction {
    const sender = addressToBytes32(packet.sender);
    const receiver = publicKey(addressToBytes32(packet.sender));
    const { srcEid } = packet;
    const nonce = parseInt(packet.nonce);
    const endpointSDK = new EndpointProgram.Endpoint(EndpointProgram.ENDPOINT_PROGRAM_ID);
    // PDAs
    const [endpoint] = endpointSDK.pda.setting();
    const [noncePda] = endpointSDK.pda.nonce(receiver, srcEid, sender);
    const [oappRegistryPda] = endpointSDK.pda.oappRegistry(receiver);
    const [payloadHashPda] = endpointSDK.pda.payloadHash(receiver, srcEid, sender, nonce);

    return EndpointProgram.instructions.clear(
        { programs: endpointSDK.programRepo },
        {
            signer: delegate,
            oappRegistry: oappRegistryPda,
            nonce: noncePda,
            payloadHash: payloadHashPda,
            endpoint,
            eventAuthority: endpointSDK.eventAuthority,
            program: endpointSDK.programId,
        },
        {
            receiver: publicKey(addressToBytes32(packet.receiver)),
            srcEid: packet.srcEid,
            sender: addressToBytes32(packet.sender),
            nonce: nonce,
            guid: arrayify(packet.guid),
            message: arrayify(packet.message),
        },
    ).items[0];
}

export function revertIx(): WrappedInstruction {
    const simpleMessageLibSdk = new SimpleMessageLib(SIMPLE_MESSAGELIB_PROGRAM_ID);
    return SimpleMessageLibProgram.instructions.revertCall({
        programs: simpleMessageLibSdk.programRepo,
    }).items[0];
}

export function revertTxError(): OnlyRevertError {
    const simpleMessageLibSdk = new SimpleMessageLib(SIMPLE_MESSAGELIB_PROGRAM_ID);
    return new OnlyRevertError(simpleMessageLibSdk.getProgram());
}

export function hexToNumberArray(hex: string): number[] {
    return Array.from(hexToBytes(hex));
}

export function generatePublicKeys(num: number): PublicKey[] {
    return Array.from({ length: num }, () => generateSigner({ eddsa }).publicKey);
}

export function generateMaxUpdater(): PublicKey[] {
    return Array.from({ length: maxUpdaterNum }, () => generateSigner({ eddsa }).publicKey);
}

export function generateMaxMsgLib(): PublicKey[] {
    return Array.from({ length: maxMsgLibsLen }, () => generateSigner({ eddsa }).publicKey);
}

export function generateMaxExecutor(): PublicKey[] {
    return Array.from({ length: maxExecutorsLen }, () => generateSigner({ eddsa }).publicKey);
}

export function generateMaxAdmin(): PublicKey[] {
    return Array.from({ length: maxAdminNum }, () => generateSigner({ eddsa }).publicKey);
}

export async function generateMaxSigner(): Promise<Uint8Array[]> {
    return Promise.all(
        generateMaxSolanaSigner().map(async (signer) => getECDSAPublicKeyWithoutPrefix(signer)),
    );
}

/**
 * Retrieves the ECDSA public key from a given Solana signer.
 *
 * This function extracts the public key from the provided `signer` object,
 * which is expected to contain the ECDSA public key as a `Uint8Array`.
 * The first byte of the public key is dropped, returning only the 64-byte
 * representation of the public key. This is suitable for use in Solana
 * applications where only the raw public key coordinates (x and y)
 * are needed.
 *
 * @param signer - An object implementing the SolanaSigner interface,
 *                 which must contain the ECDSAPublicKey as a Uint8Array.
 *
 * @returns A Uint8Array containing the 64-byte ECDSA public key,
 *          with the first byte removed. This result includes the x and
 *          y coordinates of the public key.
 *
 * @example
 * const publicKey64 = getECDSAPublicKeyWithoutPrefix(signer);
 * console.log(publicKey64.length); // Outputs: 64
 */
export async function getECDSAPublicKeyWithoutPrefix(signer: SolanaSigner): Promise<Uint8Array> {
    const { secretKey } = signer.native;
    const seed = secretKey.subarray(0, 32);
    const publicKey = await secp256k1.getPublicKey(seed);
    return publicKey.subarray(1);
}

/**
 * Extracts the ECDSA private key (32-byte seed) from a Solana signer.
 *
 * @param signer - A SolanaSigner instance
 * @returns The 32-byte private key seed used for ECDSA signing
 */
export function getECDSAPrivateKey(signer: SolanaSigner): Uint8Array {
    const { secretKey } = signer.native;
    return secretKey.subarray(0, 32);
}

export function generateMaxSolanaSigner(): SolanaSigner[] {
    const array = Array.from({ length: maxSignerNum }, () => 0);
    return array.map((_, index) => {
        const path = `m/44'/501'/0'/${index}'`;
        return SolanaSigner.from(
            'test test test test test test test test test test test junk',
            path,
        );
    });
}

export function buildHashSignerFromSolanaSigner(signer: SolanaSigner): HashSigner {
    const { secretKey } = signer.native;
    const seed = secretKey.subarray(0, 32);
    const s = Secp256k1Signer.from(seed);
    return s;
}

export const MAX_VERIFIER_SIGNERS = generateMaxSolanaSigner();
export const VERIFIER_SIGNER1 = MAX_VERIFIER_SIGNERS[0];
export const VERIFIER_SIGNER2 = MAX_VERIFIER_SIGNERS[1];

export function generateOptionTypes(
    num: number,
    optionType: number = ExecutorOptionType.LZ_RECEIVE,
): number[] {
    return Array.from({ length: num }, () => optionType);
}

export function generateDstConfigs(num: number): types.DstConfig[] {
    return Array.from({ length: num }, (_, i) => {
        const dstConfig: types.DstConfig = {
            eid: i,
            dstGas: 10000,
            multiplierBps: some(12000),
            floorMarginUsd: none(),
        };
        return dstConfig;
    });
}

export function splitArrayIntoChunks<T>(array: T[], chunkSize: number): T[][] {
    const chunks: T[][] = [];
    for (let i = 0; i < array.length; i += chunkSize) {
        chunks.push(array.slice(i, i + chunkSize));
    }
    return chunks;
}

export async function createLzToke(
    connection: web3.Connection,
    payer: web3.Keypair,
): Promise<void> {
    // create lz token
    const mint = await createMint(
        connection,
        payer,
        toWeb3JsPublicKey(LZ_TOKEN_ADMIN.publicKey),
        null,
        9, // We are using 9 to match the CLI decimal default exactly
    );
    setLzTokenMint(mint);
    // await airdropLzToken(connection, payer, simpleMessageLibPda, 0) // create simpleMessageLibPda associated lz account
    // await airdropLzToken(connection, payer, ulnPda, 0) // create ulnPda associated lz account
    // await airdropLzToken(connection, payer, TREASURER.publicKey, 0) // create treasurer associated lz account, so treasurer can receive lz token

    const amount = 1e9;
    await airdropLzToken(connection, payer, payer.publicKey, amount);
    const lzAccount = await getLzTokenAssociatedAccount(connection, payer.publicKey);
    expect(lzAccount.amount.toString()).to.eq(amount.toString());
}

export async function createFakeLzToke(
    connection: web3.Connection,
    payer: web3.Keypair,
): Promise<void> {
    // create fake lz token
    const mint = await createMint(
        connection,
        payer,
        toWeb3JsPublicKey(LZ_TOKEN_ADMIN.publicKey),
        null,
        9, // We are using 9 to match the CLI decimal default exactly
    );
    setFakeLzTokenMint(mint);

    const amount = 1000000000;
    await airdropFakeLzToken(connection, payer, payer.publicKey, amount);
    const lzAccount = await getFakeLzTokenAssociatedAccount(connection, payer.publicKey);
    expect(lzAccount.amount.toString()).to.eq(amount.toString());
}

/**
 * Sends and confirms a transaction containing one or more wrapped instructions.
 *
 * @param umi - The Umi instance to use for sending the transaction.
 * @param instructions - A single wrapped instruction or an array of wrapped instructions to be included in the transaction.
 * @param signers - A single signer or an array of signers. The first signer is the fee payer. If multiple signers are provided, the first signer is the fee payer and the rest are used as signers for the instructions.
 * @param computeUnitsLimit - Optional. The maximum number of compute units the transaction is allowed to consume. Default is 0 (no limit).
 * @returns A promise that resolves to an object containing the transaction signature and the result of the transaction confirmation.
 */
export async function sendAndConfirm(
    umi: Umi,
    instructions: WrappedInstruction | WrappedInstruction[],
    signers: Signer | Signer[],
    computeUnitsLimit = 0,
): Promise<{
    signature: string;
    result: RpcConfirmTransactionResult;
}> {
    if (!Array.isArray(instructions)) {
        instructions = [instructions];
    }
    const feePayer = Array.isArray(signers) ? signers[0] : signers;
    if (Array.isArray(signers) && signers.length > 1) {
        // override the signers for each instruction
        const ixSigners = signers.slice(1);
        instructions.forEach((ix) => {
            ix.signers = ixSigners;
        });
    }
    if (computeUnitsLimit > 0) {
        const computeUnitsBudgetIX = web3.ComputeBudgetProgram.setComputeUnitLimit({
            units: computeUnitsLimit,
        });
        instructions = [
            {
                instruction: fromWeb3JsInstruction(computeUnitsBudgetIX),
                signers: [],
                bytesCreatedOnChain: 0,
            },
            ...instructions,
        ];
    }
    return new TransactionBuilder(instructions, { feePayer: feePayer })
        .sendAndConfirm(umi, {
            send: { preflightCommitment: 'confirmed', commitment: 'confirmed' },
        })
        .then((result) => {
            return { signature: base58.deserialize(result.signature)[0], result: result.result };
        });
}
