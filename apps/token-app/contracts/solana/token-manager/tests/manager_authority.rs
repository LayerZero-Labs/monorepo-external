//! One root per mint, authorized by any live native authority (freeze admin, mint admin, PB
//! authority, permanent delegate); the admin must accept.
#[path = "support/mod.rs"]
mod support;

use anchor_lang::{error::ErrorCode, AccountDeserialize, InstructionData, ToAccountMetas};
use mollusk_svm_programs_token::token2022;
use pubkey_policy::RoleType as PolicyRole;
use pubkey_policy_interface::PubkeyPolicyMode;
use solana_account::Account;
use solana_instruction::{AccountMeta, Instruction};
use solana_program_pack::Pack;
use solana_pubkey::Pubkey;
use spl_token_2022_interface::{error::TokenError, instruction as token, state::Multisig};
use support::*;
use token_acl_client::instructions as acl;
use token_manager::{errors::TokenManagerError, RoleType};
use token_manager_interface::TokenManagerStore;

fn legacy_token_id() -> Pubkey {
    // Tokenkeg canonical legacy SPL Token program, not a Token-2022 interface mint.
    "TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA".parse().unwrap()
}

fn set_authority(f: &Fixture, kind: token::AuthorityType, next: Option<&Pubkey>) -> Instruction {
    token::set_authority(&token2022::ID, &f.mint, next, kind, &f.admin, &[]).unwrap()
}

fn store(f: &Fixture) -> TokenManagerStore {
    TokenManagerStore::try_deserialize(&mut f.account(&f.token_manager).data.as_slice()).unwrap()
}

/// Native 1-of-1 multisig account owned by `owner`, with `member` as its only signer.
fn insert_multisig(f: &Fixture, owner: Pubkey, member: Pubkey) -> Pubkey {
    let multisig = Pubkey::new_unique();
    let mut data = vec![0; Multisig::LEN];
    let mut signers = [Pubkey::default(); 11];
    signers[0] = member;
    Multisig { m: 1, n: 1, is_initialized: true, signers }.pack_into_slice(&mut data);
    f.context
        .account_store
        .borrow_mut()
        .insert(multisig, Account { lamports: 1_000_000_000, data, owner, ..Account::default() });
    multisig
}

fn with_member(mut ix: Instruction, member: Pubkey) -> Instruction {
    ix.accounts.push(AccountMeta::new_readonly(member, true));
    ix
}

#[test]
fn legacy_spl_mint_support_is_registry_only() {
    let f = Fixture::uninitialized(Mode::Plain);
    // A plain initialized mint has the shared legacy base layout. This fixture
    // models a legacy-token-owned mint; it does not exercise legacy token CPIs.
    let mut mint = f.account(&f.mint);
    mint.owner = legacy_token_id();
    f.context.account_store.borrow_mut().insert(f.mint, mint);
    f.ok(&[f.init_token_manager_ix(f.admin, f.admin), f.accept_admin_ix(f.admin)]);
    f.ok(&f.policy_ixs());
    let subject = Pubkey::new_unique();
    f.block(subject, true);
    assert!(membership(&f.account(&f.record(&subject)).data).unwrap().blacklisted);
    f.fails(&[f.init_acl_ix()], 0, ErrorCode::ConstraintOwner);
}

#[test]
fn only_a_signing_native_authority_creates_the_root_once() {
    let f = Fixture::uninitialized(Mode::Plain);
    f.ok(&[set_authority(&f, token::AuthorityType::FreezeAccount, Some(&f.keeper))]);
    // A key holding no native authority cannot create the root.
    f.fails(
        &[f.init_token_manager_ix(f.operator, f.operator)],
        0,
        TokenManagerError::InvalidAuthority,
    );
    let mut unsigned = f.init_token_manager_ix(f.keeper, f.operator);
    unsigned.accounts.iter_mut().find(|a| a.pubkey == f.keeper).unwrap().is_signer = false;
    f.fails(&[unsigned], 0, TokenManagerError::InvalidAuthority);
    assert!(f.account(&f.token_manager).data.is_empty());

    f.ok(&[f.init_token_manager_ix(f.keeper, f.operator)]);
    let root = store(&f);
    assert_eq!(root.mint, f.mint);
    assert_eq!(root.bootstrap, f.keeper);
    assert_eq!(root.pending_default_admin, f.operator);
    assert_eq!(root.current_default_admin, Pubkey::default());
    assert_eq!(f.account(&f.token_manager).data.len(), 136);

    let before = f.account(&f.token_manager);
    f.fails(&[f.init_token_manager_ix(f.keeper, f.keeper)], 0, SYSTEM_ACCOUNT_ALREADY_IN_USE);
    assert_eq!(f.account(&f.token_manager), before);
}

