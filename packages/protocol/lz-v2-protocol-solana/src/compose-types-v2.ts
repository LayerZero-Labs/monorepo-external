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
    LzComposeParams,
    LzComposeTypesV2Accounts,
} from './types';
import {
    getLzComposeParamsSerializer,
    getLzComposeTypesV2AccountsSerializer,
    getLzComposeTypesV2ResultSerializer,
} from './types';
import { instructionDiscriminator, simulateWeb3JsTransaction } from './utility';

/**
 * Retrieves the instructions and signers required for the LzCompose instruction (V2).
 * This is used for lz_compose_types version 2.
 */
export async function buildLzComposeExecutionPlan(
    rpc: RpcInterface,
    executorProgram: PublicKey,
    payer: PublicKey,
    to: PublicKey,
    composerProgram: PublicKey,
    params: LzComposeParams,
    composeTypesAccounts?: LzComposeTypesV2Accounts,
    commitment: Commitment = 'confirmed',
): Promise<{
    contextVersion: number;
    signers: KeypairSigner[];
    instructions: Instruction[];
    addressLookupTables: AddressLookupTableInput[];
}> {
    composeTypesAccounts =
        composeTypesAccounts ??
        (await getLzComposeTypesInfo(rpc, payer, to, composerProgram, params, commitment));

    const data = getLzComposeParamsSerializer().serialize(params);
    const lzComposeTypesIx: Instruction = {
        programId: composerProgram,
        keys: composeTypesAccounts.accounts.map((pubkey) => {
            return {
                pubkey,
                isSigner: false,
                isWritable: false,
            };
        }),
        data: Buffer.concat([instructionDiscriminator('lz_compose_types_v2'), data]),
    };
    // Simulate the V2 instruction to get the result (instructions, ALTs, etc)
    const resp = await simulateWeb3JsTransaction(
        rpc.getEndpoint(),
        [toWeb3JsInstruction(lzComposeTypesIx)],
        toWeb3JsPublicKey(composerProgram),
        toWeb3JsPublicKey(payer),
        getLzComposeTypesV2ResultSerializer(),
        commitment,
    );
    const tables = await fetchAllAddressLookupTable({ rpc }, resp.alts);
    const signers: { [key: number]: KeypairSigner | undefined } = {};

    const lzComposeDiscriminator = instructionDiscriminator('lz_compose').toString('hex');
    const instructionTracker: { [key: string]: boolean } = {};

    for (const ix of resp.instructions) {
        let programId = composerProgram;
        let instructionType = 'lz_compose';
        if (ix.__kind === 'Standard') {
            const { programId: stdProgramId, data } = ix;
            programId = stdProgramId;
            const discriminator = Buffer.from(data.slice(0, 8)).toString('hex');
            instructionType =
                discriminator === lzComposeDiscriminator ? 'lz_compose' : discriminator;
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
        if (ix.__kind === 'LzCompose') {
            return {
                programId: composerProgram,
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
                data: Buffer.concat([instructionDiscriminator('lz_compose'), data]),
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
 * Fetches the metadata for lz_compose_types (versioned, V2).
 * This reads the PDA account and deserializes the version, alts, and accounts.
 */
export async function getLzComposeTypesInfo(
    rpc: RpcInterface,
    payer: PublicKey,
    to: PublicKey,
    composerProgram: PublicKey,
    params: LzComposeParams,
    commitment: Commitment = 'confirmed',
): Promise<LzComposeTypesV2Accounts> {
    const oappPDA = new OmniAppPDA(composerProgram);
    const [lzComposeTypesAccountsPDA] = oappPDA.lzComposeTypesAccounts(to);
    const lzComposeTypesIx: Instruction = {
        programId: composerProgram,
        keys: [
            {
                pubkey: to,
                isSigner: false,
                isWritable: false,
            },
            {
                pubkey: lzComposeTypesAccountsPDA,
                isSigner: false,
                isWritable: false,
            },
        ],
        data: Buffer.concat([
            instructionDiscriminator('lz_compose_types_info'),
            getLzComposeParamsSerializer().serialize(params),
        ]),
    };

    const resp = await simulateWeb3JsTransaction(
        rpc.getEndpoint(),
        [toWeb3JsInstruction(lzComposeTypesIx)],
        toWeb3JsPublicKey(composerProgram),
        toWeb3JsPublicKey(payer),
        bytesSerializer(),
        commitment,
    );
    const version = resp[0];
    if (version !== 2) {
        throw new Error(`Invalid version ${version}. Expected version 2.`);
    }
    return getLzComposeTypesV2AccountsSerializer().deserialize(resp, 1)[0];
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
