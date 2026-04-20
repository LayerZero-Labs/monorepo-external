// ============================================================================
// Test 1: Full OApp with all defaults
// ============================================================================
mod test_full_default {
    extern crate self as oapp;

    use endpoint_v2::Origin;
    use oapp::oapp_receiver::LzReceiveInternal;
    use oapp_macros::oapp;
    use soroban_sdk::{Address, Bytes, BytesN, Env};

    #[oapp]
    #[common_macros::lz_contract]
    struct TestFullDefault;

    impl LzReceiveInternal for TestFullDefault {
        fn __lz_receive(
            _env: &Env,
            _origin: &Origin,
            _guid: &BytesN<32>,
            _message: &Bytes,
            _extra_data: &Bytes,
            _executor: &Address,
            _value: i128,
        ) {
            // Default behavior
        }
    }
}

// ============================================================================
// Test 2: Full OApp with manual core implementation
// ============================================================================
mod test_full_manual_core {
    extern crate self as oapp;

    use endpoint_v2::Origin;
    use oapp::oapp_core::OAppCore;
    use oapp::oapp_receiver::LzReceiveInternal;
    use oapp_macros::oapp;
    use soroban_sdk::{contractimpl, Address, Bytes, BytesN, Env};

    #[oapp(custom = [core])]
    #[common_macros::lz_contract]
    struct TestFullManualCore;

    #[soroban_sdk::contractimpl(contracttrait)]
    impl utils::rbac::RoleBasedAccessControl for TestFullManualCore {}

    #[contractimpl(contracttrait)]
    impl OAppCore for TestFullManualCore {
        fn oapp_version(_env: &Env) -> (u64, u64) {
            (2, 0)
        }
    }

    impl LzReceiveInternal for TestFullManualCore {
        fn __lz_receive(
            _env: &Env,
            _origin: &Origin,
            _guid: &BytesN<32>,
            _message: &Bytes,
            _extra_data: &Bytes,
            _executor: &Address,
            _value: i128,
        ) {
            // Custom logic
        }
    }
}

// ============================================================================
// Test 3: Full OApp with manual sender implementation
// ============================================================================
mod test_full_manual_sender {
    extern crate self as oapp;

    use endpoint_v2::Origin;
    use oapp::oapp_receiver::LzReceiveInternal;
    use oapp::oapp_sender::OAppSenderInternal;
    use oapp_macros::oapp;
    use soroban_sdk::{Address, Bytes, BytesN, Env};

    #[oapp(custom = [sender])]
    #[common_macros::lz_contract]
    struct TestFullManualSender;

    impl OAppSenderInternal for TestFullManualSender {
        // Custom sender implementation
    }

    impl LzReceiveInternal for TestFullManualSender {
        fn __lz_receive(
            _env: &Env,
            _origin: &Origin,
            _guid: &BytesN<32>,
            _message: &Bytes,
            _extra_data: &Bytes,
            _executor: &Address,
            _value: i128,
        ) {
            // Implementation
        }
    }
}

// ============================================================================
// Test 4: Full OApp with manual receiver implementation
// ============================================================================
mod test_full_manual_receiver {
    extern crate self as oapp;

    use endpoint_v2::Origin;
    use oapp::oapp_receiver::{LzReceiveInternal, OAppReceiver};
    use oapp_macros::oapp;
    use soroban_sdk::{contractimpl, Address, Bytes, BytesN, Env};

    #[oapp(custom = [receiver])]
    #[common_macros::lz_contract]
    struct TestFullManualReceiver;

    impl LzReceiveInternal for TestFullManualReceiver {
        fn __lz_receive(
            _env: &Env,
            _origin: &Origin,
            _guid: &BytesN<32>,
            _message: &Bytes,
            _extra_data: &Bytes,
            _executor: &Address,
            _value: i128,
        ) {
            // Custom implementation
        }
    }

    #[contractimpl(contracttrait)]
    impl OAppReceiver for TestFullManualReceiver {
        fn is_compose_msg_sender(_env: &Env, _origin: &Origin, _message: &Bytes, _sender: &Address) -> bool {
            true
        }

        fn allow_initialize_path(_env: &Env, _origin: &Origin) -> bool {
            true
        }

        fn next_nonce(_env: &Env, _src_eid: u32, _sender: &BytesN<32>) -> u64 {
            1 // Ordered delivery
        }
    }
}