#[test]
fn a_non_canonical_address_cannot_become_a_root() {
    let f = Fixture::uninitialized(Mode::Plain);
    let mut ix = f.init_token_manager_ix(f.admin, f.admin);
    ix.accounts.iter_mut().find(|a| a.pubkey == f.token_manager).unwrap().pubkey =
        Pubkey::new_unique();
    f.fails(&[ix], 0, ErrorCode::ConstraintSeeds);
}

#[test]
fn mint_admin_authorizes_when_freeze_is_absent() {
    let f = Fixture::uninitialized(Mode::Plain);
    f.ok(&[set_authority(&f, token::AuthorityType::FreezeAccount, None)]);
    f.fails(&[f.init_token_manager_ix(f.keeper, f.keeper)], 0, TokenManagerError::InvalidAuthority);
    f.ok(&[f.init_token_manager_ix(f.admin, f.admin), f.accept_admin_ix(f.admin)]);
    f.ok(&f.policy_ixs());
    let subject = Pubkey::new_unique();
    f.block(subject, true);
    f.ok(&[f.set_mode_ix(PubkeyPolicyMode::Whitelist)]);
    // Root creation did not restore native freeze authority.
    f.fails(
        &[set_authority(&f, token::AuthorityType::FreezeAccount, Some(&f.admin))],
        0,
        TokenError::MintCannotFreeze as u32,
    );
}

#[test]
fn mint_without_mint_or_freeze_authority_gets_no_root() {
    let f = Fixture::uninitialized(Mode::Plain);
    f.ok(&[
        set_authority(&f, token::AuthorityType::FreezeAccount, None),
        set_authority(&f, token::AuthorityType::MintTokens, None),
    ]);
    f.fails(&[f.init_token_manager_ix(f.admin, f.admin)], 0, TokenManagerError::InvalidAuthority);
}

/// `holder` moves a native authority straight through Token-2022.
fn hand(
    f: &Fixture,
    kind: token::AuthorityType,
    holder: Pubkey,
    to: Option<&Pubkey>,
) -> Instruction {
    token::set_authority(&token2022::ID, &f.mint, to, kind, &holder, &[]).unwrap()
}

/// Every live native authority is trusted alike, so the PB holder creates the root while the base
/// authorities still exist; the other holders join by handing their authority to it.
#[test]
fn a_pb_holder_creates_the_root_and_the_pd_holder_joins() {
    use token_manager_interface::{signer_address, SignerKind};
    let f = Fixture::uninitialized(Mode::PermissionedBurn);
    let source = f.create_token(f.operator);
    f.mint_to(source, 10);
    f.ok(&[hand(&f, token::AuthorityType::PermissionedBurn, f.admin, Some(&f.keeper))]);
    f.ok(&[f.init_token_manager_ix(f.keeper, f.keeper), f.accept_admin_ix(f.keeper)]);
    assert_eq!(store(&f).bootstrap, f.keeper);

    // The PD holder joins by handing PD to the root's signer; one admin governs both.
    let root = f.token_manager;
    let pd_signer = signer_address(&root, SignerKind::PermanentDelegate).0;
    f.ok(&[
        hand(&f, token::AuthorityType::PermanentDelegate, f.admin, Some(&pd_signer)),
        hand(&f, token::AuthorityType::PermissionedBurn, f.keeper, Some(&f.pb_signer())),
        f.as_current_admin(f.grant_role_ix(RoleType::PdBurner, f.operator)),
    ]);
    let burn = Instruction {
        program_id: token_manager::ID,
        accounts: token_manager::accounts::PdBurn {
            authority: f.operator,
            token_manager: root,
            pd_signer,
            pb_signer: f.pb_signer(),
            mint: f.mint,
            token_account: source,
            token_program: token2022::ID,
            role_member: role_member(&root, RoleType::PdBurner, &f.operator),
            event_authority: event_authority(&token_manager::ID),
            program: token_manager::ID,
        }
        .to_account_metas(None),
        data: token_manager::instruction::PdBurn { amount: 4 }.data(),
    };
    f.ok(&[burn]);
    assert_eq!(f.token(&source).amount, 6);
}

