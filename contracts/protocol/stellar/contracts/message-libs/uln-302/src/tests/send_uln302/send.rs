use crate::{
    events::{DVNFeePaid, ExecutorFeePaid},
    interfaces::{ExecutorConfig, UlnConfig},
    tests::setup::{
        setup, DummyDVNClient, DummyExecutorClient, CONFIRMATIONS, DVN_FEE, EXECUTOR_FEE, LOCAL_EID as EID,
        MAX_MESSAGE_SIZE, REMOTE_EID as DST_EID, TREASURY_NATIVE_FEE, TREASURY_ZRO_FEE,
    },
};
use endpoint_v2::{FeeRecipient, OutboundPacket};
use message_lib_common::{packet_codec_v1, testing_utils::create_type3_options};
use soroban_sdk::{
    log,
    testutils::{Address as _, MockAuth, MockAuthInvoke},
    vec, Bytes, BytesN, IntoVal,
};
use soroban_sdk::{Address, Env, Vec};
use utils::testing_utils::assert_eq_events;

// Note that all the hot paths and assertions are covered in the quote test so here we only test the events emittance
#[test]
fn test_send_events_emittance() {
    let mut setup = setup();
    let oapp = Address::generate(&setup.env);

    // setup workers
    let mut dvns = Vec::new(&setup.env);
    DVN_FEE.iter().for_each(|fee| {
        let dvn = setup.register_dvn(*fee);
        dvns.push_back(dvn);
    });
    let executor = setup.register_executor(EXECUTOR_FEE);
    setup.treasury.set_native_fee(&TREASURY_NATIVE_FEE);
    setup.treasury.set_zro_fee(&TREASURY_ZRO_FEE);

    // setup configs
    setup.set_default_send_uln_config(
        DST_EID,
        UlnConfig::new(
            CONFIRMATIONS,
            &vec![&setup.env, dvns.get_unchecked(0), dvns.get_unchecked(1)],
            &vec![&setup.env],
            0,
        ),
    );
    setup.set_default_executor_config(DST_EID, ExecutorConfig::new(MAX_MESSAGE_SIZE, &executor));

    let effective_send_uln_config = setup.uln302.effective_send_uln_config(&oapp, &DST_EID);
    log!(&setup.env, "effective_send_uln_config: {:?}", effective_send_uln_config);

    // quote
    let packet = OutboundPacket {
        nonce: 1,
        src_eid: EID,
        sender: oapp,
        dst_eid: DST_EID,
        receiver: BytesN::<32>::from_array(&setup.env, &[0u8; 32]),
        guid: BytesN::<32>::from_array(&setup.env, &[0u8; 32]),
        message: Bytes::from_array(&setup.env, b"dummy testing message"),
    };
    let options = create_type3_options(&setup.env, &vec![&setup.env, dvns.get_unchecked(0)], true);
    let pay_in_zro = false;

    setup.env.mock_auths(&[MockAuth {
        address: &setup.endpoint.address,
        invoke: &MockAuthInvoke {
            contract: &setup.uln302.address,
            fn_name: "send",
            args: (&packet, &options, &pay_in_zro).into_val(&setup.env),
            sub_invokes: &[],
        },
    }]);
    let send_result = setup.uln302.send(&packet, &options, &pay_in_zro);
    let native_fee_recipients = &send_result.native_fee_recipients;
    let zro_fee_recipients = &send_result.zro_fee_recipients;
    assert_eq_events(
        &setup.env,
        &setup.uln302.address,
        &[
            &ExecutorFeePaid {  guid: packet.guid.clone(),executor: executor.clone(), fee: native_fee_recipients.get(0).unwrap().clone() },
            &DVNFeePaid { guid: packet.guid.clone(),dvns: dvns.slice(0..2).clone(), fees: native_fee_recipients.slice(1..3).clone() },
        ],
    );

    // executor, dvn1, dvn2, treasury native fee
    assert_eq!(native_fee_recipients.len(), 4);
    assert_eq!(zro_fee_recipients.len(), 0);
    assert_eq!(
        native_fee_recipients.get(0).unwrap(),
        FeeRecipient { amount: EXECUTOR_FEE, to: DummyExecutorClient::new(&setup.env, &executor).recipient() }
    );
    assert_eq!(
        native_fee_recipients.get(1).unwrap(),
        FeeRecipient { amount: DVN_FEE[0], to: DummyDVNClient::new(&setup.env, &dvns.get_unchecked(0)).recipient() }
    );
    assert_eq!(
        native_fee_recipients.get(2).unwrap(),
        FeeRecipient { amount: DVN_FEE[1], to: DummyDVNClient::new(&setup.env, &dvns.get_unchecked(1)).recipient() }
    );
    assert_eq!(
        native_fee_recipients.get(3).unwrap(),
        FeeRecipient { amount: TREASURY_NATIVE_FEE, to: setup.treasury.address }
    );
    assert_eq!(send_result.encoded_packet, packet_codec_v1::encode_packet(&setup.env, &packet));
}

