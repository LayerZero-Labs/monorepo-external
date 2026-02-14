//! E2E test of DVN quorums

use core::num::traits::Bounded;
use layerzero::common::packet_v1_codec::PacketV1Codec;
use layerzero::message_lib::interface::{IMessageLibDispatcherTrait, IMessageLibSafeDispatcherTrait};
use layerzero::message_lib::uln_302::errors::err_uln_verifying;
use layerzero::message_lib::uln_302::options::TYPE_3;
use layerzero::message_lib::uln_302::structs::executor_config::ExecutorConfig;
use layerzero::message_lib::uln_302::structs::uln_config::UlnConfig;
use layerzero::oapps::counter::constants::VANILLA_TYPE;
use layerzero::oapps::counter::counter::OmniCounter;
use layerzero::oapps::counter::interface::IOmniCounterDispatcherTrait;
use layerzero::oapps::counter::structs::IncrementSent;
use layerzero::oapps::oapp::interface::IOAppDispatcherTrait;
use layerzero::treasury::interfaces::treasury_admin::ITreasuryAdminDispatcherTrait;
use layerzero::workers::base::interface::IWorkerBaseDispatcherTrait;
use layerzero::workers::dvn::interface::IDvnDispatcherTrait;
use layerzero::workers::dvn::structs::ExecuteParam as DvnExecuteParam;
use layerzero::workers::executor::options::OPTION_TYPE_LZRECEIVE;
use lz_utils::byte_array_ext::byte_array_ext::ByteArrayTraitExt;
use lz_utils::bytes::ContractAddressIntoBytes32;
use openzeppelin::token::erc20::interface::IERC20DispatcherTrait;
use snforge_std::{
    CheatSpan, EventSpyAssertionsTrait, EventSpyTrait, EventsFilterTrait, cheat_caller_address,
    spy_events,
};
use starknet::ContractAddress;
use starknet::account::Call;
use starkware_utils_testing::test_utils::{assert_panic_with_error, cheat_caller_address_once};
use utils::{
    BlockchainOptions, DEFAULT_DVN_DST_CONFIG, DvnHelper, EndpointV2Helper, ExecutorHelper,
    OmniCounterHelper, TreasuryHelper, UltraLightNode302Helper, decode_packet_on_endpoint,
    deploy_omni_counter, setup_layer_zero, wire_oapp, wire_ultra_light_node_302,
};
use crate::constants::assert_eq;
use crate::e2e::utils;
use crate::e2e::utils::{ERC20Helper, deploy_dvn};
use crate::fuzzable::blockchain_config::BlockchainConfig;
use crate::fuzzable::contract_address::FuzzableContractAddress;
use crate::fuzzable::eid::FuzzableEid;
use crate::fuzzable::keys::FuzzableKeyPair;
use crate::mocks::erc20::interface::IMockERC20DispatcherTrait;
use crate::utils::sort;
use crate::workers::dvn::utils::{KeyPair, build_signatures};
use crate::workers::executor::utils::{
    ExecutorOptionBytes, serialize_executor_options, serialize_lz_receive_option,
};

const MAX_REQUIRED_DVNS: u8 = 4;
const MAX_OPTIONAL_DVNS: u8 = 4;
const DVN_CONFIRMATIONS: u64 = 1;
const DEFAULT_EXPIRATION: u256 = Bounded::<u256>::MAX;
const MAX_MESSAGE_SIZE: u32 = 1024;
const LZ_RECEIVE_USER_GAS: u128 = 100_000;
const TREASURY_NATIVE_FEE_CAP: u256 = 0;

fn deploy_dvns(
    config: @BlockchainConfig,
    message_lib: ContractAddress,
    price_feed: ContractAddress,
    vid: u32,
    remote_eid: u32,
    count: u8,
) -> Array<DvnHelper> {
    (0..count)
        .into_iter()
        .map(
            |
                index,
            | deploy_dvn(
                message_lib,
                price_feed,
                vid + index.into(),
                config.dvn_signers,
                array![*config.dvn_admin].span(),
                *config.dvn_owner,
                DEFAULT_DVN_DST_CONFIG,
                remote_eid,
            ),
        )
        .collect()
}