#[test]
fn a_pd_holder_alone_creates_the_root() {
    let f = Fixture::uninitialized(Mode::PermissionedBurn);
    f.ok(&[
        hand(&f, token::AuthorityType::PermissionedBurn, f.admin, None),
        hand(&f, token::AuthorityType::PermanentDelegate, f.admin, Some(&f.keeper)),
        set_authority(&f, token::AuthorityType::FreezeAccount, None),
        set_authority(&f, token::AuthorityType::MintTokens, None),
    ]);
    f.fails(&[f.init_token_manager_ix(f.admin, f.admin)], 0, TokenManagerError::InvalidAuthority);
    f.ok(&[f.init_token_manager_ix(f.keeper, f.keeper)]);
    assert_eq!(store(&f).bootstrap, f.keeper);
}

#[test]
fn native_multisig_mint_admin_can_create_the_root_for_legacy_and_t22_multisigs() {
    for owner in [token2022::ID, legacy_token_id()] {
        let f = Fixture::uninitialized(Mode::Plain);
        let multisig = insert_multisig(&f, owner, f.keeper);
        f.ok(&[
            set_authority(&f, token::AuthorityType::FreezeAccount, None),
            set_authority(&f, token::AuthorityType::MintTokens, Some(&multisig)),
        ]);
        // The multisig account itself never signs; its member threshold does.
        f.fails(
            &[f.init_token_manager_ix(multisig, f.admin)],
            0,
            TokenManagerError::InvalidAuthority,
        );
        let mut ix = f.init_token_manager_ix(multisig, f.admin);
        ix.accounts.iter_mut().find(|a| a.pubkey == multisig).unwrap().is_signer = false;
        f.ok(&[with_member(ix, f.keeper), f.accept_admin_ix(f.admin)]);
        assert_eq!(store(&f).bootstrap, multisig);
        assert_eq!(store(&f).current_default_admin, f.admin);
    }
}

/// When Token ACL's MintConfig holds freeze, its logical admin stands in for the freeze authority,
/// and it can be identified only through the config. Like any native authority, a multisig logical
/// admin proves itself by its members.
#[test]
fn acl_logical_admin_creates_the_root_only_through_its_config() {
    let f = Fixture::uninitialized(Mode::Acl);
    f.ok(&[f.create_acl_config_ix()]);
    let multisig = insert_multisig(&f, token2022::ID, f.keeper);
    f.ok(&[acl::SetAuthorityBuilder::new()
        .authority(f.admin)
        .mint_config(f.mint_config())
        .new_authority(multisig)
        .instruction()]);
    let by_multisig = || {
        let mut ix = f.init_token_manager_ix(multisig, f.admin);
        ix.accounts.iter_mut().find(|a| a.pubkey == multisig).unwrap().is_signer = false;
        with_member(ix, f.keeper)
    };
    // Without the config the freeze authority is only the MintConfig PDA, which the multisig is
    // not.
    let mut no_config = by_multisig();
    no_config
        .accounts
        .iter_mut()
        .find(|a| a.pubkey == f.mint_config())
        .unwrap()
        .pubkey = Pubkey::new_unique();
    f.fails(&[no_config], 0, TokenManagerError::InvalidAuthority);
    f.ok(&[by_multisig()]);
    assert_eq!(store(&f).bootstrap, multisig);
}

