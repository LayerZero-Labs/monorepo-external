use core::num::traits::Bounded;
use layerzero::common::structs::packet::Origin;
use layerzero::endpoint::interfaces::layerzero_receiver::{
    ILayerZeroReceiverDispatcher, ILayerZeroReceiverDispatcherTrait,
};
use layerzero::oapps::oapp::interface::{IOAppDispatcher, IOAppDispatcherTrait};
use layerzero::oapps::oft::interface::{IOFTDispatcher, IOFTDispatcherTrait};
use layerzero::oapps::oft::oft_msg_codec::OFTMsgCodec;
use layerzero::oapps::oft::structs::SendParam;
use layerzero::{MessageReceipt, MessagingFee};
use lz_utils::bytes::{Bytes32, ContractAddressIntoBytes32};
use oft_mint_burn::interface::{IMintableTokenDispatcher, IMintableTokenDispatcherTrait};
use openzeppelin::token::erc20::interface::{IERC20Dispatcher, IERC20DispatcherTrait};
use snforge_std::{start_cheat_caller_address, start_mock_call};
use starknet::ContractAddress;
use starkware_utils_testing::test_utils::cheat_caller_address_once;
use crate::fuzzable::contract_address::FuzzableContractAddress;
use crate::utils::{
    DIFF_DECIMALS, LZ_ENDPOINT, NATIVE_TOKEN_OWNER, OFTMintBurnAdapterDeploy, OFT_OWNER,
    setup_mint_burn_adapter,
};

#[test]
#[fuzzer]
fn test_mint_burn_adapter_send(
    dst_eid: u32,
    peer: u256,
    user: ContractAddress,
    receiver: u256,
    amount_seed: u256,
    send_native_fee: u128,
    user_native_remainder: u128,
    user_erc20_remainder: u128,
) {
    // =============================== Transfer parameters =================================

    let amount_ld = amount_seed % (Bounded::<u64>::MAX.into() * DIFF_DECIMALS);
    let amount_sd: u64 = (amount_ld / DIFF_DECIMALS).try_into().unwrap();
    let dust_ld = amount_ld % DIFF_DECIMALS;
    let clean_amount_ld = amount_ld - dust_ld;
    // Expect a lossless token transfer.
    let min_amount_ld = amount_sd.into() * DIFF_DECIMALS;

    // Preconditions
    assert_eq!(clean_amount_ld, min_amount_ld);
    assert_gt!(amount_sd, 0); // Hopefully, we never hit 0 of `u64`...

    // =============================== Setup =================================

    let OFTMintBurnAdapterDeploy {
        oft_mint_burn_adapter, native_token, erc20_token,
    } = setup_mint_burn_adapter();

    let oapp_dispatcher = IOAppDispatcher { contract_address: oft_mint_burn_adapter };

    cheat_caller_address_once(oft_mint_burn_adapter, OFT_OWNER);
    oapp_dispatcher.set_peer(dst_eid, peer.into());

    // =============================== Send tokens =================================

    let send_param = SendParam {
        dst_eid,
        to: receiver.into(),
        amount_ld,
        min_amount_ld,
        // not using extra options, compose msg, or oft cmd in this test
        extra_options: Default::default(),
        compose_msg: Default::default(),
        oft_cmd: Default::default(),
    };

    let balance_ld = amount_ld + user_erc20_remainder.into();

    // Give user the amount of tokens to send by minting directly to them
    // The OFTMintBurnAdapter will burn these tokens when sending
    // We need to cheat caller address to be the oft_mint_burn_adapter since it has the MINTER_ROLE
    cheat_caller_address_once(erc20_token, oft_mint_burn_adapter);
    IMintableTokenDispatcher { contract_address: erc20_token }.permissioned_mint(user, balance_ld);

    // Mint native tokens to user for gas fee payment
    cheat_caller_address_once(native_token, NATIVE_TOKEN_OWNER);
    IMintableTokenDispatcher { contract_address: native_token }
        .permissioned_mint(user, send_native_fee.into() + user_native_remainder.into());

    let pay_in_lz_token = false;

    // mock endpoint quote call to return the expected send fee
    start_mock_call(
        LZ_ENDPOINT,
        selector!("quote"),
        MessagingFee { native_fee: send_native_fee.into(), lz_token_fee: 0 },
    );

    // We only quote send since this OFT doesn't have any fees
    let fee = IOFTDispatcher { contract_address: oft_mint_burn_adapter }
        .quote_send(send_param.clone(), pay_in_lz_token);

    // user has to give allowance to the OFTMintBurnAdapter contract to spend the native fee
    cheat_caller_address_once(native_token, user);
    IERC20Dispatcher { contract_address: native_token }
        .approve(oft_mint_burn_adapter, fee.native_fee);

    // mock endpoint send call to return the expected message receipt
    // guid nonce and payees are not important for this test
    start_mock_call(
        LZ_ENDPOINT,
        selector!("send"),
        MessageReceipt { guid: Bytes32 { value: 1 }, nonce: 1, payees: array![] },
    );

    // Refund address is not important for this test since endpoint handles the refund and is mocked
    // here
    cheat_caller_address_once(oft_mint_burn_adapter, user);
    let result = IOFTDispatcher { contract_address: oft_mint_burn_adapter }
        .send(send_param, fee.clone(), user);

    // =============================== Assertions =================================

    // User should have sent the amount of tokens to the OFTMintBurnAdapter contract
    let expected_sent_ld = clean_amount_ld;
    let expected_received_ld = clean_amount_ld;

    assert_eq!(result.oft_receipt.amount_sent_ld, expected_sent_ld);
    assert_eq!(result.oft_receipt.amount_received_ld, expected_received_ld);

    // Native token should have been approved to endpoint
    // in real endpoint it would have used all the allowance and refunded the remainder
    // but here oapp will have approved the endpoint to spend the native fee
    let approved_after = IERC20Dispatcher { contract_address: native_token }
        .allowance(oft_mint_burn_adapter, LZ_ENDPOINT);
    assert_eq!(fee.native_fee, approved_after);

    // User should have spent the native fee
    let expected_native_after = IERC20Dispatcher { contract_address: native_token }
        .balance_of(user);
    assert_eq!(expected_native_after, user_native_remainder.into());

    // User balance of erc20 should have been reduced by the amount of tokens sent
    // it should have received the remainder of the native fee and dust
    let erc20_after = IERC20Dispatcher { contract_address: erc20_token }.balance_of(user);
    assert_eq!(user_erc20_remainder.into() + dust_ld, erc20_after);

    // check erc20 total supply to ensure tokens were burned
    let total_supply = IERC20Dispatcher { contract_address: erc20_token }.total_supply();
    assert_eq!(total_supply, user_erc20_remainder.into() + dust_ld);
}