#[derive(Drop)]
struct Blockchain {
    native_token: ERC20Helper,
    endpoint: EndpointV2Helper,
    message_lib: UltraLightNode302Helper,
    treasury: TreasuryHelper,
    executor: ExecutorHelper,
    required_dvns: Array<DvnHelper>,
    optional_dvns: Array<DvnHelper>,
    counter: OmniCounterHelper,
}

fn setup_blockchain(
    config: @BlockchainConfig, remote_eid: u32, required_dvn_count: u8, optional_dvn_count: u8,
) -> Blockchain {
    let chain = setup_layer_zero(
        config,
        BlockchainOptions {
            dvn_dst_config: DEFAULT_DVN_DST_CONFIG,
            treasury_native_fee_cap: TREASURY_NATIVE_FEE_CAP,
        },
        remote_eid,
    );

    let required_dvns = deploy_dvns(
        config,
        chain.message_lib.address,
        chain.price_feed,
        *config.dvn_vid,
        remote_eid,
        required_dvn_count,
    );
    let optional_dvns = deploy_dvns(
        config,
        chain.message_lib.address,
        chain.price_feed,
        *config.dvn_vid + required_dvn_count.into(),
        remote_eid,
        optional_dvn_count,
    );

    let counter = deploy_omni_counter(
        chain.endpoint.address, *config.oapp_owner, chain.native_token.address,
    );
    cheat_caller_address_once(counter.address, *config.oapp_owner);
    counter.oapp.set_delegate(*config.oapp_owner);

    Blockchain {
        native_token: chain.native_token,
        endpoint: chain.endpoint,
        message_lib: chain.message_lib,
        treasury: chain.treasury,
        executor: chain.executor,
        required_dvns,
        optional_dvns,
        counter,
    }
}

fn create_uln_config(
    required_dvns: Span<DvnHelper>, optional_dvns: Span<DvnHelper>, optional_dvn_threshold: u8,
) -> UlnConfig {
    UlnConfig {
        confirmations: DVN_CONFIRMATIONS,
        has_confirmations: true,
        required_dvns: sort(required_dvns.into_iter().map(|dvn| *dvn.address).collect()),
        has_required_dvns: true,
        optional_dvns: sort(optional_dvns.into_iter().map(|dvn| *dvn.address).collect()),
        optional_dvn_threshold,
        has_optional_dvns: true,
    }
}

fn create_message_options() -> ByteArray {
    let executor_options = serialize_executor_options(
        array![
            ExecutorOptionBytes {
                option_type: OPTION_TYPE_LZRECEIVE,
                option: serialize_lz_receive_option(LZ_RECEIVE_USER_GAS, None),
            },
        ],
    );

    let mut options: ByteArray = Default::default();
    options.append_u16(TYPE_3);
    options.append(@executor_options);
    options
}

