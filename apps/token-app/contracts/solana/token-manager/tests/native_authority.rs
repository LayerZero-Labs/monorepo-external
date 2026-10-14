//! DefaultAdmin can move a signer's native authority to any live key, never to null or to
//! another signer of the same root.
#[path = "support/mod.rs"]
mod support;

use anchor_lang::error::ErrorCode;
use mollusk_svm_result::types::TransactionProgramResult;
use solana_instruction::Instruction;
use solana_program_error::ProgramError;
use solana_pubkey::Pubkey;
use spl_token_2022_interface::{
    error::TokenError,
    extension::{
        permanent_delegate::PermanentDelegate, permissioned_burn::PermissionedBurnConfig,
        BaseStateWithExtensions, StateWithExtensions,
    },
    instruction as token,
    state::Mint,
};
use support::*;
use token_acl_client::accounts::MintConfig;
use token_manager::{errors::TokenManagerError, RoleType};
use token_manager_interface::{signer_address, SignerKind};

fn set_native_authority(f: &Fixture, kind: SignerKind, new_authority: Pubkey) -> Instruction {
    f.set_native_authority_ix(kind, new_authority)
}

fn pb_authority(f: &Fixture) -> Option<Pubkey> {
    let account = f.account(&f.mint);
    let mint = StateWithExtensions::<Mint>::unpack(&account.data).unwrap();
    mint.get_extension::<PermissionedBurnConfig>().unwrap().authority.into()
}

fn acl_admin(f: &Fixture) -> Pubkey {
    MintConfig::from_bytes(&f.account(&f.mint_config()).data)
        .unwrap()
        .freeze_authority
}

fn pb_fixture() -> Fixture {
    let f = Fixture::new(Mode::PermissionedBurn);
    f.ok(&[token::set_authority(
        &spl_token_2022_interface::ID,
        &f.mint,
        Some(&f.pb_signer()),
        token::AuthorityType::PermissionedBurn,
        &f.admin,
        &[],
    )
    .unwrap()]);
    f
}

#[test]
fn default_admin_moves_pb_authority_off_its_signer() {
    let f = pb_fixture();
    let next = Pubkey::new_unique();
    f.ok(&[set_native_authority(&f, SignerKind::PermissionedBurn, next)]);
    assert_eq!(pb_authority(&f), Some(next));
    // The signer no longer holds it, so a second move fails in Token-2022.
    f.fails(
        &[set_native_authority(&f, SignerKind::PermissionedBurn, f.keeper)],
        0,
        TokenError::OwnerMismatch as u32,
    );
}

#[test]
fn null_root_mint_config_and_same_root_signers_are_rejected() {
    let f = pb_fixture();
    for target in [
        Pubkey::default(),
        f.token_manager,
        f.mint_config(),
        f.pb_signer(),
        f.acl_signer(),
        signer_address(&f.token_manager, SignerKind::PermanentDelegate).0,
        f.pause_signer(),
    ] {
        f.fails(
            &[set_native_authority(&f, SignerKind::PermissionedBurn, target)],
            0,
            TokenManagerError::InvalidNewAuthority,
        );
    }
    assert_eq!(pb_authority(&f), Some(f.pb_signer()));
}

#[test]
fn only_default_admin_can_move_a_native_authority() {
    let f = pb_fixture();
    let mut ix = set_native_authority(&f, SignerKind::PermissionedBurn, f.keeper);
    for meta in &mut ix.accounts {
        if meta.pubkey == f.admin {
            meta.pubkey = f.operator;
        }
        if meta.pubkey == role_member(&f.token_manager, RoleType::DefaultAdmin, &f.admin) {
            meta.pubkey = role_member(&f.token_manager, RoleType::DefaultAdmin, &f.operator);
        }
    }
    f.fails(&[ix], 0, ErrorCode::AccountNotInitialized);
    assert_eq!(pb_authority(&f), Some(f.pb_signer()));
}