#[test]
fn test_send_events_emittance_with_zro() {
    let mut setup = setup();
    let oapp = Address::generate(&setup.env);

    // setup workers
    let mut dvns = Vec::new(&setup.env);
    DVN_FEE.iter().for_each(|fee| {
        let dvn = setup.register_dvn(*fee);
        dvns.push_back(dvn);
    });
    let executor = setup.register_executor(EXECUTOR_FEE);
    setup.treasury.set_native_fee(&TREASURY_NATIVE_FEE);
    setup.treasury.set_zro_fee(&TREASURY_ZRO_FEE);

    // setup configs
    setup.set_default_send_uln_config(
        DST_EID,
        UlnConfig::new(
            CONFIRMATIONS,
            &vec![&setup.env, dvns.get_unchecked(0), dvns.get_unchecked(1)],
            &vec![&setup.env],
            0,
        ),
    );
    setup.set_default_executor_config(DST_EID, ExecutorConfig::new(MAX_MESSAGE_SIZE, &executor));

    let effective_send_uln_config = setup.uln302.effective_send_uln_config(&oapp, &DST_EID);
    log!(&setup.env, "effective_send_uln_config: {:?}", effective_send_uln_config);

    // quote
    let packet = OutboundPacket {
        nonce: 1,
        src_eid: EID,
        sender: oapp,
        dst_eid: DST_EID,
        receiver: BytesN::<32>::from_array(&setup.env, &[0u8; 32]),
        guid: BytesN::<32>::from_array(&setup.env, &[0u8; 32]),
        message: Bytes::from_array(&setup.env, b"dummy testing message"),
    };
    let options = create_type3_options(&setup.env, &vec![&setup.env, dvns.get_unchecked(0)], true);
    let pay_in_zro = true;

    setup.env.mock_auths(&[MockAuth {
        address: &setup.endpoint.address,
        invoke: &MockAuthInvoke {
            contract: &setup.uln302.address,
            fn_name: "send",
            args: (&packet, &options, &pay_in_zro).into_val(&setup.env),
            sub_invokes: &[],
        },
    }]);

    let send_result = setup.uln302.send(&packet, &options, &pay_in_zro);
    let native_fee_recipients = &send_result.native_fee_recipients;
    let zro_fee_recipients = &send_result.zro_fee_recipients;

    assert_eq_events(
        &setup.env,
        &setup.uln302.address,
        &[
            &ExecutorFeePaid {  guid: packet.guid.clone(), executor: executor.clone(), fee: native_fee_recipients.get(0).unwrap().clone() },
            &DVNFeePaid { guid: packet.guid.clone(), dvns: dvns.slice(0..2).clone(), fees: native_fee_recipients.slice(1..3).clone() },
        ],
    );

    assert_eq!(send_result.encoded_packet, packet_codec_v1::encode_packet(&setup.env, &packet));
    // executor, dvn1, dvn2
    assert_eq!(native_fee_recipients.len(), 3);
    assert_eq!(
        native_fee_recipients.get(0).unwrap(),
        FeeRecipient { amount: EXECUTOR_FEE, to: DummyExecutorClient::new(&setup.env, &executor).recipient() }
    );
    assert_eq!(
        native_fee_recipients.get(1).unwrap(),
        FeeRecipient { amount: DVN_FEE[0], to: DummyDVNClient::new(&setup.env, &dvns.get_unchecked(0)).recipient() }
    );
    assert_eq!(
        native_fee_recipients.get(2).unwrap(),
        FeeRecipient { amount: DVN_FEE[1], to: DummyDVNClient::new(&setup.env, &dvns.get_unchecked(1)).recipient() }
    );
    assert_eq!(
        zro_fee_recipients.get(0).unwrap(),
        FeeRecipient { amount: TREASURY_ZRO_FEE, to: setup.treasury.address }
    );
    assert_eq!(send_result.encoded_packet, packet_codec_v1::encode_packet(&setup.env, &packet));
}

