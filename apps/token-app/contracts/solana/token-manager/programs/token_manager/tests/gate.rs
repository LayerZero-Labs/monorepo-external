//! Direct handler tests of the gate's policy decision. Token ACL's own account checks (flag,
//! manifest resolution, owner, mint config) are covered by the SBF suite.
use anchor_lang::{prelude::*, solana_program::program_pack::Pack};
use pubkey_policy_interface::{
    pubkey_policy_address, subject_address, subject_address_in, Membership, PolicyError,
    PubkeyPolicy, PubkeyPolicyMode, SubjectRecord,
};
use spl_tlv_account_resolution::state::ExtraAccountMetaList;
use spl_token_2022::state::{Account as TokenAccount, AccountState, Mint};
use std::collections::BTreeSet;
use token_acl_interface::{
    instruction::{CanFreezePermissionlessInstruction, CanThawPermissionlessInstruction},
    FLAG_ACCOUNT_SEED, FREEZE_EXTRA_ACCOUNT_METAS_SEED, THAW_EXTRA_ACCOUNT_METAS_SEED,
    TOKEN_ACL_ID,
};
use token_manager::{
    errors::TokenManagerError,
    instructions::acl::gate::{Gate, GateBumps},
    ID,
};
use token_manager_interface::acl::{gate_account_metas, ACL_EXTRA_COUNT};

// Positions in the `Gate` account list.
const TOKEN_ACCOUNT: usize = 1;
const OWNER: usize = 3;
const PUBKEY_POLICY: usize = 6;
const POLICY_PROGRAM: usize = 7;
const RECORD: usize = 8;

struct TestAccount {
    key: Pubkey,
    owner: Pubkey,
    data: Vec<u8>,
    lamports: u64,
}

impl TestAccount {
    fn new(key: Pubkey, owner: Pubkey, data: Vec<u8>) -> Self {
        Self { key, owner, data, lamports: 1_000_000 }
    }
    fn info(&mut self) -> AccountInfo<'_> {
        AccountInfo::new(
            &self.key,
            false,
            false,
            &mut self.lamports,
            &mut self.data,
            &self.owner,
            false,
        )
    }
}

fn run_gate(freeze: bool, mutate: impl FnOnce(&mut [TestAccount])) -> Result<()> {
    let mint = Pubkey::new_unique();
    let owner = Pubkey::new_unique();
    let token = Pubkey::new_unique();
    let policy_key = pubkey_policy_address(&mint, &Pubkey::new_unique()).0;
    let pubkey_policy = PubkeyPolicy {
        mint,
        current_default_admin: Pubkey::new_unique(),
        pending_default_admin: Pubkey::default(),
        mode: PubkeyPolicyMode::Blacklist,
    };
    let mut policy_data = Vec::new();
    pubkey_policy.try_serialize(&mut policy_data).unwrap();
    let mut token_data = vec![0; TokenAccount::LEN];
    TokenAccount::pack(
        TokenAccount { mint, owner, state: AccountState::Frozen, ..Default::default() },
        &mut token_data,
    )
    .unwrap();
    let mut mint_data = vec![0; Mint::LEN];
    Mint::pack(Mint { is_initialized: true, ..Default::default() }, &mut mint_data).unwrap();
    let seed = if freeze { FREEZE_EXTRA_ACCOUNT_METAS_SEED } else { THAW_EXTRA_ACCOUNT_METAS_SEED };
    let mut manifest = vec![0; ExtraAccountMetaList::size_of(ACL_EXTRA_COUNT).unwrap()];
    let metas = gate_account_metas(&policy_key, &pubkey_policy_interface::ID).unwrap();
    if freeze {
        ExtraAccountMetaList::init::<CanFreezePermissionlessInstruction>(&mut manifest, &metas)
            .unwrap();
    } else {
        ExtraAccountMetaList::init::<CanThawPermissionlessInstruction>(&mut manifest, &metas)
            .unwrap();
    }
    let mut record = Vec::new();
    SubjectRecord {
        policy: policy_key,
        subject: owner,
        membership: Membership { blacklisted: freeze, whitelisted: false },
    }
    .try_serialize(&mut record)
    .unwrap();
    let mut accounts = [
        TestAccount::new(Pubkey::new_unique(), System::id(), vec![]),
        TestAccount::new(token, spl_token_2022::ID, token_data),
        TestAccount::new(mint, spl_token_2022::ID, mint_data),
        TestAccount::new(owner, System::id(), vec![]),
        TestAccount::new(
            Pubkey::find_program_address(&[FLAG_ACCOUNT_SEED, token.as_ref()], &TOKEN_ACL_ID).0,
            TOKEN_ACL_ID,
            vec![1],
        ),
        TestAccount::new(Pubkey::find_program_address(&[seed, mint.as_ref()], &ID).0, ID, manifest),
        TestAccount::new(policy_key, pubkey_policy_interface::ID, policy_data),
        TestAccount::new(pubkey_policy_interface::ID, Pubkey::default(), vec![]),
        TestAccount::new(
            subject_address(&policy_key, &owner).0,
            pubkey_policy_interface::ID,
            record,
        ),
    ];
    mutate(&mut accounts);
    let infos: Vec<_> = accounts.iter_mut().map(TestAccount::info).collect();
    let mut remaining = infos.as_slice();
    let mut bumps = GateBumps::default();
    let mut validated =
        Gate::try_accounts(&ID, &mut remaining, &[], &mut bumps, &mut BTreeSet::new())?;
    let context = Context::new(&ID, &mut validated, remaining, bumps);
    if freeze {
        Gate::can_freeze(&context)
    } else {
        Gate::can_thaw(&context)
    }
}

