#[starknet::component]
pub mod MultisigComponent {
    use core::integer::u256;
    use core::num::traits::Zero;
    use core::panics::panic_with_byte_array;
    use enumerable_set::{EnumerableSet, EnumerableSetImpl, EnumerableSetTrait};
    use lz_utils::error::assert_with_byte_array;
    use starknet::eth_signature::public_key_point_to_eth_address;
    use starknet::secp256_trait::{Signature, recover_public_key};
    use starknet::secp256k1::Secp256k1Point;
    use starknet::storage::{StoragePointerReadAccess, StoragePointerWriteAccess};
    use starknet::{EthAddress, get_caller_address, get_contract_address};
    use crate::errors::{
        err_invalid_signature, err_invalid_signer, err_only_multisig, err_signature_error,
        err_signer_already_added, err_signer_not_found, err_threshold_greater_than_max_threshold,
        err_total_signers_less_than_threshold, err_unsorted_signers, err_zero_threshold,
    };
    use crate::events;


    /// =============================== Storage =================================
    #[storage]
    pub struct Storage {
        pub multisig_threshold: u32,
        pub multisig_signer_set: EnumerableSet<EthAddress>,
    }


    /// =============================== Events =================================
    #[event]
    #[derive(Drop, Debug, PartialEq, starknet::Event)]
    pub enum Event {
        ThresholdSet: events::ThresholdSet,
        SignerSet: events::SignerSet,
    }

    /// =============================== Traits  =================================

    /// Constants expected to be defined at the contract level used to configure the component
    /// behaviour.
    ///
    /// - `MAX_THRESHOLD`: Returns the maximum threshold for the multisig.
    pub trait ImmutableConfig {
        const MAX_THRESHOLD: u32;
    }

    /// =============================== External Functions =================================
    #[embeddable_as(Multisig)]
    impl MultisigImpl<
        TContractState, +HasComponent<TContractState>, impl Immutable: ImmutableConfig,
    > of crate::interface::IMultisig<ComponentState<TContractState>> {
        fn set_threshold(ref self: ComponentState<TContractState>, threshold: u32) {
            self._only_multisig();
            self._set_threshold(threshold);
        }

        // View function to get the current threshold
        fn get_threshold(self: @ComponentState<TContractState>) -> u32 {
            self.multisig_threshold.read()
        }

        fn set_signer(ref self: ComponentState<TContractState>, signer: EthAddress, active: bool) {
            self._only_multisig();
            if active {
                self._add_signer(signer);
            } else {
                self._remove_signer(signer);
            }
        }

        fn is_signer(self: @ComponentState<TContractState>, signer: EthAddress) -> bool {
            self.multisig_signer_set.contains(signer)
        }

        fn get_signers(self: @ComponentState<TContractState>) -> Array<EthAddress> {
            self.multisig_signer_set.values()
        }

        fn total_signers(self: @ComponentState<TContractState>) -> u32 {
            self.multisig_signer_set.length()
        }

        fn verify_signatures(
            self: @ComponentState<TContractState>, digest: u256, signatures: Span<Signature>,
        ) {
            match self._verify_n_signatures(digest, signatures, self.multisig_threshold.read()) {
                Ok(()) => (),
                Err(err) => panic_with_byte_array(@err),
            }
        }

        fn get_max_threshold(self: @ComponentState<TContractState>) -> u32 {
            Immutable::MAX_THRESHOLD
        }
    }


