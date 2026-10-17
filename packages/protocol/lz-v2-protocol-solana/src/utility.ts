import type {
    Instruction,
    PublicKey,
    RpcInterface,
    WrappedInstruction,
} from '@metaplex-foundation/umi';
import { isPublicKey } from '@metaplex-foundation/umi';
import type { Serializer } from '@metaplex-foundation/umi/serializers';
import { base58 } from '@metaplex-foundation/umi/serializers';
import { toWeb3JsInstruction, toWeb3JsPublicKey } from '@metaplex-foundation/umi-web3js-adapters';
import * as web3 from '@solana/web3.js';

import { sha2_256 } from '@layerzerolabs/lz-foundation';

import { EventEmitDiscriminator } from './endpoint';
import type {
    ComposeDeliveredEvent,
    ComposeSentEvent,
    PacketDeliveredEvent,
    PacketSentEvent,
    PacketVerifiedEvent,
} from './generated/endpoint/events';
import {
    getComposeDeliveredEventSerializer,
    getComposeSentEventSerializer,
    getPacketDeliveredEventSerializer,
    getPacketSentEventSerializer,
    getPacketVerifiedEventSerializer,
} from './generated/endpoint/events';
import type { FeesPaidEvent } from './generated/uln/events';
import { getFeesPaidEventSerializer } from './generated/uln/events';

/**
 * Gets the event discriminator for a given event.
 *
 * @param {string} event - The event name.
 * @returns {string} The event discriminator.
 */
function getEventDiscriminator(event: string): string {
    /*
        https://book.anchor-lang.com/anchor_bts/discriminator.html
        sha256(namespace:eventName) namespace of cpi event is 'event'
    */
    return Buffer.from(sha2_256(`event:${event}`))
        .subarray(0, 8)
        .toString('hex');
}

/**
 * Extracts the sent packet event by transaction hash.
 *
 * @param {web3.Connection | RpcInterface} connection - The connection to the Solana cluster.
 * @param {PublicKey | web3.PublicKey} program - The program public key.
 * @param {web3.TransactionSignature | web3.ParsedTransactionWithMeta | null} signature - The transaction signature or parsed transaction.
 * @param {web3.Finality | web3.GetVersionedTransactionConfig} [commitment] - The commitment level.
 * @param {boolean} [unsafeParseErr=false] - Whether to parse the event even if the transaction failed.
 * @returns {Promise<PacketSentEvent[] | null>} A promise that resolves to an array of sent packet events or null if not found.
 */
export async function extractPacketSentEventByTxHash(
    connection: web3.Connection | RpcInterface,
    program: PublicKey | web3.PublicKey,
    signature: web3.TransactionSignature | web3.ParsedTransactionWithMeta | null,
    commitment?: web3.Finality | web3.GetVersionedTransactionConfig,
    unsafeParseErr = false,
): Promise<PacketSentEvent[] | null> {
    const events = await extractEventFromTransactionSignature(
        connection,
        program,
        signature,
        getPacketSentEventSerializer(),
        commitment,
        unsafeParseErr,
    );
    if (!events) return null;
    return events;
}

/**
 * Extracts the verified packet event by transaction hash.
 *
 * @param {Connection} connection - The connection to the Solana cluster.
 * @param {PublicKey} program - The program public key.
 * @param {TransactionSignature | Awaited<ReturnType<typeof connection.getParsedTransaction>>} signature - The transaction signature or parsed transaction.
 * @param {Finality | GetVersionedTransactionConfig} [commitment] - The commitment level.
 * @param {boolean} [unsafeParseErr=false] - Whether to parse the event even if the transaction failed.
 * @returns {Promise<PacketVerifiedEvent[] | null>} A promise that resolves to an array of verified packet events or null if not found.
 */