#[test]
fn default_admin_hands_the_acl_back_to_a_live_key() {
    let f = Fixture::new(Mode::Acl);
    assert_eq!(acl_admin(&f), f.acl_signer());
    f.ok(&[set_native_authority(&f, SignerKind::Acl, f.keeper)]);
    assert_eq!(acl_admin(&f), f.keeper);
    // The Acl signer lost the admin, so TM-signed ACL operations now fail.
    let owner = Pubkey::new_unique();
    let account = f.create_token(owner);
    f.fails(
        &[f.admin_freeze(account, false, f.admin)],
        0,
        token_acl_client::errors::TokenAclError::InvalidAuthority as u32,
    );
}

#[test]
fn default_admin_moves_the_permanent_delegate_off_its_signer() {
    let f = Fixture::new(Mode::PermissionedBurn);
    let pd = signer_address(&f.token_manager, SignerKind::PermanentDelegate).0;
    f.ok(&[token::set_authority(
        &spl_token_2022_interface::ID,
        &f.mint,
        Some(&pd),
        token::AuthorityType::PermanentDelegate,
        &f.admin,
        &[],
    )
    .unwrap()]);
    f.ok(&[set_native_authority(&f, SignerKind::PermanentDelegate, f.keeper)]);
    let account = f.account(&f.mint);
    let mint = StateWithExtensions::<Mint>::unpack(&account.data).unwrap();
    assert_eq!(
        Option::<Pubkey>::from(mint.get_extension::<PermanentDelegate>().unwrap().delegate),
        Some(f.keeper)
    );
}

#[test]
fn acl_handback_requires_the_config_and_acl_program() {
    let f = Fixture::new(Mode::Acl);
    for strip in [0, 1] {
        let mut ix = set_native_authority(&f, SignerKind::Acl, f.keeper);
        let target = if strip == 0 { f.mint_config() } else { token_acl_interface::TOKEN_ACL_ID };
        // Anchor encodes an omitted optional account as the program id placeholder.
        ix.accounts.iter_mut().find(|m| m.pubkey == target).unwrap().pubkey = token_manager::ID;
        f.fails(&[ix], 0, TokenManagerError::MissingAclAccounts);
    }
    assert_eq!(acl_admin(&f), f.acl_signer());
}

fn set_transfer_hook_policy(f: &Fixture, caller: Pubkey, pubkey_policy: Pubkey) -> Instruction {
    use anchor_lang::{InstructionData, ToAccountMetas};
    Instruction {
        program_id: token_manager::ID,
        accounts: token_manager::accounts::SetTransferHookPolicy {
            authority: caller,
            payer: caller,
            token_manager: f.token_manager,
            hook_signer: signer_address(&f.token_manager, SignerKind::TransferHook).0,
            mint: f.mint,
            pubkey_policy,
            extra_account_metas: hook_manifest(f),
            hook_event_authority: event_authority(&pubkey_policy_hook::ID),
            hook_program: pubkey_policy_hook::ID,
            system_program: SYSTEM,
            role_member: role_member(&f.token_manager, RoleType::DefaultAdmin, &caller),
            event_authority: event_authority(&token_manager::ID),
            program: token_manager::ID,
        }
        .to_account_metas(None),
        data: token_manager::instruction::SetTransferHookPolicy {}.data(),
    }
}

fn hook_manifest(f: &Fixture) -> Pubkey {
    spl_transfer_hook_interface::get_extra_account_metas_address(&f.mint, &pubkey_policy_hook::ID)
}

fn binds(f: &Fixture, policy: &Pubkey) -> bool {
    f.account(&hook_manifest(f))
        .data
        .windows(32)
        .any(|bytes| bytes == policy.as_ref())
}

