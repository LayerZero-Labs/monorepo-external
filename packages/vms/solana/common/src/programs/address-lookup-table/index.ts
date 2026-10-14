import {
    ASSOCIATED_TOKEN_PROGRAM_ID,
    TOKEN_2022_PROGRAM_ID,
    TOKEN_PROGRAM_ID,
} from '@solana/spl-token';
import type {
    AddressLookupTableAccount,
    Connection,
    PublicKey,
    TransactionInstruction,
} from '@solana/web3.js';
import {
    SystemProgram,
    SYSVAR_INSTRUCTIONS_PUBKEY,
    SYSVAR_RECENT_BLOCKHASHES_PUBKEY,
    SYSVAR_RENT_PUBKEY,
} from '@solana/web3.js';
import { AddressLookupTableProgram } from '@solana/web3.js';

import {
    EndpointPDADeriver,
    EndpointProgram,
    EventPDADeriver,
    ExecutorProgram,
    PriceFeedProgram,
    UlnProgram,
} from '@layerzerolabs/lz-solana-sdk-v2';

/**
 * Creates a new address lookup table with the specified addresses.
 *
 * This function creates a lookup table and immediately extends it with the provided addresses.
 * Address lookup tables are used to compress transaction sizes by replacing frequently used
 * addresses with shorter indices.
 *
 * @param connection - The Solana RPC connection used to fetch the current slot
 * @param payer - The public key of the account that will pay for the transaction fees
 * @param authority - The public key of the account that will have authority over the lookup table
 * @param addresses - Array of public keys to include in the lookup table
 * @returns A promise that resolves to an object containing:
 *   - instructions: Array of transaction instructions (create + extend)
 *   - address: The public key of the created lookup table
 * @throws Will throw an error if the connection fails or if the addresses array is too large
 */
export async function createAddressLookupTable(
    connection: Connection,
    payer: PublicKey,
    authority: PublicKey,
): Promise<{ instruction: TransactionInstruction; address: PublicKey }> {
    const slot = await connection.getSlot('confirmed');
    const [createInstruction, lookupTableAddress] = AddressLookupTableProgram.createLookupTable({
        payer,
        authority,
        recentSlot: slot,
    });

    return {
        instruction: createInstruction,
        address: lookupTableAddress,
    };
}

/**
 * Extends an existing address lookup table with additional addresses.
 *
 * This function adds new addresses to an already created lookup table. The lookup table
 * must not be frozen and the authority must match the original authority used when
 * creating the table.
 *
 * @param payer - The public key of the account that will pay for the transaction fees
 * @param authority - The public key of the account that has authority over the lookup table
 * @param lookupTableAddress - The public key of the existing lookup table to extend
 * @param addresses - Array of new public keys to add to the lookup table
 * @returns A transaction instruction for extending the lookup table
 * @throws Will throw an error if the lookup table is frozen or authority is invalid
 */
export function extendAddressLookupTable(
    payer: PublicKey,
    authority: PublicKey,
    lookupTableAddress: PublicKey,
    addresses: PublicKey[],
): TransactionInstruction {
    return AddressLookupTableProgram.extendLookupTable({
        payer,
        authority,
        lookupTable: lookupTableAddress,
        addresses,
    });
}

export async function getAddressLookupTable(
    connection: Connection,
    lookupTableAddress: PublicKey,
): Promise<AddressLookupTableAccount | null> {
    return (await connection.getAddressLookupTable(lookupTableAddress)).value;
}

/**
 * Freezes an address lookup table, making it immutable.
 *
 * Once a lookup table is frozen, no additional addresses can be added to it.
 * This is a permanent operation that cannot be reversed. Freezing a lookup table
 * is typically done when the set of addresses is finalized and won't change.
 *
 * @param authority - The public key of the account that has authority over the lookup table
 * @param lookupTableAddress - The public key of the lookup table to freeze
 * @returns A transaction instruction for freezing the lookup table
 * @throws Will throw an error if the authority is invalid or the table is already frozen
 */
