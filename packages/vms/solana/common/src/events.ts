import * as beet from '@metaplex-foundation/beet';
import type {
    Connection,
    Finality,
    GetVersionedTransactionConfig,
    PartiallyDecodedInstruction,
    TransactionSignature,
} from '@solana/web3.js';
import { PublicKey } from '@solana/web3.js';
import base58 from 'bs58';
import { createHash } from 'crypto';

import type { EndpointProgram, ExecutorProgram, UlnProgram } from '@layerzerolabs/lz-solana-sdk-v2';

export interface QueryFilter {
    program: PublicKey;
    beet: beet.FixableBeetArgsStruct<any> | beet.BeetArgsStruct<any>;
}

export const getQueryFilter = (
    beet: beet.FixableBeetArgsStruct<any> | beet.BeetArgsStruct<any>,
    program: string,
): QueryFilter => {
    return {
        beet,
        program: new PublicKey(program),
    };
};

export type EndpointEvent =
    | EndpointProgram.events.PacketSentEvent
    | EndpointProgram.events.PacketVerifiedEvent
    | EndpointProgram.events.PacketDeliveredEvent
    | EndpointProgram.events.LzReceiveAlertEvent
    | EndpointProgram.events.ComposeSentEvent
    | EndpointProgram.events.ComposeDeliveredEvent
    | EndpointProgram.events.LzComposeAlertEvent;

export type TxReceipt = {
    slot: number;
    transactionHash: string;
    blockHash?: string;
};

export type UlnEvent = UlnProgram.events.PayloadVerifiedEvent | UlnProgram.events.FeesPaidEvent;

export type ExecutorEvent = ExecutorProgram.events.NativeDropAppliedEvent;

export type LZSolanaEvent = TxReceipt & (EndpointEvent | UlnEvent | ExecutorEvent);
const EventEmitDiscriminator = 'e445a52e51cb9a1d'; // Sha256(anchor:event)[..8] then evert

const getEventDiscriminator = (event: string): string => {
    const hash = createHash('sha256');
    /*
        https://book.anchor-lang.com/anchor_bts/discriminator.html
        sha256(namespace:eventName) namespace of cpi event is 'event'
    */
    hash.update(`event:${event}`);
    const sha256 = hash.digest('hex');
    return sha256.slice(0, 16); // first 8 bytes
};

export async function extractEventFromTransactionSignature<E>(
    connection: Connection,
    program: PublicKey,
    signature: TransactionSignature | Awaited<ReturnType<typeof connection.getParsedTransaction>>,
    eventBeet: beet.FixableBeetArgsStruct<E> | beet.BeetArgsStruct<E>,
    commitment?: Finality | GetVersionedTransactionConfig,
): Promise<E[] | null> {
    const tx =
        typeof signature === 'string'
            ? await connection.getParsedTransaction(signature, commitment)
            : signature;
    // tx?.meta.
    if (tx == null) return null;

    /* hotfix
    From the rpc docs: https://solana.com/docs/rpc/http/gettransaction
    tx.meta.err:
        Error code if the transaction failed or null if the transaction succeeds
    */
    if (tx.meta?.err !== null) return null;
    /**/

    const events = new Array<E>();
    for (const instruction of tx.meta?.innerInstructions ?? []) {
        for (const innerInstruction of instruction.instructions) {
            const inst = innerInstruction as PartiallyDecodedInstruction;
            if (!inst.programId.equals(program)) {
                continue;
            }
            const decoded = base58.decode(inst.data);
            const discriminator = Buffer.from(decoded.subarray(0, 8)).toString('hex');
            if (discriminator !== EventEmitDiscriminator) {
                continue;
            }
            // get second 8 bits, filter event here
            const eventDiscriminator = Buffer.from(decoded.subarray(8, 16)).toString('hex');
            if (eventDiscriminator !== getEventDiscriminator(eventBeet.description)) {
                continue;
            }
            const dataBuffer = Buffer.from(decoded.subarray(16, decoded.length));
            if (eventBeet instanceof beet.FixableBeetArgsStruct) {
                const beet = eventBeet.toFixedFromData(dataBuffer, 0);
                events.push(beet.read(dataBuffer, 0));
            } else {
                events.push(eventBeet.read(dataBuffer, 0));
            }
        }
    }

    return events.length > 0 ? events : null;
}

export const matchQueryFilter = (
    event: { description: string; programId: string },
    queryFilter: QueryFilter,
) => {
    return (
        queryFilter.beet.description === event.description &&
        queryFilter.program.toBase58() === event.programId
    );
};
