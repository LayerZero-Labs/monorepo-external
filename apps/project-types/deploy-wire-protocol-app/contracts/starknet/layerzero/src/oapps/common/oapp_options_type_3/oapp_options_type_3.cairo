#[starknet::component]
pub mod OAppOptionsType3Component {
    use core::panics::panic_with_byte_array;
    use lz_utils::byte_array_ext::byte_array_ext::ByteArrayTraitExt;
    use lz_utils::error::assert_with_byte_array;
    use openzeppelin::access::ownable::OwnableComponent;
    use openzeppelin::access::ownable::OwnableComponent::{
        InternalImpl as OwnableInternalImpl, InternalTrait as OwnableInternalTrait,
    };
    use starknet::storage::{Map, StorageMapReadAccess, StorageMapWriteAccess};
    use crate::oapps::common::oapp_options_type_3::errors::err_invalid_options;
    use crate::oapps::common::oapp_options_type_3::events::EnforcedOptionSet;
    use crate::oapps::common::oapp_options_type_3::interface::IOAppOptionsType3;
    use crate::oapps::common::oapp_options_type_3::structs::EnforcedOptionParam;

    // Constants
    pub const OPTION_TYPE_3: u16 = 3;

    #[storage]
    pub struct Storage {
        /// Mapping from (eid, msg_type) => enforced options
        OAppOptionsType3_enforced_options: Map<(u32, u16), ByteArray>,
    }

    #[event]
    #[derive(Drop, starknet::Event)]
    pub enum Event {
        EnforcedOptionSet: EnforcedOptionSet,
    }

    #[generate_trait]
    pub impl InternalImpl<
        TContractState, +HasComponent<TContractState>,
    > of InternalTrait<TContractState> {
        /// Internal function to set enforced options
        fn _set_enforced_options(
            ref self: ComponentState<TContractState>, enforced_options: Array<EnforcedOptionParam>,
        ) {
            for option in enforced_options.clone().into_iter() {
                // Enforced options are only available for optionType 3
                self._assert_options_type_3(@option.options);

                // Store the enforced option
                self
                    .OAppOptionsType3_enforced_options
                    .write((option.eid, option.msg_type), option.options.clone());
            }

            self.emit(EnforcedOptionSet { options: enforced_options });
        }

        /// Internal function to assert that options are of type 3
        fn _assert_options_type_3(self: @ComponentState<TContractState>, options: @ByteArray) {
            // Use the ByteArrayTraitExt to read u16 from the beginning
            let (_, option_type) = options.read_u16(0);

            assert_with_byte_array(option_type == OPTION_TYPE_3, err_invalid_options(options));
        }
    }

    #[embeddable_as(OAppOptionsType3Impl)]
    impl OAppOptionsType3<
        TContractState,
        +HasComponent<TContractState>,
        impl Ownable: OwnableComponent::HasComponent<TContractState>,
    > of IOAppOptionsType3<ComponentState<TContractState>> {
        fn set_enforced_options(
            ref self: ComponentState<TContractState>, enforced_options: Array<EnforcedOptionParam>,
        ) {
            // Only owner can set enforced options
            let ownable = get_dep_component!(@self, Ownable);
            ownable.assert_only_owner();

            self._set_enforced_options(enforced_options);
        }

        fn combine_options(
            self: @ComponentState<TContractState>,
            eid: u32,
            msg_type: u16,
            extra_options: ByteArray,
        ) -> ByteArray {
            let enforced = self.OAppOptionsType3_enforced_options.read((eid, msg_type));

            // No enforced options, pass whatever the caller supplied
            if enforced.len() == 0 {
                return extra_options;
            }

            // No caller options, return enforced
            if extra_options.len() == 0 {
                return enforced;
            }

            // If caller provided extra_options, must be type 3 as it's the ONLY type that can be
            // combined
            if extra_options.len() >= 2 {
                self._assert_options_type_3(@extra_options);

                // Remove the first 2 bytes containing the type from the extra_options and combine
                // with enforced
                let mut combined = enforced;
                if extra_options.len() > 2 {
                    let (_, extra_data) = extra_options.read_bytes(2, extra_options.len() - 2);
                    combined.append(@extra_data);
                }
                return combined;
            }

            // No valid set of options was found
            panic_with_byte_array(@err_invalid_options(@extra_options));
        }

        fn get_enforced_options(
            self: @ComponentState<TContractState>, eid: u32, msg_type: u16,
        ) -> ByteArray {
            self.OAppOptionsType3_enforced_options.read((eid, msg_type))
        }
    }
}
