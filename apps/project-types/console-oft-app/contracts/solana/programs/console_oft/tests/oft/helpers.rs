//! Shared Mollusk fixture for the OFT program tests and the cross-program suite in
//! `tests/integration`.
//!
//! The fixture writes an initialized OFT's accounts directly (store, escrow, default limiter,
//! peer, roles) so each test starts from a visible configuration; `tests/integration` covers
//! `init_console_oft` itself. Instructions are built from Anchor's generated client types, so
//! account order and privileges follow the program's `Accounts` definitions.
#![allow(dead_code)]

use anchor_lang::{
    prelude::borsh, AccountDeserialize, AnchorDeserialize, AnchorSerialize, Discriminator,
    InstructionData, Space, ToAccountMetas,
};
use console_oft::{
    accounts, instruction,
    instructions::{
        GetFeeParams, SetFeeBpsParams, SetPausedParams, SetRateLimitAddressExemptionParams,
        SetRateLimitConfigParams, SetRateLimitGlobalConfigParams, SetRateLimitStateParams,
    },
    seeds::{ESCROW_SEED, FEE_SEED, PAUSE_SEED, RATE_LIMIT_EXEMPTION_SEED, RATE_LIMIT_SEED},
    state::{OFTStore, RateLimit, RateLimitConfig, RateLimitState, RoleType},
    OAppPeer, RoleMember,
};
use mollusk_svm::{Mollusk, MolluskContext};
use mollusk_svm_programs_token::token2022;
use mollusk_svm_result::{types::ProgramResult, Check, InstructionResult};
use oapp::{types::LzReceiveParams, LZ_RECEIVE_TYPES_SEED, OAPP_INFO_SEED, PEER_SEED};
use oft::types::{OftType, QuoteOFTParams};
use rbac::ROLE_MEMBER_SEED;
use solana_account::Account;
use solana_instruction::{AccountMeta, Instruction};
use solana_program_error::ProgramError;
use solana_program_option::COption;
use solana_program_pack::Pack;
use solana_pubkey::Pubkey;
use spl_token_2022::state::{Account as TokenAccount, AccountState, Mint as TokenMint};
use std::{collections::HashMap, sync::Once};

pub const SYSTEM_PROGRAM: Pubkey = Pubkey::new_from_array([0u8; 32]);
pub const DST_EID: u32 = 2;
pub const TOKEN_DECIMALS: u8 = 6;

pub const ALL_ROLES: [RoleType; 7] = [
    RoleType::DefaultAdmin,
    RoleType::FeeConfigManager,
    RoleType::Pauser,
    RoleType::Unpauser,
    RoleType::RateLimiterManager,
    RoleType::MessagingChannelManager,
    RoleType::MessageNilifier,
];

static QUIET_MOLLUSK_LOGS: Once = Once::new();

pub type TestContext = MolluskContext<HashMap<Pubkey, Account>>;

/// A LockUnlock Token-2022 OFT with no fee, pause, redirect or policy configured. `admin` holds
/// every OFT role; `user` holds none.
pub struct OftFixture {
    pub context: TestContext,
    pub payer: Pubkey,
    pub admin: Pubkey,
    pub user: Pubkey,
    pub oft_store: Pubkey,
    pub token_mint: Pubkey,
    pub initializer: Pubkey,
    pub fee_deposit: Pubkey,
    pub oft_escrow: Pubkey,
    pub default_rate_limit: Pubkey,
    pub peer: Pubkey,
}

// ================================ Keys and conversions ================================

pub fn program_id() -> Pubkey {
    host(console_oft::ID)
}

/// Anchor's `Pubkey` and the Mollusk toolchain's `solana_pubkey::Pubkey` are distinct types.
pub fn host(key: anchor_lang::prelude::Pubkey) -> Pubkey {
    Pubkey::new_from_array(key.to_bytes())
}

pub fn to_program_pubkey(key: &Pubkey) -> anchor_lang::prelude::Pubkey {
    anchor_lang::prelude::Pubkey::new_from_array(*key.as_array())
}

pub fn payer_key() -> Pubkey {
    Pubkey::new_from_array([0xAA; 32])
}

pub fn admin_key() -> Pubkey {
    Pubkey::new_from_array([0xAB; 32])
}

pub fn user_key() -> Pubkey {
    Pubkey::new_from_array([0xAC; 32])
}