#[test]
#[fuzzer(runs: 10)]
fn test_verify_and_commit(
    src_config: BlockchainConfig,
    dst_config: BlockchainConfig,
    required_dvn_count_seed: u8,
    optional_dvn_count_seed: u8,
    optional_dvn_threshold_seed: u8,
) {
    let optional_dvn_count = optional_dvn_count_seed % (MAX_OPTIONAL_DVNS + 1);
    let optional_dvn_threshold = if optional_dvn_count == 0 {
        0
    } else {
        optional_dvn_threshold_seed % optional_dvn_count + 1 // in [1, optional_dvn_count]
    };
    let required_dvn_count = if optional_dvn_count == 0 {
        required_dvn_count_seed % MAX_REQUIRED_DVNS + 1 // in [1, MAX_REQUIRED_DVNS]
    } else {
        required_dvn_count_seed % (MAX_REQUIRED_DVNS + 1) // in [0, MAX_REQUIRED_DVNS]
    };

    assert_gt!(required_dvn_count + optional_dvn_count, 0);

    let src = setup_blockchain(
        @src_config, dst_config.eid.eid, required_dvn_count, optional_dvn_count,
    );
    let dst = setup_blockchain(
        @dst_config, src_config.eid.eid, required_dvn_count, optional_dvn_count,
    );

    // =============================== Wiring =================================

    wire_ultra_light_node_302(
        src_config.message_lib_owner,
        @src.message_lib,
        dst_config.eid.eid,
        create_uln_config(
            src.required_dvns.span(), src.optional_dvns.span(), optional_dvn_threshold,
        ),
        ExecutorConfig { executor: src.executor.address, max_message_size: MAX_MESSAGE_SIZE },
    );

    wire_ultra_light_node_302(
        dst_config.message_lib_owner,
        @dst.message_lib,
        src_config.eid.eid,
        create_uln_config(
            dst.required_dvns.span(), dst.optional_dvns.span(), optional_dvn_threshold,
        ),
        ExecutorConfig { executor: dst.executor.address, max_message_size: MAX_MESSAGE_SIZE },
    );

    wire_oapp(
        @src.endpoint,
        src.message_lib.address,
        src.counter.oapp,
        src_config.oapp_owner,
        dst_config.eid.eid,
        dst.counter.address,
    );

    wire_oapp(
        @dst.endpoint,
        dst.message_lib.address,
        dst.counter.oapp,
        dst_config.oapp_owner,
        src_config.eid.eid,
        src.counter.address,
    );

    // =============================== Send a message =================================

    let options = create_message_options();
    let fee = src
        .counter
        .omni_counter
        .quote(dst_config.eid.eid, VANILLA_TYPE, options.clone(), false);

    assert_gt!(fee.native_fee, 0);
    assert_eq(fee.lz_token_fee, 0);

    // Mint a message fee to the user.
    cheat_caller_address_once(src.native_token.address, src_config.native_token_owner);
    src.native_token.mock_erc20.mint(src_config.user, fee.native_fee);

    assert_eq(src.native_token.erc20.balance_of(src_config.user), fee.native_fee);

    // Approve the fee from the user to the counter.
    cheat_caller_address_once(src.native_token.address, src_config.user);
    src.native_token.erc20.approve(src.counter.address, fee.native_fee);

    let mut spy = spy_events();

    // Send an increment message.
    cheat_caller_address_once(src.counter.address, src_config.user);
    src
        .counter
        .omni_counter
        .increment(dst_config.eid.eid, VANILLA_TYPE, options, fee.clone(), src_config.user);

    assert_eq(src.native_token.erc20.balance_of(src_config.user), 0);

    spy
        .assert_emitted(
            @array![
                (
                    src.counter.address,
                    OmniCounter::Event::IncrementSent(
                        IncrementSent {
                            sender: src_config.user,
                            dst_eid: dst_config.eid.eid,
                            increment_type: VANILLA_TYPE,
                        },
                    ),
                ),
            ],
        );

    for dvn in src.required_dvns.span().into_iter().chain(src.optional_dvns.span()) {
        // Withdraw a DVN fee.
        let balance = src.native_token.erc20.balance_of(src_config.dvn_owner);
        let amount = src.native_token.erc20.balance_of(*dvn.address);

        cheat_caller_address_once(*dvn.address, src_config.dvn_admin);
        dvn.worker_base.withdraw_fee(src.native_token.address, src_config.dvn_owner, amount);

        assert_gt!(amount, 0);
        assert_eq(src.native_token.erc20.balance_of(src_config.dvn_owner), balance + amount);
        assert_eq(src.native_token.erc20.balance_of(*dvn.address), 0);
    }

    // Withdraw an executor fee.
    cheat_caller_address(
        src.executor.address, src_config.executor_admin, CheatSpan::TargetCalls(1),
    );
    src
        .executor
        .worker_base
        .withdraw_fee(
            src.native_token.address,
            src_config.executor_role_admin,
            src.native_token.erc20.balance_of(src.executor.address),
        );

    assert_gt!(src.native_token.erc20.balance_of(src_config.executor_role_admin), 0);

    // Withdraw a treasury fee.
    cheat_caller_address_once(src.treasury.address, src_config.treasury_owner);
    src
        .treasury
        .treasury_admin
        .withdraw_tokens(
            src.native_token.address,
            src_config.treasury_owner,
            src.native_token.erc20.balance_of(src.treasury.address),
        );

    assert_eq(src.native_token.erc20.balance_of(src_config.treasury_owner), fee.native_fee / 2);

    // =============================== Verify a message =================================

    // Extract a packet-sent event from the event stream on the endpoint.
    let events = spy.get_events().emitted_by(src.endpoint.address).events;

    assert_eq(events.len(), 1);

    let (_, event) = events.at(0);
    let (encoded_packet, _) = decode_packet_on_endpoint(event);

    // Decode packet fields and encode them into the call data.
    let mut calldata = array![];
    PacketV1Codec::header(@encoded_packet).serialize(ref calldata);
    PacketV1Codec::payload_hash(@encoded_packet).serialize(ref calldata);
    DVN_CONFIRMATIONS.serialize(ref calldata);

    let call_data = Call {
        to: dst.message_lib.address, selector: selector!("verify"), calldata: calldata.span(),
    };

    // TODO Inline this when type inference is fixed in the Cairo compiler.
    let chosen_optional_dvns: Array<@DvnHelper> = dst
        .optional_dvns
        .span()
        .into_iter()
        .take(optional_dvn_threshold.into())
        .collect();

    // Iterate over all DVNs and execute the `verify` function call against ULN one by one.
    for (index, dvn) in dst
        .required_dvns
        .span()
        .into_iter()
        .chain(chosen_optional_dvns)
        .enumerate() {
        let hash = dvn.dvn.hash_call_data(*dvn.vid, call_data, DEFAULT_EXPIRATION);
        let signatures = build_signatures(
            array![dst_config.dvn_signers[0].clone(), dst_config.dvn_signers[1].clone()].span(),
            hash,
        );

        cheat_caller_address_once(*dvn.address, dst_config.dvn_admin);
        dvn
            .dvn
            .execute(
                array![
                    DvnExecuteParam {
                        vid: *dvn.vid,
                        call_data,
                        expiration: DEFAULT_EXPIRATION,
                        signatures: signatures.span(),
                    },
                ],
            );

        // Because we do not meet the quorum count yet, the commit should fail as ULN is still
        // verifying the message.
        if index + 1 < required_dvn_count.into() + optional_dvn_threshold.into() {
            let result = dst
                .message_lib
                .safe_message_lib
                .commit(
                    PacketV1Codec::header(@encoded_packet),
                    PacketV1Codec::payload_hash(@encoded_packet),
                );

            assert_panic_with_error(result, err_uln_verifying());
        }
    }

    // =============================== Commit a message =================================

    dst
        .message_lib
        .message_lib
        .commit(
            PacketV1Codec::header(@encoded_packet), PacketV1Codec::payload_hash(@encoded_packet),
        );
}

