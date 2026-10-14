import type { AddressLookupTable } from '@metaplex-foundation/mpl-toolbox';
import { fetchAllAddressLookupTable } from '@metaplex-foundation/mpl-toolbox';
import type {
    AccountMeta,
    AddressLookupTableInput,
    Commitment,
    Context,
    Instruction,
    KeypairSigner,
    PublicKey,
    RpcInterface,
} from '@metaplex-foundation/umi';
import { generateSigner } from '@metaplex-foundation/umi';
import { bytes as bytesSerializer } from '@metaplex-foundation/umi/serializers';
import { toWeb3JsInstruction, toWeb3JsPublicKey } from '@metaplex-foundation/umi-web3js-adapters';

import { EDDSA, ExecutorPDA, OmniAppPDA } from '.';
import type {
    AccountMetaRef,
    AddressLocator,
    LzReceiveParams,
    LzReceiveTypesV2Accounts,
} from './types';
import {
    getLzReceiveParamsSerializer,
    getLzReceiveTypesV2AccountsSerializer,
    getLzReceiveTypesV2ResultSerializer,
} from './types';
import { instructionDiscriminator, simulateWeb3JsTransaction } from './utility';

/**
 * Retrieves the instructions and signers required for the LzReceive instruction (V2).
 * This is used for lz_receive_types version 2.
 */
export async function buildLzReceiveExecutionPlan(
    rpc: RpcInterface,
    executorProgram: PublicKey,
    payer: PublicKey,
    receiver: PublicKey,
    receiverProgram: PublicKey,
    params: LzReceiveParams,
    receiveTypesAccounts?: LzReceiveTypesV2Accounts,
    commitment: Commitment = 'confirmed',
): Promise<{
    contextVersion: number;
    signers: KeypairSigner[];
    instructions: Instruction[];
    addressLookupTables: AddressLookupTableInput[];
}> {
    receiveTypesAccounts =
        receiveTypesAccounts ??
        (await getLzReceiveTypesInfo(rpc, payer, receiver, receiverProgram, params, commitment));

    const data = getLzReceiveParamsSerializer().serialize(params);
    const lzReceiveTypesIx: Instruction = {
        programId: receiverProgram,
        keys: receiveTypesAccounts.accounts.map((pubkey) => {
            return {
                pubkey,
                isSigner: false,
                isWritable: false,
            };
        }),
        data: Buffer.concat([instructionDiscriminator('lz_receive_types_v2'), data]),
    };
    // Simulate the V2 instruction to get the result (instructions, ALTs, etc)
    const resp = await simulateWeb3JsTransaction(
        rpc.getEndpoint(),
        [toWeb3JsInstruction(lzReceiveTypesIx)],
        toWeb3JsPublicKey(receiverProgram),
        toWeb3JsPublicKey(payer),
        getLzReceiveTypesV2ResultSerializer(),
        commitment,
    );
    const tables = await fetchAllAddressLookupTable({ rpc }, resp.alts);
    const signers: { [key: number]: KeypairSigner | undefined } = {};

    const lzReceiveDiscriminator = instructionDiscriminator('lz_receive').toString('hex');
    const instructionTracker: { [key: string]: boolean } = {};

    for (const ix of resp.instructions) {
        let programId = receiverProgram;
        let instructionType = 'lz_receive';
        if (ix.__kind === 'Standard') {
            const { programId: stdProgramId, data } = ix;
            programId = stdProgramId;
            const discriminator = Buffer.from(data.slice(0, 8)).toString('hex');
            instructionType =
                discriminator === lzReceiveDiscriminator ? 'lz_receive' : discriminator;
        }
        const key = `${programId}-${instructionType}`;
        if (instructionTracker[key]) {
            throw new Error(
                `Duplicate instruction found: ${instructionType} for program ${programId}`,
            );
        }
        instructionTracker[key] = true;
    }
    const { contextVersion } = resp;
    const instructions: Instruction[] = resp.instructions.map((ix) => {
        if (ix.__kind === 'LzReceive') {
            return {
                programId: receiverProgram,
                keys: ix.accounts.map((account) =>
                    accountMetaRefToAccountMeta(
                        { eddsa: EDDSA },
                        executorProgram,
                        tables,
                        signers,
                        account,
                        payer,
                        contextVersion,
                    ),
                ),
                data: Buffer.concat([instructionDiscriminator('lz_receive'), data]),
            };
        } else {
            return {
                programId: ix.programId,
                keys: ix.accounts.map((account) =>
                    accountMetaRefToAccountMeta(
                        { eddsa: EDDSA },
                        executorProgram,
                        tables,
                        signers,
                        account,
                        payer,
                        contextVersion,
                    ),
                ),
                data: ix.data,
            };
        }
    });
    return {
        contextVersion,
        signers: Object.values(signers).filter((signer) => signer !== undefined) as KeypairSigner[],
        instructions,
        addressLookupTables: tables,
    };
}