pub fn initializer_key() -> Pubkey {
    Pubkey::new_from_array([0xB3; 32])
}

pub fn oft_store_key() -> Pubkey {
    Pubkey::find_program_address(&[b"OFT", initializer_key().as_ref()], &program_id()).0
}

pub fn token_mint_key() -> Pubkey {
    Pubkey::new_from_array([0xB2; 32])
}

pub fn fee_deposit_key() -> Pubkey {
    Pubkey::new_from_array([0xB4; 32])
}

// ================================ PDAs ================================

pub fn event_authority_pda() -> Pubkey {
    Pubkey::find_program_address(&[b"__event_authority"], &program_id()).0
}

pub fn oapp_info_pda() -> Pubkey {
    Pubkey::find_program_address(&[OAPP_INFO_SEED], &program_id()).0
}

pub fn lz_receive_types_accounts_pda(oft_store: &Pubkey) -> Pubkey {
    Pubkey::find_program_address(&[LZ_RECEIVE_TYPES_SEED, oft_store.as_ref()], &program_id()).0
}

pub fn role_member_pda(state: &Pubkey, role: RoleType, member: &Pubkey) -> Pubkey {
    Pubkey::find_program_address(
        &[ROLE_MEMBER_SEED, state.as_ref(), &[role as u8], member.as_ref()],
        &program_id(),
    )
    .0
}

pub fn oft_escrow_pda(oft_store: &Pubkey) -> Pubkey {
    Pubkey::find_program_address(&[ESCROW_SEED, oft_store.as_ref()], &program_id()).0
}

pub fn peer_pda(oft_store: &Pubkey, eid: u32) -> (Pubkey, u8) {
    Pubkey::find_program_address(
        &[PEER_SEED, oft_store.as_ref(), &eid.to_be_bytes()],
        &program_id(),
    )
}

pub fn fee_config_pda(oft_store: &Pubkey, id: u128) -> Pubkey {
    Pubkey::find_program_address(&[FEE_SEED, oft_store.as_ref(), &id.to_be_bytes()], &program_id())
        .0
}

pub fn pause_config_pda(oft_store: &Pubkey, id: u128) -> Pubkey {
    Pubkey::find_program_address(
        &[PAUSE_SEED, oft_store.as_ref(), &id.to_be_bytes()],
        &program_id(),
    )
    .0
}

pub fn rate_limit_pda(oft_store: &Pubkey, id: u128) -> Pubkey {
    Pubkey::find_program_address(
        &[RATE_LIMIT_SEED, oft_store.as_ref(), &id.to_be_bytes()],
        &program_id(),
    )
    .0
}

pub fn rate_limit_address_exemption_pda(oft_store: &Pubkey, user: &Pubkey) -> Pubkey {
    Pubkey::find_program_address(
        &[RATE_LIMIT_EXEMPTION_SEED, oft_store.as_ref(), user.as_ref()],
        &program_id(),
    )
    .0
}

// ================================ Mollusk ================================

pub fn mollusk() -> Mollusk {
    QUIET_MOLLUSK_LOGS.call_once(|| {
        if std::env::var_os("RUST_LOG").is_none() {
            std::env::set_var("RUST_LOG", "off");
        }
    });
    let binary = std::path::PathBuf::from(env!("CARGO_MANIFEST_DIR"))
        .ancestors()
        .find(|path| path.join("Cargo.lock").exists())
        .expect("Cargo.lock not found")
        .join("target/test-deploy/console_oft");
    let mut mollusk = Mollusk::new(&program_id(), binary.to_str().unwrap());
    token2022::add_program(&mut mollusk);
    mollusk_svm_programs_token::associated_token::add_program(&mut mollusk);
    mollusk
}

pub fn fixture() -> OftFixture {
    build_fixture(mollusk().with_context(HashMap::new()))
}

/// For tests that seed `last_updated` in the past and observe decay.
pub fn fixture_at(unix_timestamp: i64) -> OftFixture {
    let mut mollusk = mollusk();
    mollusk.sysvars.clock.unix_timestamp = unix_timestamp;
    build_fixture(mollusk.with_context(HashMap::new()))
}

