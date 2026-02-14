//! Fee component implementation

#[starknet::component]
pub mod FeeComponent {
    use lz_utils::error::assert_with_byte_array;
    use openzeppelin::access::ownable::OwnableComponent;
    use openzeppelin::access::ownable::OwnableComponent::{
        InternalImpl as OwnableInternalImpl, InternalTrait as OwnableInternalTrait,
    };
    use starknet::storage::{
        Map, StorageMapReadAccess, StorageMapWriteAccess, StoragePointerReadAccess,
        StoragePointerWriteAccess,
    };
    use crate::common::constants::BPS_DENOMINATOR;
    use crate::oapps::common::fee::errors::err_invalid_bps;
    use crate::oapps::common::fee::events::{DefaultFeeBpsSet, FeeBpsSet};
    use crate::oapps::common::fee::interface::IFee;
    use crate::oapps::common::fee::structs::FeeConfig;

    #[storage]
    pub struct Storage {
        /// dst_eid => fee config
        pub Fee_fee_bps: Map<u32, FeeConfig>,
        pub Fee_default_fee_bps: u16,
    }

    #[event]
    #[derive(Drop, starknet::Event)]
    pub enum Event {
        FeeBpsSet: FeeBpsSet,
        DefaultFeeBpsSet: DefaultFeeBpsSet,
    }

    // =============================== Hooks =================================

    /// Hooks for the Fee component.
    ///
    /// Contracts embedding this component can override these to customize how
    /// BPS are resolved while retaining access to the component's storage and
    /// functions via `ComponentState<TContractState>`.
    pub trait FeeHooks<TContractState> {
        /// Returns the fee for a destination.
        ///
        /// Default behavior:
        /// - If a per-destination config is enabled, use it
        /// - Otherwise fall back to the default BPS
        /// - Apply the BPS to the amount
        fn _get_fee(
            self: @ComponentState<TContractState>, dst_eid: u32, amount: u256,
        ) -> u256 {
            let fee_config = self.Fee_fee_bps.read(dst_eid);
            let bps = if fee_config.enabled {
                fee_config.fee_bps
            } else {
                self.Fee_default_fee_bps.read()
            };

            amount * bps.into() / BPS_DENOMINATOR
        }
    }

    #[embeddable_as(FeeImpl)]
    impl Fee<
        TContractState,
        +HasComponent<TContractState>,
        +OwnableComponent::HasComponent<TContractState>,
        +FeeHooks<TContractState>,
    > of IFee<ComponentState<TContractState>> {
        fn set_default_fee_bps(ref self: ComponentState<TContractState>, fee_bps: u16) {
            self._assert_only_owner();
            self._assert_valid_fee_bps(fee_bps);
            self.Fee_default_fee_bps.write(fee_bps);
            self.emit(DefaultFeeBpsSet { fee_bps });
        }

        fn set_fee_bps(
            ref self: ComponentState<TContractState>, dst_eid: u32, fee_bps: u16, enabled: bool,
        ) {
            self._assert_only_owner();
            self._assert_valid_fee_bps(fee_bps);
            self.Fee_fee_bps.write(dst_eid, FeeConfig { fee_bps, enabled });
            self.emit(FeeBpsSet { dst_eid, fee_bps, enabled });
        }

        fn get_fee(self: @ComponentState<TContractState>, dst_eid: u32, amount: u256) -> u256 {
            self._get_fee(dst_eid, amount)
        }

        fn get_raw_fee_bps(self: @ComponentState<TContractState>, dst_eid: u32) -> FeeConfig {
            self.Fee_fee_bps.read(dst_eid)
        }

        fn get_raw_default_fee_bps(self: @ComponentState<TContractState>) -> u16 {
            self.Fee_default_fee_bps.read()
        }

        fn get_raw_bps_denominator(self: @ComponentState<TContractState>) -> u16 {
            BPS_DENOMINATOR.try_into().unwrap()
        }
    }

    // =============================== Internal Functions =================================

    #[generate_trait]
    pub impl InternalImpl<
        TContractState, +HasComponent<TContractState>,
    > of InternalTrait<TContractState> {
        /// Restricts function access to only the contract owner
        /// Delegates to the OpenZeppelin Ownable component for ownership checks
        fn _assert_only_owner<impl Ownable: OwnableComponent::HasComponent<TContractState>>(
            self: @ComponentState<TContractState>,
        ) {
            get_dep_component!(self, Ownable).assert_only_owner();
        }

        /// Asserts that the fee basis points are valid
        /// Checks that the fee basis points are less than or equal to the BPS denominator
        fn _assert_valid_fee_bps(self: @ComponentState<TContractState>, fee_bps: u16) {
            assert_with_byte_array(
                fee_bps <= BPS_DENOMINATOR.try_into().unwrap(), err_invalid_bps(fee_bps),
            );
        }
    }
}

/// Default implementation of the Fee hooks
pub impl FeeHooksDefaultImpl<TContractState> of FeeComponent::FeeHooks<TContractState> {}
