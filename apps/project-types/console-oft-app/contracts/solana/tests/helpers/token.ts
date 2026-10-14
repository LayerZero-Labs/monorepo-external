/**
 * SPL Token / Token-2022 plumbing shared by every fixture. Instructions come from @solana/spl-token;
 * only `createMint` submits (through `sendV1`), the rest build instructions or read state.
 */

import { type KeypairSigner, type PublicKey } from '@metaplex-foundation/umi';
import { fromWeb3JsPublicKey, toWeb3JsPublicKey } from '@metaplex-foundation/umi-web3js-adapters';
import {
    type AccountState,
    createAssociatedTokenAccountIdempotentInstruction,
    createInitializeDefaultAccountStateInstruction,
    createInitializeMint2Instruction,
    createInitializeMultisigInstruction,
    createInitializeTransferHookInstruction,
    createMintToInstruction,
    ExtensionType,
    getAccount,
    getAssociatedTokenAddressSync,
    getMint,
    getMintLen,
    MULTISIG_SIZE,
    TOKEN_2022_PROGRAM_ID,
    TOKEN_PROGRAM_ID,
} from '@solana/spl-token';
import { type Connection, SystemProgram, type TransactionInstruction } from '@solana/web3.js';

import { sendV1 } from './transaction-v1';

export type TokenProgram = 'spl' | 'token2022';

export const tokenProgramId = (program: TokenProgram): PublicKey =>
    fromWeb3JsPublicKey(program === 'spl' ? TOKEN_PROGRAM_ID : TOKEN_2022_PROGRAM_ID);

/** Token-2022 mint extensions a fixture may need. SPL Token mints take none. */
export interface MintExtensions {
    /** DefaultAccountState at mint creation. Canonical ACL later switches it to Frozen. */
    defaultAccountState?: AccountState;
    /** Transfer-hook program the mint invokes on every transfer; it must be deployed. */
    transferHook?: PublicKey;
}

/**
 * Create a mint whose mint authority is a 1-of-2 native multisig of `oftStore` and `admin`: the OFT
 * can mint on receive (BurnMint) and the admin can fund test senders. `admin` is also the freeze
 * authority and the transfer-hook authority.
 */
export async function createMint(
    connection: Connection,
    admin: KeypairSigner,
    {
        mint,
        multisig,
        oftStore,
    }: { mint: KeypairSigner; multisig: KeypairSigner; oftStore: PublicKey },
    program: TokenProgram,
    decimals: number,
    extensions: MintExtensions = {},
): Promise<void> {
    if (program === 'spl' && Object.keys(extensions).length > 0)
        throw new Error('SPL Token mints have no extensions');
    const programId = toWeb3JsPublicKey(tokenProgramId(program));
    const mintKey = toWeb3JsPublicKey(mint.publicKey);
    const adminKey = toWeb3JsPublicKey(admin.publicKey);
    const multisigKey = toWeb3JsPublicKey(multisig.publicKey);

    const extensionTypes = [
        ...(extensions.defaultAccountState === undefined
            ? []
            : [ExtensionType.DefaultAccountState]),
        ...(extensions.transferHook ? [ExtensionType.TransferHook] : []),
    ];
    const mintLen = getMintLen(extensionTypes);
    const extensionInstructions: TransactionInstruction[] = [
        ...(extensions.defaultAccountState === undefined
            ? []
            : [
                  createInitializeDefaultAccountStateInstruction(
                      mintKey,
                      extensions.defaultAccountState,
                      programId,
                  ),
              ]),
        ...(extensions.transferHook
            ? [
                  createInitializeTransferHookInstruction(
                      mintKey,
                      adminKey,
                      toWeb3JsPublicKey(extensions.transferHook),
                      programId,
                  ),
              ]
            : []),
    ];

    await sendV1(
        connection,
        admin,
        [
            SystemProgram.createAccount({
                fromPubkey: adminKey,
                newAccountPubkey: multisigKey,
                space: MULTISIG_SIZE,
                lamports: await connection.getMinimumBalanceForRentExemption(MULTISIG_SIZE),
                programId,
            }),
            createInitializeMultisigInstruction(
                multisigKey,
                [toWeb3JsPublicKey(oftStore), adminKey],
                1,
                programId,
            ),
            SystemProgram.createAccount({
                fromPubkey: adminKey,
                newAccountPubkey: mintKey,
                space: mintLen,
                lamports: await connection.getMinimumBalanceForRentExemption(mintLen),
                programId,
            }),
            ...extensionInstructions,
            createInitializeMint2Instruction(mintKey, decimals, multisigKey, adminKey, programId),
        ],
        { signers: [multisig, mint] },
    );
}

export const ata = (mint: PublicKey, owner: PublicKey, tokenProgram: PublicKey): PublicKey =>
    fromWeb3JsPublicKey(
        getAssociatedTokenAddressSync(
            toWeb3JsPublicKey(mint),
            toWeb3JsPublicKey(owner),
            true, // Program-derived owners (OFT store, composer store) are off-curve.
            toWeb3JsPublicKey(tokenProgram),
        ),
    );

export const createAtaInstruction = (
    payer: PublicKey,
    mint: PublicKey,
    owner: PublicKey,
    tokenProgram: PublicKey,
): TransactionInstruction =>
    createAssociatedTokenAccountIdempotentInstruction(
        toWeb3JsPublicKey(payer),
        toWeb3JsPublicKey(ata(mint, owner, tokenProgram)),
        toWeb3JsPublicKey(owner),
        toWeb3JsPublicKey(mint),
        toWeb3JsPublicKey(tokenProgram),
    );

/** Mint `amount` to `owner`'s ATA (created if needed), signed by `admin` as the multisig member. */
export const mintToInstructions = (
    {
        mint,
        mintAuthority,
        tokenProgram,
    }: { mint: PublicKey; mintAuthority: PublicKey; tokenProgram: PublicKey },
    admin: KeypairSigner,
    owner: PublicKey,
    amount: bigint,
): TransactionInstruction[] => [
    createAtaInstruction(admin.publicKey, mint, owner, tokenProgram),
    createMintToInstruction(
        toWeb3JsPublicKey(mint),
        toWeb3JsPublicKey(ata(mint, owner, tokenProgram)),
        toWeb3JsPublicKey(mintAuthority),
        amount,
        [toWeb3JsPublicKey(admin.publicKey)],
        toWeb3JsPublicKey(tokenProgram),
    ),
];

/** Token account state, or `null` when the account does not exist. */
export async function tokenAccount(
    connection: Connection,
    address: PublicKey,
    tokenProgram: PublicKey,
) {
    const info = await connection.getAccountInfo(toWeb3JsPublicKey(address), 'confirmed');
    if (!info) return null;
    return getAccount(
        connection,
        toWeb3JsPublicKey(address),
        'confirmed',
        toWeb3JsPublicKey(tokenProgram),
    );
}

export const balance = async (
    connection: Connection,
    address: PublicKey,
    tokenProgram: PublicKey,
) => (await tokenAccount(connection, address, tokenProgram))?.amount ?? 0n;

export const supply = async (connection: Connection, mint: PublicKey, tokenProgram: PublicKey) =>
    (
        await getMint(
            connection,
            toWeb3JsPublicKey(mint),
            'confirmed',
            toWeb3JsPublicKey(tokenProgram),
        )
    ).supply;