// ============================================================================
// Test 5: Full OApp with manual options_type3 implementation
// ============================================================================
mod test_full_manual_options {
    extern crate self as oapp;

    use endpoint_v2::Origin;
    use oapp::oapp_options_type3::OAppOptionsType3;
    use oapp::oapp_receiver::LzReceiveInternal;
    use oapp_macros::oapp;
    use soroban_sdk::{contractimpl, Address, Bytes, BytesN, Env};

    #[oapp(custom = [options_type3])]
    #[common_macros::lz_contract]
    struct TestFullManualOptions;

    impl LzReceiveInternal for TestFullManualOptions {
        fn __lz_receive(
            _env: &Env,
            _origin: &Origin,
            _guid: &BytesN<32>,
            _message: &Bytes,
            _extra_data: &Bytes,
            _executor: &Address,
            _value: i128,
        ) {
            // Implementation
        }
    }

    #[contractimpl(contracttrait)]
    impl OAppOptionsType3 for TestFullManualOptions {
        // Custom options implementation
    }
}

// ============================================================================
// Test 6: Full OApp with manual core + sender
// ============================================================================
mod test_full_manual_core_sender {
    extern crate self as oapp;

    use endpoint_v2::Origin;
    use oapp::{oapp_core::OAppCore, oapp_receiver::LzReceiveInternal, oapp_sender::OAppSenderInternal};
    use oapp_macros::oapp;
    use soroban_sdk::{contractimpl, Address, Bytes, BytesN, Env};

    #[oapp(custom = [core, sender])]
    #[common_macros::lz_contract]
    struct TestFullManualCoreSender;

    #[soroban_sdk::contractimpl(contracttrait)]
    impl utils::rbac::RoleBasedAccessControl for TestFullManualCoreSender {}

    #[contractimpl(contracttrait)]
    impl OAppCore for TestFullManualCoreSender {
        fn oapp_version(_env: &Env) -> (u64, u64) {
            (3, 0)
        }
    }

    impl OAppSenderInternal for TestFullManualCoreSender {
        // Custom sender implementation
    }

    impl LzReceiveInternal for TestFullManualCoreSender {
        fn __lz_receive(
            _env: &Env,
            _origin: &Origin,
            _guid: &BytesN<32>,
            _message: &Bytes,
            _extra_data: &Bytes,
            _executor: &Address,
            _value: i128,
        ) {
            // Implementation
        }
    }
}

// ============================================================================
// Test 7: Full OApp with manual core + receiver
// ============================================================================
mod test_full_manual_core_receiver {
    extern crate self as oapp;

    use endpoint_v2::Origin;
    use oapp::{
        oapp_core::OAppCore,
        oapp_receiver::{LzReceiveInternal, OAppReceiver},
    };
    use oapp_macros::oapp;
    use soroban_sdk::{contractimpl, Address, Bytes, BytesN, Env};

    #[oapp(custom = [core, receiver])]
    #[common_macros::lz_contract]
    struct TestFullManualCoreReceiver;

    #[soroban_sdk::contractimpl(contracttrait)]
    impl utils::rbac::RoleBasedAccessControl for TestFullManualCoreReceiver {}

    #[contractimpl(contracttrait)]
    impl OAppCore for TestFullManualCoreReceiver {
        fn oapp_version(_env: &Env) -> (u64, u64) {
            (4, 0)
        }
    }

    impl LzReceiveInternal for TestFullManualCoreReceiver {
        fn __lz_receive(
            _env: &Env,
            _origin: &Origin,
            _guid: &BytesN<32>,
            _message: &Bytes,
            _extra_data: &Bytes,
            _executor: &Address,
            _value: i128,
        ) {
            // Custom receiver implementation
        }
    }

    #[contractimpl(contracttrait)]
    impl OAppReceiver for TestFullManualCoreReceiver {}
}

// ============================================================================
// Test 8: Full OApp with manual sender + receiver
// ============================================================================
mod test_full_manual_sender_receiver {
    extern crate self as oapp;

    use endpoint_v2::Origin;
    use oapp::{
        oapp_receiver::{LzReceiveInternal, OAppReceiver},
        oapp_sender::OAppSenderInternal,
    };
    use oapp_macros::oapp;
    use soroban_sdk::{contractimpl, Address, Bytes, BytesN, Env};

