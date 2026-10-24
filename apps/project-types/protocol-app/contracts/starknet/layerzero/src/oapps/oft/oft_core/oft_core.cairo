//! OFT core component implementation

#[starknet::component]
pub mod OFTCoreComponent {
    use core::num::traits::{Pow, Zero};
    use lz_utils::bytes::Bytes32;
    use lz_utils::error::assert_with_byte_array;
    use openzeppelin::access::ownable::OwnableComponent;
    use openzeppelin::access::ownable::OwnableComponent::{
        InternalImpl as OwnableInternalImpl, InternalTrait as OwnableInternalTrait,
    };
    use openzeppelin::token::erc20::interface::{IERC20Dispatcher, IERC20DispatcherTrait};
    use starknet::storage::{StoragePointerReadAccess, StoragePointerWriteAccess};
    use starknet::{ContractAddress, get_caller_address};
    use crate::Origin;
    use crate::common::structs::messaging::MessagingFee;
    use crate::endpoint::messaging_composer::interface::{
        IMessagingComposerDispatcher, IMessagingComposerDispatcherTrait,
    };
    use crate::oapps::common::oapp_options_type_3::interface::IOAppOptionsType3;
    use crate::oapps::common::oapp_options_type_3::oapp_options_type_3::OAppOptionsType3Component;
    use crate::oapps::message_inspector::interface::{
        IMessageInspectorDispatcher, IMessageInspectorDispatcherTrait,
    };
    use crate::oapps::oapp::oapp_core::OAppCoreComponent;
    use crate::oapps::oft::errors::{
        err_amount_sd_overflowed, err_invalid_local_decimals, err_slippage_exceeded,
    };
    use crate::oapps::oft::events::{MsgInspectorSet, OFTReceived, OFTSent};
    use crate::oapps::oft::interface::IOFT;
    use crate::oapps::oft::oft_compose_msg_codec::OFTComposeMsgCodec;
    use crate::oapps::oft::oft_msg_codec::OFTMsgCodec;
    use crate::oapps::oft::structs::{
        OFTDebit, OFTLimit, OFTMsgAndOptions, OFTQuote, OFTReceipt, OFTSendResult, OFTVersion,
        SendParam,
    };

    // Constants
    pub const SEND: u16 = 1;
    pub const SEND_AND_CALL: u16 = 2;

    #[storage]
    pub struct Storage {
        pub OFTCore_decimal_conversion_rate: u256,
        pub OFTCore_msg_inspector: ContractAddress,
        pub OFTCore_shared_decimals: u8,
    }

    #[event]
    #[derive(Drop, starknet::Event)]
    pub enum Event {
        OFTSent: OFTSent,
        OFTReceived: OFTReceived,
        MsgInspectorSet: MsgInspectorSet,
    }

    // =============================== Traits  =================================

    /// Hooks for the OFT (Omnichain Fungible Token) contract
    ///
    /// These hooks define the core token operations that must be implemented by any OFT contract.
    /// They handle the actual token transfers, metadata, and approval requirements for cross-chain
    /// operations.
    pub trait OFTHooks<TContractState> {
        /// Debits tokens from the sender's account when initiating a cross-chain transfer
        ///
        /// This function is called when a user sends tokens to another chain. It should:
        /// - Remove the specified amount from the sender's balance
        /// - Apply any fees or dust removal as needed
        /// - Validate that the minimum amount requirements are met
        /// - Return the actual amounts that were debited and will be received
        ///
        /// # Arguments
        /// * `from` - The address to debit tokens from (typically the caller)
        /// * `amount` - The amount of tokens to debit (in local decimals)
        /// * `min_amount` - The minimum amount that must be received after fees/dust removal
        /// * `dst_eid` - The destination endpoint ID where tokens are being sent
        ///
        /// # Returns
        /// * `(amount_sent_ld, amount_received_ld)` - Tuple of actual amount debited and amount
        /// that will be received
        fn _debit(
            ref self: ComponentState<TContractState>,
            from: ContractAddress,
            amount: u256,
            min_amount: u256,
            dst_eid: u32,
        ) -> OFTDebit;

