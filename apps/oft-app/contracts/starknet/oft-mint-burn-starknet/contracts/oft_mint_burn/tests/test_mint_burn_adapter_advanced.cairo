//! Advanced tests for OFTMintBurnAdapter
//! Tests for pausable, access control, rate limiting, fees, and upgrades

use layerzero::common::structs::packet::Origin;
use layerzero::endpoint::interfaces::layerzero_receiver::{
    ILayerZeroReceiverDispatcher, ILayerZeroReceiverDispatcherTrait,
};
use layerzero::oapps::common::fee::interface::{IFeeDispatcher, IFeeDispatcherTrait};
use layerzero::oapps::common::rate_limiter::interface::{
    IRateLimiterDispatcher, IRateLimiterDispatcherTrait,
};
use layerzero::oapps::common::rate_limiter::structs::{
    RateLimitConfig, RateLimitDirection, RateLimitEnabled,
};
use layerzero::oapps::oapp::interface::{IOAppDispatcher, IOAppDispatcherTrait};
use layerzero::oapps::oft::interface::{IOFTDispatcher, IOFTDispatcherTrait};
use layerzero::oapps::oft::oft_msg_codec::OFTMsgCodec;
use layerzero::oapps::oft::structs::SendParam;
use layerzero::{MessageReceipt, MessagingFee};
use lz_utils::bytes::{Bytes32, ContractAddressIntoBytes32};
use oft_mint_burn::constants::{
    FEE_MANAGER_ROLE, PAUSE_MANAGER_ROLE, RATE_LIMITER_MANAGER_ROLE, UPGRADE_MANAGER_ROLE,
};
use oft_mint_burn::errors::err_caller_not_owner_or_missing_role;
use oft_mint_burn::interface::{
    IMintableTokenDispatcher, IMintableTokenDispatcherTrait, IOFTMintBurnAdapterDispatcher,
    IOFTMintBurnAdapterDispatcherTrait, IOFTMintBurnAdapterSafeDispatcher,
    IOFTMintBurnAdapterSafeDispatcherTrait,
};
use openzeppelin::access::accesscontrol::interface::{
    IAccessControlDispatcher, IAccessControlDispatcherTrait,
};
use openzeppelin::token::erc20::interface::{IERC20Dispatcher, IERC20DispatcherTrait};
use snforge_std::{DeclareResultTrait, declare, mock_call, start_cheat_caller_address};
use starknet::{ContractAddress, SyscallResultTrait};
use starkware_utils_testing::test_utils::{assert_panic_with_error, cheat_caller_address_once};
use crate::utils::{
    DIFF_DECIMALS, LZ_ENDPOINT, OFTMintBurnAdapterDeploy, OFT_OWNER, setup_mint_burn_adapter,
};

const UNAUTHORIZED_USER: ContractAddress = 'unauthorized_user'.try_into().unwrap();
const FEE_MANAGER: ContractAddress = 'fee_manager'.try_into().unwrap();
const RATE_LIMITER_MANAGER: ContractAddress = 'rate_limiter_manager'.try_into().unwrap();
const UPGRADE_MANAGER: ContractAddress = 'upgrade_manager'.try_into().unwrap();
const PAUSE_MANAGER: ContractAddress = 'pause_manager'.try_into().unwrap();

// =============================== Pausable Tests ===============================

#[test]
fn test_pause_and_unpause() {
    let OFTMintBurnAdapterDeploy { oft_mint_burn_adapter, .. } = setup_mint_burn_adapter();
    let adapter = IOFTMintBurnAdapterDispatcher { contract_address: oft_mint_burn_adapter };

    // Owner can pause
    cheat_caller_address_once(oft_mint_burn_adapter, OFT_OWNER);
    adapter.pause();

    // Owner can unpause
    cheat_caller_address_once(oft_mint_burn_adapter, OFT_OWNER);
    adapter.unpause();
    // If we got here without reverting, pause/unpause works
}

#[test]
#[feature("safe_dispatcher")]
fn test_pause_unauthorized() {
    let OFTMintBurnAdapterDeploy { oft_mint_burn_adapter, .. } = setup_mint_burn_adapter();
    let adapter = IOFTMintBurnAdapterSafeDispatcher { contract_address: oft_mint_burn_adapter };

    // Unauthorized user cannot pause (needs owner or PAUSE_MANAGER_ROLE)
    cheat_caller_address_once(oft_mint_burn_adapter, UNAUTHORIZED_USER);
    let result = adapter.pause();
    assert_panic_with_error(result, err_caller_not_owner_or_missing_role(PAUSE_MANAGER_ROLE));
}

