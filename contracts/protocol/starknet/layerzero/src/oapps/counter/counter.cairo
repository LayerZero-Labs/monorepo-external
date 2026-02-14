#[starknet::contract]
pub mod OmniCounter {
    use lz_utils::bytes::Bytes32;
    use lz_utils::error::assert_with_byte_array;
    use openzeppelin::access::ownable::OwnableComponent;
    use openzeppelin::token::erc20::interface::{IERC20Dispatcher, IERC20DispatcherTrait};
    use starknet::storage::{
        Map, StoragePathEntry, StoragePointerReadAccess, StoragePointerWriteAccess,
    };
    use starknet::{ContractAddress, get_caller_address, get_contract_address};
    use crate::common::structs::messaging::{MessageReceipt, MessagingFee};
    use crate::common::structs::packet::Origin;
    use crate::endpoint::interfaces::endpoint_v2::{
        IEndpointV2Dispatcher, IEndpointV2DispatcherTrait,
    };
    use crate::endpoint::interfaces::layerzero_composer::ILayerZeroComposer;
    use crate::endpoint::messaging_channel::interface::{
        IMessagingChannelDispatcher, IMessagingChannelDispatcherTrait,
    };
    use crate::endpoint::messaging_composer::interface::{
        IMessagingComposerDispatcher, IMessagingComposerDispatcherTrait,
    };
    use crate::oapps::counter::constants::{
        ABA_TYPE, COMPOSED_ABA_TYPE, COMPOSED_TYPE, VANILLA_TYPE,
    };
    use crate::oapps::counter::errors::{
        err_insufficient_value, err_invalid_message_type, err_invalid_nonce, err_not_endpoint,
        err_not_oapp, err_only_admin, err_withdraw_failed,
    };
    use crate::oapps::counter::interface::IOmniCounter;
    use crate::oapps::counter::msg_codec;
    use crate::oapps::counter::options::executor_lz_receive_option;
    use crate::oapps::counter::structs::{IncrementReceived, IncrementSent};
    use crate::oapps::oapp::oapp_core::OAppCoreComponent;

    component!(path: OAppCoreComponent, storage: oapp_core, event: OAppCoreEvent);
    component!(path: OwnableComponent, storage: ownable, event: OwnableEvent);

    // OAppCore Mixin - now with built-in ownership control
    #[abi(embed_v0)]
    impl OAppCoreImpl = OAppCoreComponent::OAppCoreImpl<ContractState>;
    impl OAppCoreInternalImpl = OAppCoreComponent::InternalImpl<ContractState>;
    impl OAppCoreSenderImpl = OAppCoreComponent::OAppSenderImpl<ContractState>;

    #[abi(embed_v0)]
    impl OAppCoreReceiverImpl = OAppCoreComponent::OAppReceiverImpl<ContractState>;

    #[abi(embed_v0)]
    impl ILayerZeroReceiverImpl =
        OAppCoreComponent::LayerZeroReceiverImpl<ContractState>;

    // Ownable Mixin
    #[abi(embed_v0)]
    impl OwnableImpl = OwnableComponent::OwnableImpl<ContractState>;
    impl OwnableInternalImpl = OwnableComponent::InternalImpl<ContractState>;

    #[storage]
    struct Storage {
        // Global counters
        count: u256,
        composed_count: u256,
        // Admin address
        admin: ContractAddress,
        // Local endpoint ID
        eid: u32,
        // Ordered nonce tracking
        max_received_nonce: Map<(u32, Bytes32), u64>, // (srcEid, sender) => nonce
        ordered_nonce: bool,
        // Global assertions
        inbound_count: Map<u32, u256>, // srcEid => count
        outbound_count: Map<u32, u256>, // dstEid => count
        #[substorage(v0)]
        oapp_core: OAppCoreComponent::Storage,
        #[substorage(v0)]
        ownable: OwnableComponent::Storage,
    }

    #[event]
    #[derive(Drop, starknet::Event)]
    pub enum Event {
        #[flat]
        OAppCoreEvent: OAppCoreComponent::Event,
        #[flat]
        OwnableEvent: OwnableComponent::Event,
        IncrementSent: IncrementSent,
        IncrementReceived: IncrementReceived,
    }

    #[constructor]
    fn constructor(
        ref self: ContractState,
        endpoint: ContractAddress,
        owner: ContractAddress,
        native_token: ContractAddress,
    ) {
        self.oapp_core.initializer(endpoint, owner, native_token);
        self.ownable.initializer(owner);
        self.admin.write(owner);

        // Get and store the local endpoint ID
        let endpoint_dispatcher = IEndpointV2Dispatcher { contract_address: endpoint };
        self.eid.write(endpoint_dispatcher.get_eid());
    }


    #[abi(embed_v0)]
    impl OmniCounterImpl of IOmniCounter<ContractState> {
        fn get_counter(self: @ContractState, remote_eid: u32) -> u256 {
            // This matches the old implementation that tests expect
            self.inbound_count.entry(remote_eid).read()
        }