#[test]
fn test_send_single_dvn() {
    let mut setup = setup();
    let oapp = Address::generate(&setup.env);

    // setup workers
    let mut dvns = Vec::new(&setup.env);
    DVN_FEE.iter().for_each(|fee| {
        let dvn = setup.register_dvn(*fee);
        dvns.push_back(dvn);
    });
    let executor = setup.register_executor(EXECUTOR_FEE);
    setup.treasury.set_native_fee(&TREASURY_NATIVE_FEE);
    setup.treasury.set_zro_fee(&TREASURY_ZRO_FEE);

    // setup configs
    setup.set_default_send_uln_config(
        DST_EID,
        UlnConfig::new(CONFIRMATIONS, &vec![&setup.env, dvns.get_unchecked(0)], &vec![&setup.env], 0),
    );
    setup.set_default_executor_config(DST_EID, ExecutorConfig::new(MAX_MESSAGE_SIZE, &executor));

    // send
    let packet = OutboundPacket {
        nonce: 1,
        src_eid: EID,
        sender: oapp,
        dst_eid: DST_EID,
        receiver: BytesN::<32>::from_array(&setup.env, &[0u8; 32]),
        guid: BytesN::<32>::from_array(&setup.env, &[0u8; 32]),
        message: Bytes::from_array(&setup.env, b"dummy testing message"),
    };
    let options = create_type3_options(&setup.env, &vec![&setup.env, dvns.get_unchecked(0)], true);
    let pay_in_zro = false;

    setup.env.mock_auths(&[MockAuth {
        address: &setup.endpoint.address,
        invoke: &MockAuthInvoke {
            contract: &setup.uln302.address,
            fn_name: "send",
            args: (&packet, &options, &pay_in_zro).into_val(&setup.env),
            sub_invokes: &[],
        },
    }]);
    let send_result = setup.uln302.send(&packet, &options, &pay_in_zro);
    let native_fee_recipients = &send_result.native_fee_recipients;
    let zro_fee_recipients = &send_result.zro_fee_recipients;

    // executor, dvn, treasury
    assert_eq!(native_fee_recipients.len(), 3);
    assert_eq!(zro_fee_recipients.len(), 0);
    assert_eq!(
        native_fee_recipients.get(0).unwrap(),
        FeeRecipient { amount: EXECUTOR_FEE, to: DummyExecutorClient::new(&setup.env, &executor).recipient() }
    );
    assert_eq!(
        native_fee_recipients.get(1).unwrap(),
        FeeRecipient { amount: DVN_FEE[0], to: DummyDVNClient::new(&setup.env, &dvns.get_unchecked(0)).recipient() }
    );
    assert_eq!(
        native_fee_recipients.get(2).unwrap(),
        FeeRecipient { amount: TREASURY_NATIVE_FEE, to: setup.treasury.address }
    );
    assert_eq!(send_result.encoded_packet, packet_codec_v1::encode_packet(&setup.env, &packet));
}

#[test]
#[should_panic(expected = "HostError: Error(Auth, InvalidAction)")]
fn test_send_from_non_endpoint() {
    let mut setup = setup();
    let oapp = Address::generate(&setup.env);

    // setup workers
    let mut dvns = Vec::new(&setup.env);
    DVN_FEE.iter().for_each(|fee| {
        let dvn = setup.register_dvn(*fee);
        dvns.push_back(dvn);
    });
    let executor = setup.register_executor(EXECUTOR_FEE);
    setup.treasury.set_native_fee(&TREASURY_NATIVE_FEE);
    setup.treasury.set_zro_fee(&TREASURY_ZRO_FEE);

    // setup configs
    setup.set_default_send_uln_config(
        DST_EID,
        UlnConfig::new(CONFIRMATIONS, &vec![&setup.env, dvns.get_unchecked(0)], &vec![&setup.env], 0),
    );
    setup.set_default_executor_config(DST_EID, ExecutorConfig::new(MAX_MESSAGE_SIZE, &executor));

    // send without proper auth
    let packet = OutboundPacket {
        nonce: 1,
        src_eid: EID,
        sender: oapp,
        dst_eid: DST_EID,
        receiver: BytesN::<32>::from_array(&setup.env, &[0u8; 32]),
        guid: BytesN::<32>::from_array(&setup.env, &[0u8; 32]),
        message: Bytes::from_array(&setup.env, b"dummy testing message"),
    };
    let options = create_type3_options(&setup.env, &vec![&setup.env, dvns.get_unchecked(0)], true);
    let pay_in_zro = false;

    setup.uln302.send(&packet, &options, &pay_in_zro);
}

