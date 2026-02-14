//! Mock ULN config for testing

/// Mock contract for testing the UlnConfigStorageNode struct
#[starknet::contract]
pub mod MockUlnConfig {
    use layerzero::message_lib::uln_302::structs::uln_config::{UlnConfig, UlnConfigUtils};
    use layerzero::message_lib::uln_302::structs::uln_config_storage_node::{
        UlnConfigStorageNode, UlnConfigStorageNodeTrait,
    };
    use crate::mocks::uln_config::interface::IMockUlnConfig;

    #[storage]
    struct Storage {
        pub uln_config_node: UlnConfigStorageNode,
    }

    #[abi(embed_v0)]
    impl MockUlnConfigImpl of IMockUlnConfig<ContractState> {
        fn set_uln_config(ref self: ContractState, config: UlnConfig) {
            self.uln_config_node.set_uln_config(config);
        }

        fn _clear_dvns(ref self: ContractState) {
            self.uln_config_node._clear_dvns();
        }

        fn get_uln_config(self: @ContractState) -> UlnConfig {
            self.uln_config_node.get_uln_config()
        }

        fn resolve(ref self: ContractState, default: UlnConfig, custom: UlnConfig) -> UlnConfig {
            UlnConfigUtils::resolve(@default, @custom)
        }
    }
}
