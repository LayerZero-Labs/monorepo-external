/// # EndpointV2 Contract
///
/// The EndpointV2 contract is the core component of the LayerZero protocol, responsible for
/// managing the lifecycle of messages between different OApps. It provides a comprehensive set of
/// functionalities that enable developers to build sophisticated omnichain applications (OApps)
/// with ease.
///
/// ## Key Features
/// - **Message Sending and Receiving**: Core functions for sending and receiving messages across
///   different blockchains, abstracting away the complexities of cross-chain communication.
/// - **Configurable Security**: OApps can define their own security requirements by specifying a
///   set of Data Verification Networks (DVNs) and a threshold of required verifications,
///   ensuring that each message meets the application's security standards.
/// - **Fee Quotation**: Provides a mechanism to quote the cost of sending a message, allowing
///   applications to estimate and manage transaction fees transparently.
/// - **Message Verification and Execution**: Verifies the authenticity of incoming messages
///   through the configured DVNs and ensures that only valid messages are executed.
/// - **Verify-Store-Execute Pattern**: Implements a secure message handling pattern where message
///   payload hashes are stored on-chain and executed only after successful verification,
///   preventing race conditions and other security vulnerabilities.
/// - **Alerts and Error Handling**: Includes a system for receiving alerts about failed
///   messages, enabling robust error handling and recovery mechanisms.
/// - **Delegate and Token Management**: Supports delegation of OApp configuration management and
///   allows for the use of the ZRO token for paying fees.
#[starknet::contract]
pub mod EndpointV2 {
    use core::num::traits::Zero;
    use lz_utils::byte_array_ext::byte_array_ext::ByteArrayTraitExt;
    use lz_utils::bytes::{Bytes32, ContractAddressIntoBytes32};
    use lz_utils::error::assert_with_byte_array;
    use openzeppelin::access::ownable::OwnableComponent;
    use openzeppelin::security::ReentrancyGuardComponent;
    use openzeppelin::token::erc20::interface::{IERC20Dispatcher, IERC20DispatcherTrait};
    use starknet::storage::{
        Map, StoragePathEntry, StoragePointerReadAccess, StoragePointerWriteAccess,
    };
    use starknet::{ContractAddress, get_caller_address, get_contract_address};
    use crate::MessagingFee;
    use crate::common::guid::GUID;
    use crate::common::structs::messaging::{MessageLibSendResult, MessageReceipt, MessagingParams};
    use crate::common::structs::packet::{Origin, Packet};
    use crate::endpoint::constants::{EMPTY_PAYLOAD_HASH, NIL_PAYLOAD_HASH};
    use crate::endpoint::errors::{
        err_insufficient_fee, err_invalid_lz_token_address, err_invalid_payload_hash,
        err_invalid_receive_library, err_lz_receive_value_exceeds_allowance,
        err_lz_token_unavailable, err_native_transfer_failed, err_path_not_initializable,
        err_path_not_verifiable, err_unauthorized, err_zro_transfer_failed,
    };
    use crate::endpoint::events::{
        DelegateSet, LzReceiveAlert, LzTokenSet, PacketDelivered, PacketSent, PacketVerified,
    };
    use crate::endpoint::interfaces::endpoint_v2::{ExecutionState, IEndpointV2};
    use crate::endpoint::interfaces::layerzero_receiver::{
        ILayerZeroReceiverDispatcher, ILayerZeroReceiverDispatcherTrait,
    };
    use crate::endpoint::message_lib_manager::message_lib_manager::MessageLibManagerComponent;
    use crate::endpoint::message_lib_manager::structs::GetLibraryResponse;
    use crate::endpoint::messaging_channel::interface::IMessagingChannel;
    use crate::endpoint::messaging_channel::messaging_channel::MessagingChannelComponent;
    use crate::endpoint::messaging_composer::messaging_composer::MessagingComposerComponent;
    use crate::message_lib::interface::{IMessageLibDispatcher, IMessageLibDispatcherTrait};

    ////////////////
    // Components //
    ////////////////

    component!(path: OwnableComponent, storage: ownable, event: OwnableEvent);
    component!(
        path: MessageLibManagerComponent,
        storage: message_lib_manager,
        event: MessageLibManagerEvent,
    );
    component!(
        path: ReentrancyGuardComponent, storage: reentrancy_guard, event: ReentrancyGuardEvent,
    );
    component!(
        path: MessagingChannelComponent, storage: messaging_channel, event: MessagingChannelEvent,
    );
    component!(
        path: MessagingComposerComponent,
        storage: messaging_composer,
        event: MessagingComposerEvent,
    );

