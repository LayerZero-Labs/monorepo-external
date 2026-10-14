//! Each role-gated administrative instruction requires its own role: a signer holding every
//! other OFT role — DefaultAdmin included — is rejected without changing state, and granting the
//! required role alone admits it.
//!
//! Messaging-channel operations need a live Endpoint: `tests/integration` covers clear and nilify.
//! Skip and burn share clear's role gate and are not separately tested.
mod oft;

use anchor_lang::error::ErrorCode;
use console_oft::state::{RateLimitConfig, RateLimitState, RoleType};
use oft::helpers::*;
use solana_account::Account;
use solana_instruction::Instruction;
use solana_pubkey::Pubkey;

struct Case {
    name: &'static str,
    role: RoleType,
    prepare: fn(&OftFixture),
    build: fn(&OftFixture, Pubkey) -> Instruction,
}

fn nothing(_: &OftFixture) {}

fn default_paused(f: &OftFixture) {
    f.update_store(|store| store.default_paused = true);
}

const ID: u128 = DST_EID as u128;

fn cases() -> [Case; 16] {
    use RoleType::*;
    [
        Case {
            name: "set_default_fee_bps",
            role: FeeConfigManager,
            prepare: nothing,
            build: |f, who| set_default_fee_bps_ix(f, who, 25),
        },
        Case {
            name: "set_fee_bps",
            role: FeeConfigManager,
            prepare: nothing,
            build: |f, who| set_fee_bps_ix(f, who, ID, Some(25)),
        },
        Case {
            name: "set_fee_deposit",
            role: DefaultAdmin,
            prepare: nothing,
            build: |f, who| set_fee_deposit_ix(f, who, f.fee_deposit),
        },
        Case {
            name: "set_credit_redirect_config",
            role: DefaultAdmin,
            prepare: nothing,
            build: |f, who| set_credit_redirect_config_ix(f, who, None),
        },
        Case {
            name: "set_pubkey_policy",
            role: DefaultAdmin,
            prepare: nothing,
            build: |f, who| set_pubkey_policy_ix(f, who, None),
        },
        // Pause roles follow the effective direction, EVM `PauseByIDRBACUpgradeable`.
        Case {
            name: "set_default_paused(true)",
            role: Pauser,
            prepare: nothing,
            build: |f, who| set_default_paused_ix(f, who, Pauser, true),
        },
        Case {
            name: "set_default_paused(false)",
            role: Unpauser,
            prepare: default_paused,
            build: |f, who| set_default_paused_ix(f, who, Unpauser, false),
        },
        Case {
            name: "set_paused(Some(true))",
            role: Pauser,
            prepare: nothing,
            build: |f, who| set_paused_ix(f, who, Pauser, ID, Some(true)),
        },
        Case {
            name: "set_paused(Some(false))",
            role: Unpauser,
            prepare: default_paused,
            build: |f, who| set_paused_ix(f, who, Unpauser, ID, Some(false)),
        },
        Case {
            name: "set_paused(None) while unpaused by default",
            role: Unpauser,
            prepare: nothing,
            build: |f, who| set_paused_ix(f, who, Unpauser, ID, None),
        },
        Case {
            name: "set_paused(None) while paused by default",
            role: Pauser,
            prepare: default_paused,
            build: |f, who| set_paused_ix(f, who, Pauser, ID, None),
        },
        Case {
            name: "set_rate_limit_global_config",
            role: RateLimiterManager,
            prepare: nothing,
            build: |f, who| set_rate_limit_global_config_ix(f, who, true, false),
        },
        Case {
            name: "set_rate_limit_config",
            role: RateLimiterManager,
            prepare: nothing,
            build: |f, who| set_rate_limit_config_ix(f, who, ID, RateLimitConfig::default()),
        },
        Case {
            name: "set_rate_limit_state",
            role: RateLimiterManager,
            prepare: nothing,
            build: |f, who| set_rate_limit_state_ix(f, who, ID, RateLimitState::default()),
        },
        Case {
            name: "set_rate_limit_address_exemption",
            role: RateLimiterManager,
            prepare: nothing,
            build: |f, who| set_rate_limit_address_exemption_ix(f, who, f.payer, true),
        },
        Case {
            name: "checkpoint_rate_limit",
            role: RateLimiterManager,
            prepare: nothing,
            build: |f, who| checkpoint_rate_limit_ix(f, who, 0),
        },
    ]
}

#[test]
fn admin_instructions_require_their_own_role_and_no_other() {
    for Case { name, role, prepare, build } in cases() {
        let f = fixture();
        prepare(&f);
        let who = Pubkey::new_unique();
        f.insert(who, Account::new(100_000_000, 0, &SYSTEM_PROGRAM));
        for other in ALL_ROLES.into_iter().filter(|other| *other != role) {
            f.grant(other, who);
        }
        let store = f.account(&f.oft_store);

        // The rejection is the role gate itself: no member PDA exists for the required role.
        assert_eq!(
            f.context.process_instruction(&build(&f, who)).program_result,
            program_failure(ErrorCode::AccountNotInitialized),
            "{name} accepted a signer without its role"
        );
        assert_eq!(f.account(&f.oft_store), store, "{name} changed the store while rejecting");

        f.grant(role, who);
        let result = f.context.process_instruction(&build(&f, who));
        assert!(
            result.program_result.is_ok(),
            "{name} rejected its role: {:?}",
            result.program_result
        );
    }
}
