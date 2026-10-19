//! Messaging composer component

/// # `MessagingComposerComponent`
///
/// The `MessagingComposerComponent` is responsible for the lifecycle of "compose"
/// payloads that are requested by an OApp after a LayerZero message has been
/// delivered. It provides a minimal, verifiable queue keyed by the originating
/// OApp, target contract, message GUID, and compose index. The executor later
/// triggers delivery to the target contract implementing `ILayerZeroComposer`.
///
/// ## High-level responsibilities
/// - Queue compose payloads by recording their keccak hash
/// - Verify and deliver compose payloads to the target contract
/// - Optionally transfer an ERC20 compose token to the target prior to callback
/// - Emit alert events to aid off-chain/executor diagnostics
/// - Expose read accessors for compose queue inspection
///
/// ## Security considerations
/// - Delivery marks a compose entry as received using a sentinel value to
///   prevent reentrancy or replay, rather than deleting the entry
/// - Value transfer requires sufficient allowance from the executor to the
///   composer contract
/// - The executor is the caller of `lz_compose`; do not assume `from == caller`
///
/// ## Events emitted by the implementation
/// - `ComposeSent(from, to, guid, index, message)`
/// - `ComposeDelivered(from, to, guid, index)`
/// - `LzComposeAlert(from, to, executor, guid, index, gas, value, message, extra_data, reason)`
#[starknet::component]
pub mod MessagingComposerComponent {
    use lz_utils::bytes::Bytes32;
    use lz_utils::error::assert_with_byte_array;
    use lz_utils::keccak::keccak256;
    use openzeppelin::token::erc20::interface::{IERC20Dispatcher, IERC20DispatcherTrait};
    use starknet::storage::{
        Map, StoragePathEntry, StoragePointerReadAccess, StoragePointerWriteAccess,
    };
    use starknet::{ContractAddress, get_caller_address, get_contract_address};
    use crate::endpoint::constants::EMPTY_PAYLOAD_HASH;
    use crate::endpoint::interfaces::layerzero_composer::{
        ILayerZeroComposerDispatcher, ILayerZeroComposerDispatcherTrait,
    };
    use crate::endpoint::messaging_composer::errors::{
        err_lz_compose_already_exists, err_lz_compose_not_found,
        err_lz_compose_value_exceeds_allowance, err_transfer_failed,
    };
    use crate::endpoint::messaging_composer::events::{
        ComposeDelivered, ComposeSent, LzComposeAlert,
    };
    use crate::endpoint::messaging_composer::interface::IMessagingComposer;

    /// Sentinel value written to the compose queue when a compose has been
    /// successfully delivered. Used to prevent reentrancy/replay.
    const RECEIVED_MESSAGE_HASH: Bytes32 = Bytes32 { value: 0x1 };

    #[storage]
    pub struct Storage {
        /// ERC20 token used for value transfer on compose
        compose_token_address: ContractAddress,
        /// Compose queue mapping structure that stores the keccak hash of the
        /// queued payload, or `RECEIVED_MESSAGE_HASH` once delivered.
        /// uses keccak hash
        ///
        /// from => to => guid => index => messageHash
        compose_queue: Map<ContractAddress, Map<ContractAddress, Map<Bytes32, Map<u16, Bytes32>>>>,
    }

    #[event]
    #[derive(Drop, starknet::Event)]
    pub enum Event {
        ComposeSent: ComposeSent,
        ComposeDelivered: ComposeDelivered,
        LzComposeAlert: LzComposeAlert,
    }