    // Ownable
    #[abi(embed_v0)]
    impl OwnableImpl = OwnableComponent::OwnableImpl<ContractState>;
    impl OwnableInternalImpl = OwnableComponent::InternalImpl<ContractState>;

    #[abi(embed_v0)]
    impl MessageLibManagerImpl =
        MessageLibManagerComponent::MessageLibManagerImpl<ContractState>;
    impl MessageLibManagerInternalImpl = MessageLibManagerComponent::InternalImpl<ContractState>;

    // ReentrancyGuard
    impl ReentrancyGuardInternalImpl = ReentrancyGuardComponent::InternalImpl<ContractState>;

    // MessagingChannel
    #[abi(embed_v0)]
    impl MessagingChannelImpl =
        MessagingChannelComponent::MessagingChannelImpl<ContractState>;
    impl MessagingChannelInternalImpl = MessagingChannelComponent::InternalImpl<ContractState>;

    // MessagingComposer
    #[abi(embed_v0)]
    impl MessagingComposerImpl =
        MessagingComposerComponent::MessagingComposerImpl<ContractState>;
    impl MessagingComposerInternalImpl = MessagingComposerComponent::InternalImpl<ContractState>;

    #[storage]
    struct Storage {
        // Native token address
        native_token_address: ContractAddress,
        lz_token_address: ContractAddress,
        // Delegates
        // Used to authorize OApps to set their own libraries
        // oapp => delegate
        delegates: Map<ContractAddress, ContractAddress>,
        // Component substorages:
        #[substorage(v0)]
        ownable: OwnableComponent::Storage,
        #[substorage(v0)]
        message_lib_manager: MessageLibManagerComponent::Storage,
        #[substorage(v0)]
        reentrancy_guard: ReentrancyGuardComponent::Storage,
        #[substorage(v0)]
        messaging_channel: MessagingChannelComponent::Storage,
        #[substorage(v0)]
        messaging_composer: MessagingComposerComponent::Storage,
    }

    #[event]
    #[derive(Drop, starknet::Event)]
    pub enum Event {
        PacketSent: PacketSent,
        PacketVerified: PacketVerified,
        PacketDelivered: PacketDelivered,
        LzTokenSet: LzTokenSet,
        LzReceiveAlert: LzReceiveAlert,
        DelegateSet: DelegateSet,
        // Component events:
        #[flat]
        OwnableEvent: OwnableComponent::Event,
        #[flat]
        ReentrancyGuardEvent: ReentrancyGuardComponent::Event,
        #[flat]
        MessagingChannelEvent: MessagingChannelComponent::Event,
        #[flat]
        MessageLibManagerEvent: MessageLibManagerComponent::Event,
        #[flat]
        MessagingComposerEvent: MessagingComposerComponent::Event,
    }

    #[constructor]
    fn constructor(
        ref self: ContractState,
        owner: ContractAddress,
        eid: u32,
        native_token_address: ContractAddress,
        blocked_library: ContractAddress,
    ) {
        self.ownable.initializer(owner);
        // Initialize MessagingChannel with EID
        self.messaging_channel.initializer(eid);
        // Initialize Native token
        self.native_token_address.write(native_token_address);
        // Initialize MessagingComposer with native token
        self.messaging_composer.initializer(native_token_address);
        // Initialize MessageLibManager with blocked library
        self.message_lib_manager.initializer(blocked_library);
    }

