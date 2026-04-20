use endpoint_v2::OutboundPacket;
use message_lib_common::{errors::WorkerOptionsError, testing_utils::create_type3_options};
use soroban_sdk::{
    log,
    testutils::{Address as _, MockAuth, MockAuthInvoke},
    vec, Address, Bytes, BytesN, Env, IntoVal, Vec,
};

use crate::{
    errors::Uln302Error,
    interfaces::{ExecutorConfig, UlnConfig},
    tests::setup::{
        setup, CONFIRMATIONS, DVN_FEE, EXECUTOR_FEE, LOCAL_EID as EID, MAX_MESSAGE_SIZE, REMOTE_EID as DST_EID,
        TREASURY_NATIVE_FEE, TREASURY_ZRO_FEE,
    },
};

#[test]
fn test_quote_single_dvn() {
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
            fn_name: "quote",
            args: (&packet, &options, &pay_in_zro).into_val(&setup.env),
            sub_invokes: &[],
        },
    }]);
    let fee = setup.uln302.quote(&packet, &options, &pay_in_zro);
    assert_eq!(fee.native_fee, EXECUTOR_FEE + DVN_FEE[0] + TREASURY_NATIVE_FEE);
    assert_eq!(fee.zro_fee, 0);
}

#[test]
fn test_quote_with_zro_fee() {
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
            fn_name: "quote",
            args: (&packet, &options, &pay_in_zro).into_val(&setup.env),
            sub_invokes: &[],
        },
    }]);
    let fee = setup.uln302.quote(&packet, &options, &pay_in_zro);
    assert_eq!(fee.native_fee, EXECUTOR_FEE + DVN_FEE[0]);
    assert_eq!(fee.zro_fee, TREASURY_ZRO_FEE);
}

#[test]
fn test_quote_multiple_dvns() {
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
    let options =
        create_type3_options(&setup.env, &vec![&setup.env, dvns.get_unchecked(0), dvns.get_unchecked(1)], true);
    let pay_in_zro = false;

    setup.env.mock_auths(&[MockAuth {
        address: &setup.endpoint.address,
        invoke: &MockAuthInvoke {
            contract: &setup.uln302.address,
            fn_name: "quote",
            args: (&packet, &options, &pay_in_zro).into_val(&setup.env),
            sub_invokes: &[],
        },
    }]);
    let fee = setup.uln302.quote(&packet, &options, &pay_in_zro);
    assert_eq!(fee.native_fee, EXECUTOR_FEE + DVN_FEE[0] + DVN_FEE[1] + TREASURY_NATIVE_FEE);
    assert_eq!(fee.zro_fee, 0);
}

#[test]
fn test_quote_with_only_optional_dvns() {
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
            fn_name: "quote",
            args: (&packet, &options, &pay_in_zro).into_val(&setup.env),
            sub_invokes: &[],
        },
    }]);
    let fee = setup.uln302.quote(&packet, &options, &pay_in_zro);
    assert_eq!(fee.native_fee, EXECUTOR_FEE + DVN_FEE[0] + TREASURY_NATIVE_FEE);
    assert_eq!(fee.zro_fee, 0);
}

#[test]
fn test_quote_with_bad_options() {
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
    let options = Bytes::from_array(&setup.env, b"ensure bad options can be captured");
    let pay_in_zro = false;

    setup.env.mock_auths(&[MockAuth {
        address: &setup.endpoint.address,
        invoke: &MockAuthInvoke {
            contract: &setup.uln302.address,
            fn_name: "quote",
            args: (&packet, &options, &pay_in_zro).into_val(&setup.env),
            sub_invokes: &[],
        },
    }]);
    let result = setup.uln302.try_quote(&packet, &options, &pay_in_zro);
    assert_eq!(result.err().unwrap().ok().unwrap(), WorkerOptionsError::InvalidOptionType.into());
}

#[test]
fn test_quote_exceeding_message_size() {
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
        // message length bigger than max_message_size=2
        message: Bytes::from_array(&setup.env, b"dummy testing message"),
    };
    let options = create_type3_options(&setup.env, &vec![&setup.env, dvns.get_unchecked(0)], true);
    let pay_in_zro = false;

    setup.env.mock_auths(&[MockAuth {
        address: &setup.endpoint.address,
        invoke: &MockAuthInvoke {
            contract: &setup.uln302.address,
            fn_name: "quote",
            args: (&packet, &options, &pay_in_zro).into_val(&setup.env),
            sub_invokes: &[],
        },
    }]);
    let result = setup.uln302.try_quote(&packet, &options, &pay_in_zro);
    assert_eq!(result.err().unwrap().ok().unwrap(), Uln302Error::InvalidMessageSize.into());
}

#[test]
fn test_quote_with_missing_dvn_options() {
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
    let options = create_type3_options(&setup.env, &vec![&setup.env, dvns.get_unchecked(0)], true); // only provide dvn option for index 0
    let pay_in_zro = false;

    setup.env.mock_auths(&[MockAuth {
        address: &setup.endpoint.address,
        invoke: &MockAuthInvoke {
            contract: &setup.uln302.address,
            fn_name: "quote",
            args: (&packet, &options, &pay_in_zro).into_val(&setup.env),
            sub_invokes: &[],
        },
    }]);
    let fee = setup.uln302.quote(&packet, &options, &pay_in_zro);
    assert_eq!(fee.native_fee, EXECUTOR_FEE + DVN_FEE[0] + DVN_FEE[1] + TREASURY_NATIVE_FEE);
    assert_eq!(fee.zro_fee, 0);
}