    #[embeddable_as(MessagingComposerImpl)]
    impl MessagingComposer<
        TContractState, +HasComponent<TContractState>,
    > of IMessagingComposer<ComponentState<TContractState>> {
        /// Queue a compose payload for later delivery
        ///
        /// Stores the keccak hash of `message` under the key composed of
        /// `(sender, to, guid, index)`. Reverts if an entry already exists.
        ///
        /// Emits: `ComposeSent`
        ///
        /// Panics:
        /// - If a compose payload is already queued for the given key
        fn send_compose(
            ref self: ComponentState<TContractState>,
            to: ContractAddress,
            guid: Bytes32,
            index: u16,
            message: ByteArray,
        ) {
            let sender = get_caller_address();
            let entry = self.compose_queue.entry(sender).entry(to).entry(guid).entry(index);
            let current_hash = entry.read();
            assert_with_byte_array(
                current_hash == EMPTY_PAYLOAD_HASH, err_lz_compose_already_exists(),
            );
            // Hash message and store it in the compose queue
            // Note: No endianness conversion is required; this is not cross-chain dependent
            let message_hash = keccak256(@message);
            entry.write(message_hash);
            self.emit(ComposeSent { from: sender, to, guid, index, message });
        }

        /// Deliver a previously queued compose payload to the target contract
        ///
        /// Verifies the provided `message` against the queued hash. Marks the
        /// queue entry as received using `RECEIVED_MESSAGE_HASH` to prevent
        /// reentrancy/replay. If `value > 0`, transfers compose token from the
        /// executor (caller) to the target prior to invoking
        /// `ILayerZeroComposer.lz_compose`.
        ///
        /// Emits: `ComposeDelivered`
        ///
        /// Panics:
        /// - If the compose entry is missing or the hash does not match
        /// - If `value > 0` and the executor's allowance is insufficient
        fn lz_compose(
            ref self: ComponentState<TContractState>,
            from: ContractAddress,
            to: ContractAddress,
            guid: Bytes32,
            index: u16,
            message: ByteArray,
            extra_data: ByteArray,
            value: u256,
        ) {
            let entry = self.compose_queue.entry(from).entry(to).entry(guid).entry(index);
            let expected_hash = entry.read();
            let actual_hash = keccak256(@message);
            assert_with_byte_array(
                expected_hash == actual_hash, err_lz_compose_not_found(expected_hash, actual_hash),
            );

            // marks the message as received to prevent reentrancy
            // cannot just delete the value, otherwise the message can be sent again and could
            // result in some undefined behaviour even though the sender(composing Oapp) is
            // implicitly fully trusted by the composer.
            // eg. sender may not even realize it has such a bug
            entry.write(RECEIVED_MESSAGE_HASH);

            let executor = get_caller_address();

            // Verify allowance and transfer only when value > 0
            if value > 0 {
                let compose_token = IERC20Dispatcher {
                    contract_address: self.compose_token_address.read(),
                };
                let allowance = compose_token.allowance(executor, get_contract_address());
                assert_with_byte_array(
                    value <= allowance, err_lz_compose_value_exceeds_allowance(value, allowance),
                );

                let success = compose_token.transfer_from(executor, to, value);
                assert_with_byte_array(success, err_transfer_failed());
            }

            let composer_dispatcher = ILayerZeroComposerDispatcher { contract_address: to };
            composer_dispatcher.lz_compose(from, guid, message, executor, extra_data, value);

            self.emit(ComposeDelivered { from, to, guid, index });
        }

        /// Emit an alert related to compose execution
        ///
        /// Allows the executor to surface telemetry or failure information for a
        /// compose attempt. This does not modify the compose queue state.
        ///
        /// Emits: `LzComposeAlert`
        fn lz_compose_alert(
            ref self: ComponentState<TContractState>,
            from: ContractAddress,
            to: ContractAddress,
            guid: Bytes32,
            index: u16,
            gas: u256,
            value: u256,
            message: ByteArray,
            extra_data: ByteArray,
            reason: Array<felt252>,
        ) {
            let executor = get_caller_address();
            self
                .emit(
                    LzComposeAlert {
                        from, to, executor, guid, index, gas, value, message, extra_data, reason,
                    },
                );
        }

        /// Inspect a specific compose queue entry
        ///
        /// Returns the stored value for a compose entry keyed by
        /// `(sender, to, guid, index)` with the following semantics:
        /// - `0` — no compose queued
        /// - `RECEIVED_MESSAGE_HASH` (1) — compose delivered
        /// - otherwise — keccak hash of the queued `message`
        fn get_compose_queue(
            self: @ComponentState<TContractState>,
            from: ContractAddress,
            to: ContractAddress,
            guid: Bytes32,
            index: u16,
        ) -> Bytes32 {
            self.compose_queue.entry(from).entry(to).entry(guid).entry(index).read()
        }
    }

    /// Internal functions for initialization
    #[generate_trait]
    pub impl InternalImpl<
        TContractState, +HasComponent<TContractState>,
    > of InternalTrait<TContractState> {
        /// Initialize the MessagingComposer with the ERC20 token address used
        /// for value transfers during compose delivery.
        fn initializer(ref self: ComponentState<TContractState>, token_address: ContractAddress) {
            self.compose_token_address.write(token_address);
        }
    }
}