#[test]
#[fuzzer]
fn test_mint_burn_adapter_receive(
    src_eid: u32,
    sender: u256,
    nonce: u64,
    guid: u256,
    receiver: ContractAddress,
    amount_sd: u64,
    executor: ContractAddress,
) {
    // =============================== Parameters =================================
    let receiver_bytes32: Bytes32 = receiver.into();
    let expected_amount_ld: u256 = amount_sd.into() * DIFF_DECIMALS;
    let origin = Origin { src_eid, sender: sender.into(), nonce };

    // not using compose msg in this test
    let (message, _) = OFTMsgCodec::encode(receiver_bytes32, amount_sd, @"");

    // =============================== Setup =================================

    let OFTMintBurnAdapterDeploy {
        oft_mint_burn_adapter, erc20_token, ..,
    } = setup_mint_burn_adapter();

    // setup_peer
    cheat_caller_address_once(oft_mint_burn_adapter, OFT_OWNER);
    IOAppDispatcher { contract_address: oft_mint_burn_adapter }.set_peer(src_eid, sender.into());

    // =============================== Receive tokens =================================

    // Cheat caller address to endpoint since it is the one calling lz_receive
    start_cheat_caller_address(oft_mint_burn_adapter, LZ_ENDPOINT);
    ILayerZeroReceiverDispatcher { contract_address: oft_mint_burn_adapter }
        .lz_receive(origin, guid.into(), message, executor, Default::default(), 0);

    // =============================== Assertions =================================

    // User should have received the amount of tokens
    let received_ld = IERC20Dispatcher { contract_address: erc20_token }.balance_of(receiver);
    assert_eq!(expected_amount_ld, received_ld);

    // check erc20 total supply to ensure tokens were minted
    let total_supply = IERC20Dispatcher { contract_address: erc20_token }.total_supply();
    assert_eq!(total_supply, expected_amount_ld);
}
