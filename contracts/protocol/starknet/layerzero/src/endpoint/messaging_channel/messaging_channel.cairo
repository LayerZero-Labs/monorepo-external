//! Messaging channel component

/// # `MessagingChannelComponent`
///
/// This component handles the critical messaging infrastructure for LayerZero cross-chain
/// communication.
/// It manages inbound and outbound nonces, payload hash verification, and provides mechanisms for
/// message lifecycle management including skipping, nilifying, and burning messages.
///
/// ## Key features
/// - Ordered message execution with nonce management
/// - Payload hash verification for message integrity
/// - Lazy nonce updates for gas optimization
/// - Message lifecycle management (skip, nilify, burn)
/// - GUID generation for unique message identification
#[starknet::component]
pub mod MessagingChannelComponent {
    use lz_utils::bytes::{Bytes32, ContractAddressIntoBytes32};
    use lz_utils::error::assert_with_byte_array;
    use lz_utils::keccak::keccak256;
    use starknet::ContractAddress;
    use starknet::storage::{
        Map, Mutable, StoragePath, StoragePathEntry, StoragePointerReadAccess,
        StoragePointerWriteAccess,
    };
    use crate::common::guid::GUID;
    use crate::common::structs::packet::Origin;
    use crate::endpoint::constants::{EMPTY_PAYLOAD_HASH, NIL_PAYLOAD_HASH};
    use crate::endpoint::messaging_channel::errors::{err_invalid_nonce, err_payload_hash_not_found};
    use crate::endpoint::messaging_channel::events::{
        InboundNonceSkipped, PacketBurnt, PacketNilified,
    };
    use crate::endpoint::messaging_channel::interface::IMessagingChannel;

    /// =============================== Storage =================================

    #[storage]
    pub struct Storage {
        /// The universally unique endpoint identifier for this deployed instance
        pub eid: u32,
        /// Outbound nonce tracking: sender => [dstEid => [receiver => nonce]]
        ///
        /// Tracks the number of messages sent from each sender to each destination.
        /// Incremented atomically when messages are sent.
        pub outbound_nonce: Map<ContractAddress, Map<u32, Map<Bytes32, u64>>>,
        /// Lazy inbound nonce tracking: receiver => [srcEid => [sender => nonce]]
        ///
        /// Represents the last processed nonce (checkpoint) for each path.
        /// Updated lazily when messages are executed or explicitly skipped.
        /// Used as starting point for calculating effective inbound nonce.
        pub lazy_inbound_nonce: Map<ContractAddress, Map<u32, Map<Bytes32, u64>>>,
        /// Inbound payload hash storage: receiver => [srcEid => [sender => [nonce => payloadHash]]]
        ///
        /// Stores payload hashes for verified but not yet executed messages.
        /// EMPTY_PAYLOAD_HASH (0) indicates message has been executed.
        /// NIL_PAYLOAD_HASH (max) indicates message has been nilified.
        /// Actual hash indicates message is verified and ready for execution.
        pub inbound_payload_hash: Map<ContractAddress, Map<u32, Map<Bytes32, Map<u64, Bytes32>>>>,
    }

    /// =============================== Events =================================
    #[event]
    #[derive(Drop, starknet::Event)]
    pub enum Event {
        InboundNonceSkipped: InboundNonceSkipped,
        PacketNilified: PacketNilified,
        PacketBurnt: PacketBurnt,
    }

    // =============================== Hooks =================================
    pub trait MessagingChannelHooks<TContractState> {
        fn _assert_authorized(self: @ComponentState<TContractState>, receiver: ContractAddress);
    }

    /// =============================== Public Interface =================================

