/// OAppCore Component - Complete LayerZero OApp functionality

#[starknet::component]
pub mod OAppCoreComponent {
    use core::num::traits::Zero;
    use lz_utils::bytes::{Bytes32, ContractAddressIntoBytes32};
    use lz_utils::error::assert_with_byte_array;
    use openzeppelin::access::ownable::OwnableComponent;
    use openzeppelin::access::ownable::OwnableComponent::{
        InternalImpl as OwnableInternalImpl, InternalTrait as OwnableInternalTrait,
    };
    use openzeppelin::token::erc20::interface::{IERC20Dispatcher, IERC20DispatcherTrait};
    use starknet::storage::{
        Map, StoragePathEntry, StoragePointerReadAccess, StoragePointerWriteAccess,
    };
    use starknet::{ContractAddress, get_caller_address, get_contract_address};
    use crate::common::structs::messaging::{MessageReceipt, MessagingFee, MessagingParams};
    use crate::common::structs::packet::Origin;
    use crate::endpoint::interfaces::endpoint_v2::{
        IEndpointV2Dispatcher, IEndpointV2DispatcherTrait,
    };
    use crate::endpoint::interfaces::layerzero_receiver::ILayerZeroReceiver;
    use crate::oapps::oapp::errors::{
        err_approval_failed, err_invalid_delegate, err_lz_token_unavailable, err_no_peer,
        err_not_enough_lz_token, err_not_enough_lz_token_allowance, err_not_enough_native,
        err_not_enough_native_allowance, err_only_endpoint, err_only_peer, err_transfer_failed,
    };
    use crate::oapps::oapp::events::PeerSet;

    // Version constants
    pub const OAPP_CORE_VERSION: u64 = 1;
    pub const OAPP_SENDER_VERSION: u64 = 1;
    pub const OAPP_RECEIVER_VERSION: u64 = 1;

    /// =============================== Storage =================================
    #[storage]
    pub struct Storage {
        pub OAppCore_endpoint: ContractAddress,
        pub OAppCore_native_token: ContractAddress,
        // Mapping from remoteEid to peer address
        pub OAppCore_peers: Map<u32, Bytes32>,
    }

    /// =============================== Events =================================
    #[event]
    #[derive(Drop, starknet::Event)]
    pub enum Event {
        PeerSet: PeerSet,
    }

    /// =============================== Hooks =================================

    /// Hooks for the OApp component
    ///
    /// These hooks are used to override the default behavior of the OApp component.
    /// They are used to implement the custom logic for the OApp component.
    ///
    /// Its mandatory to implement all the hooks.
    /// _lz_receive doesn't have a default implementation
    /// i.e. it must be implemented by the OApp.
    /// _is_compose_msg_sender, _allow_initialize_path, _next_nonce have default implementations
    /// and can be omitted in the contract implementation.
    pub trait OAppHooks<TContractState> {
        /// Entry point for receiving messages from the LayerZero endpoint
        ///
        /// # Arguments
        ///
        /// * `origin`: The origin information containing the source endpoint and sender address
        /// * `guid`: The unique identifier for the received LayerZero message
        /// * `message`: The payload of the received message
        fn _lz_receive(
            ref self: ComponentState<TContractState>,
            origin: Origin,
            guid: Bytes32,
            message: ByteArray,
            executor: ContractAddress,
            extra_data: ByteArray,
            value: u256,
        );

        /// Checks if the caller is a valid composeMsg sender
        ///
        /// # Arguments
        ///
        /// * `origin`: The origin information containing the source endpoint and sender address
        /// * `message`: The payload of the received message
        /// * `sender`: The address of the sender
        ///
        /// # Returns
        ///
        /// * `bool`: True if the sender is a valid composeMsg sender, false otherwise
        ///
        /// Applications can optionally choose to implement separate composeMsg senders that are NOT
        /// the bridging layer.
        /// The default sender IS the OAppReceiver implementer.
        fn _is_compose_msg_sender(
            self: @ComponentState<TContractState>,
            origin: Origin,
            message: ByteArray,
            sender: ContractAddress,
        ) -> bool {
            sender == get_contract_address()
        }