#[test]
fn test_send_multiple_dvns() {
    let mut setup = setup();
    let oapp = Address::generate(&setup.env);

    // setup workers
    let mut dvns = Vec::new(&setup.env);
    DVN_FEE.iter().for_each(|fee| {
        let dvn = setup.register_dvn(*fee);
        dvns.push_back(dvn);
    });
    let executor = setup.register_executor(EXECUTOR_FEE);
    setup.treasury.set_native_fee(&TREASURY_NATIVE_FEE);
    setup.treasury.set_zro_fee(&TREASURY_ZRO_FEE);

    // setup configs
    setup.set_default_send_uln_config(
        DST_EID,
        UlnConfig::new(
            CONFIRMATIONS,
            &vec![&setup.env, dvns.get_unchecked(0), dvns.get_unchecked(1)],
            &vec![&setup.env],
            0,
        ),
    );
    setup.set_default_executor_config(DST_EID, ExecutorConfig::new(MAX_MESSAGE_SIZE, &executor));

    // send
    let packet = OutboundPacket {
        nonce: 1,
        src_eid: EID,
        sender: oapp,
        dst_eid: DST_EID,
        receiver: BytesN::<32>::from_array(&setup.env, &[0u8; 32]),
        guid: BytesN::<32>::from_array(&setup.env, &[0u8; 32]),
        message: Bytes::from_array(&setup.env, b"dummy testing message"),
    };
    let options =
        create_type3_options(&setup.env, &vec![&setup.env, dvns.get_unchecked(0), dvns.get_unchecked(1)], true);
    let pay_in_zro = false;

    setup.env.mock_auths(&[MockAuth {
        address: &setup.endpoint.address,
        invoke: &MockAuthInvoke {
            contract: &setup.uln302.address,
            fn_name: "send",
            args: (&packet, &options, &pay_in_zro).into_val(&setup.env),
            sub_invokes: &[],
        },
    }]);
    let send_result = setup.uln302.send(&packet, &options, &pay_in_zro);
    let native_fee_recipients = &send_result.native_fee_recipients;
    let zro_fee_recipients = &send_result.zro_fee_recipients;

    // executor, dvn1, dvn2, treasury
    assert_eq!(native_fee_recipients.len(), 4);
    assert_eq!(zro_fee_recipients.len(), 0);
    assert_eq!(
        native_fee_recipients.get(0).unwrap(),
        FeeRecipient { amount: EXECUTOR_FEE, to: DummyExecutorClient::new(&setup.env, &executor).recipient() }
    );
    assert_eq!(
        native_fee_recipients.get(1).unwrap(),
        FeeRecipient { amount: DVN_FEE[0], to: DummyDVNClient::new(&setup.env, &dvns.get_unchecked(0)).recipient() }
    );
    assert_eq!(
        native_fee_recipients.get(2).unwrap(),
        FeeRecipient { amount: DVN_FEE[1], to: DummyDVNClient::new(&setup.env, &dvns.get_unchecked(1)).recipient() }
    );
    assert_eq!(
        native_fee_recipients.get(3).unwrap(),
        FeeRecipient { amount: TREASURY_NATIVE_FEE, to: setup.treasury.address }
    );
    assert_eq!(send_result.encoded_packet, packet_codec_v1::encode_packet(&setup.env, &packet));
}

