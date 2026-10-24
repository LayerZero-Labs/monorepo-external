use crate::tests::endpoint_setup::setup;
// The default_send_library is per-EID (None for unset EIDs, distinct libs per EID)
#[test]
fn test_default_send_library_none_and_distinct_per_eid() {
    let context = setup();
    let endpoint_client = &context.endpoint_client;

    let eid_a = context.eid;
    let eid_b = eid_a + 1;
    let eid_none = eid_a + 2;

    // Set defaults for two EIDs.
    let (send_lib_a, _fee_recipient_a) = context.setup_default_send_lib(eid_a, 100, 0);
    let (send_lib_b, _fee_recipient_b) = context.setup_default_send_lib(eid_b, 100, 0);

    assert_eq!(endpoint_client.default_send_library(&eid_a), Some(send_lib_a.clone()));
    assert_eq!(endpoint_client.default_send_library(&eid_b), Some(send_lib_b.clone()));

    // Different EIDs should be allowed to point to different libs.
    assert_ne!(send_lib_a, send_lib_b);

    // Setting other EIDs should not affect an unset EID.
    assert_eq!(endpoint_client.default_send_library(&eid_none), None);
}