#[test]
fn test_grant_pause_manager_role() {
    let OFTMintBurnAdapterDeploy { oft_mint_burn_adapter, .. } = setup_mint_burn_adapter();
    let access_control = IAccessControlDispatcher { contract_address: oft_mint_burn_adapter };

    // Owner can grant PAUSE_MANAGER_ROLE
    cheat_caller_address_once(oft_mint_burn_adapter, OFT_OWNER);
    access_control.grant_role(PAUSE_MANAGER_ROLE, PAUSE_MANAGER);
    assert!(access_control.has_role(PAUSE_MANAGER_ROLE, PAUSE_MANAGER));
}

#[test]
fn test_pause_manager_can_pause_and_unpause() {
    let OFTMintBurnAdapterDeploy { oft_mint_burn_adapter, .. } = setup_mint_burn_adapter();
    let adapter = IOFTMintBurnAdapterDispatcher { contract_address: oft_mint_burn_adapter };
    let access_control = IAccessControlDispatcher { contract_address: oft_mint_burn_adapter };

    // Grant PAUSE_MANAGER_ROLE to PAUSE_MANAGER
    cheat_caller_address_once(oft_mint_burn_adapter, OFT_OWNER);
    access_control.grant_role(PAUSE_MANAGER_ROLE, PAUSE_MANAGER);

    // Pause manager can pause
    cheat_caller_address_once(oft_mint_burn_adapter, PAUSE_MANAGER);
    adapter.pause();

    // Pause manager can unpause
    cheat_caller_address_once(oft_mint_burn_adapter, PAUSE_MANAGER);
    adapter.unpause();
}

#[test]
#[feature("safe_dispatcher")]
fn test_unpause_unauthorized() {
    let OFTMintBurnAdapterDeploy { oft_mint_burn_adapter, .. } = setup_mint_burn_adapter();
    let adapter = IOFTMintBurnAdapterDispatcher { contract_address: oft_mint_burn_adapter };
    let safe_adapter = IOFTMintBurnAdapterSafeDispatcher {
        contract_address: oft_mint_burn_adapter,
    };

    // First pause with owner
    cheat_caller_address_once(oft_mint_burn_adapter, OFT_OWNER);
    adapter.pause();

    // Unauthorized user cannot unpause (needs owner or PAUSE_MANAGER_ROLE)
    cheat_caller_address_once(oft_mint_burn_adapter, UNAUTHORIZED_USER);
    let result = safe_adapter.unpause();
    assert_panic_with_error(result, err_caller_not_owner_or_missing_role(PAUSE_MANAGER_ROLE));
}

#[test]
#[should_panic(expected: 'Pausable: paused')]
fn test_send_when_paused() {
    let OFTMintBurnAdapterDeploy {
        oft_mint_burn_adapter, erc20_token, ..,
    } = setup_mint_burn_adapter();

    let dst_eid = 1_u32;
    let peer = 0x123_u256;
    let amount_ld = 1000_u256 * DIFF_DECIMALS;

    // Setup peer
    cheat_caller_address_once(oft_mint_burn_adapter, OFT_OWNER);
    IOAppDispatcher { contract_address: oft_mint_burn_adapter }.set_peer(dst_eid, peer.into());

    // Pause contract
    cheat_caller_address_once(oft_mint_burn_adapter, OFT_OWNER);
    IOFTMintBurnAdapterDispatcher { contract_address: oft_mint_burn_adapter }.pause();

    // Try to send - should fail
    let user: ContractAddress = 'user'.try_into().unwrap();
    let send_param = SendParam {
        dst_eid,
        to: peer.into(),
        amount_ld,
        min_amount_ld: amount_ld,
        extra_options: Default::default(),
        compose_msg: Default::default(),
        oft_cmd: Default::default(),
    };

    // Mint tokens to user
    cheat_caller_address_once(erc20_token, oft_mint_burn_adapter);
    IMintableTokenDispatcher { contract_address: erc20_token }.permissioned_mint(user, amount_ld);

    // Mock endpoint calls
    mock_call(LZ_ENDPOINT, selector!("quote"), MessagingFee { native_fee: 0, lz_token_fee: 0 }, 1);
    mock_call(
        LZ_ENDPOINT,
        selector!("send"),
        MessageReceipt { guid: Bytes32 { value: 1 }, nonce: 1, payees: array![] },
        1,
    );

    // This should panic with "Pausable: paused"
    cheat_caller_address_once(oft_mint_burn_adapter, user);
    IOFTDispatcher { contract_address: oft_mint_burn_adapter }
        .send(send_param, MessagingFee { native_fee: 0, lz_token_fee: 0 }, user);
}

