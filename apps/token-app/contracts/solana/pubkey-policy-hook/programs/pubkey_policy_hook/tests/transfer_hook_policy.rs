//! Handler-level policy tests, including Anchor account validation. These do not
//! replace runtime tests of Token-2022 authority checks or transaction rollback.

use anchor_lang::{prelude::*, solana_program::program_option::COption};
use pubkey_policy_hook::{
    account_metas,
    errors::HookError,
    instructions::transfer_hook::{TransferHook, TransferHookBumps, TransferHookParams},
    EXTRA_COUNT, EXTRA_METAS_SEED, ID,
};
use pubkey_policy_interface::{
    pubkey_policy_address, subject_address, Membership, PolicyError, PubkeyPolicy,
    PubkeyPolicyMode, SubjectRecord,
};
use spl_tlv_account_resolution::state::ExtraAccountMetaList;
use spl_token_2022::{
    extension::{
        permanent_delegate::PermanentDelegate,
        transfer_hook::{TransferHook as HookExtension, TransferHookAccount},
        BaseStateWithExtensionsMut, ExtensionType, StateWithExtensionsMut,
    },
    state::{Account as AccountState, Mint as MintState},
};
use spl_transfer_hook_interface::instruction::ExecuteInstruction;
use std::collections::BTreeSet;

// Positions in the Execute account list (see `account_metas`).
const PUBKEY_POLICY: usize = 5;
const POLICY_PROGRAM: usize = 6;
const SOURCE_RECORD: usize = 7;
const DESTINATION_RECORD: usize = 8;
const AUTHORITY_RECORD: usize = 9;

struct TestAccount {
    key: Pubkey,
    owner: Pubkey,
    data: Vec<u8>,
    lamports: u64,
    executable: bool,
}

impl TestAccount {
    fn new(key: Pubkey, owner: Pubkey, data: Vec<u8>) -> Self {
        Self { key, owner, data, lamports: 1_000_000, executable: false }
    }

    fn info(&mut self) -> AccountInfo<'_> {
        AccountInfo::new(
            &self.key,
            false,
            false,
            &mut self.lamports,
            &mut self.data,
            &self.owner,
            self.executable,
        )
    }
}

fn record(policy: &Pubkey, subject: &Pubkey, blocked: bool) -> TestAccount {
    let mut data = Vec::new();
    SubjectRecord {
        policy: *policy,
        subject: *subject,
        membership: Membership { blacklisted: blocked, whitelisted: false },
    }
    .try_serialize(&mut data)
    .unwrap();
    TestAccount::new(subject_address(policy, subject).0, pubkey_policy_interface::ID, data)
}

fn token_data(
    mint: Pubkey,
    owner: Pubkey,
    delegate: Option<Pubkey>,
    transferring: bool,
) -> Vec<u8> {
    let mut data = vec![
        0;
        ExtensionType::try_calculate_account_len::<AccountState>(&[
            ExtensionType::TransferHookAccount
        ],)
        .unwrap()
    ];
    let mut state =
        StateWithExtensionsMut::<AccountState>::unpack_uninitialized(&mut data).unwrap();
    state.base = AccountState {
        mint,
        owner,
        amount: 100,
        delegate: delegate.into(),
        state: spl_token_2022::state::AccountState::Initialized,
        is_native: COption::None,
        delegated_amount: if delegate.is_some() { 100 } else { 0 },
        close_authority: COption::None,
    };
    state.init_extension::<TransferHookAccount>(false).unwrap().transferring = transferring.into();
    state.init_account_type().unwrap();
    state.pack_base();
    data
}

/// When Some(true), the authority is the PD but is deliberately neither owner
/// nor approved delegate. Some(false) configures a different PD. None omits PD.
fn run_hook(
    source_blocked: bool,
    destination_blocked: bool,
    authority_blocked: bool,
    authority_is_pd: Option<bool>,
    transferring: [bool; 2],
    manifest_binds_other_policy: bool,
) -> Result<()> {
    run_hook_with_accounts(
        source_blocked,
        destination_blocked,
        authority_blocked,
        authority_is_pd,
        transferring,
        manifest_binds_other_policy,
        |_| {},
    )
}