export async function extractVerifiedPacketEventByTxHash(
    connection: web3.Connection | RpcInterface,
    program: PublicKey | web3.PublicKey,
    signature: web3.TransactionSignature | web3.ParsedTransactionWithMeta | null,
    commitment?: web3.Finality | web3.GetVersionedTransactionConfig,
    unsafeParseErr = false,
): Promise<PacketVerifiedEvent[] | null> {
    const events = await extractEventFromTransactionSignature(
        connection,
        program,
        signature,
        getPacketVerifiedEventSerializer(),
        commitment,
        unsafeParseErr,
    );
    if (!events) return null;
    return events;
}

/**
 * Extracts the received packet event by transaction hash.
 *
 * @param {Connection} connection - The connection to the Solana cluster.
 * @param {PublicKey} program - The program public key.
 * @param {TransactionSignature | Awaited<ReturnType<typeof connection.getParsedTransaction>>} signature - The transaction signature or parsed transaction.
 * @param {Finality | GetVersionedTransactionConfig} [commitment] - The commitment level.
 * @param {boolean} [unsafeParseErr=false] - Whether to parse the event even if the transaction failed.
 * @returns {Promise<PacketDeliveredEvent[] | null>} A promise that resolves to an array of received packet events or null if not found.
 */
export async function extractReceivedPacketEventByTxHash(
    connection: web3.Connection | RpcInterface,
    program: PublicKey | web3.PublicKey,
    signature: web3.TransactionSignature | web3.ParsedTransactionWithMeta | null,
    commitment?: web3.Finality | web3.GetVersionedTransactionConfig,
    unsafeParseErr = false,
): Promise<PacketDeliveredEvent[] | null> {
    const events = await extractEventFromTransactionSignature(
        connection,
        program,
        signature,
        getPacketDeliveredEventSerializer(),
        commitment,
        unsafeParseErr,
    );
    if (!events) return null;
    return events;
}

/**
 * Extracts the compose sent event by transaction hash.
 *
 * @param {Connection} connection - The connection to the Solana cluster.
 * @param {PublicKey} program - The program public key.
 * @param {TransactionSignature | Awaited<ReturnType<typeof connection.getParsedTransaction>>} signature - The transaction signature or parsed transaction.
 * @param {Finality | GetVersionedTransactionConfig} [commitment] - The commitment level.
 * @param {boolean} [unsafeParseErr=false] - Whether to parse the event even if the transaction failed.
 * @returns {Promise<ComposeSentEvent[] | null>} A promise that resolves to an array of compose sent events or null if not found.
 */
export async function extractComposeSentEventByTxHash(
    connection: web3.Connection | RpcInterface,
    program: PublicKey | web3.PublicKey,
    signature: web3.TransactionSignature | web3.ParsedTransactionWithMeta | null,
    commitment?: web3.Finality | web3.GetVersionedTransactionConfig,
    unsafeParseErr = false,
): Promise<ComposeSentEvent[] | null> {
    const events = await extractEventFromTransactionSignature(
        connection,
        program,
        signature,
        getComposeSentEventSerializer(),
        commitment,
        unsafeParseErr,
    );
    if (!events) return null;
    return events;
}

/**
 * Extracts the compose delivered event by transaction hash.
 *
 * @param {Connection} connection - The connection to the Solana cluster.
 * @param {PublicKey} program - The program public key.
 * @param {TransactionSignature | Awaited<ReturnType<typeof connection.getParsedTransaction>>} signature - The transaction signature or parsed transaction.
 * @param {Finality | GetVersionedTransactionConfig} [commitment] - The commitment level.
 * @param {boolean} [unsafeParseErr=false] - Whether to parse the event even if the transaction failed.
 * @returns {Promise<ComposeDeliveredEvent[] | null>} A promise that resolves to an array of compose delivered events or null if not found.
 */
export async function extractComposeDeliveredEventByTxHash(
    connection: web3.Connection | RpcInterface,
    program: PublicKey | web3.PublicKey,
    signature: web3.TransactionSignature | web3.ParsedTransactionWithMeta | null,
    commitment?: web3.Finality | web3.GetVersionedTransactionConfig,
    unsafeParseErr = false,
): Promise<ComposeDeliveredEvent[] | null> {
    const events = await extractEventFromTransactionSignature(
        connection,
        program,
        signature,
        getComposeDeliveredEventSerializer(),
        commitment,
        unsafeParseErr,
    );
    if (!events) return null;
    return events;
}