#[test]
#[should_panic(expected: 'Pausable: paused')]
fn test_receive_when_paused() {
    let OFTMintBurnAdapterDeploy { oft_mint_burn_adapter, .. } = setup_mint_burn_adapter();

    let src_eid = 1_u32;
    let sender = 0x123_u256;
    let receiver: ContractAddress = 'receiver'.try_into().unwrap();
    let amount_sd = 1000_u64;

    // Setup peer
    cheat_caller_address_once(oft_mint_burn_adapter, OFT_OWNER);
    IOAppDispatcher { contract_address: oft_mint_burn_adapter }.set_peer(src_eid, sender.into());

    // Pause contract
    cheat_caller_address_once(oft_mint_burn_adapter, OFT_OWNER);
    IOFTMintBurnAdapterDispatcher { contract_address: oft_mint_burn_adapter }.pause();

    // Try to receive - should fail
    let receiver_bytes32: Bytes32 = receiver.into();
    let (message, _) = OFTMsgCodec::encode(receiver_bytes32, amount_sd, @"");
    let origin = Origin { src_eid, sender: sender.into(), nonce: 1 };

    // This should panic with "Pausable: paused"
    start_cheat_caller_address(oft_mint_burn_adapter, LZ_ENDPOINT);
    ILayerZeroReceiverDispatcher { contract_address: oft_mint_burn_adapter }
        .lz_receive(origin, Bytes32 { value: 1 }, message, receiver, Default::default(), 0);
}

// =============================== Access Control Tests ===============================

#[test]
fn test_grant_and_revoke_fee_manager_role() {
    let OFTMintBurnAdapterDeploy { oft_mint_burn_adapter, .. } = setup_mint_burn_adapter();
    let access_control = IAccessControlDispatcher { contract_address: oft_mint_burn_adapter };

    // Owner can grant FEE_MANAGER_ROLE
    cheat_caller_address_once(oft_mint_burn_adapter, OFT_OWNER);
    access_control.grant_role(FEE_MANAGER_ROLE, FEE_MANAGER);
    assert!(access_control.has_role(FEE_MANAGER_ROLE, FEE_MANAGER));

    // Owner can revoke FEE_MANAGER_ROLE
    cheat_caller_address_once(oft_mint_burn_adapter, OFT_OWNER);
    access_control.revoke_role(FEE_MANAGER_ROLE, FEE_MANAGER);
    assert!(!access_control.has_role(FEE_MANAGER_ROLE, FEE_MANAGER));
}

#[test]
fn test_grant_rate_limiter_manager_role() {
    let OFTMintBurnAdapterDeploy { oft_mint_burn_adapter, .. } = setup_mint_burn_adapter();
    let access_control = IAccessControlDispatcher { contract_address: oft_mint_burn_adapter };

    // Owner can grant RATE_LIMITER_MANAGER_ROLE
    cheat_caller_address_once(oft_mint_burn_adapter, OFT_OWNER);
    access_control.grant_role(RATE_LIMITER_MANAGER_ROLE, RATE_LIMITER_MANAGER);
    assert!(access_control.has_role(RATE_LIMITER_MANAGER_ROLE, RATE_LIMITER_MANAGER));
}

#[test]
fn test_grant_upgrade_manager_role() {
    let OFTMintBurnAdapterDeploy { oft_mint_burn_adapter, .. } = setup_mint_burn_adapter();
    let access_control = IAccessControlDispatcher { contract_address: oft_mint_burn_adapter };

    // Owner can grant UPGRADE_MANAGER_ROLE
    cheat_caller_address_once(oft_mint_burn_adapter, OFT_OWNER);
    access_control.grant_role(UPGRADE_MANAGER_ROLE, UPGRADE_MANAGER);
    assert!(access_control.has_role(UPGRADE_MANAGER_ROLE, UPGRADE_MANAGER));
}

#[test]
fn test_rate_limiter_manager_can_set_rate_limits() {
    let OFTMintBurnAdapterDeploy { oft_mint_burn_adapter, .. } = setup_mint_burn_adapter();
    let adapter = IOFTMintBurnAdapterDispatcher { contract_address: oft_mint_burn_adapter };
    let access_control = IAccessControlDispatcher { contract_address: oft_mint_burn_adapter };

    // Grant RATE_LIMITER_MANAGER_ROLE
    cheat_caller_address_once(oft_mint_burn_adapter, OFT_OWNER);
    access_control.grant_role(RATE_LIMITER_MANAGER_ROLE, RATE_LIMITER_MANAGER);

    // Rate limiter manager can set rate limits
    let dst_eid = 1_u32;
    let rate_limits = array![
        RateLimitConfig { dst_eid, limit: 1000000, window: 3600 } // 1M per hour
    ];

    cheat_caller_address_once(oft_mint_burn_adapter, RATE_LIMITER_MANAGER);
    adapter.set_rate_limits(rate_limits, RateLimitDirection::Outbound);
}

