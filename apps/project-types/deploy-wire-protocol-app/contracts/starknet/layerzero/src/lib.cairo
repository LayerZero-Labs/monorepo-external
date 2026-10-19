//! # LayerZero Protocol Implementation for Starknet
//!
//! This project provides a comprehensive implementation of the LayerZero protocol for the Starknet
//! ecosystem.
//! It includes the core components necessary for enabling seamless cross-chain messaging, allowing
//! developers to build sophisticated omnichain applications (OApps) that can interact with other
//! blockchains.
//!
//! The project is structured into several modules, each responsible for a specific aspect of the
//! LayerZero protocol:
//! - **Common**: Contains shared data structures, constants, and utility functions used across the
//! project.
//! - **EndpointV2**: The core of the LayerZero protocol, responsible for sending and receiving
//! messages.
//! - **MessageLib**: Defines the different message libraries that OApps can use to configure their
//! security posture.
//! - **Treasury**: Manages the fees collected by the protocol.
//! - **Workers**: A collection of contracts that perform specific tasks, such as price feeds and
//! data verification.
//! - **OApps**: Example omnichain applications that demonstrate how to use the LayerZero protocol.

pub mod common {
    pub mod structs {
        pub mod messaging;
        pub mod packet;
    }
    pub mod constants;
    pub mod conversions;
    pub mod guid;
    pub mod packet_v1_codec;
}

pub mod endpoint {
    pub mod message_lib_manager {
        pub mod errors;
        pub mod events;
        pub mod interface;
        pub mod message_lib_manager;
        pub mod structs;
    }
    pub mod messaging_channel {
        pub mod errors;
        pub mod events;
        pub mod interface;
        pub mod messaging_channel;
    }
    pub mod messaging_composer {
        pub mod errors;
        pub mod events;
        pub mod interface;
        pub mod messaging_composer;
    }
    pub mod interfaces {
        pub mod endpoint_v2;
        pub mod layerzero_composer;
        pub mod layerzero_receiver;
    }
    pub mod constants;
    pub mod endpoint_v2;
    pub mod errors;
    pub mod events;
}

pub mod message_lib {
    pub mod interface;
    pub mod sml {
        pub mod errors;
        pub mod events;
        pub mod simple_message_lib;
    }
    pub mod structs;
    pub mod uln_302 {
        pub mod errors;
        pub mod events;
        pub mod options;
        pub mod structs {
            pub mod executor_config;
            pub mod payment_info;
            pub mod uln_config;
            pub mod uln_config_storage_node;
            pub mod verification;
        }
        pub mod interface;
        pub mod ultra_light_node_302;
    }
    pub mod blocked_message_lib;
}

pub mod treasury {
    pub mod interfaces {
        pub mod layerzero_treasury;
        pub mod lz_token_fee_lib;
        pub mod treasury_admin;
    }
    pub mod errors;
    pub mod events;
    pub mod treasury;
}

pub mod workers {
    pub mod base {
        pub mod base;
        pub mod errors;
        pub mod events;
        pub mod interface;
        pub mod structs;
    }
    pub mod executor {
        pub mod errors;
        pub mod events;
        pub mod executor;
        pub mod fee_lib {
            pub mod executor_fee_lib;
            pub mod interface;
        }
        pub mod interface;
        pub mod options;
        pub mod structs;
    }
    pub mod price_feed {
        pub mod constants;
        pub mod errors;
        pub mod events;
        pub mod interface;
        pub mod price_feed;
        pub mod structs;
    }
    pub mod dvn {
        pub mod constants;
        pub mod dvn;
        pub mod errors;
        pub mod events;
        pub mod fee_lib {
            pub mod dvn_fee_lib;
            pub mod interface;
        }
        pub mod interface;
        pub mod options;
        pub mod structs;
    }
    pub mod access_control;
    pub mod common;
    pub mod interface;
}

pub mod oapps {
    pub mod common {
        pub mod oapp_options_type_3 {
            pub mod errors;
            pub mod events;
            pub mod interface;
            pub mod oapp_options_type_3;
            pub mod structs;
        }
        pub mod fee {
            pub mod errors;
            pub mod events;
            pub mod fee;
            pub mod interface;
            pub mod structs;
        }
        pub mod rate_limiter {
            pub mod errors;
            pub mod events;
            pub mod interface;
            pub mod rate_limiter;
            pub mod structs;
        }
        pub mod allow_list {
            pub mod allow_list;
            pub mod errors;
            pub mod events;
            pub mod interface;
        }
    }
    pub mod oapp {
        pub mod errors;
        pub mod events;
        pub mod interface;
        pub mod oapp;
        pub mod oapp_core;
    }
    pub mod oft {
        pub mod errors;
        pub mod events;
        pub mod interface;
        pub mod oft_compose_msg_codec;
        pub mod oft_core {
            pub mod default_oapp_hooks;
            pub mod default_oft_hooks;
            pub mod oft_core;
        }
        pub mod oft_msg_codec;
        pub mod structs;
    }
    pub mod counter {
        pub mod constants;
        pub mod counter;
        pub mod errors;
        pub mod interface;
        pub mod msg_codec;
        pub mod options;
        pub mod structs;
    }
    pub mod message_inspector {
        pub mod interface;
    }
}

// Re-export commonly used types for easier access
pub use common::structs::messaging::{MessageReceipt, MessagingFee, MessagingParams};
pub use common::structs::packet::{Origin, Packet};
pub use oapps::oapp::oapp_core::OAppCoreComponent;
pub use workers::base::base::WorkerBaseComponent;
