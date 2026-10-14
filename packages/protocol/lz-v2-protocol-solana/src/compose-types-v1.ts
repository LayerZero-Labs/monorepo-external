import type {
    AccountMeta,
    Commitment,
    Instruction,
    PublicKey,
    RpcInterface,
} from '@metaplex-foundation/umi';
import { defaultPublicKey } from '@metaplex-foundation/umi';
import { array, publicKey as publicKeySerializer } from '@metaplex-foundation/umi/serializers';
import { toWeb3JsInstruction, toWeb3JsPublicKey } from '@metaplex-foundation/umi-web3js-adapters';

import { OmniAppPDA } from '.';
import type { LzComposeParams } from './types';
import { getLzComposeParamsSerializer, getLzReceiveAccountSerializer } from './types';
import { instructionDiscriminator, simulateWeb3JsTransaction } from './utility';

/**
 * Get the accounts required for lz_compose by querying lz_compose_types_v1.
 */
export async function getLzComposeAccountsFromTypesV1(
    rpc: RpcInterface,
    payer: PublicKey,
    to: PublicKey,
    composerProgram: PublicKey,
    params: LzComposeParams,
    commitment: Commitment = 'confirmed',
): Promise<AccountMeta[]> {
    // Derive the PDA for the lz_compose_types_accounts
    const oappPDA = new OmniAppPDA(composerProgram);
    const [lzComposeTypesAccountsPDA] = oappPDA.lzComposeTypesAccounts(to);
    // Fetch the PDA account and parse the static account list
    const info = await rpc.getAccount(lzComposeTypesAccountsPDA, { commitment });
    const accounts: AccountMeta[] = [];
    if (info.exists) {
        const buffer = Buffer.from(info.data);
        const len = buffer.length - 8;
        if (len % 32 !== 0) {
            throw new Error(
                `Invalid length of AccountInfo.data. The length must be a multiple of 32 plus 8.(n*32+8). Current length is ${buffer.length}`,
            );
        }
        for (let i = 8; i < len; i += 32) {
            const [address] = publicKeySerializer().deserialize(buffer, i);
            accounts.push({
                pubkey: address,
                isSigner: false,
                isWritable: false,
            });
        }
    }
    // Simulate the lz_compose_types instruction to get the dynamic account metas
    const data = getLzComposeParamsSerializer().serialize(params);
    const lzComposeTypesIx: Instruction = {
        programId: composerProgram,
        keys: accounts,
        data: Buffer.concat([instructionDiscriminator('lz_compose_types'), data]),
    };
    const keys = await simulateWeb3JsTransaction(
        rpc.getEndpoint(),
        [toWeb3JsInstruction(lzComposeTypesIx)],
        toWeb3JsPublicKey(composerProgram),
        toWeb3JsPublicKey(payer),
        array(getLzReceiveAccountSerializer()),
        commitment,
    );
    return updateAccountFromSimulatedResp(keys, payer);
}

function updateAccountFromSimulatedResp(accounts: AccountMeta[], payer?: PublicKey): AccountMeta[] {
    return accounts.map((r) => {
        if (r.pubkey == defaultPublicKey() && r.isSigner) {
            if (!payer) throw new Error('payer is required');
            return {
                pubkey: payer,
                isSigner: true,
                isWritable: r.isWritable,
            } satisfies AccountMeta;
        } else {
            return {
                pubkey: r.pubkey,
                isSigner: r.isSigner,
                isWritable: r.isWritable,
            } satisfies AccountMeta;
        }
    });
}