        fn get_count(self: @ContractState) -> u256 {
            self.count.read()
        }

        fn get_composed_count(self: @ContractState) -> u256 {
            self.composed_count.read()
        }

        fn get_inbound_count(self: @ContractState, src_eid: u32) -> u256 {
            self.inbound_count.entry(src_eid).read()
        }

        fn get_outbound_count(self: @ContractState, dst_eid: u32) -> u256 {
            self.outbound_count.entry(dst_eid).read()
        }

        fn get_admin(self: @ContractState) -> ContractAddress {
            self.admin.read()
        }

        fn get_eid(self: @ContractState) -> u32 {
            self.eid.read()
        }

        fn get_ordered_nonce(self: @ContractState) -> bool {
            self.ordered_nonce.read()
        }

        fn set_admin(ref self: ContractState, admin: ContractAddress) {
            self._only_admin();
            self.admin.write(admin);
        }

        fn withdraw(ref self: ContractState, to: ContractAddress, amount: u256) {
            self._only_admin();
            let token_dispatcher = IERC20Dispatcher {
                contract_address: self.oapp_core.OAppCore_native_token.read(),
            };

            let success = token_dispatcher.transfer(to, amount);

            assert_with_byte_array(success, err_withdraw_failed());
        }

        fn set_ordered_nonce(ref self: ContractState, ordered_nonce: bool) {
            self.oapp_core._assert_only_owner();
            self.ordered_nonce.write(ordered_nonce);
        }

        fn quote(
            self: @ContractState,
            dst_eid: u32,
            msg_type: u8,
            options: ByteArray,
            pay_in_lz_token: bool,
        ) -> MessagingFee {
            // Create message using msg_codec
            let eid = self.eid.read();
            let message = msg_codec::encode(msg_type, eid);

            self.oapp_core._quote(dst_eid, message, options, pay_in_lz_token)
        }

        fn increment(
            ref self: ContractState,
            dst_eid: u32,
            msg_type: u8,
            options: ByteArray,
            fee: MessagingFee,
            refund_address: ContractAddress,
        ) -> MessageReceipt {
            let caller = get_caller_address();

            // Create message using msg_codec
            let eid = self.eid.read();
            let message = msg_codec::encode(msg_type, eid);

            self.emit(IncrementSent { sender: caller, dst_eid, increment_type: msg_type });

            self._increment_outbound(dst_eid);

            // Call the underlying OAppCore send function
            self.oapp_core._lz_send(caller, dst_eid, message, options, fee, refund_address)
        }

        fn skip_inbound_nonce(ref self: ContractState, src_eid: u32, sender: Bytes32, nonce: u64) {
            self.oapp_core._assert_only_owner();

            let endpoint_dispatcher = IMessagingChannelDispatcher {
                contract_address: self.oapp_core.OAppCore_endpoint.read(),
            };
            endpoint_dispatcher.skip(get_contract_address(), Origin { src_eid, sender, nonce });

            if self.ordered_nonce.read() {
                let key = (src_eid, sender);
                let current = self.max_received_nonce.entry(key).read();
                self.max_received_nonce.entry(key).write(current + 1);
            }
        }

        fn is_peer(self: @ContractState, eid: u32, peer: Bytes32) -> bool {
            self.oapp_core.get_peer(eid) == peer
        }
    }

    #[abi(embed_v0)]
    impl ILayerZeroComposerImpl of ILayerZeroComposer<ContractState> {
        fn lz_compose(
            ref self: ContractState,
            from: ContractAddress,
            guid: Bytes32,
            message: ByteArray,
            executor: ContractAddress,
            extra_data: ByteArray,
            value: u256,
        ) {
            assert_with_byte_array(from == get_contract_address(), err_not_oapp());
            let endpoint = self.oapp_core.get_endpoint();
            assert_with_byte_array(get_caller_address() == endpoint, err_not_endpoint());

            // Extract message type using msg_codec
            let msg_type = msg_codec::msg_type(@message);

            if msg_type == COMPOSED_TYPE {
                self.composed_count.write(self.composed_count.read() + 1);
            } else if msg_type == COMPOSED_ABA_TYPE {
                self.composed_count.write(self.composed_count.read() + 1);

                let src_eid = msg_codec::src_eid(@message);
                self._increment_outbound(src_eid);

                // Create response message using msg_codec
                let eid = self.eid.read();
                let response_message = msg_codec::encode(VANILLA_TYPE, eid);
                let options = executor_lz_receive_option(200000, 0);
                let fee = MessagingFee { native_fee: value, lz_token_fee: 0 };
                let contract_address = get_contract_address();

                self
                    .oapp_core
                    ._lz_send(
                        contract_address, src_eid, response_message, options, fee, contract_address,
                    );
                self
                    .emit(
                        IncrementSent {
                            sender: contract_address,
                            dst_eid: src_eid,
                            increment_type: VANILLA_TYPE,
                        },
                    );
            } else {
                assert_with_byte_array(false, err_invalid_message_type(msg_type));
            }
        }
    }

