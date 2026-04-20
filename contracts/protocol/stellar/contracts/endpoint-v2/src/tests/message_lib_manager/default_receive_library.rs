use crate::tests::endpoint_setup::setup;
// The default_receive_library is per-EID (None for unset EIDs, distinct libs per EID)
#[test]
fn test_default_receive_library_none_and_distinct_per_eid() {
    let context = setup();
    let endpoint_client = &context.endpoint_client;

    let eid_a = context.eid;
    let eid_b = eid_a + 1;
    let eid_none = eid_a + 2;

    // Set defaults for two EIDs.
    let receive_lib_a = context.setup_default_receive_lib(eid_a, 0);
    let receive_lib_b = context.setup_default_receive_lib(eid_b, 0);

    assert_eq!(endpoint_client.default_receive_library(&eid_a), Some(receive_lib_a.clone()));
    assert_eq!(endpoint_client.default_receive_library(&eid_b), Some(receive_lib_b.clone()));

    // Different EIDs should be allowed to point to different libs.
    assert_ne!(receive_lib_a, receive_lib_b);

    // Setting other EIDs should not affect an unset EID.
    assert_eq!(endpoint_client.default_receive_library(&eid_none), None);
}
