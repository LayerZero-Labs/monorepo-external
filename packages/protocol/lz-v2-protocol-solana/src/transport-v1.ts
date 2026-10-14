import {
    type Instruction,
    isKeypairSigner,
    type PublicKey,
    type Signer,
} from '@metaplex-foundation/umi';
import type { Serializer } from '@metaplex-foundation/umi/serializers';
import {
    createKeyPairSignerFromBytes,
    createSolanaRpc,
    getBase58Encoder,
    getBase64EncodedWireTransaction,
    getCompiledTransactionMessageDecoder,
    getTransactionDecoder,
    isSolanaError,
    type Signature,
    signTransaction,
    SOLANA_ERROR__JSON_RPC__SERVER_ERROR_SEND_TRANSACTION_PREFLIGHT_FAILURE,
    type TransactionVersion,
} from '@solana/kit';
import type { Connection } from '@solana/web3.js';

import { sha2_256 } from '@layerzerolabs/lz-foundation';

import { compileTransactionV1, type TransactionV1Budgets } from './transaction-v1';

/** A failed V1 submission or simulation, carrying the program logs that explain it. */
export class TransactionV1Error extends Error {
    constructor(
        summary: string,
        readonly logs: readonly string[],
    ) {
        super(`${summary}\n${logs.join('\n')}`);
        this.name = 'TransactionV1Error';
    }
}

const rpcFor = (connection: Connection) => createSolanaRpc(connection.rpcEndpoint);

/** Solana's cap on a transaction's return data. */
const MAX_RETURN_DATA = 1024;

/**
 * Compile, sign and submit one V1 transaction, then confirm it. `payer` pays the fee; every other
 * required signature must come from `signers` and be a local keypair. Preflight is on, so a failing
 * transaction throws before it lands.
 */
export async function sendTransactionV1(
    connection: Connection,
    payer: Signer,
    instructions: readonly Instruction[],
    { signers = [], budgets }: { signers?: readonly Signer[]; budgets: TransactionV1Budgets },
): Promise<string> {
    const rpc = rpcFor(connection);
    const { value: lifetime } = await rpc.getLatestBlockhash({ commitment: 'confirmed' }).send();
    const transaction = compileTransactionV1(payer.publicKey, instructions, lifetime, budgets);

    const keypairs = new Map(
        [payer, ...signers].filter(isKeypairSigner).map((signer) => [signer.publicKey, signer]),
    );
    const keyPairs = await Promise.all(
        Object.keys(transaction.signatures).map(async (address) => {
            const signer = keypairs.get(address as PublicKey);
            if (!signer)
                throw new Error(`V1 transaction needs a local keypair for signer ${address}`);
            return (await createKeyPairSignerFromBytes(signer.secretKey)).keyPair;
        }),
    );
    const signed = await signTransaction(keyPairs, transaction);

    let signature: Signature;
    try {
        signature = await rpc
            .sendTransaction(getBase64EncodedWireTransaction(signed), {
                encoding: 'base64',
                preflightCommitment: 'confirmed',
                skipPreflight: false,
            })
            .send();
    } catch (error) {
        if (
            isSolanaError(
                error,
                SOLANA_ERROR__JSON_RPC__SERVER_ERROR_SEND_TRANSACTION_PREFLIGHT_FAILURE,
            )
        )
            throw new TransactionV1Error('V1 preflight failed', error.context.logs ?? []);
        throw error;
    }

    const { value } = await connection.confirmTransaction(
        {
            signature,
            blockhash: lifetime.blockhash,
            lastValidBlockHeight: Number(lifetime.lastValidBlockHeight),
        },
        'confirmed',
    );
    if (value.err) {
        const { logs } = await fetchTransactionV1(connection, signature);
        throw new TransactionV1Error(`V1 transaction failed: ${JSON.stringify(value.err)}`, logs);
    }
    return signature;
}

/**
 * Simulate unsigned V1 instructions and decode `programId`'s return data. The runtime trims
 * trailing zero bytes from return data, so it is padded back to the cap before decoding: a decoder
 * reads only its own encoding, so the restored zeros are exactly the trimmed ones.
 */