/**
 * Extracts the worker fee paid event by transaction hash.
 *
 * @param {Connection} connection - The connection to the Solana cluster.
 * @param {PublicKey} program - The program public key.
 * @param {TransactionSignature | Awaited<ReturnType<typeof connection.getParsedTransaction>>} signature - The transaction signature or parsed transaction.
 * @param {Finality | GetVersionedTransactionConfig} [commitment] - The commitment level.
 * @param {boolean} [unsafeParseErr=false] - Whether to parse the event even if the transaction failed.
 * @returns {Promise<FeesPaidEvent[] | null>} A promise that resolves to an array of worker fee paid events or null if not found.
 */
export async function extractWorkerFeePaidEventByTxHash(
    connection: web3.Connection | RpcInterface,
    program: PublicKey | web3.PublicKey,
    signature: web3.TransactionSignature | web3.ParsedTransactionWithMeta | null,
    commitment?: web3.Finality | web3.GetVersionedTransactionConfig,
    unsafeParseErr = false,
): Promise<FeesPaidEvent[] | null> {
    const events = await extractEventFromTransactionSignature(
        connection,
        program,
        signature,
        getFeesPaidEventSerializer(),
        commitment,
        unsafeParseErr,
    );
    if (!events) return null;
    return events;
}

/**
 * Extracts events from a transaction signature.
 *
 * @param {Connection} connection - The connection to the Solana cluster.
 * @param {PublicKey} program - The program public key, extract event from specific program id
 * @param {TransactionSignature | Awaited<ReturnType<typeof connection.getParsedTransaction>>} signature - The transaction signature(tx hash) or parsed transaction.
 * @param {beet.FixableBeetArgsStruct<E> | beet.BeetArgsStruct<E>} eventBeet - The beet struct for the event.
 * @param {Finality | GetVersionedTransactionConfig} [commitment] - The commitment level.
 * @param {boolean} [unsafeParseErr=false] - Whether to parse the event even if the transaction failed. Default is false, only parse event if transaction succeeded. if true, will parse event even if transaction failed. Please set this to false if you want to ignore failed transaction and set `true` with caution as it may lead to unexpected behavior.
 * @returns {Promise<E[] | null>} A promise that resolves to an array of events or null if not found.
 */
export async function extractEventFromTransactionSignature<From, To extends From = From>(
    rpc: web3.Connection | RpcInterface,
    _program: PublicKey | web3.PublicKey,
    signature: web3.TransactionSignature | web3.ParsedTransactionWithMeta | null,
    serializer: Serializer<From, To>,
    commitment?: web3.Finality | web3.GetVersionedTransactionConfig,
    unsafeParseErr = false,
): Promise<To[] | null> {
    let program: web3.PublicKey;
    if (typeof _program === 'string' && isPublicKey(_program)) {
        program = toWeb3JsPublicKey(_program);
    } else {
        program = _program;
    }
    let tx: web3.ParsedTransactionWithMeta | null;
    if (typeof signature === 'string') {
        const connection = toWeb3Connection(rpc);
        tx = await connection.getParsedTransaction(signature, commitment);
    } else {
        tx = signature;
    }
    if (tx == null) return null;
    const events = new Array<To>();
    // refer: https://solana.com/docs/rpc/http/gettransaction
    // tx.meta.err: Error if transaction failed, null if transaction succeeded
    if (tx.meta?.err !== null && !unsafeParseErr) {
        return null;
    }
    for (const instruction of tx.meta?.innerInstructions ?? []) {
        for (const innerInstruction of instruction.instructions) {
            const inst = innerInstruction as web3.PartiallyDecodedInstruction;
            if (!inst.programId.equals(program)) {
                continue;
            }
            const decoded = base58.serialize(inst.data);
            const discriminator = Buffer.from(decoded.subarray(0, 8)).toString('hex');
            if (discriminator !== EventEmitDiscriminator) {
                continue;
            }
            // get second 8 bits, filter event here
            const eventDiscriminator = Buffer.from(decoded.subarray(8, 16)).toString('hex');
            if (eventDiscriminator !== getEventDiscriminator(serializer.description)) {
                continue;
            }
            events.push(serializer.deserialize(decoded, 16)[0]);
            // const dataBuffer = Buffer.from(decoded.subarray(16, decoded.length))
            // if (eventBeet instanceof beet.FixableBeetArgsStruct) {
            //     const beet = eventBeet.toFixedFromData(dataBuffer, 0)
            //     events.push(beet.read(dataBuffer, 0))
            // } else {
            //     events.push(eventBeet.read(dataBuffer, 0))
            // }
        }
    }
    return events.length > 0 ? events : null;
}