#[test]
#[fuzzer(runs: 10)]
fn test_invalid_signature(
    src_config: BlockchainConfig,
    dst_config: BlockchainConfig,
    invalid_signer: KeyPair,
    required_dvn_count_seed: u8,
    optional_dvn_count_seed: u8,
    optional_dvn_threshold_seed: u8,
) {
    let optional_dvn_count = optional_dvn_count_seed % (MAX_OPTIONAL_DVNS - 1) + 2;
    let optional_dvn_threshold = optional_dvn_threshold_seed % (optional_dvn_count - 1) + 1;
    let required_dvn_count = required_dvn_count_seed % (MAX_REQUIRED_DVNS + 1);

    assert(optional_dvn_count >= 2, 'At least 2');
    assert(optional_dvn_count <= MAX_OPTIONAL_DVNS, 'At most MAX_OPTIONAL_DVNS');
    assert(optional_dvn_threshold >= 1, 'At least 1');
    // There is at least an optional DVN that can be invalid.
    assert(optional_dvn_threshold < optional_dvn_count, 'Less than optional_dvn_count');
    assert(required_dvn_count <= MAX_REQUIRED_DVNS, 'At most MAX_REQUIRED_DVNS');

    let src = setup_blockchain(
        @src_config, dst_config.eid.eid, required_dvn_count, optional_dvn_count,
    );
    let dst = setup_blockchain(
        @dst_config, src_config.eid.eid, required_dvn_count, optional_dvn_count,
    );

    // =============================== Wiring =================================

    wire_ultra_light_node_302(
        src_config.message_lib_owner,
        @src.message_lib,
        dst_config.eid.eid,
        create_uln_config(
            src.required_dvns.span(), src.optional_dvns.span(), optional_dvn_threshold,
        ),
        ExecutorConfig { executor: src.executor.address, max_message_size: MAX_MESSAGE_SIZE },
    );

    wire_ultra_light_node_302(
        dst_config.message_lib_owner,
        @dst.message_lib,
        src_config.eid.eid,
        create_uln_config(
            dst.required_dvns.span(), dst.optional_dvns.span(), optional_dvn_threshold,
        ),
        ExecutorConfig { executor: dst.executor.address, max_message_size: MAX_MESSAGE_SIZE },
    );

    wire_oapp(
        @src.endpoint,
        src.message_lib.address,
        src.counter.oapp,
        src_config.oapp_owner,
        dst_config.eid.eid,
        dst.counter.address,
    );

    wire_oapp(
        @dst.endpoint,
        dst.message_lib.address,
        dst.counter.oapp,
        dst_config.oapp_owner,
        src_config.eid.eid,
        src.counter.address,
    );

    // =============================== Send a message =================================

    let options = create_message_options();
    let fee = src
        .counter
        .omni_counter
        .quote(dst_config.eid.eid, VANILLA_TYPE, options.clone(), false);

    assert_gt!(fee.native_fee, 0);
    assert_eq(fee.lz_token_fee, 0);

    // Mint a message fee to the user.
    cheat_caller_address_once(src.native_token.address, src_config.native_token_owner);
    src.native_token.mock_erc20.mint(src_config.user, fee.native_fee);

    assert_eq(src.native_token.erc20.balance_of(src_config.user), fee.native_fee);

    // Approve the fee from the user to the counter.
    cheat_caller_address_once(src.native_token.address, src_config.user);
    src.native_token.erc20.approve(src.counter.address, fee.native_fee);

    let mut spy = spy_events();

    // Send an increment message.
    cheat_caller_address_once(src.counter.address, src_config.user);
    src
        .counter
        .omni_counter
        .increment(dst_config.eid.eid, VANILLA_TYPE, options, fee.clone(), src_config.user);

    assert_eq(src.native_token.erc20.balance_of(src_config.user), 0);

    spy
        .assert_emitted(
            @array![
                (
                    src.counter.address,
                    OmniCounter::Event::IncrementSent(
                        IncrementSent {
                            sender: src_config.user,
                            dst_eid: dst_config.eid.eid,
                            increment_type: VANILLA_TYPE,
                        },
                    ),
                ),
            ],
        );

    for dvn in src.required_dvns.span().into_iter().chain(src.optional_dvns.span()) {
        // Withdraw a DVN fee.
        let balance = src.native_token.erc20.balance_of(src_config.dvn_owner);
        let amount = src.native_token.erc20.balance_of(*dvn.address);

        cheat_caller_address_once(*dvn.address, src_config.dvn_admin);
        dvn.worker_base.withdraw_fee(src.native_token.address, src_config.dvn_owner, amount);

        assert(amount > 0, 'Greater than 0');
        assert_eq(src.native_token.erc20.balance_of(src_config.dvn_owner), balance + amount);
        assert_eq(src.native_token.erc20.balance_of(*dvn.address), 0);
    }

    // Withdraw an executor fee.
    cheat_caller_address(
        src.executor.address, src_config.executor_admin, CheatSpan::TargetCalls(1),
    );
    src
        .executor
        .worker_base
        .withdraw_fee(
            src.native_token.address,
            src_config.executor_role_admin,
            src.native_token.erc20.balance_of(src.executor.address),
        );

    assert(src.native_token.erc20.balance_of(src_config.executor_role_admin) > 0, 'Greater than 0');

    // Withdraw a treasury fee.
    cheat_caller_address_once(src.treasury.address, src_config.treasury_owner);
    src
        .treasury
        .treasury_admin
        .withdraw_tokens(
            src.native_token.address,
            src_config.treasury_owner,
            src.native_token.erc20.balance_of(src.treasury.address),
        );

    assert_eq(src.native_token.erc20.balance_of(src_config.treasury_owner), fee.native_fee / 2);

    // =============================== Verify a message =================================

    // Extract a packet-sent event from the event stream on the endpoint.
    let events = spy.get_events().emitted_by(src.endpoint.address).events;

    assert_eq(events.len(), 1);

    let (_, event) = events.at(0);
    let (encoded_packet, _) = decode_packet_on_endpoint(event);

    // Decode packet fields and encode them into the call data.
    let mut calldata = array![];
    PacketV1Codec::header(@encoded_packet).serialize(ref calldata);
    PacketV1Codec::payload_hash(@encoded_packet).serialize(ref calldata);
    DVN_CONFIRMATIONS.serialize(ref calldata);

    let call_data = Call {
        to: dst.message_lib.address, selector: selector!("verify"), calldata: calldata.span(),
    };

    let mut invalid_optional_dvns = dst.optional_dvns.span().into_iter();
    invalid_optional_dvns.advance_by(optional_dvn_threshold.into()).unwrap();

    for dvn in invalid_optional_dvns {
        let hash = dvn.dvn.hash_call_data(*dvn.vid, call_data, DEFAULT_EXPIRATION);
        // Use an invalid signer that does not correspond to this DVN.
        let signatures = build_signatures(
            array![invalid_signer.clone(), dst_config.dvn_signers[0].clone()].span(), hash,
        );

        // Execute the `verify` function call with the invalid signature.
        cheat_caller_address_once(*dvn.address, dst_config.dvn_admin);
        dvn
            .dvn
            .execute(
                array![
                    DvnExecuteParam {
                        vid: *dvn.vid,
                        call_data,
                        expiration: DEFAULT_EXPIRATION,
                        signatures: signatures.span(),
                    },
                ],
            );

        let result = dst
            .message_lib
            .safe_message_lib
            .commit(
                PacketV1Codec::header(@encoded_packet),
                PacketV1Codec::payload_hash(@encoded_packet),
            );

        assert_panic_with_error(result, err_uln_verifying());
    }

    // TODO Inline this when type inference is fixed in the Cairo compiler.
    let chosen_optional_dvns: Array<@DvnHelper> = dst
        .optional_dvns
        .span()
        .into_iter()
        .take(optional_dvn_threshold.into())
        .collect();

    // Iterate over all valid DVNs and execute the `verify` function call against ULN one by one.
    for (index, dvn) in dst
        .required_dvns
        .span()
        .into_iter()
        .chain(chosen_optional_dvns)
        .enumerate() {
        let hash = dvn.dvn.hash_call_data(*dvn.vid, call_data, DEFAULT_EXPIRATION);
        let signatures = build_signatures(
            array![dst_config.dvn_signers[0].clone(), dst_config.dvn_signers[1].clone()].span(),
            hash,
        );

        cheat_caller_address_once(*dvn.address, dst_config.dvn_admin);
        dvn
            .dvn
            .execute(
                array![
                    DvnExecuteParam {
                        vid: *dvn.vid,
                        call_data,
                        expiration: DEFAULT_EXPIRATION,
                        signatures: signatures.span(),
                    },
                ],
            );

        if index + 1 < required_dvn_count.into() + optional_dvn_threshold.into() {
            // Because we do not meet the quorum count yet, the commit should fail as ULN is still
            // verifying the message.
            let result = dst
                .message_lib
                .safe_message_lib
                .commit(
                    PacketV1Codec::header(@encoded_packet),
                    PacketV1Codec::payload_hash(@encoded_packet),
                );

            assert_panic_with_error(result, err_uln_verifying());
        }
    }

    // =============================== Commit a message =================================

    dst
        .message_lib
        .message_lib
        .commit(
            PacketV1Codec::header(@encoded_packet), PacketV1Codec::payload_hash(@encoded_packet),
        );
}