fn run_hook_with_accounts(
    source_blocked: bool,
    destination_blocked: bool,
    authority_blocked: bool,
    authority_is_pd: Option<bool>,
    transferring: [bool; 2],
    manifest_binds_other_policy: bool,
    mutate: impl FnOnce(&mut [TestAccount]),
) -> Result<()> {
    let mint = Pubkey::new_unique();
    let admin = Pubkey::new_unique();
    let authority = Pubkey::new_unique();
    let source_owner = Pubkey::new_unique();
    let destination_owner = Pubkey::new_unique();
    let policy_key = pubkey_policy_address(&mint, &admin).0;
    let policy = PubkeyPolicy {
        mint,
        current_default_admin: admin,
        pending_default_admin: Pubkey::default(),
        mode: PubkeyPolicyMode::Blacklist,
    };
    let mut policy_data = Vec::new();
    policy.try_serialize(&mut policy_data).unwrap();

    let mut extensions = vec![ExtensionType::TransferHook];
    if authority_is_pd.is_some() {
        extensions.push(ExtensionType::PermanentDelegate);
    }
    let mut mint_data =
        vec![0; ExtensionType::try_calculate_account_len::<MintState>(&extensions).unwrap()];
    let mut mint_state =
        StateWithExtensionsMut::<MintState>::unpack_uninitialized(&mut mint_data).unwrap();
    mint_state.base.is_initialized = true;
    mint_state.base.decimals = 9;
    mint_state.init_extension::<HookExtension>(false).unwrap().program_id =
        Some(ID).try_into().unwrap();
    if let Some(is_pd) = authority_is_pd {
        let pd = if is_pd { authority } else { Pubkey::new_unique() };
        mint_state.init_extension::<PermanentDelegate>(false).unwrap().delegate =
            Some(pd).try_into().unwrap();
    }
    mint_state.init_account_type().unwrap();
    mint_state.pack_base();

    let manifest_key = Pubkey::find_program_address(&[EXTRA_METAS_SEED, mint.as_ref()], &ID).0;
    let mut manifest_data = vec![0; ExtraAccountMetaList::size_of(EXTRA_COUNT).unwrap()];
    ExtraAccountMetaList::init::<ExecuteInstruction>(
        &mut manifest_data,
        &account_metas(
            &if manifest_binds_other_policy {
                pubkey_policy_address(&mint, &Pubkey::new_unique()).0
            } else {
                policy_key
            },
            &pubkey_policy_interface::ID,
        )
        .unwrap(),
    )
    .unwrap();
    let source_delegate = (authority_is_pd != Some(true)).then_some(authority);
    let mut accounts = [
        TestAccount::new(
            Pubkey::new_unique(),
            spl_token_2022::ID,
            token_data(mint, source_owner, source_delegate, transferring[0]),
        ),
        TestAccount::new(mint, spl_token_2022::ID, mint_data),
        TestAccount::new(
            Pubkey::new_unique(),
            spl_token_2022::ID,
            token_data(mint, destination_owner, None, transferring[1]),
        ),
        TestAccount::new(authority, System::id(), vec![]),
        TestAccount::new(manifest_key, ID, manifest_data),
        TestAccount::new(policy_key, pubkey_policy_interface::ID, policy_data),
        TestAccount {
            executable: true,
            ..TestAccount::new(
                pubkey_policy_interface::ID,
                anchor_lang::solana_program::bpf_loader_upgradeable::ID,
                vec![],
            )
        },
        record(&policy_key, &source_owner, source_blocked),
        record(&policy_key, &destination_owner, destination_blocked),
        record(&policy_key, &authority, authority_blocked),
    ];
    mutate(&mut accounts);
    let infos: Vec<_> = accounts.iter_mut().map(TestAccount::info).collect();
    let mut remaining = infos.as_slice();
    let mut bumps = TransferHookBumps::default();
    let mut validated =
        TransferHook::try_accounts(&ID, &mut remaining, &[], &mut bumps, &mut BTreeSet::new())?;
    let context = Context::new(&ID, &mut validated, remaining, bumps);
    TransferHook::apply(&context, &TransferHookParams { amount: 1 })
}

fn assert_error(result: Result<()>, code: impl Into<u32>) {
    let anchor_lang::error::Error::AnchorError(error) = result.unwrap_err() else {
        panic!("expected an Anchor error");
    };
    assert_eq!(error.error_code_number, code.into());
}

/// The mint's actual permanent delegate is exempt from every check; anyone else is checked on
/// source, destination and authority.
#[test]
fn actual_pd_is_exempt_and_everyone_else_is_fully_checked() {
    for is_pd in [None, Some(false), Some(true)] {
        for source in [false, true] {
            for destination in [false, true] {
                for authority in [false, true] {
                    let result =
                        run_hook(source, destination, authority, is_pd, [true, true], false);
                    let allowed = is_pd == Some(true) || (!source && !destination && !authority);
                    if allowed {
                        result.unwrap();
                    } else {
                        assert_error(result, PolicyError::Blocked);
                    }
                }
            }
        }
    }
}

#[test]
fn typed_policy_and_subject_record_boundaries_remain_enforced() {
    use anchor_lang::error::ErrorCode;
    type Substitute = fn(&mut [TestAccount]);
    let substitutions: [(Substitute, u32); 5] = [
        (|a| a[PUBKEY_POLICY].data[..8].fill(0), ErrorCode::AccountDiscriminatorMismatch.into()),
        // The policy's mint follows its discriminator.
        (|a| a[PUBKEY_POLICY].data[8..40].fill(7), HookError::WrongPolicyMint.into()),
        (|a| a[SOURCE_RECORD].key = Pubkey::new_unique(), PolicyError::WrongRecord.into()),
        (|a| a[DESTINATION_RECORD].key = Pubkey::new_unique(), PolicyError::WrongRecord.into()),
        (|a| a[AUTHORITY_RECORD].key = Pubkey::new_unique(), PolicyError::WrongRecord.into()),
    ];
    for (substitute, code) in substitutions {
        assert_error(
            run_hook_with_accounts(false, false, false, None, [true, true], false, substitute),
            code,
        );
    }
}

#[test]
fn policy_program_key_is_a_pda_namespace_not_an_invocation_target() {
    run_hook_with_accounts(false, false, false, None, [true, true], false, |accounts| {
        accounts[POLICY_PROGRAM].executable = false;
    })
    .unwrap();
}