/**
 * Generates an address lookup table.
 *
 * @param {Connection} connection - The connection to the Solana cluster.
 * @param {PublicKey} payer - The payer public key.
 * @param {PublicKey} authority - The authority public key.
 * @param {PublicKey[]} addresses - The addresses to include in the lookup table.
 * @returns {Promise<{ instructions: TransactionInstruction[]; address: PublicKey }>} A promise that resolves to the instructions and lookup table address.
 */
export async function generateAddressLookupTable(
    connection: web3.Connection,
    payer: web3.PublicKey,
    authority: web3.PublicKey,
    addresses: web3.PublicKey[],
): Promise<{ instructions: web3.TransactionInstruction[]; address: web3.PublicKey }> {
    const slot = await connection.getSlot('finalized');
    const [createInstruction, lookupTableAddress] =
        web3.AddressLookupTableProgram.createLookupTable({
            payer,
            authority,
            recentSlot: slot,
        });
    const extendInstruction = web3.AddressLookupTableProgram.extendLookupTable({
        payer,
        authority,
        lookupTable: lookupTableAddress,
        addresses,
    });

    return {
        instructions: [createInstruction, extendInstruction],
        address: lookupTableAddress,
    };
}

/**
 * Deactivates an address lookup table.
 * To properly terminate the lookup table, it is advisable to initially invoke `deactivateLookupTable`,
 * pause for a duration of 500 blocks, and subsequently invoke `closeLookupTable`.
 *
 * @param {web3.PublicKey} authority - The authority public key.
 * @param {web3.PublicKey} lookupTable - The lookup table public key.
 * @returns {web3.TransactionInstruction} The transaction instruction.
 */
export function deactivateLookupTable(
    authority: web3.PublicKey,
    lookupTable: web3.PublicKey,
): web3.TransactionInstruction {
    return web3.AddressLookupTableProgram.deactivateLookupTable({
        authority,
        lookupTable,
    } satisfies web3.DeactivateLookupTableParams);
}

/**
 * Closes an address lookup table.
 * To properly terminate the lookup table, it is advisable to initially invoke `deactivateLookupTable`,
 * pause for a duration of 500 blocks, and subsequently invoke `closeLookupTable`.
 *
 * @param {PublicKey} recipient - The recipient public key.
 * @param {PublicKey} authority - The authority public key.
 * @param {PublicKey} lookupTable - The lookup table public key.
 * @returns {TransactionInstruction} The transaction instruction.
 */
export function closeLookupTable(
    recipient: web3.PublicKey,
    authority: web3.PublicKey,
    lookupTable: web3.PublicKey,
): web3.TransactionInstruction {
    return web3.AddressLookupTableProgram.closeLookupTable({
        authority,
        recipient,
        lookupTable,
    } satisfies web3.CloseLookupTableParams);
}

/**
 * Creates a versioned transaction with an address lookup table.
 *
 * @param {Connection} connection - The connection to the Solana cluster.
 * @param {PublicKey} payer - The payer public key.
 * @param {TransactionInstruction[]} instructions - The transaction instructions.
 * @param {Blockhash} [recentBlockHash] - The recent block hash.
 * @param {PublicKey} [_tableAddrs] - The array of address lookup table public keys.
 * @returns {Promise<VersionedTransaction>} A promise that resolves to the versioned transaction.
 */