#[test]
fn test_quote_with_missing_executor_options() {
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
    let options = create_type3_options(&setup.env, &vec![&setup.env, dvns.get_unchecked(0)], false); // only provide executor option
    let pay_in_zro = false;
    setup.env.mock_auths(&[MockAuth {
        address: &setup.endpoint.address,
        invoke: &MockAuthInvoke {
            contract: &setup.uln302.address,
            fn_name: "quote",
            args: (&packet, &options, &pay_in_zro).into_val(&setup.env),
            sub_invokes: &[],
        },
    }]);
    let fee = setup.uln302.quote(&packet, &options, &pay_in_zro);
    assert_eq!(fee.native_fee, EXECUTOR_FEE + DVN_FEE[0] + TREASURY_NATIVE_FEE);
    assert_eq!(fee.zro_fee, 0);
}

#[test]
fn test_quote_edge_case_executor_only_charges() {
    // Sui equivalent: test_edge_case_fee_scenarios - Scenario 1
    // Tests fee distribution when only executor charges, DVNs are free
    let mut setup = setup();
    let oapp = Address::generate(&setup.env);

    // setup workers - DVN with 0 fee, executor with fee
    let dvn = setup.register_dvn(0i128); // DVN charges 0
    let executor = setup.register_executor(500i128); // Only executor charges
    setup.treasury.set_native_fee(&0i128); // No treasury fee for simplicity
    setup.treasury.set_zro_fee(&0i128);

    // setup configs
    setup.set_default_send_uln_config(
        DST_EID,
        UlnConfig::new(CONFIRMATIONS, &vec![&setup.env, dvn.clone()], &vec![&setup.env], 0),
    );
    setup.set_default_executor_config(DST_EID, ExecutorConfig::new(MAX_MESSAGE_SIZE, &executor));

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
    let options = create_type3_options(&setup.env, &vec![&setup.env, dvn], true);
    let pay_in_zro = false;

    setup.env.mock_auths(&[MockAuth {
        address: &setup.endpoint.address,
        invoke: &MockAuthInvoke {
            contract: &setup.uln302.address,
            fn_name: "quote",
            args: (&packet, &options, &pay_in_zro).into_val(&setup.env),
            sub_invokes: &[],
        },
    }]);
    let fee = setup.uln302.quote(&packet, &options, &pay_in_zro);
    // Only executor fee (500) + 0 DVN + 0 treasury
    assert_eq!(fee.native_fee, 500);
    assert_eq!(fee.zro_fee, 0);
}

#[test]
fn test_quote_edge_case_everything_free() {
    // Sui equivalent: test_edge_case_fee_scenarios - Scenario 2
    // Tests fee distribution when everything is free
    let mut setup = setup();
    let oapp = Address::generate(&setup.env);

    // setup workers - all 0 fees
    let dvn = setup.register_dvn(0i128); // DVN charges 0
    let executor = setup.register_executor(0i128); // Executor charges 0
    setup.treasury.set_native_fee(&0i128); // No treasury fee
    setup.treasury.set_zro_fee(&0i128);

    // setup configs
    setup.set_default_send_uln_config(
        DST_EID,
        UlnConfig::new(CONFIRMATIONS, &vec![&setup.env, dvn.clone()], &vec![&setup.env], 0),
    );
    setup.set_default_executor_config(DST_EID, ExecutorConfig::new(MAX_MESSAGE_SIZE, &executor));

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
    let options = create_type3_options(&setup.env, &vec![&setup.env, dvn], true);
    let pay_in_zro = false;

    setup.env.mock_auths(&[MockAuth {
        address: &setup.endpoint.address,
        invoke: &MockAuthInvoke {
            contract: &setup.uln302.address,
            fn_name: "quote",
            args: (&packet, &options, &pay_in_zro).into_val(&setup.env),
            sub_invokes: &[],
        },
    }]);
    let fee = setup.uln302.quote(&packet, &options, &pay_in_zro);
    // All fees are 0
    assert_eq!(fee.native_fee, 0);
    assert_eq!(fee.zro_fee, 0);
}

#[test]
fn test_quote_edge_case_zero_dvn_fees_multiple_dvns() {
    // Sui equivalent: test_edge_case_fee_scenarios
    // Tests fee distribution with multiple DVNs all charging 0
    let mut setup = setup();
    let oapp = Address::generate(&setup.env);

    // setup workers - DVNs with 0 fee
    let dvn1 = setup.register_dvn(0i128);
    let dvn2 = setup.register_dvn(0i128);
    let executor = setup.register_executor(100i128);
    setup.treasury.set_native_fee(&10i128);
    setup.treasury.set_zro_fee(&0i128);

    // setup configs
    setup.set_default_send_uln_config(
        DST_EID,
        UlnConfig::new(CONFIRMATIONS, &vec![&setup.env, dvn1.clone(), dvn2.clone()], &vec![&setup.env], 0),
    );
    setup.set_default_executor_config(DST_EID, ExecutorConfig::new(MAX_MESSAGE_SIZE, &executor));

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
    let options = create_type3_options(&setup.env, &vec![&setup.env, dvn1, dvn2], true);
    let pay_in_zro = false;

    setup.env.mock_auths(&[MockAuth {
        address: &setup.endpoint.address,
        invoke: &MockAuthInvoke {
            contract: &setup.uln302.address,
            fn_name: "quote",
            args: (&packet, &options, &pay_in_zro).into_val(&setup.env),
            sub_invokes: &[],
        },
    }]);
    let fee = setup.uln302.quote(&packet, &options, &pay_in_zro);
    // executor (100) + 0 DVNs + treasury (10)
    assert_eq!(fee.native_fee, 110);
    assert_eq!(fee.zro_fee, 0);
}