    #[embeddable_as(MessagingChannelImpl)]
    impl MessagingChannel<
        TContractState, +HasComponent<TContractState>, +MessagingChannelHooks<TContractState>,
    > of IMessagingChannel<ComponentState<TContractState>> {
        fn inbound_nonce(
            self: @ComponentState<TContractState>,
            receiver: ContractAddress,
            src_eid: u32,
            sender: Bytes32,
        ) -> u64 {
            // Start from the last lazy checkpoint
            let mut nonce_cursor = self.lazy_inbound_nonce(receiver, src_eid, sender);

            // Find the effective inbound nonce by checking consecutive verified nonces
            while self._has_payload_hash(receiver, src_eid, sender, nonce_cursor + 1) {
                nonce_cursor += 1;
            }
            nonce_cursor
        }

        fn outbound_nonce(
            self: @ComponentState<TContractState>,
            sender: ContractAddress,
            dst_eid: u32,
            receiver: Bytes32,
        ) -> u64 {
            self.outbound_nonce.entry(sender).entry(dst_eid).entry(receiver).read()
        }

        fn inbound_payload_hash(
            self: @ComponentState<TContractState>,
            receiver: ContractAddress,
            src_eid: u32,
            sender: Bytes32,
            nonce: u64,
        ) -> Bytes32 {
            self._inbound_payload_hash(receiver, src_eid, sender, nonce)
        }

        fn lazy_inbound_nonce(
            self: @ComponentState<TContractState>,
            receiver: ContractAddress,
            src_eid: u32,
            sender: Bytes32,
        ) -> u64 {
            // Using helper function for consistent storage access
            self.lazy_inbound_nonce.entry(receiver).entry(src_eid).entry(sender).read()
        }

        fn skip(
            ref self: ComponentState<TContractState>, receiver: ContractAddress, origin: Origin,
        ) {
            self._assert_authorized(receiver);

            let Origin { src_eid, sender, nonce } = origin;

            // Ensure the provided nonce is exactly the next expected nonce
            assert_with_byte_array(
                nonce == self.inbound_nonce(receiver, src_eid, sender) + 1, err_invalid_nonce(),
            );

            // Update the lazy inbound nonce to the skipped nonce (using helper function)
            self._lazy_inbound_nonce_entry(receiver, src_eid, sender).write(nonce);

            self.emit(InboundNonceSkipped { receiver, src_eid, sender, nonce });
        }

        fn nilify(
            ref self: ComponentState<TContractState>,
            receiver: ContractAddress,
            origin: Origin,
            payload_hash: Bytes32,
        ) {
            self._assert_authorized(receiver);

            // Validate and get current payload hash (using consolidated validation helper)
            self._validate_payload_hash(receiver, @origin, payload_hash);

            let Origin { src_eid, sender, nonce } = origin;

            // Get the current lazy nonce for validation (using helper function)
            let lazy_nonce = self._lazy_inbound_nonce_entry(receiver, src_eid, sender).read();

            // If nonce is smaller or equal to the lazy nonce, ensure it's not already executed
            assert_with_byte_array(
                nonce > lazy_nonce || payload_hash != EMPTY_PAYLOAD_HASH, err_invalid_nonce(),
            );

            // Set the payload hash to NIL to prevent execution (using helper function)
            self
                ._inbound_payload_hash_entry(receiver, src_eid, sender, nonce)
                .write(NIL_PAYLOAD_HASH);

            self.emit(PacketNilified { receiver, src_eid, sender, nonce, payload_hash });
        }

        fn burn(
            ref self: ComponentState<TContractState>,
            receiver: ContractAddress,
            origin: Origin,
            payload_hash: Bytes32,
        ) {
            self._assert_authorized(receiver);

            self._validate_payload_hash(receiver, @origin, payload_hash);

            let Origin { src_eid, sender, nonce } = origin;

            let lazy_nonce = self._lazy_inbound_nonce_entry(receiver, src_eid, sender).read();

            // Ensure the message hasn't been executed and nonce is smaller or equal to the lazy
            // nonce
            assert_with_byte_array(
                payload_hash != EMPTY_PAYLOAD_HASH && nonce <= lazy_nonce, err_invalid_nonce(),
            );

            // Permanently remove the payload hash (using helper function)
            self
                ._inbound_payload_hash_entry(receiver, src_eid, sender, nonce)
                .write(EMPTY_PAYLOAD_HASH);

            self.emit(PacketBurnt { receiver, src_eid, sender, nonce, payload_hash });
        }

        fn next_guid(
            self: @ComponentState<TContractState>,
            sender: ContractAddress,
            dst_eid: u32,
            receiver: Bytes32,
        ) -> Bytes32 {
            let next_nonce = self.outbound_nonce(sender, dst_eid, receiver) + 1;

            GUID::generate(next_nonce, self.eid.read(), sender.into(), dst_eid, receiver)
        }
    }

