//! Admin setters write and emit on every call, even with the value already stored, as their EVM
//! counterparts (`setCreditRedirectConfig`, `NexusERC20.setGuard`) do. Only the permissionless
//! syncs skip an unchanged value (see `oft_sync.rs`).
mod oft;

use console_oft::events::{CreditRedirectConfigSet, PubkeyPolicySet, TokenManagerSet};
use oft::helpers::*;
use solana_pubkey::Pubkey;

#[test]
fn setting_the_stored_value_emits_again() {
    let f = fixture();
    let oft_store = to_program_pubkey(&f.oft_store);

    // A new OFT has no policy, no redirect escrow and no TokenManager root.
    assert_only_event(
        &f.ok(&set_pubkey_policy_ix(&f, f.admin, None)),
        PubkeyPolicySet { oft_store, pubkey_policy: None },
    );
    assert_only_event(
        &f.ok(&set_credit_redirect_config_ix(&f, f.admin, None)),
        CreditRedirectConfigSet { oft_store, config: None },
    );
    assert_only_event(
        &f.ok(&set_token_manager_ix(&f, f.admin, None)),
        TokenManagerSet { oft_store, token_manager: None },
    );

    let root = Pubkey::new_unique();
    f.insert(root, solana_account::Account::default());
    let token_manager = Some(to_program_pubkey(&root));
    for _ in 0..2 {
        assert_only_event(
            &f.ok(&set_token_manager_ix(&f, f.admin, Some(root))),
            TokenManagerSet { oft_store, token_manager },
        );
    }
    assert_eq!(f.store().token_manager, token_manager);
}