    #[abi(embed_v0)]
    impl EndpointV2Impl of IEndpointV2<ContractState> {
        /// Here we're assuming that the OApp takes an allowance from the user,
        /// takes that money from the user, gives that as allowance to the EndpointV2
        /// and then the endpoint gives the remainder back to the refund_address provided
        fn send(
            ref self: ContractState, params: MessagingParams, refund_address: ContractAddress,
        ) -> MessageReceipt {
            self.reentrancy_guard.start();

            let sender = get_caller_address();

            // Create the packet and find the send message lib
            let (packet, message_lib_dispatcher) = self._send(sender, @params);

            let MessagingParams { options, pay_in_lz_token, dst_eid, receiver, .. } = params;

            // Update the nonce
            self
                .messaging_channel
                ._outbound_nonce_entry(sender, dst_eid, receiver)
                .write(packet.nonce);

            // Call send on the message lib
            let MessageLibSendResult {
                message_receipt, encoded_packet,
            } = message_lib_dispatcher.send(packet, options.clone(), pay_in_lz_token);

            // Pay the workers based on the quote provided by the message lib
            self._pay_workers(sender, @message_receipt, refund_address, pay_in_lz_token);

            self
                .emit(
                    PacketSent {
                        encoded_packet,
                        options,
                        send_library: message_lib_dispatcher.contract_address,
                    },
                );

            self.reentrancy_guard.end();
            message_receipt
        }

        fn lz_receive_alert(
            ref self: ContractState,
            origin: Origin,
            receiver: ContractAddress,
            guid: Bytes32,
            gas: u256,
            value: u256,
            message: ByteArray,
            extra_data: ByteArray,
            reason: Array<felt252>,
        ) {
            let executor = get_caller_address();
            self
                .emit(
                    LzReceiveAlert {
                        origin, receiver, executor, guid, gas, value, message, extra_data, reason,
                    },
                );
        }

        fn verify(
            ref self: ContractState,
            origin: Origin,
            receiver: ContractAddress,
            payload_hash: Bytes32,
        ) {
            self.reentrancy_guard.start();

            // Assert that the caller is the receive library for this path
            self._assert_only_receive_library(receiver, origin.src_eid);

            // Get the lazy inbound nonce for this path
            let lazy_nonce = self
                .messaging_channel
                .lazy_inbound_nonce(receiver, origin.src_eid, origin.sender);

            // Ensure that the path is initializable
            assert_with_byte_array(
                self._initializable(origin.clone(), receiver, lazy_nonce),
                err_path_not_initializable(),
            );

            // Ensure that the path is verifiable
            assert_with_byte_array(
                self._verifiable(origin.clone(), receiver, lazy_nonce), err_path_not_verifiable(),
            );

            // Ensure that the payload hash is valid
            assert_with_byte_array(payload_hash != EMPTY_PAYLOAD_HASH, err_invalid_payload_hash());

            // Store the payload hash for this inbound message
            self
                .messaging_channel
                ._inbound_payload_hash_entry(receiver, origin.src_eid, origin.sender, origin.nonce)
                .write(payload_hash);

            self.emit(PacketVerified { origin, receiver, payload_hash });

            self.reentrancy_guard.end();
        }

        fn lz_receive(
            ref self: ContractState,
            origin: Origin,
            receiver: ContractAddress,
            guid: Bytes32,
            message: ByteArray,
            extra_data: ByteArray,
            value: u256,
        ) {
            // Create payload by concatenating guid and message
            let payload = self._create_payload(guid, @message);

            // Clear the payload first to prevent reentrancy, then execute the message
            self.messaging_channel._clear_payload(receiver, @origin, @payload);

            // Check if the LzReceive.value is greater than the allowance
            let executor = get_caller_address();

            let native_token = IERC20Dispatcher {
                contract_address: self.native_token_address.read(),
            };
            let allowance = native_token.allowance(executor, get_contract_address());
            assert_with_byte_array(
                value <= allowance, err_lz_receive_value_exceeds_allowance(value, allowance),
            );

            // Transfer the LzReceive.value to the receiver
            let success = native_token.transfer_from(executor, receiver, value);
            assert_with_byte_array(success, err_native_transfer_failed());

            // We're calling .lz_receive after giving it the money, so they can have the money
            // available to use it to handle the message
            let receiver_dispatcher = ILayerZeroReceiverDispatcher { contract_address: receiver };
            receiver_dispatcher
                .lz_receive(origin.clone(), guid, message, executor, extra_data, value);

            self.emit(PacketDelivered { origin, receiver });
        }

        fn clear(
            ref self: ContractState,
            origin: Origin,
            receiver: ContractAddress,
            guid: Bytes32,
            message: ByteArray,
        ) {
            self._assert_authorized(receiver);

            /// Create payload by concatenating guid and message
            let payload = self._create_payload(guid, @message);

            /// Clear the payload first to prevent reentrancy, then execute the message
            self.messaging_channel._clear_payload(receiver, @origin, @payload);

            self.emit(PacketDelivered { origin, receiver });
        }