export async function simulateTransactionV1<From, To extends From = From>(
    connection: Connection,
    payer: PublicKey,
    instructions: readonly Instruction[],
    programId: PublicKey,
    serializer: Serializer<From, To>,
    budgets: TransactionV1Budgets,
): Promise<To> {
    const rpc = rpcFor(connection);
    const { value: lifetime } = await rpc.getLatestBlockhash({ commitment: 'confirmed' }).send();
    const transaction = compileTransactionV1(payer, instructions, lifetime, budgets);
    const { value } = await rpc
        .simulateTransaction(getBase64EncodedWireTransaction(transaction), {
            commitment: 'confirmed',
            encoding: 'base64',
            sigVerify: false,
        })
        .send();
    const logs = value.logs ?? [];
    if (value.err)
        throw new TransactionV1Error(`V1 simulation failed: ${JSON.stringify(value.err)}`, logs);
    if (!value.returnData || String(value.returnData.programId) !== String(programId))
        throw new TransactionV1Error(`V1 simulation returned no data from ${programId}`, logs);
    const data = Buffer.from(value.returnData.data[0], 'base64');
    if (data.length > MAX_RETURN_DATA)
        throw new TransactionV1Error(
            `V1 simulation returned oversized data from ${programId}`,
            logs,
        );
    const padded = Buffer.concat([data, Buffer.alloc(MAX_RETURN_DATA - data.length)]);
    return serializer.deserialize(padded, 0)[0];
}

export interface LandedTransaction {
    version: TransactionVersion;
    /** The message's account table. V1 has no lookup tables, so this is every account it loads. */
    staticAccounts: string[];
    logs: string[];
    /** Inner (CPI) instructions, in execution order. */
    innerInstructions: { programId: string; data: Uint8Array }[];
}

/** Fetch a confirmed transaction as its wire bytes, accepting Transaction V1. */
export async function fetchTransactionV1(
    connection: Connection,
    signature: string,
): Promise<LandedTransaction> {
    const response = await rpcFor(connection)
        .getTransaction(signature as Signature, {
            commitment: 'confirmed',
            encoding: 'base64',
            maxSupportedTransactionVersion: 1,
        })
        .send();
    if (!response) throw new Error(`Transaction ${signature} not found`);
    const wire = getTransactionDecoder().decode(Buffer.from(response.transaction[0], 'base64'));
    const staticAccounts = getCompiledTransactionMessageDecoder()
        .decode(wire.messageBytes)
        .staticAccounts.map(String);
    const base58 = getBase58Encoder();
    return {
        version: response.version,
        staticAccounts,
        logs: [...(response.meta?.logMessages ?? [])],
        innerInstructions: (response.meta?.innerInstructions ?? []).flatMap((group) =>
            group.instructions.map((ix) => ({
                programId: staticAccounts[ix.programIdIndex],
                data: new Uint8Array(base58.encode(ix.data)),
            })),
        ),
    };
}

/** Anchor's `emit_cpi!` tag, followed by the event's 8-byte discriminator. */
const EVENT_IX_TAG = Buffer.from('e445a52e51cb9a1d', 'hex');

/**
 * Decode every `emit_cpi!` event of one type that `programId` emitted in `transaction`.
 * `serializer.description` must be the event's Rust struct name: it selects the discriminator.
 */
export function decodeEvents<T>(
    transaction: LandedTransaction,
    programId: PublicKey,
    serializer: Serializer<T, T>,
): T[] {
    const discriminator = Buffer.from(
        sha2_256(Buffer.from(`event:${serializer.description}`)),
    ).subarray(0, 8);
    return transaction.innerInstructions
        .filter(({ programId: emitter }) => emitter === String(programId))
        .map(({ data }) => Buffer.from(data))
        .filter(
            (data) =>
                data.subarray(0, 8).equals(EVENT_IX_TAG) &&
                data.subarray(8, 16).equals(discriminator),
        )
        .map((data) => serializer.deserialize(data, 16)[0]);
}