#[test]
fn test_owner_can_set_rate_limits_without_role() {
    let OFTMintBurnAdapterDeploy { oft_mint_burn_adapter, .. } = setup_mint_burn_adapter();
    let adapter = IOFTMintBurnAdapterDispatcher { contract_address: oft_mint_burn_adapter };

    // Owner can set rate limits even without explicit role
    let dst_eid = 1_u32;
    let rate_limits = array![RateLimitConfig { dst_eid, limit: 1000000, window: 3600 }];

    cheat_caller_address_once(oft_mint_burn_adapter, OFT_OWNER);
    adapter.set_rate_limits(rate_limits, RateLimitDirection::Outbound);
}

#[test]
#[feature("safe_dispatcher")]
fn test_unauthorized_cannot_set_rate_limits() {
    let OFTMintBurnAdapterDeploy { oft_mint_burn_adapter, .. } = setup_mint_burn_adapter();
    let adapter = IOFTMintBurnAdapterSafeDispatcher { contract_address: oft_mint_burn_adapter };

    let dst_eid = 1_u32;
    let rate_limits = array![RateLimitConfig { dst_eid, limit: 1000000, window: 3600 }];

    // Unauthorized user cannot set rate limits
    cheat_caller_address_once(oft_mint_burn_adapter, UNAUTHORIZED_USER);
    let result = adapter.set_rate_limits(rate_limits, RateLimitDirection::Outbound);
    assert_panic_with_error(
        result, err_caller_not_owner_or_missing_role(RATE_LIMITER_MANAGER_ROLE),
    );
}

// =============================== Fee Management Tests ===============================

#[test]
fn test_fee_balance_initially_zero() {
    let OFTMintBurnAdapterDeploy { oft_mint_burn_adapter, .. } = setup_mint_burn_adapter();

    // Check initial fee balance
    let adapter = IOFTMintBurnAdapterDispatcher { contract_address: oft_mint_burn_adapter };
    assert_eq!(adapter.fee_balance(), 0);
}

#[test]
#[should_panic]
fn test_withdraw_fees_when_zero() {
    let OFTMintBurnAdapterDeploy { oft_mint_burn_adapter, .. } = setup_mint_burn_adapter();
    let adapter = IOFTMintBurnAdapterDispatcher { contract_address: oft_mint_burn_adapter };

    let recipient: ContractAddress = 'recipient'.try_into().unwrap();

    // Should fail because fee_balance is 0
    cheat_caller_address_once(oft_mint_burn_adapter, OFT_OWNER);
    adapter.withdraw_fees(recipient);
}

#[test]
#[feature("safe_dispatcher")]
fn test_unauthorized_cannot_withdraw_fees() {
    let OFTMintBurnAdapterDeploy { oft_mint_burn_adapter, .. } = setup_mint_burn_adapter();
    let adapter = IOFTMintBurnAdapterSafeDispatcher { contract_address: oft_mint_burn_adapter };

    let recipient: ContractAddress = 'recipient'.try_into().unwrap();

    // Unauthorized user cannot withdraw fees
    cheat_caller_address_once(oft_mint_burn_adapter, UNAUTHORIZED_USER);
    let result = adapter.withdraw_fees(recipient);
    assert_panic_with_error(result, err_caller_not_owner_or_missing_role(FEE_MANAGER_ROLE));
}

#[test]
fn test_fee_manager_role_grant() {
    let OFTMintBurnAdapterDeploy { oft_mint_burn_adapter, .. } = setup_mint_burn_adapter();
    let access_control = IAccessControlDispatcher { contract_address: oft_mint_burn_adapter };

    // Grant FEE_MANAGER_ROLE
    cheat_caller_address_once(oft_mint_burn_adapter, OFT_OWNER);
    access_control.grant_role(FEE_MANAGER_ROLE, FEE_MANAGER);

    // Verify role was granted
    assert!(access_control.has_role(FEE_MANAGER_ROLE, FEE_MANAGER));
}