        fn quote(
            self: @ContractState, params: MessagingParams, sender: ContractAddress,
        ) -> MessagingFee {
            let (packet, msg_lib_dispatcher) = self._send(sender, @params);
            msg_lib_dispatcher.quote(packet, params.options, params.pay_in_lz_token)
        }

        fn get_lz_token(self: @ContractState) -> ContractAddress {
            self.lz_token_address.read()
        }

        fn get_eid(self: @ContractState) -> u32 {
            self.messaging_channel.eid.read()
        }

        fn set_lz_token(ref self: ContractState, lz_token_address: ContractAddress) {
            self.ownable.assert_only_owner();
            assert_with_byte_array(
                self.native_token_address.read() != lz_token_address,
                err_invalid_lz_token_address(lz_token_address),
            );

            self.lz_token_address.write(lz_token_address);
            self.emit(LzTokenSet { lz_token_address });
        }

        fn set_delegate(ref self: ContractState, delegate: ContractAddress) {
            let oapp = get_caller_address();
            self.delegates.entry(oapp).write(delegate);
            self.emit(DelegateSet { oapp, delegate });
        }

        fn get_delegate(self: @ContractState, oapp: ContractAddress) -> ContractAddress {
            self.delegates.entry(oapp).read()
        }

        fn initializable(self: @ContractState, origin: Origin, receiver: ContractAddress) -> bool {
            let lazy_nonce = self
                .messaging_channel
                .lazy_inbound_nonce(receiver, origin.src_eid, origin.sender);
            self._initializable(origin, receiver, lazy_nonce)
        }

        fn verifiable(self: @ContractState, origin: Origin, receiver: ContractAddress) -> bool {
            let Origin { src_eid, sender, .. } = origin.clone();
            let lazy_nonce = self.messaging_channel.lazy_inbound_nonce(receiver, src_eid, sender);
            self._verifiable(origin, receiver, lazy_nonce)
        }

        fn verifiable_with_receive_lib(
            self: @ContractState,
            origin: Origin,
            receiver: ContractAddress,
            receive_lib: ContractAddress,
        ) -> bool {
            self.verifiable(origin.clone(), receiver)
                && self
                    .message_lib_manager
                    .is_valid_receive_library(receiver, origin.src_eid, receive_lib)
        }

        fn executable(
            self: @ContractState, origin: Origin, receiver: ContractAddress,
        ) -> ExecutionState {
            let Origin { src_eid, sender, nonce } = origin;

            let payload_hash = self
                .messaging_channel
                .inbound_payload_hash(receiver, src_eid, sender, nonce);

            // executed if the payload hash has been cleared and the nonce is less than or equal to
            // lazyInboundNonce
            if payload_hash == EMPTY_PAYLOAD_HASH
                && nonce <= self.messaging_channel.lazy_inbound_nonce(receiver, src_eid, sender) {
                return ExecutionState::Executed;
            }

            // executable if nonce has not been executed and has not been nilified and nonce is less
            // than or equal to inboundNonce
            if payload_hash != NIL_PAYLOAD_HASH
                && nonce <= self.messaging_channel.inbound_nonce(receiver, src_eid, sender) {
                return ExecutionState::Executable;
            }

            // only start active executable polling if payload hash is not empty nor nil
            if payload_hash != EMPTY_PAYLOAD_HASH && payload_hash != NIL_PAYLOAD_HASH {
                return ExecutionState::VerifiedButNotExecutable;
            }

            // return NotExecutable as a catch-all
            ExecutionState::NotExecutable
        }
    }

    // =============================== Internal Functions ===============================

    #[generate_trait]
    impl InternalImpl of InternalTrait {
        fn _send(
            self: @ContractState, sender: ContractAddress, params: @MessagingParams,
        ) -> (Packet, IMessageLibDispatcher) {
            let MessagingParams { dst_eid, receiver, message, pay_in_lz_token, .. } = params;
            let src_eid = self.messaging_channel.eid.read();

            assert_with_byte_array(
                !(*pay_in_lz_token && self.lz_token_address.read().is_zero()),
                err_lz_token_unavailable(),
            );

            let nonce = self.messaging_channel.outbound_nonce(sender, *dst_eid, *receiver) + 1;

            let packet = Packet {
                nonce,
                src_eid,
                sender,
                dst_eid: *dst_eid,
                receiver: *receiver,
                guid: GUID::generate(nonce, src_eid, sender.into(), *dst_eid, *receiver),
                message: message.clone(),
            };

            let GetLibraryResponse {
                lib: send_msglib, ..,
            } = self.message_lib_manager.get_send_library(sender, *dst_eid);

            let message_lib_dispatcher = IMessageLibDispatcher { contract_address: send_msglib };

            (packet, message_lib_dispatcher)
        }

