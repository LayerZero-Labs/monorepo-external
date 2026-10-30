//! Mock OFT Core component for testing

/// MockOFTCore - Contract to test OFT Core internal functions
#[starknet::contract]
pub mod MockOFTCore {
    use layerzero::oapps::common::oapp_options_type_3::oapp_options_type_3::OAppOptionsType3Component;
    use layerzero::oapps::oapp::oapp_core::OAppCoreComponent;
    use layerzero::oapps::oft::oft_core::default_oapp_hooks::OFTCoreOAppHooksDefaultImpl;
    use layerzero::oapps::oft::oft_core::default_oft_hooks::OFTCoreOFTHooksDefaultImpl;
    use layerzero::oapps::oft::oft_core::oft_core::OFTCoreComponent;
    use layerzero::oapps::oft::structs::{OFTDebit, OFTMsgAndOptions, SendParam};
    use openzeppelin::access::ownable::OwnableComponent;
    use openzeppelin::token::erc20::{ERC20Component, ERC20HooksEmptyImpl};
    use starknet::ContractAddress;
    use starknet::storage::{StoragePointerReadAccess, StoragePointerWriteAccess};
    use crate::mocks::oft_core::interface::IMockOFTCore;


    // Component declarations
    component!(path: ERC20Component, storage: erc20, event: ERC20Event);
    component!(path: OwnableComponent, storage: ownable, event: OwnableEvent);
    component!(path: OAppCoreComponent, storage: oapp_core, event: OAppCoreEvent);
    component!(path: OFTCoreComponent, storage: oft_core, event: OFTCoreEvent);
    component!(
        path: OAppOptionsType3Component, storage: oapp_options_type_3, event: OAppOptionsType3Event,
    );

    // ERC20 Mixin
    #[abi(embed_v0)]
    impl ERC20MixinImpl = ERC20Component::ERC20MixinImpl<ContractState>;
    impl ERC20InternalImpl = ERC20Component::InternalImpl<ContractState>;

    // ERC20 immutable configuration
    impl ERC20ImmutableConfig of ERC20Component::ImmutableConfig {
        const DECIMALS: u8 = 18;
    }

    // Ownable Mixin
    #[abi(embed_v0)]
    impl OwnableMixinImpl = OwnableComponent::OwnableMixinImpl<ContractState>;
    impl OwnableInternalImpl = OwnableComponent::InternalImpl<ContractState>;

    // OApp Core
    #[abi(embed_v0)]
    impl OAppCoreImpl = OAppCoreComponent::OAppCoreImpl<ContractState>;
    impl OAppCoreInternalImpl = OAppCoreComponent::InternalImpl<ContractState>;

    // OApp Receiver
    #[abi(embed_v0)]
    impl IOAppReceiverImpl = OAppCoreComponent::OAppReceiverImpl<ContractState>;

    // LayerZero Receiver from OApp Core
    #[abi(embed_v0)]
    impl ILayerZeroReceiverImpl =
        OAppCoreComponent::LayerZeroReceiverImpl<ContractState>;

    // OFT Core - embed the implementation
    #[abi(embed_v0)]
    impl OFTCoreImpl = OFTCoreComponent::OFTCoreImpl<ContractState>;
    impl OFTCoreInternalImpl = OFTCoreComponent::InternalImpl<ContractState>;

    const SHARED_DECIMALS: u8 = 6;

    // OApp Options Type 3
    #[abi(embed_v0)]
    impl OAppOptionsType3Impl =
        OAppOptionsType3Component::OAppOptionsType3Impl<ContractState>;
    impl OAppOptionsType3InternalImpl = OAppOptionsType3Component::InternalImpl<ContractState>;

    #[storage]
    struct Storage {
        #[substorage(v0)]
        erc20: ERC20Component::Storage,
        #[substorage(v0)]
        ownable: OwnableComponent::Storage,
        #[substorage(v0)]
        oapp_core: OAppCoreComponent::Storage,
        #[substorage(v0)]
        oft_core: OFTCoreComponent::Storage,
        #[substorage(v0)]
        oapp_options_type_3: OAppOptionsType3Component::Storage,
        // Add our own storage to access internal values
        test_decimal_conversion_rate: u256,
    }

    #[event]
    #[derive(Drop, starknet::Event)]
    pub enum Event {
        #[flat]
        ERC20Event: ERC20Component::Event,
        #[flat]
        OwnableEvent: OwnableComponent::Event,
        #[flat]
        OAppCoreEvent: OAppCoreComponent::Event,
        #[flat]
        OFTCoreEvent: OFTCoreComponent::Event,
        #[flat]
        OAppOptionsType3Event: OAppOptionsType3Component::Event,
    }

    #[constructor]
    fn constructor(
        ref self: ContractState,
        name: ByteArray,
        symbol: ByteArray,
        lz_endpoint: ContractAddress,
        owner: ContractAddress,
        stark_token: ContractAddress,
        use_mock_decimal_conversion_rate: bool,
    ) {
        // Initialize ERC20 with test values
        self.erc20.initializer(name, symbol);

        // Initialize Ownable
        self.ownable.initializer(owner);

        // Initialize OApp Core
        self.oapp_core.initializer(lz_endpoint, owner, stark_token);

        // Initialize OFT Core with test values (will be overridden in tests)
        let local_decimals = self.erc20.decimals();
        self.oft_core.initializer(local_decimals, SHARED_DECIMALS);

        if use_mock_decimal_conversion_rate {
            // Store the conversion rate for testing access
            self.test_decimal_conversion_rate.write(1000000000000_u256); // 10^(18-6)
        }
    }

    #[abi(embed_v0)]
    impl MockOFTCoreTestImpl of IMockOFTCore<ContractState> {
        // Expose internal functions for testing
        fn test_to_ld(self: @ContractState, amount_sd: u64) -> u256 {
            self.oft_core._to_ld(amount_sd)
        }

        fn test_to_sd(self: @ContractState, amount_ld: u256) -> u64 {
            self.oft_core._to_sd(amount_ld)
        }

        fn test_remove_dust(self: @ContractState, amount_ld: u256) -> u256 {
            self.oft_core._remove_dust(amount_ld)
        }

        fn test_debit_view(
            self: @ContractState, amount_ld: u256, min_amount_ld: u256, dst_eid: u32,
        ) -> OFTDebit {
            self.oft_core._debit_view(amount_ld, min_amount_ld, dst_eid)
        }

        fn test_build_msg_and_options(
            self: @ContractState, send_param: SendParam, amount_ld: u256,
        ) -> OFTMsgAndOptions {
            self.oft_core._build_msg_and_options(@send_param, amount_ld)
        }

        fn test_set_msg_inspector(ref self: ContractState, msg_inspector: ContractAddress) {
            self.oft_core.set_msg_inspector(msg_inspector);
        }

        fn test_shared_decimals(self: @ContractState) -> u8 {
            self.oft_core.shared_decimals()
        }

        fn test_decimal_conversion_rate(self: @ContractState) -> u256 {
            self.test_decimal_conversion_rate.read()
        }

        fn test_initializer(ref self: ContractState, local_decimals: u8) {
            self.oft_core.initializer(local_decimals, SHARED_DECIMALS);
            let shared_decimals = self.oft_core.shared_decimals();

            // Calculate and store the conversion rate for testing
            let decimals_diff = local_decimals - shared_decimals;
            let rate = if decimals_diff == 0 {
                1_u256
            } else if decimals_diff == 12 {
                1000000000000_u256 // 10^12
            } else {
                // For simplicity, only handle common cases
                1_u256
            };
            self.test_decimal_conversion_rate.write(rate);
        }
    }
}