export function freezeAddressLookupTable(
    authority: PublicKey,
    lookupTableAddress: PublicKey,
): TransactionInstruction {
    return AddressLookupTableProgram.freezeLookupTable({
        authority,
        lookupTable: lookupTableAddress,
    });
}

export function generateGlobalAddresses(): PublicKey[] {
    const endpoint = new EndpointProgram.Endpoint(EndpointProgram.PROGRAM_ID);
    const uln = new UlnProgram.Uln(UlnProgram.PROGRAM_ID);
    const executor = new ExecutorProgram.Executor(ExecutorProgram.PROGRAM_ID);
    const priceFeed = new PriceFeedProgram.PriceFeed(PriceFeedProgram.PROGRAM_ID);

    return [
        SystemProgram.programId,
        SYSVAR_INSTRUCTIONS_PUBKEY,
        SYSVAR_RECENT_BLOCKHASHES_PUBKEY,
        SYSVAR_RENT_PUBKEY,
        TOKEN_2022_PROGRAM_ID,
        TOKEN_PROGRAM_ID,
        ASSOCIATED_TOKEN_PROGRAM_ID,

        // Programs
        endpoint.program,
        uln.program,
        executor.program,
        priceFeed.program,

        // Endpoint PDAs
        endpoint.deriver.setting()[0],

        endpoint.eventAuthorityPDA,
        endpoint.deriver.messageLibraryInfo(uln.deriver.messageLib()[0])[0],

        // Uln PDAs
        uln.deriver.messageLib()[0],
        uln.deriver.setting()[0],
        uln.eventAuthorityPDA,

        // Executor PDAs
        executor.deriver.config()[0],
        new EventPDADeriver(executor.program).eventAuthority()[0],

        // Price Feed
        priceFeed.deriver.priceFeed()[0],
    ];
}

export async function generateDvnsAddresses(
    connection: Connection,
    dvns: PublicKey[],
): Promise<PublicKey[]> {
    const dvnPrograms = await connection.getMultipleAccountsInfo(dvns).then((accounts) => {
        return accounts.map((account) => account?.owner);
    });
    return dvns.flatMap((dvn, index) => {
        if (!dvnPrograms[index]) {
            throw new Error(`DVN program not found for ${dvn.toBase58()}`);
        }
        return [
            dvn,
            dvnPrograms[index],
            new EventPDADeriver(dvnPrograms[index]).eventAuthority()[0],
        ];
    });
}

export function generateOappAddresses(oapp: PublicKey, programId: PublicKey): PublicKey[] {
    return [
        oapp,
        programId,
        new EventPDADeriver(programId).eventAuthority()[0],
        new EndpointPDADeriver(programId).oappRegistry(oapp)[0],
    ];
}

export function generatePathwayAddresses(
    localOApp: PublicKey,
    remote: number,
    remoteOApp: Uint8Array,
): PublicKey[] {
    const endpoint = new EndpointProgram.Endpoint(EndpointProgram.PROGRAM_ID);
    const uln = new UlnProgram.Uln(UlnProgram.PROGRAM_ID);
    return [
        endpoint.deriver.defaultSendLibraryConfig(remote)[0],
        endpoint.deriver.oappRegistry(localOApp)[0],
        endpoint.deriver.sendLibraryConfig(localOApp, remote)[0],
        endpoint.deriver.nonce(localOApp, remote, remoteOApp)[0],
        endpoint.deriver.pendingNonce(localOApp, remote, remoteOApp)[0],

        uln.deriver.defaultSendConfig(remote)[0],
        uln.deriver.defaultReceiveConfig(remote)[0],
        uln.deriver.sendConfig(remote, localOApp)[0],
        uln.deriver.receiveConfig(remote, localOApp)[0],
    ];
}