fn assert_error(result: Result<()>, code: impl Into<u32>) {
    let anchor_lang::error::Error::AnchorError(error) = result.unwrap_err() else {
        panic!("expected an Anchor error");
    };
    assert_eq!(error.error_code_number, code.into());
}

#[test]
fn valid_callbacks_reach_both_membership_paths() {
    run_gate(false, |_| {}).unwrap();
    run_gate(true, |_| {}).unwrap();
}

#[test]
fn cross_policy_and_foreign_records_fail_inside_gate() {
    for freeze in [false, true] {
        assert_error(
            run_gate(freeze, |a| {
                a[RECORD].key = subject_address(&Pubkey::new_unique(), &a[OWNER].key).0;
            }),
            PolicyError::WrongRecord,
        );
        assert_error(run_gate(freeze, |a| a[RECORD].owner = System::id()), PolicyError::WrongOwner);
    }
}

/// A manifest written before its policy existed recorded the System Program as the policy
/// program, so Token ACL resolves an empty System record. The gate reads records under the
/// policy's actual owner, so that fails closed instead of reading as "not listed".
#[test]
fn a_manifest_naming_the_wrong_policy_program_fails_closed() {
    for freeze in [false, true] {
        assert_error(
            run_gate(freeze, |a| {
                a[POLICY_PROGRAM].key = System::id();
                a[RECORD].key =
                    subject_address_in(&a[PUBKEY_POLICY].key, &a[OWNER].key, &System::id()).0;
                a[RECORD].owner = System::id();
                a[RECORD].data.clear();
            }),
            PolicyError::WrongRecord,
        );
    }
}

#[test]
fn missing_record_uses_mode_default_after_address_validation() {
    run_gate(false, |a| {
        a[RECORD].owner = System::id();
        a[RECORD].data.clear();
    })
    .unwrap();
    assert_error(
        run_gate(true, |a| {
            a[RECORD].owner = System::id();
            a[RECORD].data.clear();
        }),
        PolicyError::NotBlocked,
    );
}

/// Permissionless ACL only ever moves accounts that hold nothing, in either direction. A
/// balance is the Freezer/Thawer roles' business, so both callbacks refuse it identically.
#[test]
fn a_funded_account_is_out_of_reach_of_both_permissionless_callbacks() {
    fn fund(account: &mut TestAccount) {
        let mut state = TokenAccount::unpack(&account.data).unwrap();
        state.amount = 1;
        TokenAccount::pack(state, &mut account.data).unwrap();
    }
    for freeze in [false, true] {
        assert_error(
            run_gate(freeze, |a| fund(&mut a[TOKEN_ACCOUNT])),
            TokenManagerError::NonEmptyAccount,
        );
    }
}

/// Why permissionless freeze still earns its place: an allowed subject can thaw a new account
/// and be blacklisted afterwards, leaving a usable empty account behind. Anyone may re-seal
/// that frontier. Nothing here decides anything about value — see the funded case above.
#[test]
fn an_account_thawed_before_the_block_can_be_sealed_by_anyone() {
    run_gate(true, |a| {
        let mut state = TokenAccount::unpack(&a[TOKEN_ACCOUNT].data).unwrap();
        state.state = AccountState::Initialized;
        TokenAccount::pack(state, &mut a[TOKEN_ACCOUNT].data).unwrap();
    })
    .unwrap();
}

/// The policy answer is about `token_account_owner`, so the gate itself requires the token account
/// to be that owner's account of this mint rather than relying on its caller to have checked.
#[test]
fn the_token_account_must_be_the_subjects_account_of_this_mint() {
    fn rewrite(account: &mut TestAccount, edit: impl FnOnce(&mut TokenAccount)) {
        let mut state = TokenAccount::unpack(&account.data).unwrap();
        edit(&mut state);
        TokenAccount::pack(state, &mut account.data).unwrap();
    }
    for freeze in [false, true] {
        assert_error(
            run_gate(freeze, |a| {
                rewrite(&mut a[TOKEN_ACCOUNT], |t| t.owner = Pubkey::new_unique())
            }),
            TokenManagerError::InvalidTokenAccount,
        );
        assert_error(
            run_gate(freeze, |a| rewrite(&mut a[TOKEN_ACCOUNT], |t| t.mint = Pubkey::new_unique())),
            TokenManagerError::InvalidTokenAccount,
        );
    }
}

#[test]
fn the_pubkey_policy_must_be_this_mints() {
    for freeze in [false, true] {
        assert_error(
            run_gate(freeze, |a| {
                let data = &mut a[PUBKEY_POLICY].data;
                let mut policy = PubkeyPolicy::try_deserialize(&mut data.as_slice()).unwrap();
                policy.mint = Pubkey::new_unique();
                data.clear();
                policy.try_serialize(data).unwrap();
            }),
            TokenManagerError::WrongPolicyMint,
        );
    }
}