        /// Credits tokens to the recipient's account when receiving a cross-chain transfer
        ///
        /// This function is called when tokens arrive from another chain. It should:
        /// - Add the specified amount to the recipient's balance
        /// - Handle any minting or token release logic as appropriate
        /// - Return the actual amount that was credited (may differ from input due to fees)
        ///
        /// # Arguments
        /// * `to` - The address to credit tokens to
        /// * `amount` - The amount of tokens to credit (in local decimals)
        /// * `src_eid` - The source endpoint ID where tokens came from
        ///
        /// # Returns
        /// * `amount_received_ld` - The actual amount credited to the recipient's account
        fn _credit(
            ref self: ComponentState<TContractState>,
            to: ContractAddress,
            amount: u256,
            src_eid: u32,
        ) -> u256;

        /// Returns the underlying token contract address
        ///
        /// For adapter OFTs, this returns the address of the existing ERC20 token.
        /// For native OFTs, this typically returns the OFT contract's own address.
        ///
        /// # Returns
        /// * `ContractAddress` - The address of the underlying token contract
        fn _token(self: @ComponentState<TContractState>) -> ContractAddress;

        /// Indicates whether the OFT requires token approval before transfers
        ///
        /// Returns true if users must approve the OFT contract to spend their tokens
        /// before calling send(). This is typically true for adapter OFTs that wrap
        /// existing tokens, and false for native OFTs where the contract owns the tokens.
        ///
        /// # Returns
        /// * `bool` - True if approval is required, false otherwise
        fn _approval_required(self: @ComponentState<TContractState>) -> bool;

        /// Internal function to remove dust from the given local decimal amount
        ///
        /// Note: this is the default and can be overridden in the implementation.
        ///
        /// Prevents the loss of dust when moving amounts between chains with different decimals.
        ///
        /// # Arguments
        /// * `amount_ld` - The amount in local decimals
        ///
        /// # Returns
        /// * `u256` - The amount after removing dust
        ///
        /// # Example
        /// uint(123) with a conversion rate of 100 becomes uint(100)
        fn _remove_dust(
            self: @ComponentState<TContractState>, amount_ld: u256,
        ) -> u256 {
            let conversion_rate = self.OFTCore_decimal_conversion_rate.read();
            (amount_ld / conversion_rate) * conversion_rate
        }

        /// Internal function to mock the amount mutation from a OFT debit() operation
        ///
        /// Note: this is the default and can be overridden in the implementation.
        ///
        /// This is where things like fees would be calculated and deducted from the amount to be
        /// received on the remote.
        ///
        /// # Arguments
        /// * `amount_ld` - The amount to send in local decimals
        /// * `min_amount_ld` - The minimum amount to send in local decimals
        /// * `dst_eid` - The destination endpoint ID
        ///
        /// # Returns
        /// * `(u256, u256)` - Tuple of (amount_sent_ld, amount_received_ld)
        ///   - amount_sent_ld: The amount sent, in local decimals
        ///   - amount_received_ld: The amount to be received on the remote chain, in local decimals
        ///
        /// # Panics
        /// * If `amount_received_ld` is less than `min_amount_ld` (slippage exceeded)
        fn _debit_view(
            self: @ComponentState<TContractState>,
            amount_ld: u256,
            min_amount_ld: u256,
            dst_eid: u32,
        ) -> OFTDebit {
            // Removes the dust so nothing is lost on the conversion between chains with different
            // decimals for the token.
            let amount_sent_ld = Self::_remove_dust(self, amount_ld);
            // The amount to send is the same as amount received in the default implementation.
            let amount_received_ld = amount_sent_ld;

            // Check for slippage
            assert_with_byte_array(
                amount_received_ld >= min_amount_ld,
                err_slippage_exceeded(amount_received_ld, min_amount_ld),
            );

            OFTDebit { amount_sent_ld, amount_received_ld }
        }

        /// Returns the OFT version
        ///
        /// # Returns
        /// * `OFTVersion` - The OFT version
        /// * `interface_id` - The OFT onchain interface ID
        /// * `version` - The OFT version compatible cross-chain
        fn _oft_version(
            self: @ComponentState<TContractState>,
        ) -> OFTVersion {
            OFTVersion { interface_id: 1, // Standard OFT interface ID
            version: 1_u64 }
        }
    }