pub fn build_fixture(context: TestContext) -> OftFixture {
    let f = OftFixture {
        context,
        payer: payer_key(),
        admin: admin_key(),
        user: user_key(),
        oft_store: oft_store_key(),
        token_mint: token_mint_key(),
        initializer: initializer_key(),
        fee_deposit: fee_deposit_key(),
        oft_escrow: oft_escrow_pda(&oft_store_key()),
        default_rate_limit: rate_limit_pda(&oft_store_key(), 0),
        peer: peer_pda(&oft_store_key(), DST_EID).0,
    };
    for wallet in [f.payer, f.admin, f.user] {
        f.insert(wallet, Account::new(100_000_000, 0, &SYSTEM_PROGRAM));
    }
    f.insert(f.token_mint, token_mint_account(TOKEN_DECIMALS));
    f.insert(f.fee_deposit, token_account(&f.token_mint, &f.admin, AccountState::Initialized));
    f.insert(f.oft_escrow, token_account(&f.token_mint, &f.oft_store, AccountState::Initialized));
    f.insert(
        f.oft_store,
        oft_store_account(&f.token_mint, &f.initializer, &f.fee_deposit, &f.admin),
    );
    for role in ALL_ROLES {
        f.grant(role, f.admin);
    }
    f.insert(
        f.default_rate_limit,
        program_account(RateLimit {
            config: RateLimitConfig::default(),
            state: Default::default(),
        }),
    );
    let (peer, bump) = peer_pda(&f.oft_store, DST_EID);
    f.insert(peer, program_account(OAppPeer { address: [0x44; 32], bump }));
    f
}

impl OftFixture {
    pub fn insert(&self, key: Pubkey, account: Account) {
        self.context.account_store.borrow_mut().insert(key, account);
    }

    pub fn account(&self, key: &Pubkey) -> Option<Account> {
        self.context.account_store.borrow().get(key).cloned()
    }

    /// Absent, or closed by the program in this context.
    pub fn is_closed(&self, key: &Pubkey) -> bool {
        self.account(key)
            .is_none_or(|account| account.lamports == 0 && account.data.is_empty())
    }

    pub fn grant(&self, role: RoleType, member: Pubkey) {
        let key = role_member_pda(&self.oft_store, role, &member);
        let bump = Pubkey::find_program_address(
            &[ROLE_MEMBER_SEED, self.oft_store.as_ref(), &[role as u8], member.as_ref()],
            &program_id(),
        )
        .1;
        self.insert(
            key,
            program_account(RoleMember {
                state: to_program_pubkey(&self.oft_store),
                role,
                account: to_program_pubkey(&member),
                bump,
            }),
        );
    }

    /// Read-modify-write the store, for configuration a test does not exercise itself.
    pub fn update_store(&self, update: impl FnOnce(&mut OFTStore)) {
        let mut store: OFTStore = read_account(&self.context, &self.oft_store);
        update(&mut store);
        let mut accounts = self.context.account_store.borrow_mut();
        let data = &mut accounts.get_mut(&self.oft_store).unwrap().data;
        anchor_lang::AccountSerialize::try_serialize(&store, &mut data.as_mut_slice()).unwrap();
    }

    pub fn store(&self) -> OFTStore {
        read_account(&self.context, &self.oft_store)
    }

    /// Process `ix` and require success.
    pub fn ok(&self, ix: &Instruction) -> InstructionResult {
        self.context.process_and_validate_instruction(ix, &[Check::success()])
    }

    /// Process `ix`, require success, and decode its return data.
    pub fn view<T: AnchorDeserialize>(&self, ix: &Instruction) -> T {
        decode_return(&self.ok(ix).return_data)
    }

    pub fn fails(&self, ix: &Instruction) -> ProgramResult {
        let result = self.context.process_instruction(ix);
        assert!(result.program_result.is_err(), "expected failure");
        result.program_result
    }
}

// ================================ Accounts ================================

pub fn program_account<T: AnchorSerialize + Discriminator + Space>(value: T) -> Account {
    let mut data = T::DISCRIMINATOR.to_vec();
    data.extend(borsh::to_vec(&value).unwrap());
    // Match on-chain init space so Option fields can grow in place.
    data.resize(data.len().max(8 + T::INIT_SPACE), 0);
    Account { lamports: 10_000_000, data, owner: program_id(), executable: false, rent_epoch: 0 }
}

pub fn token_mint_account(decimals: u8) -> Account {
    let mut data = vec![0u8; TokenMint::LEN];
    TokenMint::pack(
        TokenMint {
            mint_authority: COption::Some(admin_key()),
            supply: 1_000_000,
            decimals,
            is_initialized: true,
            freeze_authority: COption::None,
        },
        &mut data,
    )
    .unwrap();
    Account { lamports: 10_000_000, data, owner: token2022::ID, executable: false, rent_epoch: 0 }
}