        /// Checks if the path initialization is allowed based on the provided origin
        ///
        /// # Arguments
        ///
        /// * `origin`: The origin information containing the source endpoint and sender address
        ///
        /// # Returns
        ///
        /// * `bool`: True if the path has been initialized, false otherwise
        ///
        /// @dev This indicates to the endpoint that the OApp has enabled msgs for this particular
        /// path to be received.
        /// @dev This defaults to assuming if a peer has been set, its initialized.
        /// Can be overridden by the OApp if there is other logic to determine this.
        fn _allow_initialize_path(
            self: @ComponentState<TContractState>, origin: Origin,
        ) -> bool {
            self.OAppCore_peers.entry(origin.src_eid).read() == origin.sender
        }

        /// Returns the next nonce for a given source endpoint and sender address
        ///
        /// # Arguments
        ///
        /// * `src_eid`: The source endpoint ID
        /// * `sender`: The sender address
        ///
        /// # Returns
        ///
        /// * `u64`: The next nonce
        ///
        /// @dev The path nonce starts from 1. If 0 is returned it means that there is NO nonce
        /// ordered enforcement.
        /// @dev Is required by the off-chain executor to determine the OApp expects msg execution
        /// is ordered.
        /// @dev This is also enforced by the OApp.
        /// @dev By default this is NOT enabled. ie. nextNonce is hardcoded to return 0.
        fn _next_nonce(
            self: @ComponentState<TContractState>, src_eid: u32, sender: Bytes32,
        ) -> u64 {
            0
        }
    }

    #[embeddable_as(OAppCoreImpl)]
    impl OAppCore<
        TContractState,
        +HasComponent<TContractState>,
        impl Ownable: OwnableComponent::HasComponent<TContractState>,
    > of crate::oapps::oapp::interface::IOApp<ComponentState<TContractState>> {
        fn get_endpoint(self: @ComponentState<TContractState>) -> ContractAddress {
            self.OAppCore_endpoint.read()
        }

        fn set_peer(ref self: ComponentState<TContractState>, eid: u32, peer: Bytes32) {
            self._assert_only_owner();
            self.OAppCore_peers.entry(eid).write(peer);
            self.emit(PeerSet { eid, peer });
        }

        fn get_peer(self: @ComponentState<TContractState>, eid: u32) -> Bytes32 {
            self.OAppCore_peers.entry(eid).read()
        }

        fn oapp_version(self: @ComponentState<TContractState>) -> (u64, u64) {
            (OAPP_SENDER_VERSION, OAPP_RECEIVER_VERSION)
        }

        fn set_delegate(ref self: ComponentState<TContractState>, delegate: ContractAddress) {
            self._assert_only_owner();

            IEndpointV2Dispatcher { contract_address: self.OAppCore_endpoint.read() }
                .set_delegate(delegate);
        }
    }

    /// LayerZero Receiver implementation
    #[embeddable_as(LayerZeroReceiverImpl)]
    impl LayerZeroReceiver<
        TContractState,
        +HasComponent<TContractState>,
        impl Ownable: OwnableComponent::HasComponent<TContractState>,
        +OAppHooks<TContractState>,
    > of ILayerZeroReceiver<ComponentState<TContractState>> {
        fn lz_receive(
            ref self: ComponentState<TContractState>,
            origin: Origin,
            guid: Bytes32,
            message: ByteArray,
            executor: ContractAddress,
            extra_data: ByteArray,
            value: u256,
        ) {
            // Ensures that only the endpoint can attempt to lzReceive() messages to this OApp
            self._assert_only_endpoint();

            // Ensure that the sender matches the expected peer for the source endpoint
            let expected_peer = self._get_peer_or_revert(origin.src_eid);
            assert_with_byte_array(
                expected_peer == origin.sender, err_only_peer(origin.src_eid, origin.sender),
            );

            // Call the internal OApp implementation of lzReceive
            self._lz_receive(origin, guid, message, executor, extra_data, value);
        }

        fn allow_initialize_path(self: @ComponentState<TContractState>, origin: Origin) -> bool {
            self._allow_initialize_path(origin)
        }

        fn next_nonce(self: @ComponentState<TContractState>, src_eid: u32, sender: Bytes32) -> u64 {
            self._next_nonce(src_eid, sender)
        }
    }

    #[embeddable_as(OAppReceiverImpl)]
    impl IOAppReceiver<
        TContractState, +HasComponent<TContractState>, +OAppHooks<TContractState>,
    > of crate::oapps::oapp::interface::IOAppReceiver<ComponentState<TContractState>> {
        fn is_compose_msg_sender(
            self: @ComponentState<TContractState>,
            origin: Origin,
            message: ByteArray,
            sender: ContractAddress,
        ) -> bool {
            self._is_compose_msg_sender(origin, message, sender)
        }
    }