        fn _pay_workers(
            ref self: ContractState,
            sender: ContractAddress,
            message_receipt: @MessageReceipt,
            refund_address: ContractAddress,
            pay_in_lz_token: bool,
        ) {
            // In order to satisfy the requirement of throwing a custom error in case the user
            // didn't send enough fees to pay all of the workers,
            // We follow this two step process to make sure none of the ERC20 transfers fail.
            // First, we loop through the payees and make sure we have enough allowance to pay all
            // of them
            // Note that we do this loop twice, because we can't trust the message library to
            // send us a non-consistent receipt (total_native_fee != sum(payees.native_amount))
            // which would result in inaccurate allowance checks and some money remaining in the
            // allowance.
            let mut total_native_fee: u256 = 0;
            let mut total_zro_fee: u256 = 0;

            for payee in @message_receipt.payees {
                total_native_fee += *payee.native_amount;
                total_zro_fee += *payee.lz_token_amount;
            }

            // Native token allowance
            let contract_address = get_contract_address();
            let native_token = IERC20Dispatcher {
                contract_address: self.native_token_address.read(),
            };
            let native_allowance = native_token.allowance(sender, contract_address);
            let native_balance = native_token.balance_of(sender);

            // ZRO token allowance
            let zro_token = if pay_in_lz_token {
                Some(IERC20Dispatcher { contract_address: self.lz_token_address.read() })
            } else {
                None
            };
            let zro_allowance = zro_token
                .map(|dispatcher| dispatcher.allowance(sender, contract_address))
                .unwrap_or_default();
            let zro_balance = zro_token
                .map(|dispatcher| dispatcher.balance_of(sender))
                .unwrap_or_default();

            Self::_assert_messaging_fee(
                total_native_fee,
                native_allowance,
                native_balance,
                total_zro_fee,
                zro_allowance,
                zro_balance,
            );

            // Pay the workers & refund the remainder of the allowances
            self
                ._pay_native_fees(
                    sender,
                    native_token,
                    message_receipt,
                    refund_address,
                    native_allowance,
                    total_native_fee,
                );

            self
                ._pay_zro_fees(
                    sender,
                    zro_token,
                    message_receipt,
                    refund_address,
                    zro_allowance,
                    total_zro_fee,
                );
        }

        fn _assert_only_receive_library(
            ref self: ContractState, receiver: ContractAddress, src_eid: u32,
        ) {
            let caller = get_caller_address();
            assert_with_byte_array(
                self.message_lib_manager.is_valid_receive_library(receiver, src_eid, caller),
                err_invalid_receive_library(),
            );
        }

        // Checkers for packet conditions
        fn _initializable(
            self: @ContractState,
            origin: Origin,
            receiver: ContractAddress,
            lazy_inbound_nonce: u64,
        ) -> bool {
            let receiver_dispatcher = ILayerZeroReceiverDispatcher { contract_address: receiver };
            lazy_inbound_nonce > 0 || receiver_dispatcher.allow_initialize_path(origin)
        }

        fn _verifiable(
            self: @ContractState,
            origin: Origin,
            receiver: ContractAddress,
            lazy_inbound_nonce: u64,
        ) -> bool {
            origin.nonce > lazy_inbound_nonce
                || self
                    .messaging_channel
                    ._has_payload_hash(receiver, origin.src_eid, origin.sender, origin.nonce)
        }

        /// Helper function to create payload by concatenating guid and message
        /// This mimics Solidity's abi.encodePacked(_guid, _message)
        fn _create_payload(
            ref self: ContractState, guid: Bytes32, message: @ByteArray,
        ) -> ByteArray {
            let mut payload: ByteArray = "";
            payload.append_u256(guid.value);
            payload.append(message);

            payload
        }