pub fn token_account(mint: &Pubkey, owner: &Pubkey, state: AccountState) -> Account {
    let mut data = vec![0u8; TokenAccount::LEN];
    TokenAccount::pack(
        TokenAccount {
            mint: *mint,
            owner: *owner,
            amount: 0,
            delegate: COption::None,
            state,
            is_native: COption::None,
            delegated_amount: 0,
            close_authority: COption::None,
        },
        &mut data,
    )
    .unwrap();
    Account { lamports: 10_000_000, data, owner: token2022::ID, executable: false, rent_epoch: 0 }
}

pub fn oft_store_account(
    token_mint: &Pubkey,
    initializer: &Pubkey,
    fee_deposit: &Pubkey,
    default_admin: &Pubkey,
) -> Account {
    program_account(OFTStore {
        oft_type: OftType::LockUnlock,
        ld2sd_rate: 1,
        shared_decimals: TOKEN_DECIMALS,
        token_mint: to_program_pubkey(token_mint),
        initializer: to_program_pubkey(initializer),
        token_program: to_program_pubkey(&token2022::ID),
        bump: Pubkey::find_program_address(&[b"OFT", initializer.as_ref()], &program_id()).1,
        transfer_hook_program: Default::default(),
        acl_gating_program: Default::default(),
        current_default_admin: to_program_pubkey(default_admin),
        pending_default_admin: Default::default(),
        default_paused: false,
        default_fee_bps: 0,
        fee_deposit: to_program_pubkey(fee_deposit),
        use_global_state: false,
        is_globally_disabled: false,
        credit_redirect_config: None,
        pubkey_policy: None,
        token_manager: None,
    })
}

pub fn read_account<T: AccountDeserialize>(context: &TestContext, key: &Pubkey) -> T {
    let store = context.account_store.borrow();
    let account = store.get(key).expect("account missing from store");
    T::try_deserialize(&mut account.data.as_slice()).expect("failed to deserialize account")
}

// ================================ Results ================================

pub fn program_failure(error: impl Into<u32>) -> ProgramResult {
    ProgramResult::Failure(ProgramError::Custom(error.into()))
}

pub fn decode_return<T: AnchorDeserialize>(data: &[u8]) -> T {
    T::try_from_slice(data).expect("decode return data")
}

/// Assert that an `__event_cpi` inner instruction's data decodes to `expected`.
/// Layout: `[__event_cpi discriminator (8)][event discriminator (8)][borsh fields]`.
pub fn assert_event<T: AnchorSerialize + Discriminator>(data: &[u8], expected: T) {
    assert_eq!(&data[8..16], T::DISCRIMINATOR, "event discriminator mismatch");
    assert_eq!(&data[16..], borsh::to_vec(&expected).unwrap().as_slice(), "event payload mismatch");
}

/// The single event an admin instruction emits.
pub fn assert_only_event<T: AnchorSerialize + Discriminator>(
    result: &InstructionResult,
    expected: T,
) {
    let events: Vec<_> = result
        .inner_instructions
        .iter()
        .filter(|inner| {
            inner.instruction.data.get(..8) == Some(anchor_lang::event::EVENT_IX_TAG_LE)
        })
        .collect();
    assert_eq!(events.len(), 1, "expected exactly one event");
    assert_event(&events[0].instruction.data, expected);
}

/// An instruction that changed nothing: it emitted no event.
pub fn assert_no_events(result: &InstructionResult) {
    assert!(
        !result.inner_instructions.iter().any(|inner| {
            inner.instruction.data.get(..8) == Some(anchor_lang::event::EVENT_IX_TAG_LE)
        }),
        "expected no events"
    );
}

// ================================ Instructions ================================

/// An instruction from Anchor's generated client types for `program`.
pub fn instruction(
    program: anchor_lang::prelude::Pubkey,
    accounts: impl ToAccountMetas,
    data: impl InstructionData,
) -> Instruction {
    Instruction {
        program_id: host(program),
        accounts: accounts
            .to_account_metas(None)
            .into_iter()
            .map(|meta| AccountMeta {
                pubkey: host(meta.pubkey),
                is_signer: meta.is_signer,
                is_writable: meta.is_writable,
            })
            .collect(),
        data: data.data(),
    }
}