export async function txWithAddressLookupTable(
    connection: web3.Connection,
    payer: web3.PublicKey,
    instructions: web3.TransactionInstruction[],
    recentBlockHash?: web3.Blockhash,
    _tableAddrs?: web3.PublicKey | web3.PublicKey[],
): Promise<web3.VersionedTransaction> {
    recentBlockHash = recentBlockHash ?? (await connection.getLatestBlockhash()).blockhash;
    if (!_tableAddrs) {
        return new web3.VersionedTransaction(
            new web3.TransactionMessage({
                instructions,
                payerKey: payer,
                recentBlockhash: recentBlockHash,
            }).compileToV0Message(),
        );
    }
    const tableAddrs = Array.isArray(_tableAddrs) ? _tableAddrs : [_tableAddrs];
    const lookupTableAccountsResult = await connection.getMultipleAccountsInfo(tableAddrs);
    const lookupTableAccounts = lookupTableAccountsResult
        .map((result, index) => {
            if (result === null) return null;
            return new web3.AddressLookupTableAccount({
                key: tableAddrs[index],
                state: web3.AddressLookupTableAccount.deserialize(result.data),
            });
        })
        .filter((account): account is web3.AddressLookupTableAccount => account !== null);
    return new web3.VersionedTransaction(
        new web3.TransactionMessage({
            instructions,
            payerKey: payer,
            recentBlockhash: recentBlockHash,
        }).compileToV0Message(lookupTableAccounts.length > 0 ? lookupTableAccounts : undefined),
    );
}

/**
 * Creates a nonce account transaction.
 *
 * @param {Connection} connection - The connection to the Solana cluster.
 * @param {PublicKey} auth - The authorized public key.
 * @param {number} [lamportsForRent] - The lamports for rent.
 * @returns {Promise<{ tx: Transaction; nonceAccount: Keypair }>} A promise that resolves to the transaction and nonce account.
 */
export async function createNonceAccountTX(
    connection: web3.Connection,
    auth: web3.PublicKey,
    lamportsForRent?: number,
): Promise<{ tx: web3.Transaction; nonceAccount: web3.Keypair }> {
    const nonceAccount = web3.Keypair.generate();

    const lamports =
        lamportsForRent ??
        (await connection.getMinimumBalanceForRentExemption(web3.NONCE_ACCOUNT_LENGTH));

    const tx = new web3.Transaction();
    tx.add(
        // create nonce account
        web3.SystemProgram.createAccount({
            fromPubkey: auth,
            newAccountPubkey: nonceAccount.publicKey,
            lamports,
            space: web3.NONCE_ACCOUNT_LENGTH,
            programId: web3.SystemProgram.programId,
        }),
        // init nonce account
        web3.SystemProgram.nonceInitialize({
            noncePubkey: nonceAccount.publicKey, // nonce account pubkey
            authorizedPubkey: auth, // nonce account auth
        }),
    );
    return { tx, nonceAccount };
}

/**
 * Creates a transaction with a nonce.
 *
 * @param {Connection} connection - The connection to the Solana cluster.
 * @param {PublicKey} noncePubkey - The nonce public key.
 * @param {TransactionInstruction[]} instructions - The transaction instructions.
 * @param {NonceAccount} [nonceInfo] - The nonce account information.
 * @returns {Promise<Transaction | null>} A promise that resolves to the transaction or null if not found.
 */