    /// =============================== Internal Functions =================================
    #[generate_trait]
    pub impl MultisigInternalImpl<
        TContractState, +HasComponent<TContractState>, impl Immutable: ImmutableConfig,
    > of MultisigInternalTrait<TContractState> {
        fn _init(
            ref self: ComponentState<TContractState>, mut signers: Span<EthAddress>, threshold: u32,
        ) {
            for signer in signers {
                self._add_signer(*signer);
            }
            self._set_threshold(threshold);
        }

        /// Restricts access to functions so they can only be called via this contract itself
        fn _only_multisig(self: @ComponentState<TContractState>) {
            let multisig_address = get_contract_address();
            let caller_address = get_caller_address();
            assert_with_byte_array(multisig_address == caller_address, err_only_multisig());
        }

        /// Internal function to set the threshold for this MultiSig
        /// The threshold must be greater than zero and less than or equal to the number of signers
        ///
        /// # Arguments
        ///
        /// * `threshold`: The new threshold value
        fn _set_threshold(ref self: ComponentState<TContractState>, threshold: u32) {
            let current_signer_count = self.total_signers();
            assert_with_byte_array(threshold != 0, err_zero_threshold());

            assert_with_byte_array(
                current_signer_count >= threshold,
                err_total_signers_less_than_threshold(current_signer_count, threshold),
            );

            assert_with_byte_array(
                threshold <= Immutable::MAX_THRESHOLD,
                err_threshold_greater_than_max_threshold(threshold),
            );

            self.multisig_threshold.write(threshold);
            self.emit(events::ThresholdSet { threshold });
        }

        /// Internal function to add a signer to the Multisig
        ///     - `address(0)` is not a valid signer
        ///     - A signer cannot be added twice
        /// # Arguments
        ///
        /// * `signer`: The address of the signer to add
        fn _add_signer(ref self: ComponentState<TContractState>, signer: EthAddress) {
            assert_with_byte_array(signer != Zero::<EthAddress>::zero(), err_invalid_signer());
            assert_with_byte_array(!self.is_signer(signer), err_signer_already_added(signer));

            self.multisig_signer_set.add(signer);
            self.emit(events::SignerSet { signer, active: true });
        }

        /// Internal function to remove a signer from the Multisig
        ///     - Signer must be part of the existing set of signers
        ///     - The threshold must be less than or equal to the number of remaining signers
        /// # Arguments
        ///
        /// * `signer`: The address of the signer to remove
        fn _remove_signer(ref self: ComponentState<TContractState>, signer: EthAddress) {
            assert_with_byte_array(self.is_signer(signer), err_signer_not_found(signer));
            let current_signer_count = self.total_signers();
            let threshold = self.multisig_threshold.read();
            assert_with_byte_array(
                current_signer_count > threshold,
                err_total_signers_less_than_threshold(current_signer_count - 1, threshold),
            );
            self.multisig_signer_set.remove(signer);

            self.emit(events::SignerSet { signer, active: false });
        }


        fn _verify_n_signatures(
            self: @ComponentState<TContractState>,
            digest: u256,
            signatures: Span<Signature>,
            threshold: u32,
        ) -> Result<(), ByteArray> {
            if threshold == 0 {
                return Err(err_zero_threshold());
            }
            if signatures.len() < threshold {
                return Err(err_signature_error());
            }

            let mut last_signer = 0_u256;
            for signature_index in 0..signatures.len() {
                let signature = signatures.at(signature_index);
                // Each call to recover_public_key consumes approximately 23,000,000 L2 gas.
                // https://github.com/starkware-libs/sequencer/blob/667ad92c9936cdefae4191e30437fe7beaf65962/config/sequencer/default_config.json#L37
                // https://github.com/0xSpaceShard/starknet-devnet/blob/b989e0c8c78f8e1907c7fff208d7eb873f6f6a1f/crates/starknet-devnet-core/src/utils.rs#L56
                let public_key_point = recover_public_key::<Secp256k1Point>(digest, *signature);
                if !public_key_point.is_some() {
                    return Err(err_invalid_signature(signature));
                }

                let current_signer: EthAddress = public_key_point_to_eth_address(
                    public_key_point.unwrap(),
                );
                // EthAddress does not implement PartialOrd, so we need to convert to u256
                let current_signer_256: u256 = Into::<_, felt252>::into(current_signer).into();

                if current_signer_256 <= last_signer {
                    return Err(err_unsorted_signers());
                }
                let is_signer = self.is_signer(current_signer);
                if !is_signer {
                    return Err(err_signer_not_found(current_signer));
                }
                last_signer = current_signer_256;
            }
            Ok(())
        }
    }
}