/**
 * Fetches the metadata for lz_receive_types (versioned, V2).
 * This reads the PDA account and deserializes the version, alts, and accounts.
 */
export async function getLzReceiveTypesInfo(
    rpc: RpcInterface,
    payer: PublicKey,
    receiver: PublicKey,
    receiverProgram: PublicKey,
    params: LzReceiveParams,
    commitment: Commitment = 'confirmed',
): Promise<LzReceiveTypesV2Accounts> {
    const oappPDA = new OmniAppPDA(receiverProgram);
    const [lzReceiveTypesAccountsPDA] = oappPDA.lzReceiveTypesAccounts(receiver);
    const lzReceiveTypesIx: Instruction = {
        programId: receiverProgram,
        keys: [
            {
                pubkey: receiver,
                isSigner: false,
                isWritable: false,
            },
            {
                pubkey: lzReceiveTypesAccountsPDA,
                isSigner: false,
                isWritable: false,
            },
        ],
        data: Buffer.concat([
            instructionDiscriminator('lz_receive_types_info'),
            getLzReceiveParamsSerializer().serialize(params),
        ]),
    };

    const resp = await simulateWeb3JsTransaction(
        rpc.getEndpoint(),
        [toWeb3JsInstruction(lzReceiveTypesIx)],
        toWeb3JsPublicKey(receiverProgram),
        toWeb3JsPublicKey(payer),
        bytesSerializer(),
        commitment,
    );
    const version = resp[0];
    if (version !== 2) {
        throw new Error(`Invalid version ${version}. Expected version 2.`);
    }
    return getLzReceiveTypesV2AccountsSerializer().deserialize(resp, 1)[0];
}

function accountMetaRefToAccountMeta(
    umi: Pick<Context, 'eddsa'>,
    executorProgram: PublicKey,
    tables: AddressLookupTable[],
    signers: { [key: number]: KeypairSigner | undefined },
    accountMetaRef: AccountMetaRef,
    payer: PublicKey,
    contextVersion: number,
): AccountMeta {
    const { isWritable, pubkey: locator } = accountMetaRef;
    const pubkey = addressLocatorToPublicKey(
        umi,
        executorProgram,
        tables,
        signers,
        locator,
        payer,
        contextVersion,
    );
    return {
        pubkey,
        isSigner: locator.__kind === 'Signer' || locator.__kind === 'Payer',
        isWritable,
    };
}

function addressLocatorToPublicKey(
    umi: Pick<Context, 'eddsa'>,
    executorProgram: PublicKey,
    tables: AddressLookupTable[],
    signers: { [key: number]: KeypairSigner | undefined },
    locator: AddressLocator,
    payer: PublicKey,
    contextVersion: number,
): PublicKey {
    if (locator.__kind === 'Payer') {
        return payer;
    } else if (locator.__kind === 'Signer') {
        const index = locator.fields[0];
        let signer = signers[index];
        if (signer === undefined) {
            signer = generateSigner(umi);
            signers[index] = signer;
        }
        return signer.publicKey;
    } else if (locator.__kind === 'Address') {
        return locator.fields[0];
    } else if (locator.__kind === 'Context') {
        const pda = new ExecutorPDA(executorProgram);
        return pda.context(payer, contextVersion)[0];
    } else {
        const table = tables[locator.fields[0]];
        return table.addresses[locator.fields[1]];
    }
}