    #[oapp(custom = [sender, receiver])]
    #[common_macros::lz_contract]
    struct TestFullManualSenderReceiver;

    impl OAppSenderInternal for TestFullManualSenderReceiver {
        // Custom sender implementation
    }

    impl LzReceiveInternal for TestFullManualSenderReceiver {
        fn __lz_receive(
            _env: &Env,
            _origin: &Origin,
            _guid: &BytesN<32>,
            _message: &Bytes,
            _extra_data: &Bytes,
            _executor: &Address,
            _value: i128,
        ) {
            // Custom receiver implementation
        }
    }

    #[contractimpl(contracttrait)]
    impl OAppReceiver for TestFullManualSenderReceiver {}
}

// ============================================================================
// Test 9: Full OApp with manual core + sender + receiver (all except options)
// ============================================================================
mod test_full_manual_all_except_options {
    extern crate self as oapp;

    use endpoint_v2::Origin;
    use oapp::{
        oapp_core::OAppCore,
        oapp_receiver::{LzReceiveInternal, OAppReceiver},
        oapp_sender::OAppSenderInternal,
    };
    use oapp_macros::oapp;
    use soroban_sdk::{contractimpl, Address, Bytes, BytesN, Env};

    #[oapp(custom = [core, sender, receiver])]
    #[common_macros::lz_contract]
    struct TestFullManualAllExceptOptions;

    #[soroban_sdk::contractimpl(contracttrait)]
    impl utils::rbac::RoleBasedAccessControl for TestFullManualAllExceptOptions {}

    #[contractimpl(contracttrait)]
    impl OAppCore for TestFullManualAllExceptOptions {
        fn oapp_version(_env: &Env) -> (u64, u64) {
            (5, 0)
        }
    }

    impl OAppSenderInternal for TestFullManualAllExceptOptions {
        // Custom sender implementation
    }

    impl LzReceiveInternal for TestFullManualAllExceptOptions {
        fn __lz_receive(
            _env: &Env,
            _origin: &Origin,
            _guid: &BytesN<32>,
            _message: &Bytes,
            _extra_data: &Bytes,
            _executor: &Address,
            _value: i128,
        ) {
            // Custom receiver implementation
        }
    }

    #[contractimpl(contracttrait)]
    impl OAppReceiver for TestFullManualAllExceptOptions {}
}

// ============================================================================
// Test 10: Full OApp with all manual implementations
// ============================================================================
mod test_full_manual_all {
    extern crate self as oapp;

    use endpoint_v2::Origin;
    use oapp::{
        oapp_core::OAppCore,
        oapp_options_type3::OAppOptionsType3,
        oapp_receiver::{LzReceiveInternal, OAppReceiver},
        oapp_sender::OAppSenderInternal,
    };
    use oapp_macros::oapp;
    use soroban_sdk::{contractimpl, Address, Bytes, BytesN, Env};

    #[oapp(custom = [core, sender, receiver, options_type3])]
    #[common_macros::lz_contract]
    struct TestFullManualAll;

    #[soroban_sdk::contractimpl(contracttrait)]
    impl utils::rbac::RoleBasedAccessControl for TestFullManualAll {}

    #[contractimpl(contracttrait)]
    impl OAppCore for TestFullManualAll {
        fn oapp_version(_env: &Env) -> (u64, u64) {
            (6, 0)
        }
    }

    impl OAppSenderInternal for TestFullManualAll {
        // Custom sender implementation
    }

    impl LzReceiveInternal for TestFullManualAll {
        fn __lz_receive(
            _env: &Env,
            _origin: &Origin,
            _guid: &BytesN<32>,
            _message: &Bytes,
            _extra_data: &Bytes,
            _executor: &Address,
            _value: i128,
        ) {
            // Custom receiver implementation
        }
    }

    #[contractimpl(contracttrait)]
    impl OAppReceiver for TestFullManualAll {}

    #[contractimpl(contracttrait)]
    impl OAppOptionsType3 for TestFullManualAll {
        // Custom options implementation
    }
}

// ============================================================================
// Tests
// ============================================================================

#[test]
fn test_macros_compile() {
    // This test verifies that all macro combinations compile successfully
    assert!(true);
}