    /// =============================== Internal Interface =================================

    /// Internal interface for component functions used by the endpoint and other components
    #[generate_trait]
    pub impl InternalImpl<
        TContractState, +HasComponent<TContractState>,
    > of InternalTrait<TContractState> {
        /// Initialize the MessagingChannel component with the endpoint ID
        ///
        /// Should be called during contract deployment/initialization.
        /// The endpoint ID is immutable once set.
        ///
        /// # Arguments
        ///
        /// * `eid`: The universally unique endpoint identifier
        fn initializer(ref self: ComponentState<TContractState>, eid: u32) {
            self.eid.write(eid);
        }

        /// Returns a mutable storage path for the outbound nonce
        ///
        /// Used internally by the endpoint to increment nonces when sending messages.
        ///
        /// # Arguments
        ///
        /// * `sender`: The sender contract address
        /// * `dst_eid`: The destination endpoint ID
        /// * `receiver`: The receiver address on the destination chain
        ///
        /// # Returns
        ///
        /// * `StoragePath<Mutable<u64>>`: Mutable storage path for the outbound nonce
        fn _outbound_nonce_entry(
            ref self: ComponentState<TContractState>,
            sender: ContractAddress,
            dst_eid: u32,
            receiver: Bytes32,
        ) -> StoragePath<Mutable<u64>> {
            self.outbound_nonce.entry(sender).entry(dst_eid).entry(receiver)
        }

        /// Returns a mutable storage path for the lazy inbound nonce
        ///
        /// Used internally to update checkpoint nonces during message execution.
        ///
        /// # Arguments
        ///
        /// * `receiver`: The receiver contract address
        /// * `src_eid`: The source endpoint ID
        /// * `sender`: The sender address on the source chain
        ///
        /// # Returns
        ///
        /// * `StoragePath<Mutable<u64>>`: Mutable storage path for the lazy inbound nonce
        fn _lazy_inbound_nonce_entry(
            ref self: ComponentState<TContractState>,
            receiver: ContractAddress,
            src_eid: u32,
            sender: Bytes32,
        ) -> StoragePath<Mutable<u64>> {
            self.lazy_inbound_nonce.entry(receiver).entry(src_eid).entry(sender)
        }

        /// Returns a mutable storage path for the inbound payload hash
        ///
        /// Used internally to store and clear payload hashes during verification and execution.
        ///
        /// # Arguments
        ///
        /// * `receiver`: The receiver contract address
        /// * `src_eid`: The source endpoint ID
        /// * `sender`: The sender address on the source chain
        /// * `nonce`: The message nonce
        ///
        /// # Returns
        ///
        /// * `StoragePath<Mutable<Bytes32>>`: Mutable storage path for the payload hash
        fn _inbound_payload_hash_entry(
            ref self: ComponentState<TContractState>,
            receiver: ContractAddress,
            src_eid: u32,
            sender: Bytes32,
            nonce: u64,
        ) -> StoragePath<Mutable<Bytes32>> {
            self.inbound_payload_hash.entry(receiver).entry(src_eid).entry(sender).entry(nonce)
        }

        /// Returns the inbound payload hash
        ///
        /// # Arguments
        ///
        /// * `receiver`: The receiver contract address
        /// * `src_eid`: The source endpoint ID
        /// * `sender`: The sender address on the source chain
        /// * `nonce`: The message nonce
        ///
        /// # Returns
        ///
        /// * `Bytes32`: The payload hash
        fn _inbound_payload_hash(
            self: @ComponentState<TContractState>,
            receiver: ContractAddress,
            src_eid: u32,
            sender: Bytes32,
            nonce: u64,
        ) -> Bytes32 {
            self
                .inbound_payload_hash
                .entry(receiver)
                .entry(src_eid)
                .entry(sender)
                .entry(nonce)
                .read()
        }

        /// Checks if a payload hash exists for a specific message
        ///
        /// Checks if the storage slot is not initialized.
        /// Assumes computationally infeasible that payload can hash to 0.
        /// Returns false for EMPTY_PAYLOAD_HASH (executed messages).
        /// Returns true for both actual hashes and NIL_PAYLOAD_HASH (nilified messages).
        ///
        /// # Arguments
        ///
        /// * `receiver`: The receiver contract address
        /// * `src_eid`: The source endpoint ID
        /// * `sender`: The sender address on the source chain
        /// * `nonce`: The message nonce to check
        ///
        /// # Returns
        ///
        /// * `bool`: True if a payload hash exists (message is verified), false otherwise
        fn _has_payload_hash(
            self: @ComponentState<TContractState>,
            receiver: ContractAddress,
            src_eid: u32,
            sender: Bytes32,
            nonce: u64,
        ) -> bool {
            self._inbound_payload_hash(receiver, src_eid, sender, nonce) != EMPTY_PAYLOAD_HASH
        }

        /// Validates that the provided payload hash matches the stored hash and returns it
        ///
        /// Consolidates repetitive payload hash validation logic used in nilify() and burn().
        ///
        /// # Arguments
        ///
        /// * `receiver`: The receiver contract address
        /// * `origin`: The origin information containing source endpoint, sender, and nonce
        /// * `expected_payload_hash`: The payload hash to validate against stored hash
        ///
        /// # Returns
        ///
        /// * `Bytes32`: The validated current payload hash from storage
        ///
        /// # Panics
        ///
        /// * `err_payload_hash_not_found`: If the stored hash doesn't match the expected hash
        fn _validate_payload_hash(
            self: @ComponentState<TContractState>,
            receiver: ContractAddress,
            origin: @Origin,
            expected_payload_hash: Bytes32,
        ) {
            let current_payload_hash = self
                ._inbound_payload_hash(receiver, *origin.src_eid, *origin.sender, *origin.nonce);
            assert_with_byte_array(
                current_payload_hash == expected_payload_hash,
                err_payload_hash_not_found(expected_payload_hash, current_payload_hash),
            );
        }

        /// Clears a payload after successful execution and updates lazy nonce
        ///
        /// This function is called during message execution to clear verified payloads.
        /// Updates the lazy_inbound_nonce to the provided nonce if it's greater than current.
        /// Verifies that all nonces between current and target have payload hashes (ordered
        /// execution).
        /// Validates the payload hash matches the stored hash before clearing.
        /// Sets the payload hash to EMPTY_PAYLOAD_HASH to mark as executed.
        ///
        /// # Arguments
        ///
        /// * `receiver`: The receiver contract address
        /// * `origin`: The origin information containing source endpoint, sender, and nonce
        /// * `payload`: The payload bytes to verify and clear
        fn _clear_payload(
            ref self: ComponentState<TContractState>,
            receiver: ContractAddress,
            origin: @Origin,
            payload: @ByteArray,
        ) {
            // Get the current lazy nonce checkpoint
            let lazy_nonce_entry = self
                ._lazy_inbound_nonce_entry(receiver, *origin.src_eid, *origin.sender);
            let current_nonce = lazy_nonce_entry.read();

            // If this nonce is beyond the current checkpoint, validate ordered execution
            if *origin.nonce > current_nonce {
                // Ensure that no nonce between current_nonce and origin.nonce is missing a payload
                // hash. Because if it is, it means we have an unverified nonce in between
                // and we can't execute the packet until everything before it is committed
                for nonce in current_nonce + 1..*origin.nonce {
                    assert_with_byte_array(
                        self._has_payload_hash(receiver, *origin.src_eid, *origin.sender, nonce),
                        err_invalid_nonce(),
                    );
                }
                // Update the lazy nonce to the current execution point
                lazy_nonce_entry.write(*origin.nonce);
            }

            // Verify the payload hash matches what was stored during verification
            let actual_payload_hash = keccak256(payload);
            let hash_entry = self
                ._inbound_payload_hash_entry(
                    receiver, *origin.src_eid, *origin.sender, *origin.nonce,
                );
            let expected_payload_hash = hash_entry.read();

            assert_with_byte_array(
                actual_payload_hash == expected_payload_hash,
                err_payload_hash_not_found(expected_payload_hash, actual_payload_hash),
            );

            // Clear the payload hash to mark as executed
            hash_entry.write(EMPTY_PAYLOAD_HASH);
        }
    }
}