    #[generate_trait]
    pub impl InternalImpl<
        TContractState, +HasComponent<TContractState>,
    > of InternalTrait<TContractState> {
        /// Initializes the OFT Core component with decimal configuration
        ///
        /// Provides a conversion rate when swapping between denominations of SD and LD:
        /// - shareDecimals == SD == shared Decimals
        /// - localDecimals == LD == local decimals
        ///
        /// Considers that tokens have different decimal amounts on various chains.
        /// For a token:
        /// - locally with 4 decimals --> 1.2345 => uint(12345)
        /// - remotely with 2 decimals --> 1.23 => uint(123)
        /// - The conversion rate would be 10 ** (4 - 2) = 100
        ///
        /// If you want to send 1.2345 -> (uint 12345), you CANNOT represent that value on the
        /// remote, you can only display 1.23 -> uint(123).
        /// To preserve the dust that would otherwise be lost on that conversion,
        /// we need to unify a denomination that can be represented on ALL chains inside of the OFT
        /// mesh.
        ///
        /// # Arguments
        /// * `local_decimals` - The decimals of the token on the local chain (this chain)
        ///
        /// # Panics
        /// * If `local_decimals` is less than `shared_decimals` (would cause precision loss)
        fn initializer(
            ref self: ComponentState<TContractState>, local_decimals: u8, shared_decimals: u8,
        ) {
            self.OFTCore_shared_decimals.write(shared_decimals);

            assert_with_byte_array(
                local_decimals >= shared_decimals,
                err_invalid_local_decimals(local_decimals, shared_decimals),
            );

            // Calculate decimal conversion rate
            let decimals_diff = local_decimals - shared_decimals;
            let conversion_rate = 10_u256.pow(decimals_diff.into());
            self.OFTCore_decimal_conversion_rate.write(conversion_rate);
        }

        /// Internal function to handle the receive on the LayerZero endpoint
        ///
        /// The src sending chain doesn't know the address length on this chain (potentially
        /// non-evm)
        /// thus everything is bytes32() encoded in flight.
        /// Credits the amountLD to the recipient and returns the ACTUAL amount the recipient
        /// received in local decimals.
        ///
        /// # Arguments
        /// * `origin` - The origin information containing:
        ///   - src_eid: The source chain endpoint ID
        ///   - sender: The sender address from the src chain
        ///   - nonce: The nonce of the LayerZero message
        /// * `guid` - The unique identifier for the received LayerZero message
        /// * `message` - The encoded message
        /// * `executor` - The address of the executor (unused in the default implementation)
        /// * `value` - Native token value sent with the message (unused in the default
        /// implementation)
        /// * `extra_data` - Additional data (unused in the default implementation)
        fn _lz_receive<
            impl OFTHooks: OFTHooks<TContractState>,
            impl OAppCore: OAppCoreComponent::HasComponent<TContractState>,
        >(
            ref self: ComponentState<TContractState>,
            origin: Origin,
            guid: Bytes32,
            message: ByteArray,
            executor: ContractAddress,
            extra_data: ByteArray,
            value: u256,
        ) {
            let Origin { src_eid, nonce, .. } = origin;

            // Decode the OFT message
            let to_bytes32 = OFTMsgCodec::send_to(@message);
            let amount_sd = OFTMsgCodec::amount_sd(@message);

            // Convert to local decimals
            let amount_ld = self._to_ld(amount_sd);

            // Convert recipient from bytes32 to address
            let to_address = OFTMsgCodec::bytes32_to_address(to_bytes32).unwrap();

            let amount_received_ld = self._credit(to_address, amount_ld, src_eid);

            // Handle compose messages - Proprietary composeMsg format for the OFT
            if OFTMsgCodec::is_composed(@message) {
                let compose_msg = OFTMsgCodec::compose_msg(@message);

                let endpoint_dispatcher = IMessagingComposerDispatcher {
                    contract_address: get_dep_component!(@self, OAppCore).OAppCore_endpoint.read(),
                };

                // Stores the lz_compose payload that will be executed in a separate tx.
                // Standardizes functionality for executing arbitrary contract invocation on some
                // non-evm chains.
                // The off-chain executor will listen and process the msg based on the
                // src-chain-callers compose options passed.
                // The index is used when a OApp needs to compose multiple msgs on lzReceive.
                // For default OFT implementation there is only 1 compose msg per lzReceive, thus
                // its always 0.
                endpoint_dispatcher
                    .send_compose(
                        to_address,
                        guid,
                        0,
                        OFTComposeMsgCodec::encode(
                            nonce, src_eid, amount_received_ld, @compose_msg,
                        ),
                    );
            }

            self.emit(OFTReceived { guid, src_eid, to: to_address, amount_received_ld });
        }

        /// Internal function to convert an amount from shared decimals into local decimals
        ///
        /// # Arguments
        /// * `amount_sd` - The amount in shared decimals
        ///
        /// # Returns
        /// * `u256` - The amount in local decimals
        fn _to_ld(self: @ComponentState<TContractState>, amount_sd: u64) -> u256 {
            let conversion_rate = self.OFTCore_decimal_conversion_rate.read();
            amount_sd.into() * conversion_rate
        }

        /// Internal function to convert an amount from local decimals into shared decimals
        ///
        /// # Arguments
        /// * `amount_ld` - The amount in local decimals
        ///
        /// # Returns
        /// * `u64` - The amount in shared decimals
        fn _to_sd(self: @ComponentState<TContractState>, amount_ld: u256) -> u64 {
            let conversion_rate = self.OFTCore_decimal_conversion_rate.read();
            let amount_sd_u256 = amount_ld / conversion_rate;
            let converted = amount_sd_u256.try_into();
            assert_with_byte_array(converted.is_some(), err_amount_sd_overflowed(amount_sd_u256));
            converted.unwrap()
        }


        /// Internal function to build the message and options
        ///
        /// This generated message has the msg.sender encoded into the payload so the remote knows
        /// who the caller is.
        /// Must include a non empty bytes if you want to compose, EVEN if you don't need it on the
        /// remote.
        /// EVEN if you don't require an arbitrary payload to be sent... eg. '0x01'
        /// Changes the msg type depending if it's composed or not.
        /// Combines the caller's _extraOptions with the enforced options via the OAppOptionsType3.
        ///
        /// # Arguments
        /// * `send_param` - The parameters for the send() operation
        /// * `amount_ld` - The amount in local decimals
        ///
        /// # Returns
        /// * `(ByteArray, ByteArray)` - Tuple of (message, options)
        ///   - message: The encoded message
        ///   - options: The encoded options
        fn _build_msg_and_options<
            impl Ownable: OwnableComponent::HasComponent<TContractState>,
            impl OAppOptionsType3: OAppOptionsType3Component::HasComponent<TContractState>,
        >(
            self: @ComponentState<TContractState>, send_param: @SendParam, amount_ld: u256,
        ) -> OFTMsgAndOptions {
            let SendParam { to, compose_msg, extra_options, dst_eid, .. } = send_param;

            // Convert amount to shared decimals
            let amount_sd = self._to_sd(amount_ld);

            // Encode OFT message
            let (message, has_compose) = OFTMsgCodec::encode(*to, amount_sd, compose_msg);

            let msg_type = if has_compose {
                SEND_AND_CALL
            } else {
                SEND
            };

            let oapp_options_type_3 = get_dep_component!(self, OAppOptionsType3);
            let options = oapp_options_type_3
                .combine_options(*dst_eid, msg_type, extra_options.clone());

            // Optionally inspect the message and options depending
            // if the OApp owner has set a msg inspector.
            // If it fails inspection, needs to revert in the implementation.
            // ie. does not rely on return boolean
            let msg_inspector = self.OFTCore_msg_inspector.read();
            if !msg_inspector.is_zero() {
                let inspector_dispatcher = IMessageInspectorDispatcher {
                    contract_address: msg_inspector,
                };
                inspector_dispatcher.inspect_msg(message.clone(), options.clone());
            }

            OFTMsgAndOptions { message, options }
        }
    }