    #[generate_trait]
    impl InternalImpl of InternalTrait {
        fn _only_admin(self: @ContractState) {
            assert_with_byte_array(get_caller_address() == self.admin.read(), err_only_admin());
        }

        fn _increment_inbound(ref self: ContractState, src_eid: u32) {
            let entry = self.inbound_count.entry(src_eid);
            entry.write(entry.read() + 1);
        }

        fn _increment_outbound(ref self: ContractState, dst_eid: u32) {
            let entry = self.outbound_count.entry(dst_eid);
            entry.write(entry.read() + 1);
        }

        fn _accept_nonce(ref self: ContractState, src_eid: u32, sender: Bytes32, nonce: u64) {
            let current_nonce_entry = self.max_received_nonce.entry((src_eid, sender));
            let current_nonce = current_nonce_entry.read();

            if self.ordered_nonce.read() {
                assert_with_byte_array(
                    nonce == current_nonce + 1, err_invalid_nonce(current_nonce + 1, nonce),
                );
            }

            // Update the max nonce anyway
            if nonce > current_nonce {
                current_nonce_entry.write(nonce);
            }
        }
    }

    // Implement OAppHooks to provide the required _lz_receive implementation
    impl OAppHooks of OAppCoreComponent::OAppHooks<ContractState> {
        fn _lz_receive(
            ref self: OAppCoreComponent::ComponentState<ContractState>,
            origin: Origin,
            guid: Bytes32,
            message: ByteArray,
            executor: ContractAddress,
            extra_data: ByteArray,
            value: u256,
        ) {
            let mut contract = self.get_contract_mut();

            // Accept nonce
            contract._accept_nonce(origin.src_eid, origin.sender, origin.nonce);

            // Extract message type using msg_codec
            let msg_type = msg_codec::msg_type(@message);

            if msg_type == VANILLA_TYPE {
                contract.count.write(contract.count.read() + 1);

                let message_value = msg_codec::value(@message);

                // Check if value is correct
                assert_with_byte_array(
                    value >= message_value, err_insufficient_value(message_value, value),
                );

                contract._increment_inbound(origin.src_eid);

                // Emit event
                contract
                    .emit(
                        IncrementReceived {
                            src_eid: origin.src_eid,
                            old_value: contract.count.read() - 1,
                            new_value: contract.count.read(),
                            increment_type: msg_type,
                            value,
                        },
                    );
            } else if msg_type == COMPOSED_TYPE || msg_type == COMPOSED_ABA_TYPE {
                contract.count.write(contract.count.read() + 1);
                contract._increment_inbound(origin.src_eid);

                // Send compose request to endpoint
                let endpoint = self.get_endpoint();
                let endpoint_dispatcher = IMessagingComposerDispatcher {
                    contract_address: endpoint,
                };
                endpoint_dispatcher.send_compose(get_contract_address(), guid, 0, message);

                // Emit event
                contract
                    .emit(
                        IncrementReceived {
                            src_eid: origin.src_eid,
                            old_value: contract.count.read() - 1,
                            new_value: contract.count.read(),
                            increment_type: msg_type,
                            value,
                        },
                    );
            } else if msg_type == ABA_TYPE {
                contract.count.write(contract.count.read() + 1);
                contract._increment_inbound(origin.src_eid);

                // Send back to sender
                contract._increment_outbound(origin.src_eid);

                // Create response message using msg_codec
                let eid = contract.eid.read();
                let response_message = msg_codec::encode_with_value(VANILLA_TYPE, eid, 10);
                let options = executor_lz_receive_option(200000, 10);

                // Quote the fee for the response message
                let contract_address = get_contract_address();
                self
                    ._lz_send(
                        contract_address,
                        origin.src_eid,
                        response_message,
                        options,
                        MessagingFee { native_fee: value, lz_token_fee: 0 },
                        contract_address,
                    );

                contract
                    .emit(
                        IncrementReceived {
                            src_eid: origin.src_eid,
                            old_value: contract.count.read() - 1,
                            new_value: contract.count.read(),
                            increment_type: msg_type,
                            value,
                        },
                    );
                contract
                    .emit(
                        IncrementSent {
                            sender: contract_address,
                            dst_eid: origin.src_eid,
                            increment_type: VANILLA_TYPE,
                        },
                    );
            } else {
                assert_with_byte_array(false, err_invalid_message_type(msg_type));
            }
        }

        fn _next_nonce(
            self: @OAppCoreComponent::ComponentState<ContractState>, src_eid: u32, sender: Bytes32,
        ) -> u64 {
            let contract = self.get_contract();
            if contract.ordered_nonce.read() {
                contract.max_received_nonce.entry((src_eid, sender)).read() + 1
            } else {
                0
            }
        }
    }
}