pub fn oft_ix(accounts: impl ToAccountMetas, data: impl InstructionData) -> Instruction {
    instruction(console_oft::ID, accounts, data)
}

fn k(key: &Pubkey) -> anchor_lang::prelude::Pubkey {
    to_program_pubkey(key)
}

fn member(f: &OftFixture, role: RoleType, authority: Pubkey) -> anchor_lang::prelude::Pubkey {
    k(&role_member_pda(&f.oft_store, role, &authority))
}

fn event_authority() -> anchor_lang::prelude::Pubkey {
    k(&event_authority_pda())
}

// Role-gated administration. Each builder names the role member PDA for the role the instruction
// requires; pause's role follows the requested direction, so the caller names it.

pub fn set_default_fee_bps_ix(f: &OftFixture, authority: Pubkey, fee_bps: u16) -> Instruction {
    oft_ix(
        accounts::SetDefaultFeeBps {
            authority: k(&authority),
            oft_store: k(&f.oft_store),
            role_member: member(f, RoleType::FeeConfigManager, authority),
            event_authority: event_authority(),
            program: console_oft::ID,
        },
        instruction::SetDefaultFeeBps { fee_bps },
    )
}

pub fn set_fee_bps_ix(
    f: &OftFixture,
    authority: Pubkey,
    id: u128,
    fee_bps: Option<u16>,
) -> Instruction {
    oft_ix(
        accounts::SetFeeBps {
            authority: k(&authority),
            payer: k(&f.payer),
            oft_store: k(&f.oft_store),
            fee_config: k(&fee_config_pda(&f.oft_store, id)),
            system_program: Default::default(),
            role_member: member(f, RoleType::FeeConfigManager, authority),
            event_authority: event_authority(),
            program: console_oft::ID,
        },
        instruction::SetFeeBps { params: SetFeeBpsParams { id, fee_bps } },
    )
}

pub fn set_fee_deposit_ix(f: &OftFixture, authority: Pubkey, fee_deposit: Pubkey) -> Instruction {
    oft_ix(
        accounts::SetFeeDeposit {
            authority: k(&authority),
            oft_store: k(&f.oft_store),
            fee_deposit: k(&fee_deposit),
            role_member: member(f, RoleType::DefaultAdmin, authority),
            event_authority: event_authority(),
            program: console_oft::ID,
        },
        instruction::SetFeeDeposit { fee_deposit: k(&fee_deposit) },
    )
}

pub fn set_default_paused_ix(
    f: &OftFixture,
    authority: Pubkey,
    role: RoleType,
    paused: bool,
) -> Instruction {
    oft_ix(
        accounts::SetDefaultPaused {
            authority: k(&authority),
            oft_store: k(&f.oft_store),
            role_member: member(f, role, authority),
            event_authority: event_authority(),
            program: console_oft::ID,
        },
        instruction::SetDefaultPaused { paused },
    )
}

pub fn set_paused_ix(
    f: &OftFixture,
    authority: Pubkey,
    role: RoleType,
    id: u128,
    paused: Option<bool>,
) -> Instruction {
    oft_ix(
        accounts::SetPaused {
            authority: k(&authority),
            payer: k(&f.payer),
            oft_store: k(&f.oft_store),
            pause_config: k(&pause_config_pda(&f.oft_store, id)),
            system_program: Default::default(),
            role_member: member(f, role, authority),
            event_authority: event_authority(),
            program: console_oft::ID,
        },
        instruction::SetPaused { params: SetPausedParams { id, paused } },
    )
}

pub fn set_rate_limit_global_config_ix(
    f: &OftFixture,
    authority: Pubkey,
    use_global_state: bool,
    is_globally_disabled: bool,
) -> Instruction {
    oft_ix(
        accounts::SetRateLimitGlobalConfig {
            authority: k(&authority),
            oft_store: k(&f.oft_store),
            role_member: member(f, RoleType::RateLimiterManager, authority),
            event_authority: event_authority(),
            program: console_oft::ID,
        },
        instruction::SetRateLimitGlobalConfig {
            params: SetRateLimitGlobalConfigParams { use_global_state, is_globally_disabled },
        },
    )
}