#[test]
fn test_withdraw_fees_successfully() {
    let OFTMintBurnAdapterDeploy {
        oft_mint_burn_adapter, erc20_token, ..,
    } = setup_mint_burn_adapter();

    let dst_eid = 1_u32;
    let peer = 0x123_u256;
    let user: ContractAddress = 'user'.try_into().unwrap();
    let fee_recipient: ContractAddress = 'fee_recipient'.try_into().unwrap();
    let amount_ld = 10000_u256 * DIFF_DECIMALS; // 10000 tokens

    // Setup peer
    cheat_caller_address_once(oft_mint_burn_adapter, OFT_OWNER);
    IOAppDispatcher { contract_address: oft_mint_burn_adapter }.set_peer(dst_eid, peer.into());

    // Set fee BPS (1% = 100 bps)
    let fee_dispatcher = IFeeDispatcher { contract_address: oft_mint_burn_adapter };
    cheat_caller_address_once(oft_mint_burn_adapter, OFT_OWNER);
    fee_dispatcher.set_fee_bps(dst_eid, 100, true); // 1% fee

    // Mint tokens to user
    cheat_caller_address_once(erc20_token, oft_mint_burn_adapter);
    IMintableTokenDispatcher { contract_address: erc20_token }.permissioned_mint(user, amount_ld);

    // Mock endpoint calls
    mock_call(LZ_ENDPOINT, selector!("quote"), MessagingFee { native_fee: 0, lz_token_fee: 0 }, 1);
    mock_call(
        LZ_ENDPOINT,
        selector!("send"),
        MessageReceipt { guid: Bytes32 { value: 1 }, nonce: 1, payees: array![] },
        1,
    );

    // Send tokens (this should collect fees)
    let send_param = SendParam {
        dst_eid,
        to: peer.into(),
        amount_ld,
        min_amount_ld: 0, // Allow slippage for fee
        extra_options: Default::default(),
        compose_msg: Default::default(),
        oft_cmd: Default::default(),
    };

    cheat_caller_address_once(oft_mint_burn_adapter, user);
    IOFTDispatcher { contract_address: oft_mint_burn_adapter }
        .send(send_param, MessagingFee { native_fee: 0, lz_token_fee: 0 }, user);

    // Check that fees were collected
    let adapter = IOFTMintBurnAdapterDispatcher { contract_address: oft_mint_burn_adapter };
    let fee_balance = adapter.fee_balance();
    assert!(fee_balance > 0, "Fee balance should be greater than 0");

    // Check initial balance of fee recipient
    let recipient_balance_before = IERC20Dispatcher { contract_address: erc20_token }
        .balance_of(fee_recipient);
    assert_eq!(recipient_balance_before, 0);

    // Withdraw fees
    cheat_caller_address_once(oft_mint_burn_adapter, OFT_OWNER);
    adapter.withdraw_fees(fee_recipient);

    // Check that fee balance is now 0
    assert_eq!(adapter.fee_balance(), 0);

    // Check that recipient received the fees
    let recipient_balance_after = IERC20Dispatcher { contract_address: erc20_token }
        .balance_of(fee_recipient);
    assert_eq!(recipient_balance_after, fee_balance);
}