    /// =============================== OApp Sender Functions =================================
    #[generate_trait]
    pub impl OAppSenderImpl<
        TContractState,
        +HasComponent<TContractState>,
        impl Ownable: OwnableComponent::HasComponent<TContractState>,
    > of OAppSender<TContractState> {
        /// Quotes the fee for sending a message to a destination endpoint
        ///
        /// # Arguments
        ///
        /// * `dst_eid`: The destination endpoint ID
        /// * `message`: The message payload to be sent
        /// * `options`: Additional options for the message transmission
        /// * `pay_in_lz_token`: Flag indicating whether to pay the fee in LZ tokens
        ///
        /// # Returns
        ///
        /// * `MessagingFee`: The calculated fee structure for the message
        fn _quote(
            self: @ComponentState<TContractState>,
            dst_eid: u32,
            message: ByteArray,
            options: ByteArray,
            pay_in_lz_token: bool,
        ) -> MessagingFee {
            let receiver = self._get_peer_or_revert(dst_eid);
            let params = MessagingParams { dst_eid, receiver, message, options, pay_in_lz_token };
            let sender = get_contract_address();
            let endpoint = self.OAppCore_endpoint.read();
            let endpoint_dispatcher = IEndpointV2Dispatcher { contract_address: endpoint };
            endpoint_dispatcher.quote(params, sender)
        }

        /// Sends a message through the LayerZero endpoint to a destination chain
        ///
        /// # Arguments
        ///
        /// * `dst_eid`: The destination endpoint ID
        /// * `message`: The message payload to be sent
        /// * `options`: Additional options for the message transmission
        /// * `fee`: The messaging fee structure containing native and LZ token fees
        /// * `refund_address`: Address to receive any excess fees
        ///
        /// # Returns
        ///
        /// * `MessageReceipt`: Receipt containing transaction details and message information
        fn _lz_send(
            ref self: ComponentState<TContractState>,
            caller: ContractAddress,
            dst_eid: u32,
            message: ByteArray,
            options: ByteArray,
            fee: MessagingFee,
            refund_address: ContractAddress,
        ) -> MessageReceipt {
            let contract_address = get_contract_address();
            let endpoint = self.OAppCore_endpoint.read();
            self._pay_native(caller, endpoint, contract_address, fee.native_fee);
            if fee.lz_token_fee > 0 {
                self._pay_lz_token(caller, endpoint, contract_address, fee.lz_token_fee);
            }

            let endpoint_dispatcher = IEndpointV2Dispatcher { contract_address: endpoint };

            endpoint_dispatcher
                .send(
                    MessagingParams {
                        dst_eid,
                        receiver: self._get_peer_or_revert(dst_eid),
                        message,
                        options,
                        pay_in_lz_token: fee.lz_token_fee > 0,
                    },
                    refund_address,
                )
        }

        /// Handles payment of native token fees for message transmission
        ///
        /// # Arguments
        ///
        /// * `caller`: The address making the payment
        /// * `endpoint`: The LayerZero endpoint address
        /// * `contract_address`: This contract's address
        /// * `fee`: The amount of native tokens to pay
        fn _pay_native(
            ref self: ComponentState<TContractState>,
            caller: ContractAddress,
            endpoint: ContractAddress,
            contract_address: ContractAddress,
            fee: u256,
        ) {
            let native_token_address = self.OAppCore_native_token.read();
            // Check if enough native fee is sent
            let native_token_dispatcher = IERC20Dispatcher {
                contract_address: native_token_address,
            };
            let balance = native_token_dispatcher.balance_of(caller);
            assert_with_byte_array(balance >= fee, err_not_enough_native(fee, balance));
            if caller != contract_address {
                let allowance = native_token_dispatcher.allowance(caller, contract_address);
                assert_with_byte_array(
                    allowance >= fee, err_not_enough_native_allowance(fee, allowance),
                );
            }

            self._pay_in_token(caller, endpoint, contract_address, fee, native_token_address);
        }

        /// Handles payment of LayerZero token fees for message transmission
        ///
        /// # Arguments
        ///
        /// * `caller`: The address making the payment
        /// * `endpoint`: The LayerZero endpoint address
        /// * `contract_address`: This contract's address
        /// * `fee`: The amount of LZ tokens to pay
        fn _pay_lz_token(
            ref self: ComponentState<TContractState>,
            caller: ContractAddress,
            endpoint: ContractAddress,
            contract_address: ContractAddress,
            fee: u256,
        ) {
            let endpoint_dispatcher = IEndpointV2Dispatcher { contract_address: endpoint };
            let lz_token_address = endpoint_dispatcher.get_lz_token();
            assert_with_byte_array(lz_token_address != Zero::zero(), err_lz_token_unavailable());

            // Check if enough lz token fee is sent
            let lz_dispatcher = IERC20Dispatcher { contract_address: lz_token_address };
            let balance = lz_dispatcher.balance_of(caller);
            assert_with_byte_array(balance >= fee, err_not_enough_lz_token(fee, balance));
            if caller != contract_address {
                let allowance = lz_dispatcher.allowance(caller, contract_address);
                assert_with_byte_array(
                    allowance >= fee, err_not_enough_lz_token_allowance(fee, allowance),
                );
            }
            self._pay_in_token(caller, endpoint, contract_address, fee, lz_token_address);
        }

        /// Internal function responsible for transferring tokens from caller to OApp
        /// and approving the endpoint to spend the tokens
        ///
        /// # Arguments
        ///
        /// * `caller`: The address making the payment
        /// * `endpoint`: The LayerZero endpoint address that needs approval
        /// * `contract_address`: This contract's address (recipient of the transfer)
        /// * `fee`: The amount of tokens to transfer and approve
        /// * `token_address`: The address of the token contract
        fn _pay_in_token(
            ref self: ComponentState<TContractState>,
            caller: ContractAddress,
            endpoint: ContractAddress,
            contract_address: ContractAddress,
            fee: u256,
            token_address: ContractAddress,
        ) {
            let token_dispatcher = IERC20Dispatcher { contract_address: token_address };

            if caller != contract_address {
                let success = token_dispatcher.transfer_from(caller, contract_address, fee);
                assert_with_byte_array(success, err_transfer_failed());
            }

            let success = token_dispatcher.approve(endpoint, fee);
            assert_with_byte_array(success, err_approval_failed());
        }
    }