/// An authority handed to this root's own signer before the root exists cannot sign for it, but
/// any other live authority still creates it.
#[test]
fn an_authority_already_on_this_roots_signer_does_not_block_creation() {
    let f = Fixture::uninitialized(Mode::Acl);
    f.ok(&[f.create_acl_config_ix()]);
    f.ok(&[acl::SetAuthorityBuilder::new()
        .authority(f.admin)
        .mint_config(f.mint_config())
        .new_authority(f.acl_signer())
        .instruction()]);
    f.ok(&[f.init_token_manager_ix(f.admin, f.admin), f.accept_admin_ix(f.admin)]);
    assert_eq!(store(&f).bootstrap, f.admin);
}

#[test]
fn pending_admin_must_accept_and_only_bootstrap_repoints_before_acceptance() {
    let f = Fixture::uninitialized(Mode::Plain);
    f.ok(&[f.init_token_manager_ix(f.admin, f.keeper)]);
    // No DefaultAdmin exists yet: neither the bootstrap nor the pending admin holds the role.
    for caller in [f.admin, f.keeper] {
        let mut ix = f.grant_role_ix(RoleType::Freezer, f.operator);
        for meta in &mut ix.accounts {
            if meta.pubkey == f.admin {
                meta.pubkey = caller;
            } else if meta.pubkey == role_member(&f.token_manager, RoleType::DefaultAdmin, &f.admin)
            {
                meta.pubkey = role_member(&f.token_manager, RoleType::DefaultAdmin, &caller);
            }
        }
        f.fails(&[ix], 0, ErrorCode::AccountNotInitialized);
    }
    // Only the pending key may accept; its DefaultAdmin RoleMember is seeded by the pending key.
    f.fails(&[f.accept_admin_ix(f.operator)], 0, ErrorCode::ConstraintSeeds);

    // A non-bootstrap key cannot re-point; the bootstrap can, even to fix a typo.
    f.fails(
        &[f.set_pending_admin_ix(f.operator, f.operator)],
        0,
        TokenManagerError::InvalidAuthority,
    );
    f.ok(&[f.set_pending_admin_ix(f.admin, f.operator)]);
    f.fails(&[f.accept_admin_ix(f.keeper)], 0, ErrorCode::ConstraintSeeds);
    f.ok(&[f.accept_admin_ix(f.operator)]);
    assert_eq!(store(&f).current_default_admin, f.operator);
    assert_eq!(store(&f).pending_default_admin, Pubkey::default());

    // After acceptance, neither bootstrap re-point nor a second acceptance works.
    f.fails(
        &[f.set_pending_admin_ix(f.admin, f.keeper)],
        0,
        rbac::RbacError::DefaultAdminAlreadyInitialized,
    );
    f.fails(&[f.accept_admin_ix(f.operator)], 0, ErrorCode::ConstraintSeeds);
}

/// A null pending admin could never accept, so creation and bootstrap re-pointing refuse it.
#[test]
fn a_null_pending_admin_is_refused() {
    let f = Fixture::uninitialized(Mode::Plain);
    let null = Pubkey::default();
    f.fails(&[f.init_token_manager_ix(f.admin, null)], 0, rbac::RbacError::InvalidDefaultAdmin);
    f.ok(&[f.init_token_manager_ix(f.admin, Pubkey::new_unique())]);
    f.fails(&[f.set_pending_admin_ix(f.admin, null)], 0, rbac::RbacError::InvalidDefaultAdmin);
}

#[test]
fn bootstrap_repoint_survives_an_early_native_handoff() {
    let f = Fixture::uninitialized(Mode::Plain);
    f.ok(&[f.init_token_manager_ix(f.admin, Pubkey::new_unique())]);
    // The freeze admin moves away before any admin accepted; bootstrap is unaffected.
    f.ok(&[set_authority(&f, token::AuthorityType::FreezeAccount, Some(&f.keeper))]);
    f.fails(&[f.set_pending_admin_ix(f.keeper, f.keeper)], 0, TokenManagerError::InvalidAuthority);
    f.ok(&[f.set_pending_admin_ix(f.admin, f.admin), f.accept_admin_ix(f.admin)]);
}