#[test]
fn test_fee_manager_can_withdraw_fees() {
    let OFTMintBurnAdapterDeploy {
        oft_mint_burn_adapter, erc20_token, ..,
    } = setup_mint_burn_adapter();

    let dst_eid = 1_u32;
    let peer = 0x123_u256;
    let user: ContractAddress = 'user'.try_into().unwrap();
    let fee_recipient: ContractAddress = 'fee_recipient'.try_into().unwrap();
    let amount_ld = 10000_u256 * DIFF_DECIMALS;

    // Setup peer
    cheat_caller_address_once(oft_mint_burn_adapter, OFT_OWNER);
    IOAppDispatcher { contract_address: oft_mint_burn_adapter }.set_peer(dst_eid, peer.into());

    // Set fee BPS (1% = 100 bps)
    let fee_dispatcher = IFeeDispatcher { contract_address: oft_mint_burn_adapter };
    cheat_caller_address_once(oft_mint_burn_adapter, OFT_OWNER);
    fee_dispatcher.set_fee_bps(dst_eid, 100, true);

    // Grant FEE_MANAGER_ROLE
    let access_control = IAccessControlDispatcher { contract_address: oft_mint_burn_adapter };
    cheat_caller_address_once(oft_mint_burn_adapter, OFT_OWNER);
    access_control.grant_role(FEE_MANAGER_ROLE, FEE_MANAGER);

    // Mint tokens to user
    cheat_caller_address_once(erc20_token, oft_mint_burn_adapter);
    IMintableTokenDispatcher { contract_address: erc20_token }.permissioned_mint(user, amount_ld);

    // Mock endpoint calls
    mock_call(LZ_ENDPOINT, selector!("quote"), MessagingFee { native_fee: 0, lz_token_fee: 0 }, 1);
    mock_call(
        LZ_ENDPOINT,
        selector!("send"),
        MessageReceipt { guid: Bytes32 { value: 1 }, nonce: 1, payees: array![] },
        1,
    );

    // Send tokens to collect fees
    let send_param = SendParam {
        dst_eid,
        to: peer.into(),
        amount_ld,
        min_amount_ld: 0,
        extra_options: Default::default(),
        compose_msg: Default::default(),
        oft_cmd: Default::default(),
    };

    cheat_caller_address_once(oft_mint_burn_adapter, user);
    IOFTDispatcher { contract_address: oft_mint_burn_adapter }
        .send(send_param, MessagingFee { native_fee: 0, lz_token_fee: 0 }, user);

    // Fee manager can withdraw fees
    let adapter = IOFTMintBurnAdapterDispatcher { contract_address: oft_mint_burn_adapter };
    let fee_balance = adapter.fee_balance();

    cheat_caller_address_once(oft_mint_burn_adapter, FEE_MANAGER);
    adapter.withdraw_fees(fee_recipient);

    // Check that fee balance is now 0 and recipient received fees
    assert_eq!(adapter.fee_balance(), 0);
    let recipient_balance = IERC20Dispatcher { contract_address: erc20_token }
        .balance_of(fee_recipient);
    assert_eq!(recipient_balance, fee_balance);
}

// =============================== Rate Limiting Tests ===============================

#[test]
fn test_rate_limit_enable_and_disable() {
    let OFTMintBurnAdapterDeploy { oft_mint_burn_adapter, .. } = setup_mint_burn_adapter();
    let adapter = IOFTMintBurnAdapterDispatcher { contract_address: oft_mint_burn_adapter };
    let rate_limiter = IRateLimiterDispatcher { contract_address: oft_mint_burn_adapter };

    // Initially both should be disabled
    let enabled = rate_limiter.get_rate_limit_enabled();
    assert!(!enabled.is_outbound_enabled);
    assert!(!enabled.is_inbound_enabled);

    // Enable outbound rate limiting
    cheat_caller_address_once(oft_mint_burn_adapter, OFT_OWNER);
    adapter
        .set_rate_limits_enabled(
            RateLimitEnabled { is_outbound_enabled: true, is_inbound_enabled: false },
        );

    let enabled = rate_limiter.get_rate_limit_enabled();
    assert!(enabled.is_outbound_enabled);
    assert!(!enabled.is_inbound_enabled);

    // Enable both
    cheat_caller_address_once(oft_mint_burn_adapter, OFT_OWNER);
    adapter
        .set_rate_limits_enabled(
            RateLimitEnabled { is_outbound_enabled: true, is_inbound_enabled: true },
        );

    let enabled = rate_limiter.get_rate_limit_enabled();
    assert!(enabled.is_outbound_enabled);
    assert!(enabled.is_inbound_enabled);
}

#[test]
#[feature("safe_dispatcher")]
fn test_unauthorized_cannot_enable_rate_limits() {
    let OFTMintBurnAdapterDeploy { oft_mint_burn_adapter, .. } = setup_mint_burn_adapter();
    let adapter = IOFTMintBurnAdapterSafeDispatcher { contract_address: oft_mint_burn_adapter };

    // Unauthorized user cannot enable rate limits
    cheat_caller_address_once(oft_mint_burn_adapter, UNAUTHORIZED_USER);
    let result = adapter
        .set_rate_limits_enabled(
            RateLimitEnabled { is_outbound_enabled: true, is_inbound_enabled: true },
        );
    assert_panic_with_error(
        result, err_caller_not_owner_or_missing_role(RATE_LIMITER_MANAGER_ROLE),
    );
}

#[test]
fn test_set_outbound_rate_limit() {
    let OFTMintBurnAdapterDeploy { oft_mint_burn_adapter, .. } = setup_mint_burn_adapter();
    let adapter = IOFTMintBurnAdapterDispatcher { contract_address: oft_mint_burn_adapter };
    let rate_limiter = IRateLimiterDispatcher { contract_address: oft_mint_burn_adapter };

    let dst_eid = 1_u32;
    let limit = 1000000_u128;
    let window = 3600_u64;

    // Set outbound rate limit
    let rate_limits = array![RateLimitConfig { dst_eid, limit, window }];
    cheat_caller_address_once(oft_mint_burn_adapter, OFT_OWNER);
    adapter.set_rate_limits(rate_limits, RateLimitDirection::Outbound);

    // Check the rate limit was set
    let rate_limit = rate_limiter.get_outbound_rate_limit(dst_eid);
    assert_eq!(rate_limit.limit, limit);
    assert_eq!(rate_limit.window, window);
    assert_eq!(rate_limit.amount_in_flight, 0);
}