pub fn set_rate_limit_config_ix(
    f: &OftFixture,
    authority: Pubkey,
    id: u128,
    config: RateLimitConfig,
) -> Instruction {
    oft_ix(
        accounts::SetRateLimitConfig {
            authority: k(&authority),
            payer: k(&f.payer),
            oft_store: k(&f.oft_store),
            rate_limit: k(&rate_limit_pda(&f.oft_store, id)),
            system_program: Default::default(),
            role_member: member(f, RoleType::RateLimiterManager, authority),
            event_authority: event_authority(),
            program: console_oft::ID,
        },
        instruction::SetRateLimitConfig { params: SetRateLimitConfigParams { id, config } },
    )
}

pub fn set_rate_limit_state_ix(
    f: &OftFixture,
    authority: Pubkey,
    id: u128,
    state: RateLimitState,
) -> Instruction {
    oft_ix(
        accounts::SetRateLimitState {
            authority: k(&authority),
            payer: k(&f.payer),
            oft_store: k(&f.oft_store),
            rate_limit: k(&rate_limit_pda(&f.oft_store, id)),
            system_program: Default::default(),
            role_member: member(f, RoleType::RateLimiterManager, authority),
            event_authority: event_authority(),
            program: console_oft::ID,
        },
        instruction::SetRateLimitState { params: SetRateLimitStateParams { id, state } },
    )
}

pub fn set_rate_limit_address_exemption_ix(
    f: &OftFixture,
    authority: Pubkey,
    user: Pubkey,
    is_exempt: bool,
) -> Instruction {
    oft_ix(
        accounts::SetRateLimitAddressExemption {
            authority: k(&authority),
            payer: k(&f.payer),
            oft_store: k(&f.oft_store),
            exemption: k(&rate_limit_address_exemption_pda(&f.oft_store, &user)),
            system_program: Default::default(),
            role_member: member(f, RoleType::RateLimiterManager, authority),
            event_authority: event_authority(),
            program: console_oft::ID,
        },
        instruction::SetRateLimitAddressExemption {
            params: SetRateLimitAddressExemptionParams { user: k(&user), is_exempt },
        },
    )
}

pub fn checkpoint_rate_limit_ix(f: &OftFixture, authority: Pubkey, id: u128) -> Instruction {
    oft_ix(
        accounts::CheckpointRateLimit {
            authority: k(&authority),
            oft_store: k(&f.oft_store),
            default_rate_limit: k(&f.default_rate_limit),
            rate_limit: k(&rate_limit_pda(&f.oft_store, id)),
            role_member: member(f, RoleType::RateLimiterManager, authority),
        },
        instruction::CheckpointRateLimit { id },
    )
}

/// `None` disables redirect.
pub fn set_credit_redirect_config_ix(
    f: &OftFixture,
    authority: Pubkey,
    redirect_escrow: Option<Pubkey>,
) -> Instruction {
    oft_ix(
        accounts::SetCreditRedirectConfig {
            authority: k(&authority),
            oft_store: k(&f.oft_store),
            token_mint: k(&f.token_mint),
            redirect_escrow: redirect_escrow.as_ref().map(k),
            role_member: member(f, RoleType::DefaultAdmin, authority),
            event_authority: event_authority(),
            program: console_oft::ID,
        },
        instruction::SetCreditRedirectConfig {},
    )
}

/// Accept `root` as the OFT's TokenManager (or clear it).
pub fn set_token_manager_ix(
    f: &OftFixture,
    authority: Pubkey,
    root: Option<Pubkey>,
) -> Instruction {
    oft_ix(
        accounts::SetTokenManager {
            authority: k(&authority),
            oft_store: k(&f.oft_store),
            token_manager: root.as_ref().map(k),
            role_member: member(f, RoleType::DefaultAdmin, authority),
            event_authority: event_authority(),
            program: console_oft::ID,
        },
        instruction::SetTokenManager {},
    )
}

/// Select `policy` (or clear the selection) on a mint that has neither ACL nor a hook.
pub fn set_pubkey_policy_ix(
    f: &OftFixture,
    authority: Pubkey,
    policy: Option<Pubkey>,
) -> Instruction {
    oft_ix(
        accounts::SetPubkeyPolicy {
            authority: k(&authority),
            oft_store: k(&f.oft_store),
            pubkey_policy: policy.as_ref().map(k),
            role_member: member(f, RoleType::DefaultAdmin, authority),
            event_authority: event_authority(),
            program: console_oft::ID,
        },
        instruction::SetPubkeyPolicy {},
    )
}

// Views.

