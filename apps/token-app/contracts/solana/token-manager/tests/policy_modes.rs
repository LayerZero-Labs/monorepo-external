//! Consumers read the policy's live mode: ACL permissionless thaw and the hook. The policy
//! program's own write rules are tested in `contracts/common/utils/solana/pubkey-policy`.
#[path = "support/mod.rs"]
mod support;
use pubkey_policy_interface::{Membership, PolicyError, PubkeyPolicyMode};
use solana_pubkey::Pubkey;
use spl_token_2022_interface::state::AccountState;
use support::*;

#[test]
fn acl_modes_keep_memberships_independent_and_missing_whitelist_records_fail_closed() {
    let f = Fixture::new(Mode::Acl);
    let alice = Pubkey::new_unique();
    let bob = Pubkey::new_unique();
    let account = f.create_token(alice);
    let bob_account = f.create_token(bob);
    let both = Membership { blacklisted: true, whitelisted: true };
    f.ok(&f.membership_ixs(alice, both));
    f.fails(&[f.acl(account, alice, false)], 0, PolicyError::Blocked);
    f.ok(&[f.set_mode_ix(PubkeyPolicyMode::Whitelist), f.acl(account, alice, false)]);
    f.fails(&[f.acl(bob_account, bob, false)], 0, PolicyError::Blocked);
    assert!(f.account(&f.record(&bob)).data.is_empty());
    assert_eq!(membership(&f.account(&f.record(&alice)).data).unwrap(), both);

    // Switching back does not sweep or rewrite existing native account states.
    f.ok(&[f.set_mode_ix(PubkeyPolicyMode::Blacklist)]);
    assert_eq!(f.token(&account).state, AccountState::Initialized);
    f.ok(&[f.acl(account, alice, true)]);
    f.fails(&[f.acl(account, alice, false)], 0, PolicyError::Blocked);
    f.ok(&[f.set_mode_ix(PubkeyPolicyMode::Open), f.acl(account, alice, false)]);
    assert_eq!(membership(&f.account(&f.record(&alice)).data).unwrap(), both);
}

#[test]
fn hook_reads_live_mode_on_existing_accounts_with_a_precomputed_plan() {
    let f = Fixture::new(Mode::Hook);
    let alice = Pubkey::new_unique();
    let bob = Pubkey::new_unique();
    let source = f.create_token(alice);
    let destination = f.create_token(bob);
    f.mint_to(source, 10);
    let transfer = f.transfer(source, destination, alice, 1);
    f.ok(std::slice::from_ref(&transfer));
    f.ok(&[f.set_mode_ix(PubkeyPolicyMode::Whitelist)]);
    f.fails(std::slice::from_ref(&transfer), 0, PolicyError::Blocked);
    f.ok(&f.membership_ixs(alice, Membership { blacklisted: true, whitelisted: true }));
    f.ok(&f.membership_ixs(bob, Membership { blacklisted: false, whitelisted: true }));
    f.ok(std::slice::from_ref(&transfer));
    f.ok(&[f.set_mode_ix(PubkeyPolicyMode::Blacklist)]);
    f.fails(std::slice::from_ref(&transfer), 0, PolicyError::Blocked);
    f.ok(&[f.set_mode_ix(PubkeyPolicyMode::Open), transfer]);
    assert_eq!(f.token(&destination).amount, 3);
}
