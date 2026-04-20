use crate::tests::endpoint_setup::setup;
// The is_supported_eid view reflects whether BOTH default send & receive libraries exist, and is isolated per-EID

#[test]
fn test_is_supported_eid_requires_both_defaults_per_eid() {
    let context = setup();
    let endpoint_client = &context.endpoint_client;

    let eid = context.eid;
    let receive_only_eid = eid + 2;

    // No defaults set for any EID.
    assert!(!endpoint_client.is_supported_eid(&eid));
    assert!(!endpoint_client.is_supported_eid(&receive_only_eid));

    // Only default send set => still not supported.
    let _ = context.setup_default_send_lib(eid, 100, 0);
    assert!(!endpoint_client.is_supported_eid(&eid));

    // Only default receive set (on a different EID) => still not supported.
    let _ = context.setup_default_receive_lib(receive_only_eid, 0);
    assert!(!endpoint_client.is_supported_eid(&receive_only_eid));

    // Both defaults set => supported.
    let _ = context.setup_default_receive_lib(eid, 0);
    assert!(endpoint_client.is_supported_eid(&eid));
    assert!(!endpoint_client.is_supported_eid(&receive_only_eid));
}
