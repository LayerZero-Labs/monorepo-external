/**
 * Canonical Token ACL governance for a Token-2022 fixture mint, with `token_manager` as the gating
 * program. This is the native state `lz_receive_types_v3` detects when it plans an inline
 * create-and-thaw of a first-time recipient's ATA.
 *
 * Mirrors the Rust integration harness (tests/integration/harness.rs):
 *
 *   init_token_manager → accept → DefaultAccountState = Frozen → acl::create_config
 *     → acl::set_authority → init_acl(policy) → set_acl_permissions{thaw, freeze}
 *
 * The order is load-bearing: `create_config` hands the mint's native freeze authority to the ACL
 * config PDA, after which DefaultAccountState can no longer be changed, and `init_acl` rejects a
 * mint whose DefaultAccountState is not Frozen. Every token account that must stay usable (the OFT
 * escrow, the fee deposit, senders' ATAs, the redirect escrow) has to exist before this runs.
 */

import { type PublicKey, publicKey, publicKeyBytes } from '@metaplex-foundation/umi';
import { toWeb3JsPublicKey } from '@metaplex-foundation/umi-web3js-adapters';
import {
    AccountState,
    createUpdateDefaultAccountStateInstruction,
    TOKEN_2022_PROGRAM_ID,
} from '@solana/spl-token';
import { SystemProgram, TransactionInstruction } from '@solana/web3.js';

import * as tokenManagerInstructions from '../../build/token_manager/instructions';
import { TOKEN_MANAGER_PROGRAM_ID } from '../../build/token_manager/programs';
import { RoleType as TokenManagerRoleType } from '../../build/token_manager/types';
import { instructions as oftInstructions, types as oftTypes } from '../../sdk/oft';
import { EDDSA } from '../constants';
import type { OftFixture } from './fixture';
import { sendV1 } from './transaction-v1';

/**
 * Canonical Token ACL, pinned by token-manager-solana-contracts to
 * solana-foundation/token-acl @ bfbaf589662631ca84f3462514620a499405c6d7.
 * `token_manager` hardcodes this address.
 */
export const TOKEN_ACL_PROGRAM_ID = publicKey('TACLkU6CiCdkQN2MjoyDkVg2yAH9zkxiHDsiztQ52TP');

const seed = (text: string) => Uint8Array.from(Buffer.from(text, 'utf8'));
const managerPda = (...seeds: Uint8Array[]) => EDDSA.findPda(TOKEN_MANAGER_PROGRAM_ID, seeds)[0];

/** The mint's single root: RBAC namespace and ACL signer owner. */
const tokenManagerStore = (mint: PublicKey) =>
    managerPda(seed('token_manager'), publicKeyBytes(mint));
/** The root's Acl signer PDA (SignerKind::Acl = 0). */
const aclSigner = (tokenManager: PublicKey) =>
    managerPda(seed('token_manager_signer'), publicKeyBytes(tokenManager), Uint8Array.from([0]));
const managerRoleMember = (
    tokenManager: PublicKey,
    role: TokenManagerRoleType,
    member: PublicKey,
) =>
    managerPda(
        seed('RoleMember'),
        publicKeyBytes(tokenManager),
        Uint8Array.from([role]),
        publicKeyBytes(member),
    );
const managerEventAuthority = () => managerPda(seed('__event_authority'));
const thawMetas = (mint: PublicKey) =>
    managerPda(seed('thaw_extra_account_metas'), publicKeyBytes(mint));
const freezeMetas = (mint: PublicKey) =>
    managerPda(seed('freeze_extra_account_metas'), publicKeyBytes(mint));

/** ACL MintConfig PDA: the mint's native freeze authority once ACL governs it. */
export const aclMintConfig = (mint: PublicKey): PublicKey =>
    EDDSA.findPda(TOKEN_ACL_PROGRAM_ID, [seed('MINT_CONFIG'), publicKeyBytes(mint)])[0];

// token-acl has no generated client here; both instructions are a one-byte discriminator + pubkey.
const aclInstruction = (
    discriminator: number,
    keys: TransactionInstruction['keys'],
    argument: PublicKey,
) =>
    new TransactionInstruction({
        programId: toWeb3JsPublicKey(TOKEN_ACL_PROGRAM_ID),
        keys,
        data: Buffer.concat([Buffer.from([discriminator]), toWeb3JsPublicKey(argument).toBuffer()]),
    });