export async function txWithNonce(
    connection: web3.Connection,
    noncePubkey: web3.PublicKey,
    instructions: web3.TransactionInstruction[],
    nonceInfo?: web3.NonceAccount,
): Promise<web3.Transaction | null> {
    const tx = new web3.Transaction();

    if (!nonceInfo) {
        const accountInfo = await connection.getAccountInfo(noncePubkey);
        if (accountInfo) {
            nonceInfo = web3.NonceAccount.fromAccountData(accountInfo.data);
        } else {
            return null;
        }
    }

    tx.add(
        // nonce advance must be the first insturction
        web3.SystemProgram.nonceAdvance({
            noncePubkey: noncePubkey,
            authorizedPubkey: nonceInfo.authorizedPubkey,
        }),
    );
    tx.add(...instructions);
    tx.recentBlockhash = nonceInfo.nonce;
    return tx;
}

/**
 * Checks if an account is initialized.
 *
 * @param {Connection} connection - The connection to the Solana cluster.
 * @param {PublicKey} account - The account public key.
 * @param {Commitment | GetAccountInfoConfig} [commitmentOrConfig] - The commitment level or account info configuration.
 * @returns {Promise<boolean>} A promise that resolves to true if the account is initialized, false otherwise.
 */
export async function isAccountInitialized(
    connection: web3.Connection,
    account: web3.PublicKey,
    commitmentOrConfig?: web3.Commitment | web3.GetAccountInfoConfig,
): Promise<boolean> {
    return connection.getAccountInfo(account, commitmentOrConfig).then((res) => {
        return res !== null;
    });
}

/**
 * Builds a version 0 message.
 *
 * @param {Connection} connection - The connection to the Solana cluster.
 * @param {PublicKey} payerKey - The payer public key.
 * @param {TransactionInstruction[]} instructions - The transaction instructions.
 * @param {Commitment | GetAccountInfoConfig} [commitmentOrConfig='confirmed'] - The commitment level or account info configuration.
 * @param {Blockhash} [blockhash] - The blockhash.
 * @returns {Promise<MessageV0>} A promise that resolves to the version 0 message.
 */
export async function buildMessageV0(
    connection: web3.Connection,
    payerKey: web3.PublicKey,
    instructions: web3.TransactionInstruction[],
    commitmentOrConfig: web3.Commitment | web3.GetAccountInfoConfig = 'confirmed',
    blockhash?: web3.Blockhash,
): Promise<web3.MessageV0> {
    return new web3.TransactionMessage({
        payerKey: payerKey,
        recentBlockhash:
            blockhash ?? (await connection.getLatestBlockhash(commitmentOrConfig)).blockhash,
        instructions: instructions,
    }).compileToV0Message();
}

/**
 * Builds a versioned transaction.
 *
 * @param {Connection} connection - The connection to the Solana cluster.
 * @param {PublicKey} payerKey - The payer public key.
 * @param {TransactionInstruction[]} instructions - The transaction instructions.
 * @param {Commitment | GetAccountInfoConfig} [commitmentOrConfig='confirmed'] - The commitment level or account info configuration.
 * @param {Blockhash} [blockhash] - The blockhash.
 * @param {PublicKey} [lookupTableAddresses] - The array of lookup table addresses.
 * @returns {Promise<VersionedTransaction>} A promise that resolves to the versioned transaction.
 */
export async function buildVersionedTransaction(
    connection: web3.Connection,
    payerKey: web3.PublicKey,
    instructions: web3.TransactionInstruction[],
    commitmentOrConfig: web3.Commitment | web3.GetAccountInfoConfig = 'confirmed',
    blockhash?: web3.Blockhash,
    lookupTableAddresses?: web3.PublicKey | web3.PublicKey[],
): Promise<web3.VersionedTransaction> {
    if (lookupTableAddresses) {
        return txWithAddressLookupTable(
            connection,
            payerKey,
            instructions,
            blockhash,
            lookupTableAddresses,
        );
    }
    return new web3.VersionedTransaction(
        await buildMessageV0(connection, payerKey, instructions, commitmentOrConfig, blockhash),
    );
}