pub fn get_fee_ix(f: &OftFixture, id: u128, amount: u64) -> Instruction {
    oft_ix(
        accounts::FeeConfigView {
            oft_store: k(&f.oft_store),
            fee_config: k(&fee_config_pda(&f.oft_store, id)),
        },
        instruction::GetFee { params: GetFeeParams { id, amount } },
    )
}

pub fn is_paused_ix(f: &OftFixture, id: u128) -> Instruction {
    oft_ix(
        accounts::PauseConfigView {
            oft_store: k(&f.oft_store),
            pause_config: k(&pause_config_pda(&f.oft_store, id)),
        },
        instruction::IsPaused { id },
    )
}

pub fn rate_limits_ix(f: &OftFixture, id: u128) -> Instruction {
    oft_ix(
        accounts::RateLimits {
            oft_store: k(&f.oft_store),
            rate_limit: k(&rate_limit_pda(&f.oft_store, id)),
        },
        instruction::RateLimits { id },
    )
}

pub fn get_rate_limit_usages_ix(f: &OftFixture, id: u128) -> Instruction {
    oft_ix(
        accounts::GetRateLimitUsages {
            oft_store: k(&f.oft_store),
            default_rate_limit: k(&f.default_rate_limit),
            rate_limit: k(&rate_limit_pda(&f.oft_store, id)),
        },
        instruction::GetRateLimitUsages { id },
    )
}

pub fn is_rate_limit_address_exempt_ix(f: &OftFixture, user: Pubkey) -> Instruction {
    oft_ix(
        accounts::IsRateLimitAddressExempt {
            oft_store: k(&f.oft_store),
            exemption: k(&rate_limit_address_exemption_pda(&f.oft_store, &user)),
        },
        instruction::IsRateLimitAddressExempt { user: k(&user) },
    )
}

pub fn quote_oft_ix(f: &OftFixture, amount_ld: u64, min_amount_ld: u64) -> Instruction {
    let id = u128::from(DST_EID);
    oft_ix(
        accounts::QuoteOFT {
            oft_store: k(&f.oft_store),
            pause_config: k(&pause_config_pda(&f.oft_store, id)),
            fee_config: k(&fee_config_pda(&f.oft_store, id)),
            default_rate_limit: k(&f.default_rate_limit),
            rate_limit: k(&rate_limit_pda(&f.oft_store, id)),
        },
        instruction::QuoteOft {
            params: QuoteOFTParams {
                dst_eid: DST_EID,
                to: [0x55; 32],
                amount_ld,
                min_amount_ld,
                extra_options: vec![],
                compose_msg: None,
                pay_in_lz_token: false,
            },
        },
    )
}

pub fn lz_receive_types_info_ix(f: &OftFixture, params: LzReceiveParams) -> Instruction {
    oft_ix(
        accounts::LzReceiveTypesInfo {
            oft_store: k(&f.oft_store),
            lz_receive_types_accounts: k(&lz_receive_types_accounts_pda(&f.oft_store)),
        },
        instruction::LzReceiveTypesInfo { params },
    )
}

// ================================ Receive plan scratch ================================

/// What the SDK allocates on its first simulation. Any V1-legal plan fits inside it.
pub const PLAN_SCRATCH_BYTES: usize = 4096;

/// Stands in for the throwaway key a client generates; fixed so tests can look the plan up.
pub fn plan_scratch() -> Pubkey {
    Pubkey::new_from_array([0x9e; 32])
}

/// Seed the store with what the client's top-level `create_account` would have left behind.
pub fn planner_output_sized(f: &OftFixture, space: usize) -> Pubkey {
    f.insert(plan_scratch(), scratch_account(program_id(), space));
    plan_scratch()
}

pub fn planner_output(f: &OftFixture) -> Pubkey {
    planner_output_sized(f, PLAN_SCRATCH_BYTES)
}

pub fn scratch_account(owner: Pubkey, space: usize) -> Account {
    Account { lamports: 1_000_000, data: vec![0; space], owner, ..Account::default() }
}

/// Read the plan as a prefix: the account is the caller's size, not the plan's.
pub fn decode_plan<T: AnchorDeserialize>(result: &InstructionResult, scratch: &Pubkey) -> T {
    let required: u32 = decode_return(&result.return_data);
    let account = &result.resulting_accounts.iter().find(|(k, _)| k == scratch).unwrap().1;
    assert_eq!(account.owner, program_id());
    T::try_from_slice(&account.data[..required as usize]).unwrap()
}