/** Put `oft.mint` under canonical ACL gated by `token_manager`, whose gate binds `policy`. */
export async function governWithCanonicalAcl(oft: OftFixture, policy: PublicKey): Promise<void> {
    const { umi, connection, admin, mint } = oft;
    const tokenManager = tokenManagerStore(mint);
    const signer = aclSigner(tokenManager);
    const mintConfig = aclMintConfig(mint);
    const eventAuthority = managerEventAuthority();
    const adminRoleMember = managerRoleMember(
        tokenManager,
        TokenManagerRoleType.DefaultAdmin,
        admin.publicKey,
    );

    // `authority` is authenticated in-handler (plain signer or native multisig), so the IDL types it
    // as unchecked; the mint's freeze authority still has to sign.
    const init = tokenManagerInstructions.initTokenManager(umi, {
        payer: admin,
        authority: admin.publicKey,
        mint,
        tokenManager,
        eventAuthority,
        program: TOKEN_MANAGER_PROGRAM_ID,
        pendingAdmin: admin.publicKey,
    }).items[0].instruction;
    init.keys = init.keys.map((key) =>
        key.pubkey === admin.publicKey ? { ...key, isSigner: true } : key,
    );
    await sendV1(connection, admin, [
        init,
        tokenManagerInstructions.acceptTokenManagerAdmin(umi, {
            payer: admin,
            admin,
            tokenManager,
            adminRoleMember,
            eventAuthority,
            program: TOKEN_MANAGER_PROGRAM_ID,
        }),
    ]);

    const w = toWeb3JsPublicKey;
    await sendV1(connection, admin, [
        // Last write that needs the mint's original freeze authority.
        createUpdateDefaultAccountStateInstruction(
            w(mint),
            AccountState.Frozen,
            w(admin.publicKey),
            [],
            TOKEN_2022_PROGRAM_ID,
        ),
        // create_config: registers the mint and moves its freeze authority to the config PDA.
        aclInstruction(
            0,
            [
                { pubkey: w(admin.publicKey), isSigner: true, isWritable: true },
                { pubkey: w(admin.publicKey), isSigner: true, isWritable: false },
                { pubkey: w(mint), isSigner: false, isWritable: true },
                { pubkey: w(mintConfig), isSigner: false, isWritable: true },
                { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
                { pubkey: TOKEN_2022_PROGRAM_ID, isSigner: false, isWritable: false },
            ],
            TOKEN_MANAGER_PROGRAM_ID,
        ),
        // set_authority: hands the config's logical administrator role to the root's Acl signer.
        aclInstruction(
            1,
            [
                { pubkey: w(admin.publicKey), isSigner: true, isWritable: false },
                { pubkey: w(mintConfig), isSigner: false, isWritable: true },
            ],
            signer,
        ),
    ]);

    await sendV1(connection, admin, [
        tokenManagerInstructions.initAcl(umi, {
            payer: admin,
            authority: admin,
            mint,
            tokenManager,
            pubkeyPolicy: policy,
            thawMetas: thawMetas(mint),
            freezeMetas: freezeMetas(mint),
            roleMember: adminRoleMember,
            eventAuthority,
            program: TOKEN_MANAGER_PROGRAM_ID,
        }),
        tokenManagerInstructions.setAclPermissions(umi, {
            authority: admin,
            tokenManager,
            aclSigner: signer,
            mintConfig,
            aclProgram: TOKEN_ACL_PROGRAM_ID,
            roleMember: adminRoleMember,
            eventAuthority,
            program: TOKEN_MANAGER_PROGRAM_ID,
            freezeEnabled: true,
            thawEnabled: true,
        }),
        // Planning derives the gate's thaw manifest from the OFT's cached gate.
        oftInstructions.syncAclGatingProgram(umi, {
            oftStore: oft.oftStore,
            mintConfig,
            eventAuthority: oft.pda.eventAuthority(),
            program: oft.pda.programId,
        }),
    ]);
}

/**
 * OFT receive screening selects `policy`. OFT does not check it against the policies the ACL gate
 * and hook bind; keeping them consistent is the admins' job.
 */
export const selectPubkeyPolicy = (oft: OftFixture, policy: PublicKey) =>
    sendV1(oft.connection, oft.admin, [
        oftInstructions.setPubkeyPolicy(oft.umi, {
            authority: oft.admin,
            oftStore: oft.oftStore,
            pubkeyPolicy: policy,
            roleMember: oft.pda.roleMember(
                oft.oftStore,
                oftTypes.RoleType.DefaultAdmin,
                oft.admin.publicKey,
            ),
            eventAuthority: oft.pda.eventAuthority(),
            program: oft.pda.programId,
        }),
    ]);
