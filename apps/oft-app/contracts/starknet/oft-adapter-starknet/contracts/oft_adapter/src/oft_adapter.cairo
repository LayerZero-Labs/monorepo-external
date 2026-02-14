/// OFT Adapter Contract
/// Wraps an existing ERC20 token for cross-chain transfers using lock/unlock mechanism
#[starknet::contract]
pub mod OFTAdapter {
    use layerzero::oapps::common::oapp_options_type_3::oapp_options_type_3::OAppOptionsType3Component;
    use layerzero::oapps::oapp::oapp_core::OAppCoreComponent;
    use layerzero::oapps::oft::errors::err_oft_transfer_failed;
    use layerzero::oapps::oft::oft_core::default_oapp_hooks::OFTCoreOAppHooksDefaultImpl;
    use layerzero::oapps::oft::oft_core::oft_core::OFTCoreComponent;
    use layerzero::oapps::oft::structs::OFTDebit;
    use lz_utils::error::assert_with_byte_array;
    use openzeppelin::access::ownable::OwnableComponent;
    use openzeppelin::token::erc20::interface::{
        IERC20Dispatcher, IERC20DispatcherTrait, IERC20MetadataDispatcher,
        IERC20MetadataDispatcherTrait,
    };
    use starknet::storage::{StoragePointerReadAccess, StoragePointerWriteAccess};
    use starknet::{ContractAddress, get_contract_address};

    // Component declarations
    component!(path: OwnableComponent, storage: ownable, event: OwnableEvent);
    component!(path: OAppCoreComponent, storage: oapp_core, event: OAppCoreEvent);
    component!(path: OFTCoreComponent, storage: oft_core, event: OFTCoreEvent);
    component!(
        path: OAppOptionsType3Component, storage: oapp_options_type_3, event: OAppOptionsType3Event,
    );

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
        ownable: OwnableComponent::Storage,
        #[substorage(v0)]
        oapp_core: OAppCoreComponent::Storage,
        #[substorage(v0)]
        oft_core: OFTCoreComponent::Storage,
        #[substorage(v0)]
        oapp_options_type_3: OAppOptionsType3Component::Storage,
        erc20_token: ContractAddress,
    }

    #[event]
    #[derive(Drop, starknet::Event)]
    enum Event {
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
        erc20_token: ContractAddress,
        lz_endpoint: ContractAddress,
        owner: ContractAddress,
        native_token: ContractAddress,
    ) {
        // Initialize Ownable
        self.ownable.initializer(owner);

        // Initialize OApp Core
        self.oapp_core.initializer(lz_endpoint, owner, native_token);

        // Initialize token address
        self.erc20_token.write(erc20_token);

        // OFT Core needs to read local decimals from already deployed ERC20 token
        let token_dispatcher = IERC20MetadataDispatcher { contract_address: erc20_token };

        // Initialize OFT Core with local decimals
        self.oft_core.initializer(token_dispatcher.decimals(), SHARED_DECIMALS);
    }

    // Implement OFTHooks to provide the specific token operations
    impl OFTHooks of OFTCoreComponent::OFTHooks<ContractState> {
        fn _debit(
            ref self: OFTCoreComponent::ComponentState<ContractState>,
            from: ContractAddress,
            amount: u256,
            min_amount: u256,
            dst_eid: u32,
        ) -> OFTDebit {
            let oft_debit = self._debit_view(amount, min_amount, dst_eid);

            // Lock tokens by transferring them from the caller to this contract
            let success = IERC20Dispatcher { contract_address: self._token() }
                .transfer_from(from, get_contract_address(), oft_debit.amount_sent_ld);
            assert_with_byte_array(success, err_oft_transfer_failed());

            oft_debit
        }

        fn _credit(
            ref self: OFTCoreComponent::ComponentState<ContractState>,
            to: ContractAddress,
            amount: u256,
            src_eid: u32,
        ) -> u256 {
            // Unlock tokens by transferring them from this contract to the recipient
            let success = IERC20Dispatcher { contract_address: self._token() }.transfer(to, amount);
            assert_with_byte_array(success, err_oft_transfer_failed());

            // Return the actual amount received (same as input in default implementation)
            amount
        }

        fn _token(self: @OFTCoreComponent::ComponentState<ContractState>) -> ContractAddress {
            self.get_contract().erc20_token.read()
        }

        fn _approval_required(self: @OFTCoreComponent::ComponentState<ContractState>) -> bool {
            true
        }
    }
}