#[test]
fn test_set_inbound_rate_limit() {
    let OFTMintBurnAdapterDeploy { oft_mint_burn_adapter, .. } = setup_mint_burn_adapter();
    let adapter = IOFTMintBurnAdapterDispatcher { contract_address: oft_mint_burn_adapter };
    let rate_limiter = IRateLimiterDispatcher { contract_address: oft_mint_burn_adapter };

    let src_eid = 1_u32;
    let limit = 500000_u128;
    let window = 1800_u64;

    // Set inbound rate limit
    let rate_limits = array![RateLimitConfig { dst_eid: src_eid, limit, window }];
    cheat_caller_address_once(oft_mint_burn_adapter, OFT_OWNER);
    adapter.set_rate_limits(rate_limits, RateLimitDirection::Inbound);

    // Check the rate limit was set
    let rate_limit = rate_limiter.get_inbound_rate_limit(src_eid);
    assert_eq!(rate_limit.limit, limit);
    assert_eq!(rate_limit.window, window);
    assert_eq!(rate_limit.amount_in_flight, 0);
}

// =============================== Upgrade Tests ===============================

#[test]
fn test_upgrade_manager_can_upgrade() {
    let OFTMintBurnAdapterDeploy { oft_mint_burn_adapter, .. } = setup_mint_burn_adapter();
    let adapter = IOFTMintBurnAdapterDispatcher { contract_address: oft_mint_burn_adapter };
    let access_control = IAccessControlDispatcher { contract_address: oft_mint_burn_adapter };

    // Grant UPGRADE_MANAGER_ROLE
    cheat_caller_address_once(oft_mint_burn_adapter, OFT_OWNER);
    access_control.grant_role(UPGRADE_MANAGER_ROLE, UPGRADE_MANAGER);

    // Declare a new class (we'll use the same contract class for testing)
    let new_class = declare("OFTMintBurnAdapter").unwrap_syscall();
    let new_class_hash = *new_class.contract_class().class_hash;

    // Upgrade manager can upgrade
    cheat_caller_address_once(oft_mint_burn_adapter, UPGRADE_MANAGER);
    adapter.upgrade(new_class_hash);
}

#[test]
fn test_owner_can_upgrade() {
    let OFTMintBurnAdapterDeploy { oft_mint_burn_adapter, .. } = setup_mint_burn_adapter();
    let adapter = IOFTMintBurnAdapterDispatcher { contract_address: oft_mint_burn_adapter };

    // Declare a new class
    let new_class = declare("OFTMintBurnAdapter").unwrap_syscall();
    let new_class_hash = *new_class.contract_class().class_hash;

    // Owner can upgrade even without explicit role
    cheat_caller_address_once(oft_mint_burn_adapter, OFT_OWNER);
    adapter.upgrade(new_class_hash);
}

#[test]
#[feature("safe_dispatcher")]
fn test_unauthorized_cannot_upgrade() {
    let OFTMintBurnAdapterDeploy { oft_mint_burn_adapter, .. } = setup_mint_burn_adapter();
    let adapter = IOFTMintBurnAdapterSafeDispatcher { contract_address: oft_mint_burn_adapter };

    // Declare a new class
    let new_class = declare("OFTMintBurnAdapter").unwrap_syscall();
    let new_class_hash = *new_class.contract_class().class_hash;

    // Unauthorized user cannot upgrade
    cheat_caller_address_once(oft_mint_burn_adapter, UNAUTHORIZED_USER);
    let result = adapter.upgrade(new_class_hash);
    assert_panic_with_error(result, err_caller_not_owner_or_missing_role(UPGRADE_MANAGER_ROLE));
}

// =============================== Integration Tests ===============================