/**
 * Simulates a transaction.
 *
 * @param {string | web3.Connection | RpcInterface} _connection - The connection to the Solana cluster.
 * @param {web3.TransactionInstruction[] | WrappedInstruction[] | Instruction[]} _instructions - The transaction instructions.
 * @param {web3.PublicKey | PublicKey} _programId - The program public key.
 * @param {web3.PublicKey | PublicKey} _payer - The payer public key.
 * @param {Serializer<From, To>} serializer - The serializer.
 * @param {web3.Commitment} [commitment='confirmed'] - The commitment level.
 * @param {web3.Blockhash} [blockhash] - The blockhash.
 * @param {web3.PublicKey | PublicKey} [_lookupTableAddresses] - The array of lookup table addresses.
 * @returns {Promise<Buffer>} A promise that resolves to the simulation result.
 * @throws {Error} If the simulation fails.
 */
export async function simulateWeb3JsTransaction<From, To extends From = From>(
    _connection: string | web3.Connection | RpcInterface,
    _instructions: web3.TransactionInstruction[] | WrappedInstruction[] | Instruction[],
    _programId: web3.PublicKey | PublicKey,
    _payer: web3.PublicKey | PublicKey,
    serializer: Serializer<From, To>,
    commitment: web3.Commitment = 'confirmed',
    blockhash?: web3.Blockhash,
    _lookupTableAddresses?: web3.PublicKey | PublicKey | web3.PublicKey[] | PublicKey[],
): Promise<To> {
    let connection: web3.Connection;
    if (typeof _connection === 'string') {
        connection = new web3.Connection(_connection, commitment);
    } else {
        connection = toWeb3Connection(_connection);
    }

    let instructions: web3.TransactionInstruction[];
    if (_instructions.length === 0) {
        throw new Error('Instructions cannot be empty');
    }
    if (_instructions[0] instanceof web3.TransactionInstruction) {
        instructions = _instructions as web3.TransactionInstruction[];
    } else if ('bytesCreatedOnChain' in _instructions[0]) {
        instructions = (_instructions as WrappedInstruction[]).map((i) =>
            toWeb3JsInstruction(i.instruction),
        );
    } else {
        instructions = (_instructions as Instruction[]).map((i) => toWeb3JsInstruction(i));
    }

    let programId: web3.PublicKey;
    if (_programId instanceof web3.PublicKey) {
        programId = _programId;
    } else {
        programId = toWeb3JsPublicKey(_programId);
    }

    let payer: web3.PublicKey;
    if (_payer instanceof web3.PublicKey) {
        payer = _payer;
    } else {
        payer = toWeb3JsPublicKey(_payer);
    }

    const lookupTableAddresses =
        _lookupTableAddresses &&
        (Array.isArray(_lookupTableAddresses)
            ? _lookupTableAddresses.map((addr) =>
                  addr instanceof web3.PublicKey ? addr : toWeb3JsPublicKey(addr),
              )
            : _lookupTableAddresses instanceof web3.PublicKey
              ? _lookupTableAddresses
              : toWeb3JsPublicKey(_lookupTableAddresses));

    const tx = await buildVersionedTransaction(
        connection,
        payer,
        instructions,
        commitment,
        blockhash,
        lookupTableAddresses,
    );
    const simulateResp = await connection.simulateTransaction(tx, { sigVerify: false, commitment });
    const returnPrefix = `Program return: ${programId.toBase58()} `;
    const returnLog = simulateResp.value.logs?.find((l) => l.startsWith(returnPrefix));
    if (
        returnLog === undefined ||
        simulateResp.value.returnData?.programId !== programId.toBase58()
    ) {
        throw new Error(`Simulate Fail: ${JSON.stringify(simulateResp)}`);
    } else {
        const resp = Buffer.from(returnLog.slice(returnPrefix.length), 'base64');
        return serializer.deserialize(resp, 0)[0];
    }
}

export function toWeb3Connection(rpc: RpcInterface | web3.Connection): web3.Connection {
    if (rpc instanceof web3.Connection) {
        return rpc;
    } else if ('connection' in rpc && rpc.connection instanceof web3.Connection) {
        return rpc.connection;
    } else {
        throw new Error('Invalid connection');
    }
}

export { instructionDiscriminator } from '@layerzerolabs/lz-v2-protocol-solana-v3';