#[test]
fn test_send_with_only_optional_dvns() {
    let mut setup = setup();
    let oapp = Address::generate(&setup.env);

    // setup workers
    let mut dvns = Vec::new(&setup.env);
    DVN_FEE.iter().for_each(|fee| {
        let dvn = setup.register_dvn(*fee);
        dvns.push_back(dvn);
    });
    let executor = setup.register_executor(EXECUTOR_FEE);
    setup.treasury.set_native_fee(&TREASURY_NATIVE_FEE);
    setup.treasury.set_zro_fee(&TREASURY_ZRO_FEE);

    // setup configs
    setup.set_default_send_uln_config(
        DST_EID,
        UlnConfig::new(CONFIRMATIONS, &vec![&setup.env], &vec![&setup.env, dvns.get_unchecked(0)], 1),
    );
    setup.set_default_executor_config(DST_EID, ExecutorConfig::new(MAX_MESSAGE_SIZE, &executor));

    // send
    let packet = OutboundPacket {
        nonce: 1,
        src_eid: EID,
        sender: oapp,
        dst_eid: DST_EID,
        receiver: BytesN::<32>::from_array(&setup.env, &[0u8; 32]),
        guid: BytesN::<32>::from_array(&setup.env, &[0u8; 32]),
        message: Bytes::from_array(&setup.env, b"dummy testing message"),
    };
    let options = create_type3_options(&setup.env, &vec![&setup.env, dvns.get_unchecked(0)], true);
    let pay_in_zro = false;

    setup.env.mock_auths(&[MockAuth {
        address: &setup.endpoint.address,
        invoke: &MockAuthInvoke {
            contract: &setup.uln302.address,
            fn_name: "send",
            args: (&packet, &options, &pay_in_zro).into_val(&setup.env),
            sub_invokes: &[],
        },
    }]);
    let send_result = setup.uln302.send(&packet, &options, &pay_in_zro);
    let native_fee_recipients = &send_result.native_fee_recipients;
    let zro_fee_recipients = &send_result.zro_fee_recipients;

    // executor, dvn, treasury
    assert_eq!(native_fee_recipients.len(), 3);
    assert_eq!(zro_fee_recipients.len(), 0);
    assert_eq!(
        native_fee_recipients.get(0).unwrap(),
        FeeRecipient { amount: EXECUTOR_FEE, to: DummyExecutorClient::new(&setup.env, &executor).recipient() }
    );
    assert_eq!(
        native_fee_recipients.get(1).unwrap(),
        FeeRecipient { amount: DVN_FEE[0], to: DummyDVNClient::new(&setup.env, &dvns.get_unchecked(0)).recipient() }
    );
    assert_eq!(
        native_fee_recipients.get(2).unwrap(),
        FeeRecipient { amount: TREASURY_NATIVE_FEE, to: setup.treasury.address }
    );
    assert_eq!(send_result.encoded_packet, packet_codec_v1::encode_packet(&setup.env, &packet));
}

#[test]
fn test_send_with_bad_options() {
    let mut setup = setup();
    let oapp = Address::generate(&setup.env);

    // setup workers
    let mut dvns = Vec::new(&setup.env);
    DVN_FEE.iter().for_each(|fee| {
        let dvn = setup.register_dvn(*fee);
        dvns.push_back(dvn);
    });
    let executor = setup.register_executor(EXECUTOR_FEE);
    setup.treasury.set_native_fee(&TREASURY_NATIVE_FEE);
    setup.treasury.set_zro_fee(&TREASURY_ZRO_FEE);

    // setup configs
    setup.set_default_send_uln_config(
        DST_EID,
        UlnConfig::new(CONFIRMATIONS, &vec![&setup.env], &vec![&setup.env, dvns.get_unchecked(0)], 1),
    );
    setup.set_default_executor_config(DST_EID, ExecutorConfig::new(MAX_MESSAGE_SIZE, &executor));

    // send
    let packet = OutboundPacket {
        nonce: 1,
        src_eid: EID,
        sender: oapp,
        dst_eid: DST_EID,
        receiver: BytesN::<32>::from_array(&setup.env, &[0u8; 32]),
        guid: BytesN::<32>::from_array(&setup.env, &[0u8; 32]),
        message: Bytes::from_array(&setup.env, b"dummy testing message"),
    };
    let options = Bytes::from_array(&setup.env, b"ensure bad options can be captured");
    let pay_in_zro = false;

    setup.env.mock_auths(&[MockAuth {
        address: &setup.endpoint.address,
        invoke: &MockAuthInvoke {
            contract: &setup.uln302.address,
            fn_name: "send",
            args: (&packet, &options, &pay_in_zro).into_val(&setup.env),
            sub_invokes: &[],
        },
    }]);
    let result = setup.uln302.try_send(&packet, &options, &pay_in_zro);
    assert_eq!(
        result.err().unwrap().ok().unwrap(),
        message_lib_common::errors::WorkerOptionsError::InvalidOptionType.into()
    );
}