#[test]
fn test_send_with_pausable_and_rate_limit() {
    let OFTMintBurnAdapterDeploy {
        oft_mint_burn_adapter, erc20_token, ..,
    } = setup_mint_burn_adapter();

    let dst_eid = 1_u32;
    let peer = 0x123_u256;
    let user: ContractAddress = 'user'.try_into().unwrap();
    let amount_ld = 100_u256 * DIFF_DECIMALS;

    // Setup peer
    cheat_caller_address_once(oft_mint_burn_adapter, OFT_OWNER);
    IOAppDispatcher { contract_address: oft_mint_burn_adapter }.set_peer(dst_eid, peer.into());

    // Set rate limit
    let adapter = IOFTMintBurnAdapterDispatcher { contract_address: oft_mint_burn_adapter };
    let rate_limits = array![
        RateLimitConfig {
            dst_eid, limit: 1000_u128 * DIFF_DECIMALS.try_into().unwrap(), window: 3600,
        },
    ];
    cheat_caller_address_once(oft_mint_burn_adapter, OFT_OWNER);
    adapter.set_rate_limits(rate_limits, RateLimitDirection::Outbound);

    // Enable outbound rate limiting
    cheat_caller_address_once(oft_mint_burn_adapter, OFT_OWNER);
    adapter
        .set_rate_limits_enabled(
            RateLimitEnabled { is_outbound_enabled: true, is_inbound_enabled: false },
        );

    // Mint tokens to user
    cheat_caller_address_once(erc20_token, oft_mint_burn_adapter);
    IMintableTokenDispatcher { contract_address: erc20_token }.permissioned_mint(user, amount_ld);

    // Mock endpoint calls
    mock_call(LZ_ENDPOINT, selector!("quote"), MessagingFee { native_fee: 0, lz_token_fee: 0 }, 1);
    mock_call(
        LZ_ENDPOINT,
        selector!("send"),
        MessageReceipt { guid: Bytes32 { value: 1 }, nonce: 1, payees: array![] },
        1,
    );

    // Send tokens (should succeed as it's under rate limit)
    let send_param = SendParam {
        dst_eid,
        to: peer.into(),
        amount_ld,
        min_amount_ld: amount_ld,
        extra_options: Default::default(),
        compose_msg: Default::default(),
        oft_cmd: Default::default(),
    };

    cheat_caller_address_once(oft_mint_burn_adapter, user);
    IOFTDispatcher { contract_address: oft_mint_burn_adapter }
        .send(send_param, MessagingFee { native_fee: 0, lz_token_fee: 0 }, user);

    // Verify tokens were burned
    let balance = IERC20Dispatcher { contract_address: erc20_token }.balance_of(user);
    assert_eq!(balance, 0);
}

#[test]
fn test_receive_with_pausable_and_rate_limit() {
    let OFTMintBurnAdapterDeploy {
        oft_mint_burn_adapter, erc20_token, ..,
    } = setup_mint_burn_adapter();

    let src_eid = 1_u32;
    let sender = 0x123_u256;
    let receiver: ContractAddress = 'receiver'.try_into().unwrap();
    let amount_sd = 100_u64;
    let amount_ld = amount_sd.into() * DIFF_DECIMALS;

    // Setup peer
    cheat_caller_address_once(oft_mint_burn_adapter, OFT_OWNER);
    IOAppDispatcher { contract_address: oft_mint_burn_adapter }.set_peer(src_eid, sender.into());

    // Set inbound rate limit
    let adapter = IOFTMintBurnAdapterDispatcher { contract_address: oft_mint_burn_adapter };
    let rate_limits = array![
        RateLimitConfig {
            dst_eid: src_eid, limit: 1000_u128 * DIFF_DECIMALS.try_into().unwrap(), window: 3600,
        },
    ];
    cheat_caller_address_once(oft_mint_burn_adapter, OFT_OWNER);
    adapter.set_rate_limits(rate_limits, RateLimitDirection::Inbound);

    // Enable inbound rate limiting
    cheat_caller_address_once(oft_mint_burn_adapter, OFT_OWNER);
    adapter
        .set_rate_limits_enabled(
            RateLimitEnabled { is_outbound_enabled: false, is_inbound_enabled: true },
        );

    // Receive tokens (should succeed as it's under rate limit)
    let receiver_bytes32: Bytes32 = receiver.into();
    let (message, _) = OFTMsgCodec::encode(receiver_bytes32, amount_sd, @"");
    let origin = Origin { src_eid, sender: sender.into(), nonce: 1 };

    start_cheat_caller_address(oft_mint_burn_adapter, LZ_ENDPOINT);
    ILayerZeroReceiverDispatcher { contract_address: oft_mint_burn_adapter }
        .lz_receive(origin, Bytes32 { value: 1 }, message, receiver, Default::default(), 0);

    // Verify tokens were minted
    let balance = IERC20Dispatcher { contract_address: erc20_token }.balance_of(receiver);
    assert_eq!(balance, amount_ld);
}