#[test]
fn native_authority_holders_do_not_implicitly_gain_registry_roles() {
    let f = Fixture::new(Mode::Plain);
    let subject = Pubkey::new_unique();
    f.block(subject, true);
    let before_policy = f.account(&f.policy);
    let record = f.record(&subject);
    f.ok(&[set_authority(&f, token::AuthorityType::FreezeAccount, Some(&f.keeper))]);
    assert_eq!(f.account(&f.policy), before_policy);
    assert_eq!(f.token_manager, token_manager_interface::token_manager_address(&f.mint).0);
    for unauthorized in [f.admin, f.keeper] {
        let mut instruction = f.block_ix(subject, false);
        for meta in &mut instruction.accounts {
            if meta.pubkey == f.operator {
                meta.pubkey = unauthorized;
            }
            if meta.pubkey == policy_role_member(&f.policy, PolicyRole::Blacklister, &f.operator) {
                meta.pubkey = policy_role_member(&f.policy, PolicyRole::Blacklister, &unauthorized);
            }
        }
        f.fails(&[instruction], 0, ErrorCode::AccountNotInitialized);
        assert!(membership(&f.account(&record).data).unwrap().blacklisted);
    }
    // Clearing the only bit keeps the record in place, now asserting nothing.
    f.block(subject, false);
    assert!(!membership(&f.account(&record).data).unwrap().blacklisted);
    assert_eq!(f.record(&subject), record);
}

/// The policy has its own admin; rotating the root's admin does not move it.
#[test]
fn rotating_the_roots_default_admin_leaves_the_policy_admin_in_place() {
    let f = Fixture::new(Mode::Plain);
    f.rotate_default_admin(f.keeper);
    f.ok(&[f.set_mode_ix(PubkeyPolicyMode::Open)]);
}

#[test]
fn a_multisig_hook_authority_binds_by_member_quorum_not_by_its_own_key() {
    let f = Fixture::uninitialized(Mode::Hook);
    f.ok(&[f.init_token_manager_ix(f.admin, f.admin), f.accept_admin_ix(f.admin)]);
    f.ok(&f.policy_ixs());
    let multisig = insert_multisig(&f, token2022::ID, f.keeper);
    f.ok(&[set_authority(&f, token::AuthorityType::TransferHookProgramId, Some(&multisig))]);
    let as_multisig = |signs: bool| {
        let mut ix = f.init_transfer_hook_ix();
        let authority =
            ix.accounts.iter_mut().find(|meta| meta.pubkey == f.admin && !meta.is_writable);
        let authority = authority.unwrap();
        authority.pubkey = multisig;
        authority.is_signer = signs;
        ix
    };
    // A retained key for the multisig account itself is not its quorum.
    f.fails(&[as_multisig(true)], 0, pubkey_policy_hook::errors::HookError::Unauthorized);
    f.ok(&[with_member(as_multisig(false), f.keeper)]);
}

/// SDKs read which account layouts and IDL a deployment speaks from the build itself.
#[test]
fn get_version_reports_this_builds_versions() {
    use anchor_lang::AnchorDeserialize;
    let f = Fixture::uninitialized(Mode::Plain);
    let result = f.context.process_instruction(&Instruction {
        program_id: token_manager::ID,
        accounts: token_manager::accounts::GetVersion { program: token_manager::ID }
            .to_account_metas(None),
        data: token_manager::instruction::GetVersion {}.data(),
    });
    assert!(result.program_result.is_ok(), "{:?}", result.program_result);
    assert_eq!(
        token_manager_interface::ProgramVersion::try_from_slice(&result.return_data).unwrap(),
        token_manager_interface::TOKEN_MANAGER_VERSION
    );
}