#[test]
fn test_send_exceeding_message_size() {
    let mut setup = setup();
    let oapp = Address::generate(&setup.env);

    // setup workers
    let mut dvns = Vec::new(&setup.env);
    DVN_FEE.iter().for_each(|fee| {
        let dvn = setup.register_dvn(*fee);
        dvns.push_back(dvn);
    });
    let executor = setup.register_executor(EXECUTOR_FEE);
    setup.treasury.set_native_fee(&TREASURY_NATIVE_FEE);
    setup.treasury.set_zro_fee(&TREASURY_ZRO_FEE);

    // setup configs
    setup.set_default_send_uln_config(
        DST_EID,
        UlnConfig::new(CONFIRMATIONS, &vec![&setup.env], &vec![&setup.env, dvns.get_unchecked(0)], 1),
    );
    setup.set_default_executor_config(DST_EID, ExecutorConfig::new(2, &executor));

    // send
    let packet = OutboundPacket {
        nonce: 1,
        src_eid: EID,
        sender: oapp,
        dst_eid: DST_EID,
        receiver: BytesN::<32>::from_array(&setup.env, &[0u8; 32]),
        guid: BytesN::<32>::from_array(&setup.env, &[0u8; 32]),
        // message length bigger than max_message_size=2
        message: Bytes::from_array(&setup.env, b"dummy testing message"),
    };
    let options = create_type3_options(&setup.env, &vec![&setup.env, dvns.get_unchecked(0)], true);
    let pay_in_zro = false;

    setup.env.mock_auths(&[MockAuth {
        address: &setup.endpoint.address,
        invoke: &MockAuthInvoke {
            contract: &setup.uln302.address,
            fn_name: "send",
            args: (&packet, &options, &pay_in_zro).into_val(&setup.env),
            sub_invokes: &[],
        },
    }]);
    let result = setup.uln302.try_send(&packet, &options, &pay_in_zro);
    assert_eq!(result.err().unwrap().ok().unwrap(), crate::errors::Uln302Error::InvalidMessageSize.into());
}

#[test]
fn test_send_with_missing_dvn_options() {
    let mut setup = setup();
    let oapp = Address::generate(&setup.env);

    // setup workers
    let mut dvns = Vec::new(&setup.env);
    DVN_FEE.iter().for_each(|fee| {
        let dvn = setup.register_dvn(*fee);
        dvns.push_back(dvn);
    });
    let executor = setup.register_executor(EXECUTOR_FEE);
    setup.treasury.set_native_fee(&TREASURY_NATIVE_FEE);
    setup.treasury.set_zro_fee(&TREASURY_ZRO_FEE);

    // setup configs
    setup.set_default_send_uln_config(
        DST_EID,
        UlnConfig::new(
            CONFIRMATIONS,
            &vec![&setup.env, dvns.get_unchecked(0)],
            &vec![&setup.env, dvns.get_unchecked(1)],
            1,
        ),
    );
    setup.set_default_executor_config(DST_EID, ExecutorConfig::new(MAX_MESSAGE_SIZE, &executor));

    // send
    let packet = OutboundPacket {
        nonce: 1,
        src_eid: EID,
        sender: oapp,
        dst_eid: DST_EID,
        receiver: BytesN::<32>::from_array(&setup.env, &[0u8; 32]),
        guid: BytesN::<32>::from_array(&setup.env, &[0u8; 32]),
        message: Bytes::from_array(&setup.env, b"dummy testing message"),
    };
    let options = create_type3_options(&setup.env, &vec![&setup.env, dvns.get_unchecked(0)], true); // only provide dvn option for index 0
    let pay_in_zro = false;

    setup.env.mock_auths(&[MockAuth {
        address: &setup.endpoint.address,
        invoke: &MockAuthInvoke {
            contract: &setup.uln302.address,
            fn_name: "send",
            args: (&packet, &options, &pay_in_zro).into_val(&setup.env),
            sub_invokes: &[],
        },
    }]);
    let send_result = setup.uln302.send(&packet, &options, &pay_in_zro);
    let native_fee_recipients = &send_result.native_fee_recipients;
    let zro_fee_recipients = &send_result.zro_fee_recipients;

    // executor, dvn1, dvn2, treasury
    assert_eq!(native_fee_recipients.len(), 4);
    assert_eq!(zro_fee_recipients.len(), 0);
    assert_eq!(
        native_fee_recipients.get(0).unwrap(),
        FeeRecipient { amount: EXECUTOR_FEE, to: DummyExecutorClient::new(&setup.env, &executor).recipient() }
    );
    assert_eq!(
        native_fee_recipients.get(1).unwrap(),
        FeeRecipient { amount: DVN_FEE[0], to: DummyDVNClient::new(&setup.env, &dvns.get_unchecked(0)).recipient() }
    );
    assert_eq!(
        native_fee_recipients.get(2).unwrap(),
        FeeRecipient { amount: DVN_FEE[1], to: DummyDVNClient::new(&setup.env, &dvns.get_unchecked(1)).recipient() }
    );
    assert_eq!(
        native_fee_recipients.get(3).unwrap(),
        FeeRecipient { amount: TREASURY_NATIVE_FEE, to: setup.treasury.address }
    );
    assert_eq!(send_result.encoded_packet, packet_codec_v1::encode_packet(&setup.env, &packet));
}

