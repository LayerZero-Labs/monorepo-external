// Test library for LayerZero protocol

pub mod constants;
pub mod utils;

pub mod mocks {
    pub mod compose_receiver;
    pub mod composer_target;
    pub mod endpoint;
    pub mod fee;
    pub mod reentrant_receiver;
    pub mod rate_limiter {
        pub mod interface;
        pub mod rate_limiter;
    }
    pub mod allowlist {
        pub mod allowlist;
        pub mod interface;
    }
    pub mod messaging_channel {
        pub mod interface;
        pub mod messaging_channel;
    }
    pub mod messaging_composer;
    pub mod erc20 {
        pub mod erc20;
        pub mod interface;
    }
    pub mod message_lib_manager;
    pub mod oapp_core {
        pub mod interface;
        pub mod oapp_core;
    }
    pub mod oapp_options_type3;
    pub mod oft_core {
        pub mod interface;
        pub mod oft_core;
    }
    pub mod message_inspector {
        pub mod message_inspector;
    }
    pub mod receiver;
    pub mod treasury {
        pub mod lz_token_fee_lib;
        pub mod treasury;
    }
    pub mod uln_config {
        pub mod interface;
        pub mod uln_config;
    }
    pub mod workers {
        pub mod base;
        pub mod dvn;
        pub mod executor {
            pub mod decode {
                pub mod decode;
                pub mod interface;
            }
            pub mod executor;
        }
    }
}
pub mod common {
    mod test_constants;
    mod test_guid;
    mod test_packet_v1_codec;
    pub mod utils;
}

pub mod endpoint {
    mod test_endpoint_commit;
    #[feature("safe_dispatcher")]
    mod test_endpoint_lz_receive;
    mod test_endpoint_quote;
    #[feature("safe_dispatcher")]
    mod test_endpoint_send;
    pub mod message_lib_manager {
        mod test_message_lib_manager;
        pub mod utils;
    }
    pub mod messaging_channel {
        mod test_messaging_channel;
        pub mod utils;
    }
    pub mod utils;
    pub mod messaging_composer {
        mod test_messaging_composer;
        pub mod utils;
    }
}

pub mod workers {
    pub mod base {
        mod test_worker_base;
        pub mod utils;
    }
    pub mod dvn {
        pub mod fee_lib {
            mod test_dvn_fee_lib;
        }
        mod test_dvn;
        mod test_dvn_options;
        pub mod utils;
    }
    pub mod executor {
        pub mod fee_lib {
            mod test_executor_fee_lib;
        }
        mod test_decode;
        #[feature("safe_dispatcher")]
        mod test_executor;
        pub mod utils;
    }
    pub mod price_feed {
        mod test_price_feed;
        pub mod utils;
    }
}

pub mod message_lib {
    #[feature("safe_dispatcher")]
    pub mod sml {
        mod test_simple_message_lib;
    }
    pub mod uln_302 {
        mod test_uln_admin;
        mod test_uln_config;
        mod test_uln_config_storage_node;
        mod test_uln_executor_config;
        mod test_uln_options;
        mod test_uln_quote;
        mod test_uln_receive;
        mod test_uln_send;
        pub mod utils;
    }
}

pub mod oapps {
    pub mod common {
        #[feature("safe_dispatcher")]
        mod test_allowlist;
        mod test_fee;
        mod test_oapp_options_type_3;
        #[feature("safe_dispatcher")]
        mod test_rate_limiter;
    }
    mod test_counter;
    mod test_oapp_core;
    pub mod oft {
        mod test_oft_compose_msg_codec;
        mod test_oft_core;
        mod test_oft_msg_codec;
    }
}

#[feature("safe_dispatcher")]
pub mod treasury {
    mod test_lz_token_fee_lib;
    mod test_treasury;
    pub mod utils;
}

/// Fuzzable types for testing
pub mod fuzzable {
    pub mod blockchain_config;
    pub mod bytes32;
    pub mod contract_address;
    pub mod dst_config;
    pub mod eid;
    pub mod eth_address;
    pub mod expiry;
    pub mod felt_array;
    pub mod inbound_params;
    pub mod keys;
    pub mod model_type;
    pub mod origin;
    pub mod price;
    pub mod role_admin;
    pub mod small_byte_array;
}

/// End-to-end tests
#[feature("safe_dispatcher")]
pub mod e2e {
    pub mod oft_utils;
    mod test_counter_with_sml;
    mod test_counter_with_uln;
    mod test_dvn;
    mod test_limitation;
    mod test_lz_token;
    mod test_oft_compose_with_uln;
    mod test_oft_with_sml;
    mod test_oft_with_uln;
    pub mod utils;
}

#[cfg(feature: 'gas_profile')]
pub mod gas_profile {
    mod test_counter_increment;
    mod test_dvn_verify;
    mod test_endpoint_alert;
    mod test_executor_compose;
    mod test_executor_execute;
    mod test_executor_native_drop;
    mod test_price_feed;
    mod test_uln_commit;
    pub mod utils;
}