    /// =============================== Internal Functions =================================
    #[generate_trait]
    pub impl InternalImpl<
        TContractState,
        +HasComponent<TContractState>,
        impl Ownable: OwnableComponent::HasComponent<TContractState>,
    > of InternalTrait<TContractState> {
        /// Initialize the OApp component with the LayerZero endpoint address
        /// This should be called during contract deployment
        ///
        /// # Arguments
        ///
        /// * `endpoint`: The LayerZero endpoint contract address
        fn initializer(
            ref self: ComponentState<TContractState>,
            endpoint: ContractAddress,
            delegate: ContractAddress,
            native_token: ContractAddress,
        ) {
            self.OAppCore_endpoint.write(endpoint);
            self.OAppCore_native_token.write(native_token);

            assert_with_byte_array(delegate.is_non_zero(), err_invalid_delegate());

            IEndpointV2Dispatcher { contract_address: endpoint }.set_delegate(delegate)
        }

        /// Restricts function access to only the LayerZero endpoint contract
        /// Used to ensure that only the endpoint can call certain functions like lz_receive
        fn _assert_only_endpoint(self: @ComponentState<TContractState>) {
            let caller = get_caller_address();
            let endpoint = self.OAppCore_endpoint.read();
            assert_with_byte_array(caller == endpoint, err_only_endpoint(endpoint));
        }

        /// Restricts function access to only the contract owner
        /// Delegates to the OpenZeppelin Ownable component for ownership checks
        fn _assert_only_owner(self: @ComponentState<TContractState>) {
            get_dep_component!(self, Ownable).assert_only_owner();
        }

        /// Internal function to get the peer address associated with a specific endpoint
        /// Reverts if the peer is not set (i.e. the peer is set to Bytes32 { value: 0 })
        ///
        /// # Arguments
        ///
        /// * `eid`: The endpoint ID to look up
        ///
        /// # Returns
        ///
        /// * `Bytes32`: The peer address associated with the specified endpoint
        fn _get_peer_or_revert(self: @ComponentState<TContractState>, eid: u32) -> Bytes32 {
            let peer = self.OAppCore_peers.entry(eid).read();
            assert_with_byte_array(peer.value != 0, err_no_peer(eid));
            peer
        }
    }
}