#[test]
fn test_send_with_missing_executor_options() {
    let mut setup = setup();
    let oapp = Address::generate(&setup.env);

    // setup workers
    let mut dvns = Vec::new(&setup.env);
    DVN_FEE.iter().for_each(|fee| {
        let dvn = setup.register_dvn(*fee);
        dvns.push_back(dvn);
    });
    let executor = setup.register_executor(EXECUTOR_FEE);
    setup.treasury.set_native_fee(&TREASURY_NATIVE_FEE);
    setup.treasury.set_zro_fee(&TREASURY_ZRO_FEE);

    // setup configs
    setup.set_default_send_uln_config(
        DST_EID,
        UlnConfig::new(CONFIRMATIONS, &vec![&setup.env, dvns.get_unchecked(0)], &vec![&setup.env], 0),
    );
    setup.set_default_executor_config(DST_EID, ExecutorConfig::new(MAX_MESSAGE_SIZE, &executor));

    // send
    let packet = OutboundPacket {
        nonce: 1,
        src_eid: EID,
        sender: oapp,
        dst_eid: DST_EID,
        receiver: BytesN::<32>::from_array(&setup.env, &[0u8; 32]),
        guid: BytesN::<32>::from_array(&setup.env, &[0u8; 32]),
        message: Bytes::from_array(&setup.env, b"dummy testing message"),
    };
    let options = create_type3_options(&setup.env, &vec![&setup.env, dvns.get_unchecked(0)], false); // only provide dvn options, not executor options
    let pay_in_zro = false;
    setup.env.mock_auths(&[MockAuth {
        address: &setup.endpoint.address,
        invoke: &MockAuthInvoke {
            contract: &setup.uln302.address,
            fn_name: "send",
            args: (&packet, &options, &pay_in_zro).into_val(&setup.env),
            sub_invokes: &[],
        },
    }]);
    let send_result = setup.uln302.send(&packet, &options, &pay_in_zro);
    let native_fee_recipients = &send_result.native_fee_recipients;
    let zro_fee_recipients = &send_result.zro_fee_recipients;

    // executor, dvn, treasury
    assert_eq!(native_fee_recipients.len(), 3);
    assert_eq!(zro_fee_recipients.len(), 0);
    assert_eq!(
        native_fee_recipients.get(0).unwrap(),
        FeeRecipient { amount: EXECUTOR_FEE, to: DummyExecutorClient::new(&setup.env, &executor).recipient() }
    );
    assert_eq!(
        native_fee_recipients.get(1).unwrap(),
        FeeRecipient { amount: DVN_FEE[0], to: DummyDVNClient::new(&setup.env, &dvns.get_unchecked(0)).recipient() }
    );
    assert_eq!(
        native_fee_recipients.get(2).unwrap(),
        FeeRecipient { amount: TREASURY_NATIVE_FEE, to: setup.treasury.address }
    );
    assert_eq!(send_result.encoded_packet, packet_codec_v1::encode_packet(&setup.env, &packet));
}