    #[embeddable_as(OFTCoreImpl)]
    impl OFT<
        TContractState,
        +HasComponent<TContractState>,
        +OFTHooks<TContractState>,
        impl Ownable: OwnableComponent::HasComponent<TContractState>,
        impl OAppCore: OAppCoreComponent::HasComponent<TContractState>,
        +OAppOptionsType3Component::HasComponent<TContractState>,
        +Drop<TContractState>,
    > of IOFT<ComponentState<TContractState>> {
        fn oft_version(self: @ComponentState<TContractState>) -> OFTVersion {
            self._oft_version()
        }

        fn token(self: @ComponentState<TContractState>) -> ContractAddress {
            self._token()
        }

        fn approval_required(self: @ComponentState<TContractState>) -> bool {
            self._approval_required()
        }

        fn shared_decimals(self: @ComponentState<TContractState>) -> u8 {
            self.OFTCore_shared_decimals.read()
        }

        fn decimal_conversion_rate(self: @ComponentState<TContractState>) -> u256 {
            self.OFTCore_decimal_conversion_rate.read()
        }

        fn set_msg_inspector(
            ref self: ComponentState<TContractState>, msg_inspector: ContractAddress,
        ) {
            get_dep_component!(@self, Ownable).assert_only_owner();

            self.OFTCore_msg_inspector.write(msg_inspector);
            self.emit(MsgInspectorSet { msg_inspector });
        }

        fn msg_inspector(self: @ComponentState<TContractState>) -> ContractAddress {
            self.OFTCore_msg_inspector.read()
        }

        fn quote_oft(self: @ComponentState<TContractState>, send_param: SendParam) -> OFTQuote {
            let SendParam { dst_eid, amount_ld, min_amount_ld, .. } = send_param;

            // Calculate amounts using debit view
            let OFTDebit {
                amount_sent_ld, amount_received_ld,
            } = self._debit_view(amount_ld, min_amount_ld, dst_eid);

            // Create limit using token total supply for max amount (mirror Solidity)
            let oft_token_dispatcher = IERC20Dispatcher {
                contract_address: OFTHooks::_token(self),
            };
            let limit = OFTLimit {
                min_amount_ld: 0, max_amount_ld: oft_token_dispatcher.total_supply(),
            };

            // No additional fees in default implementation
            let oft_fee_details = array![];

            // Create receipt
            let receipt = OFTReceipt { amount_sent_ld, amount_received_ld };

            OFTQuote { limit, oft_fee_details, receipt }
        }

        fn quote_send(
            self: @ComponentState<TContractState>, send_param: SendParam, pay_in_lz_token: bool,
        ) -> MessagingFee {
            let SendParam { dst_eid, amount_ld, min_amount_ld, .. } = send_param.clone();
            // Get the amounts that would be debited/received
            let OFTDebit {
                amount_received_ld, ..,
            } = self._debit_view(amount_ld, min_amount_ld, dst_eid);

            // Build message and options
            let OFTMsgAndOptions {
                message, options,
            } = self._build_msg_and_options(@send_param, amount_received_ld);

            // Quote through OApp core
            let oapp_core = get_dep_component!(self, OAppCore);
            OAppCoreComponent::OAppSenderImpl::_quote(
                oapp_core, dst_eid, message, options, pay_in_lz_token,
            )
        }

        fn send(
            ref self: ComponentState<TContractState>,
            send_param: SendParam,
            fee: MessagingFee,
            refund_address: ContractAddress,
        ) -> OFTSendResult {
            let SendParam { dst_eid, amount_ld, min_amount_ld, .. } = send_param.clone();
            let from = get_caller_address();

            // 1. Debit tokens from sender
            let OFTDebit {
                amount_sent_ld, amount_received_ld,
            } =
                OFTHooks::_debit(
                    ref self,
                    from, // from - the address calling the send function
                    amount_ld,
                    min_amount_ld,
                    dst_eid,
                );

            // 2. Build message and options
            let OFTMsgAndOptions {
                message, options,
            } = self._build_msg_and_options(@send_param, amount_received_ld);

            // 3. Send message through LayerZero endpoint
            let mut oapp_core = get_dep_component_mut!(ref self, OAppCore);
            let message_receipt = OAppCoreComponent::OAppSenderImpl::_lz_send(
                ref oapp_core, from, dst_eid, message, options, fee, refund_address,
            );

            // 4. Emit event
            self
                .emit(
                    OFTSent {
                        guid: message_receipt.guid,
                        dst_eid,
                        from,
                        amount_sent_ld,
                        amount_received_ld,
                    },
                );

            // 5. Return the result
            OFTSendResult {
                message_receipt, oft_receipt: OFTReceipt { amount_sent_ld, amount_received_ld },
            }
        }
    }
}