/// With the transfer-hook authority on the root's signer, re-binding the hook's policy (switching
/// screening to another policy, or an Open one) is a DefaultAdmin operation: the former native
/// holder can no longer do it, nor can any other caller, and handing the authority back out
/// returns it to the native holder.
#[test]
fn a_root_held_hook_authority_rebinds_only_through_default_admin() {
    let f = Fixture::new(Mode::Hook);
    let signer = signer_address(&f.token_manager, SignerKind::TransferHook).0;
    let open = pubkey_policy_interface::pubkey_policy_address(&f.mint, &f.keeper).0;
    f.ok(&[
        f.init_policy_ix(f.keeper, pubkey_policy_interface::PubkeyPolicyMode::Open),
        token::set_authority(
            &spl_token_2022_interface::ID,
            &f.mint,
            Some(&signer),
            token::AuthorityType::TransferHookProgramId,
            &f.admin,
            &[],
        )
        .unwrap(),
    ]);
    assert!(binds(&f, &f.policy));

    f.fails(&[f.init_transfer_hook_ix()], 0, pubkey_policy_hook::errors::HookError::Unauthorized);
    f.fails(&[set_transfer_hook_policy(&f, f.keeper, open)], 0, ErrorCode::AccountNotInitialized);
    f.ok(&[set_transfer_hook_policy(&f, f.admin, open)]);
    assert!(binds(&f, &open) && !binds(&f, &f.policy));

    f.ok(&[set_native_authority(&f, SignerKind::TransferHook, f.admin)]);
    f.ok(&[f.init_transfer_hook_ix()]);
    assert!(binds(&f, &f.policy));
}

fn mint_authority(f: &Fixture) -> Option<Pubkey> {
    let account = f.account(&f.mint);
    StateWithExtensions::<Mint>::unpack(&account.data)
        .unwrap()
        .base
        .mint_authority
        .into()
}

/// A mint authority held by a 1-of-n multisig whose members are all program PDAs (say a Console
/// OFT's `oft_store` and this root's Mint signer) has no key to rotate it natively; the root moves
/// it by signing as its member.
fn pda_multisig_mint(f: &Fixture, m: u8) -> Pubkey {
    let mint_signer = signer_address(&f.token_manager, SignerKind::Mint).0;
    let other_pda = Pubkey::new_unique();
    let multisig = f.native_multisig(&[&other_pda, &mint_signer], m);
    f.ok(&[token::set_authority(
        &spl_token_2022_interface::ID,
        &f.mint,
        Some(&multisig),
        token::AuthorityType::MintTokens,
        &f.admin,
        &[],
    )
    .unwrap()]);
    multisig
}

#[test]
fn default_admin_moves_an_authority_held_by_a_1_of_n_multisig() {
    let f = Fixture::new(Mode::Plain);
    let multisig = pda_multisig_mint(&f, 1);
    let next = Pubkey::new_unique();
    f.ok(&[f.set_native_authority_via_ix(SignerKind::Mint, next, Some(multisig))]);
    assert_eq!(mint_authority(&f), Some(next));
}

/// The root's signer is one vote: a multisig needing two cannot be rotated by it alone.
#[test]
fn a_multisig_threshold_above_one_cannot_be_met_by_the_root() {
    let f = Fixture::new(Mode::Plain);
    let multisig = pda_multisig_mint(&f, 2);
    assert_eq!(
        f.run(&[f.set_native_authority_via_ix(SignerKind::Mint, f.keeper, Some(multisig))])
            .program_result,
        TransactionProgramResult::Failure(0, ProgramError::MissingRequiredSignature)
    );
    assert_eq!(mint_authority(&f), Some(multisig));
}

/// Token ACL's config authority is a single key, never a native multisig.
#[test]
fn the_acl_signer_takes_no_multisig() {
    let f = Fixture::new(Mode::Acl);
    let multisig = f.native_multisig(&[&f.acl_signer()], 1);
    f.fails(
        &[f.set_native_authority_via_ix(SignerKind::Acl, f.keeper, Some(multisig))],
        0,
        TokenManagerError::AclMultisigUnsupported,
    );
    assert_eq!(acl_admin(&f), f.acl_signer());
}