#[test]
fn test_send_derives_from_quote() {
    // Sui equivalent: test_send_derives_from_quote
    // Test that send() produces consistent results with quote() for the same config
    let mut setup = setup();
    let oapp = Address::generate(&setup.env);

    // setup workers with multiple required and optional DVNs
    let mut dvns = Vec::new(&setup.env);
    DVN_FEE.iter().for_each(|fee| {
        let dvn = setup.register_dvn(*fee);
        dvns.push_back(dvn);
    });
    let executor = setup.register_executor(EXECUTOR_FEE);
    setup.treasury.set_native_fee(&TREASURY_NATIVE_FEE);
    setup.treasury.set_zro_fee(&TREASURY_ZRO_FEE);

    // Setup complex config with 2 required DVNs + 1 optional DVN (like Sui test)
    setup.set_default_send_uln_config(
        DST_EID,
        UlnConfig::new(
            CONFIRMATIONS,
            &vec![&setup.env, dvns.get_unchecked(0), dvns.get_unchecked(1)], // 2 required DVNs
            &vec![&setup.env, dvns.get_unchecked(2)],                        // 1 optional DVN
            1,                                                               // threshold = 1
        ),
    );
    setup.set_default_executor_config(DST_EID, ExecutorConfig::new(MAX_MESSAGE_SIZE, &executor));

    // Create the same packet for both quote and send
    let packet = OutboundPacket {
        nonce: 1,
        src_eid: EID,
        sender: oapp.clone(),
        dst_eid: DST_EID,
        receiver: BytesN::<32>::from_array(&setup.env, &[0u8; 32]),
        guid: BytesN::<32>::from_array(&setup.env, &[0u8; 32]),
        message: Bytes::from_array(&setup.env, b"dummy testing message"),
    };
    let options = create_type3_options(
        &setup.env,
        &vec![&setup.env, dvns.get_unchecked(0), dvns.get_unchecked(1), dvns.get_unchecked(2)],
        true,
    );
    let pay_in_zro = false;

    // Get quote
    setup.env.mock_auths(&[MockAuth {
        address: &setup.endpoint.address,
        invoke: &MockAuthInvoke {
            contract: &setup.uln302.address,
            fn_name: "quote",
            args: (&packet, &options, &pay_in_zro).into_val(&setup.env),
            sub_invokes: &[],
        },
    }]);
    let quote_fee = setup.uln302.quote(&packet, &options, &pay_in_zro);

    // Get send result
    setup.env.mock_auths(&[MockAuth {
        address: &setup.endpoint.address,
        invoke: &MockAuthInvoke {
            contract: &setup.uln302.address,
            fn_name: "send",
            args: (&packet, &options, &pay_in_zro).into_val(&setup.env),
            sub_invokes: &[],
        },
    }]);
    let send_result = setup.uln302.send(&packet, &options, &pay_in_zro);
    let native_fee_recipients = &send_result.native_fee_recipients;

    // Verify send results are consistent with quote results
    // Total native fee should match: executor + dvn0 + dvn1 + dvn2 + treasury
    let expected_native_fee = EXECUTOR_FEE + DVN_FEE[0] + DVN_FEE[1] + DVN_FEE[2] + TREASURY_NATIVE_FEE;
    assert_eq!(quote_fee.native_fee, expected_native_fee);

    // Verify DVN count: executor + 2 required + 1 optional + treasury = 5
    assert_eq!(native_fee_recipients.len(), 5);

    // Verify executor fee is first
    assert_eq!(
        native_fee_recipients.get(0).unwrap(),
        FeeRecipient { amount: EXECUTOR_FEE, to: DummyExecutorClient::new(&setup.env, &executor).recipient() }
    );

    // Verify DVN ordering is maintained (required first, then optional)
    // DVN 0 (first required)
    assert_eq!(
        native_fee_recipients.get(1).unwrap(),
        FeeRecipient { amount: DVN_FEE[0], to: DummyDVNClient::new(&setup.env, &dvns.get_unchecked(0)).recipient() }
    );
    // DVN 1 (second required)
    assert_eq!(
        native_fee_recipients.get(2).unwrap(),
        FeeRecipient { amount: DVN_FEE[1], to: DummyDVNClient::new(&setup.env, &dvns.get_unchecked(1)).recipient() }
    );
    // DVN 2 (optional)
    assert_eq!(
        native_fee_recipients.get(3).unwrap(),
        FeeRecipient { amount: DVN_FEE[2], to: DummyDVNClient::new(&setup.env, &dvns.get_unchecked(2)).recipient() }
    );

    // Treasury fee is last
    assert_eq!(
        native_fee_recipients.get(4).unwrap(),
        FeeRecipient { amount: TREASURY_NATIVE_FEE, to: setup.treasury.address }
    );
}
