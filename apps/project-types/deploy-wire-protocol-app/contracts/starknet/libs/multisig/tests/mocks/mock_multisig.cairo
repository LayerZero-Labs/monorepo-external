use starknet::EthAddress;
/// Mock interface to test internal functions of the Multisig component
#[starknet::interface]
pub trait IMultisigInternalContract<TContractState> {
    fn expose_add_signer(ref self: TContractState, signer: EthAddress);
    fn expose_remove_signer(ref self: TContractState, signer: EthAddress);
}

/// Mock contract for testing the Multisig component
#[starknet::contract]
pub mod MultisigContract {
    use multisig::MultisigComponent;
    use starknet::EthAddress;

    component!(path: MultisigComponent, storage: multisig, event: MultisigEvent);

    #[abi(embed_v0)]
    impl MultisigImpl = MultisigComponent::Multisig<ContractState>;


    // Multisig immutable configuration
    pub impl MultisigImmutableConfig of MultisigComponent::ImmutableConfig {
        const MAX_THRESHOLD: u32 = 11;
    }


    #[storage]
    struct Storage {
        #[substorage(v0)]
        pub multisig: MultisigComponent::Storage,
    }

    #[event]
    #[derive(Drop, Debug, PartialEq, starknet::Event)]
    pub enum Event {
        #[flat]
        MultisigEvent: MultisigComponent::Event,
    }

    #[abi(embed_v0)]
    impl MultisigInternalContract of super::IMultisigInternalContract<ContractState> {
        fn expose_add_signer(ref self: ContractState, signer: EthAddress) {
            self.multisig._add_signer(signer);
        }

        fn expose_remove_signer(ref self: ContractState, signer: EthAddress) {
            self.multisig._remove_signer(signer);
        }
    }

    impl MultisigInternalImpl = MultisigComponent::MultisigInternalImpl<ContractState>;

    #[constructor]
    pub fn constructor(ref self: ContractState, signers: Span<EthAddress>, threshold: u32) {
        self.multisig._init(signers, threshold);
    }
}