        fn _assert_authorized(self: @ContractState, oapp: ContractAddress) {
            let caller = get_caller_address();
            assert_with_byte_array(
                self.delegates.entry(oapp).read() == caller || oapp == caller, err_unauthorized(),
            );
        }

        /// Checks that the supplied fees are greater than or equal to the required fees or panics
        fn _assert_messaging_fee(
            required_native_fee: u256,
            supplied_native_fee_allowance: u256,
            supplied_native_balance: u256,
            required_zro_token_fee: u256,
            supplied_zro_fee_allowance: u256,
            supplied_zro_balance: u256,
        ) {
            let has_required_native_fee = supplied_native_fee_allowance >= required_native_fee
                && supplied_native_balance >= supplied_native_fee_allowance;
            let has_required_zro_token_fee = supplied_zro_fee_allowance >= required_zro_token_fee
                && supplied_zro_balance >= supplied_zro_fee_allowance;

            assert_with_byte_array(
                has_required_native_fee && has_required_zro_token_fee,
                err_insufficient_fee(
                    required_native_fee,
                    supplied_native_fee_allowance,
                    supplied_native_balance,
                    required_zro_token_fee,
                    supplied_zro_fee_allowance,
                    supplied_zro_balance,
                ),
            );
        }

        /// Refund the remainder of the native token allowance
        fn _refund_native(
            self: @ContractState,
            native_token: IERC20Dispatcher,
            allowance: u256,
            fee: u256,
            sender: ContractAddress,
            refund_address: ContractAddress,
        ) {
            if allowance > fee {
                let success = native_token.transfer_from(sender, refund_address, allowance - fee);
                assert_with_byte_array(success, err_native_transfer_failed());
            }
        }

        /// Refund the remainder of the ZRO token allowance
        fn _refund_zro(
            self: @ContractState,
            zro_token: IERC20Dispatcher,
            allowance: u256,
            fee: u256,
            sender: ContractAddress,
            refund_address: ContractAddress,
        ) {
            if allowance > fee {
                let success = zro_token.transfer_from(sender, refund_address, allowance - fee);
                assert_with_byte_array(success, err_zro_transfer_failed());
            }
        }

        /// Pay the native token fees
        fn _pay_native_fees(
            self: @ContractState,
            sender: ContractAddress,
            native_token: IERC20Dispatcher,
            message_receipt: @MessageReceipt,
            refund_address: ContractAddress,
            native_allowance: u256,
            total_native_fee: u256,
        ) {
            for payee in @message_receipt.payees {
                let native_amount = *payee.native_amount;
                if native_amount > 0 {
                    let success = native_token
                        .transfer_from(sender, *payee.receiver, native_amount);
                    assert_with_byte_array(success, err_native_transfer_failed());
                }
            }
            self
                ._refund_native(
                    native_token, native_allowance, total_native_fee, sender, refund_address,
                );
        }

        /// Pay the ZRO token fees
        fn _pay_zro_fees(
            ref self: ContractState,
            sender: ContractAddress,
            zro_token: Option<IERC20Dispatcher>,
            message_receipt: @MessageReceipt,
            refund_address: ContractAddress,
            zro_allowance: u256,
            total_zro_fee: u256,
        ) {
            if let Some(zro_token) = zro_token {
                for payee in @message_receipt.payees {
                    let lz_token_amount = *payee.lz_token_amount;
                    if lz_token_amount > 0 {
                        let success = zro_token
                            .transfer_from(sender, *payee.receiver, lz_token_amount);
                        assert_with_byte_array(success, err_zro_transfer_failed());
                    }
                }
                self._refund_zro(zro_token, zro_allowance, total_zro_fee, sender, refund_address);
            }
        }
    }

    // =============================== Component Hooks =================================

    impl MessageLibManagerHooksImpl of MessageLibManagerComponent::MessageLibManagerHooks<
        ContractState,
    > {
        fn _assert_authorized(
            self: @MessageLibManagerComponent::ComponentState<ContractState>, oapp: ContractAddress,
        ) {
            self.get_contract()._assert_authorized(oapp);
        }
    }

    impl MessagingChannelHooksImpl of MessagingChannelComponent::MessagingChannelHooks<
        ContractState,
    > {
        fn _assert_authorized(
            self: @MessagingChannelComponent::ComponentState<ContractState>,
            receiver: ContractAddress,
        ) {
            self.get_contract()._assert_authorized(receiver);
        }
    }
}
