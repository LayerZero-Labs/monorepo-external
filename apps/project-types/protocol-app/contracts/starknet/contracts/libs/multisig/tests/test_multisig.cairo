use multisig::MultisigComponent;
use multisig::errors::{
    err_invalid_signature, err_invalid_signer, err_only_multisig, err_signer_already_added,
    err_signer_not_found, err_threshold_greater_than_max_threshold,
    err_total_signers_less_than_threshold, err_zero_threshold,
};
use multisig::events::{SignerSet, ThresholdSet};
use multisig::interface::{IMultisig, IMultisigSafeDispatcher, IMultisigSafeDispatcherTrait};
use snforge_std::{
    ContractClassTrait, DeclareResultTrait, EventSpyAssertionsTrait, declare, test_address,
};
use starknet::secp256_trait::{Secp256Trait, Signature};
use starknet::secp256k1::Secp256k1Point;
use starknet::{ContractAddress, EthAddress, SyscallResultTrait};
use starkware_utils_testing::test_utils::{assert_panic_with_error, cheat_caller_address_once};
use crate::mocks::mock_multisig::{
    IMultisigInternalContract, IMultisigInternalContractSafeDispatcher,
    IMultisigInternalContractSafeDispatcherTrait, MultisigContract,
};

fn signer0() -> EthAddress {
    Into::<u256, EthAddress>::into(0)
}

fn signer1() -> EthAddress {
    Into::<u256, EthAddress>::into(0x9b6ababd080456f900ed64e74d122ff9ca40daa1)
}

fn signer2() -> EthAddress {
    Into::<u256, EthAddress>::into(0xc221797af9445f00b4b0ff2c4853ce7bfb968b07)
}

fn signer3() -> EthAddress {
    Into::<u256, EthAddress>::into(3333)
}

fn signer4() -> EthAddress {
    Into::<u256, EthAddress>::into(4444)
}

fn signer5() -> EthAddress {
    Into::<u256, EthAddress>::into(5555)
}

const DIGEST: u256 = 0x7d84fd508a27ac81dee4bfa97f29bedb885c1bd7fc4650f491e64fbdaa05cdac;
const SIGNATURE_1: Signature = Signature {
    r: 0x31537dcfe1ec4d7e89f5972ccd3065e34e178e302c1b9e8e175d3843a2964f28,
    s: 0x63f2b60c7ef74363b687f822db6c313e8762b38d3097b6fec9b7b76165630aaa,
    y_parity: (0x1b_u8 - 27) == 1,
};
const SIGNATURE_2: Signature = Signature {
    r: 0x42674fc630e32f9000bc95271ec54283c8ad350016bb66a18464958963a51f3,
    s: 0x146e8b3fbb3a5bd0b89d3b6c1e01dd614e86bae01351dc3d1ffe3522c83ed450,
    y_parity: (0x1c_u8 - 27) == 1,
};


fn multisig_contract_state() -> MultisigContract::ContractState {
    MultisigContract::contract_state_for_testing()
}

fn state_multisig_with_three_signers_and_threshold_two() -> MultisigContract::ContractState {
    let mut contract = multisig_contract_state();

    MultisigContract::constructor(ref contract, array![signer1(), signer2(), signer3()].span(), 2);
    contract
}

fn deploy_multisig_with_three_signers_and_threshold_two_address() -> ContractAddress {
    let contract = declare("MultisigContract").unwrap_syscall().contract_class();
    let mut calldata = ArrayTrait::new();
    let signers: Span<_> = array![signer1(), signer2(), signer3()].span();
    let threshold: u32 = 2;
    signers.serialize(ref calldata);
    threshold.serialize(ref calldata);

    let (contract_address, _) = contract.deploy(@calldata).unwrap_syscall();
    contract_address
}

fn deploy_multisig_with_three_signers_and_threshold_two() -> IMultisigSafeDispatcher {
    let contract_address = deploy_multisig_with_three_signers_and_threshold_two_address();
    IMultisigSafeDispatcher { contract_address }
}

fn deploy_multisig_with_three_signers_and_threshold_two_internal() -> IMultisigInternalContractSafeDispatcher {
    let contract_address = deploy_multisig_with_three_signers_and_threshold_two_address();
    IMultisigInternalContractSafeDispatcher { contract_address }
}

#[test]
#[feature("safe_dispatcher")]
fn test_set_threshold_invariants() {
    let contract = deploy_multisig_with_three_signers_and_threshold_two();
    let contract_address = contract.contract_address;

    // Zero threshold error
    cheat_caller_address_once(contract_address, contract_address);
    let result = contract.set_threshold(0);
    assert_panic_with_error(result, err_zero_threshold());

    // Only multisig error
    cheat_caller_address_once(contract_address, test_address());
    let result = contract.set_threshold(1);
    assert_panic_with_error(result, err_only_multisig());

    // Set threshold above signers
    cheat_caller_address_once(contract_address, contract_address);
    let result = contract.set_threshold(4);
    assert_panic_with_error(result, err_total_signers_less_than_threshold(3, 4));
}

#[test]
#[feature("safe_dispatcher")]
fn test_set_threshold_with_max_threshold() {
    let contract = deploy_multisig_with_three_signers_and_threshold_two();
    let max_threshold = contract.get_max_threshold().unwrap();

    // add more signers so total_signers >= MAX_THRESHOLD + 1 (skip zero address) let internal =
    // IMultisigInternalContractSafeDispatcher { contract_address: contract.contract_address, }; //
    // start from 1 (skip zero address) and add MAX_THRESHOLD unique signers (addresses //
    // 1..=MAX_THRESHOLD)
    let internal = IMultisigInternalContractSafeDispatcher {
        contract_address: contract.contract_address,
    };
    for i in 1..=max_threshold {
        let signer = Into::<u256, EthAddress>::into(Into::<u32, u256>::into(i));
        internal.expose_add_signer(signer).unwrap();
    }

    cheat_caller_address_once(contract.contract_address, contract.contract_address);
    contract.set_threshold(max_threshold).unwrap();

    // set threshold to MAX_THRESHOLD + 1 (should fail)
    cheat_caller_address_once(contract.contract_address, contract.contract_address);
    let result = contract.set_threshold(max_threshold + 1);
    assert_panic_with_error(result, err_threshold_greater_than_max_threshold(max_threshold + 1));
}

#[test]
fn test_set_threshold_success() {
    let mut contract = state_multisig_with_three_signers_and_threshold_two();
    let contract_address = test_address();
    let mut spy = snforge_std::spy_events();

    // With less than amount of signers
    cheat_caller_address_once(contract_address, contract_address);
    contract.set_threshold(2);
    assert_eq!(contract.get_threshold(), 2);

    // With the same amount of signe
    cheat_caller_address_once(contract_address, contract_address);
    contract.set_threshold(3);
    assert_eq!(contract.get_threshold(), 3);

    // Assert both events were emitted
    spy
        .assert_emitted(
            @array![
                (
                    contract_address,
                    MultisigComponent::Event::ThresholdSet(ThresholdSet { threshold: 2 }),
                ),
                (
                    contract_address,
                    MultisigComponent::Event::ThresholdSet(ThresholdSet { threshold: 3 }),
                ),
            ],
        );
}

#[test]
fn test_get_threshold_success() {
    let mut contract = state_multisig_with_three_signers_and_threshold_two();

    // Checks that the constructor properly set the threshold, AND that the getter works
    assert_eq!(contract.get_threshold(), 2);
}

#[test]
#[feature("safe_dispatcher")]
fn test_add_signer_invariants() {
    let contract = deploy_multisig_with_three_signers_and_threshold_two_internal();
    let contract_address = contract.contract_address;

    // Add signer 0
    cheat_caller_address_once(contract_address, contract_address);
    let result = contract.expose_add_signer(signer0());
    assert_panic_with_error(result, err_invalid_signer());

    // Add existing signer 1
    cheat_caller_address_once(contract_address, contract_address);
    let result = contract.expose_add_signer(signer1());
    assert_panic_with_error(result, err_signer_already_added(signer1()));
}

#[test]
fn test_add_signer_success() {
    let mut contract = state_multisig_with_three_signers_and_threshold_two();
    let contract_address = test_address();
    let mut spy = snforge_std::spy_events();

    // Add new signer 4
    cheat_caller_address_once(contract_address, contract_address);
    contract.expose_add_signer(signer4());
    assert_eq!(contract.is_signer(signer4()), true);
    let signers = contract.get_signers();
    assert_eq!(*signers[3], signer4());
    assert_eq!(contract.total_signers(), 4);

    // Add new signer 5
    cheat_caller_address_once(contract_address, contract_address);
    contract.expose_add_signer(signer5());
    assert_eq!(contract.is_signer(signer5()), true);
    let signers = contract.get_signers();
    assert_eq!(*signers[4], signer5());
    assert_eq!(contract.total_signers(), 5);

    spy
        .assert_emitted(
            @array![
                (
                    contract_address,
                    MultisigComponent::Event::SignerSet(
                        SignerSet { signer: signer4(), active: true },
                    ),
                ),
                (
                    contract_address,
                    MultisigComponent::Event::SignerSet(
                        SignerSet { signer: signer5(), active: true },
                    ),
                ),
            ],
        );
}


#[test]
#[feature("safe_dispatcher")]
fn test_remove_signer_invariants() {
    let contract = deploy_multisig_with_three_signers_and_threshold_two_internal();
    let contract_address = contract.contract_address;

    // Remove non-existent signer
    cheat_caller_address_once(contract_address, contract_address);
    let result = contract.expose_remove_signer(signer4());
    assert_panic_with_error(result, err_signer_not_found(signer4()));

    // Remove signer with less than threshold
    cheat_caller_address_once(contract_address, contract_address);

    // Remove signer 1
    let result = contract.expose_remove_signer(signer1());
    assert_eq!(result.is_ok(), true);

    // Remove signer 2, making it less than threshold wich is 2
    let result = contract.expose_remove_signer(signer2());
    assert_panic_with_error(result, err_total_signers_less_than_threshold(1, 2));
}

#[test]
fn test_remove_signer_success() {
    let mut contract = state_multisig_with_three_signers_and_threshold_two();
    let contract_address = test_address();
    let mut spy = snforge_std::spy_events();

    // Remove signer 1
    cheat_caller_address_once(contract_address, contract_address);
    contract.expose_remove_signer(signer1());
    assert_eq!(contract.is_signer(signer1()), false);
    assert_eq!(contract.total_signers(), 2);
    // With AddressSet, the remaining signers are still accessible but order may change
    // We can verify the signers are still present
    assert_eq!(contract.is_signer(signer2()), true);
    assert_eq!(contract.is_signer(signer3()), true);

    spy
        .assert_emitted(
            @array![
                (
                    contract_address,
                    MultisigComponent::Event::SignerSet(
                        SignerSet { signer: signer1(), active: false },
                    ),
                ),
            ],
        );
}

#[test]
fn test_set_signer_success() {
    let mut contract = state_multisig_with_three_signers_and_threshold_two();
    let contract_address = test_address();
    let mut spy = snforge_std::spy_events();

    // Add new signer 4
    cheat_caller_address_once(contract_address, contract_address);
    contract.set_signer(signer4(), true);
    assert_eq!(contract.is_signer(signer4()), true);
    let signers = contract.get_signers();
    assert_eq!(*signers[3], signer4());
    assert_eq!(contract.total_signers(), 4);

    // Remove signer 4
    cheat_caller_address_once(contract_address, contract_address);
    contract.set_signer(signer4(), false);
    assert_eq!(contract.is_signer(signer4()), false);
    assert_eq!(contract.total_signers(), 3);

    spy
        .assert_emitted(
            @array![
                (
                    contract_address,
                    MultisigComponent::Event::SignerSet(
                        SignerSet { signer: signer4(), active: true },
                    ),
                ),
                (
                    contract_address,
                    MultisigComponent::Event::SignerSet(
                        SignerSet { signer: signer4(), active: false },
                    ),
                ),
            ],
        );
}

#[test]
#[feature("safe_dispatcher")]
fn test_set_signer_invariants() {
    let contract = deploy_multisig_with_three_signers_and_threshold_two();
    let contract_address = contract.contract_address;

    // Only multisig error
    cheat_caller_address_once(contract_address, test_address());
    let result = contract.set_signer(signer4(), true);
    assert_panic_with_error(result, err_only_multisig());
}

#[test]
fn test_get_signers_success() {
    let mut contract = state_multisig_with_three_signers_and_threshold_two();

    let signers = contract.get_signers();
    assert_eq!(signers.len(), 3);
    assert_eq!(*signers[0], signer1());
    assert_eq!(*signers[1], signer2());
    assert_eq!(*signers[2], signer3());
}

#[test]
fn test_total_signers_success() {
    let contract = state_multisig_with_three_signers_and_threshold_two();
    assert_eq!(contract.total_signers(), 3);
}

#[test]
fn test_verify_signatures_success() {
    let mut contract = state_multisig_with_three_signers_and_threshold_two();

    let signatures: Array<Signature> = array![SIGNATURE_1, SIGNATURE_2];
    contract.verify_signatures(DIGEST, signatures.span());
}

#[test]
#[should_panic(expected: "SIGNATURE_ERROR")]
fn test_verify_signatures_fails_with_insufficient_signatures() {
    let contract = state_multisig_with_three_signers_and_threshold_two();

    let one_signature: Array<Signature> = array![SIGNATURE_1];
    contract.verify_signatures(DIGEST, one_signature.span());
}

#[test]
#[should_panic(expected: "UNSORTED_SIGNERS")]
fn test_verify_signatures_fails_with_unsorted_signatures() {
    let contract = state_multisig_with_three_signers_and_threshold_two();

    // We reverse the order of the signatures from the success test
    let unsorted_signatures: Array<Signature> = array![SIGNATURE_2, SIGNATURE_1];
    contract.verify_signatures(DIGEST, unsorted_signatures.span());
}

#[test]
#[should_panic(expected: "SIGNER_NOT_FOUND")]
fn test_verify_signatures_fails_with_unauthorized_signer() {
    let contract = state_multisig_with_three_signers_and_threshold_two();

    // Modify a signature to produce a different recovered address that's not in signers list
    let unauthorized_signatures: Array<Signature> = array![
        Signature {
            r: 0x31537dcfe1ec4d7e89f5972ccd3065e34e178e302c1b9e8e175d3843a2964f28,
            s: 0x63f2b60c7ef74363b687f822db6c313e8762b38d3097b6fec9b7b76165630aaa,
            // Flip the parity to produce a different address
            y_parity: !((0x1b_u8 - 27) == 1),
        },
        SIGNATURE_2,
    ];

    contract.verify_signatures(DIGEST, unauthorized_signatures.span());
}

#[test]
#[feature("safe_dispatcher")]
fn test_verify_signatures_fails_with_high_s_malleability() {
    let contract = deploy_multisig_with_three_signers_and_threshold_two_address();
    let multisig_dispatcher = IMultisigSafeDispatcher { contract_address: contract };
    let curve_size = Secp256Trait::<Secp256k1Point>::get_curve_size();
    let half_curve_size = curve_size / 2;

    // Create a malleable signature by setting s just above the low-s maximum
    let high_s: u256 = half_curve_size + 1;
    let malleable_sig: Signature = Signature {
        r: SIGNATURE_1.r, s: high_s, y_parity: SIGNATURE_1.y_parity,
    };

    let signatures: Array<Signature> = array![malleable_sig, SIGNATURE_2];
    let result = multisig_dispatcher.verify_signatures(DIGEST, signatures.span());
    assert_panic_with_error(result, err_invalid_signature(@malleable_sig));
}

#[test]
#[feature("safe_dispatcher")]
fn test_verify_signatures_fails_with_invalid_signature_entries() {
    let contract = deploy_multisig_with_three_signers_and_threshold_two_address();
    let multisig_dispatcher = IMultisigSafeDispatcher { contract_address: contract };

    // Make the signature invalid by setting s to 0 (out of valid range [1, N))
    let invalid_sig: Signature = Signature {
        r: SIGNATURE_1.r, s: 0, y_parity: SIGNATURE_1.y_parity,
    };

    let signatures: Array<Signature> = array![invalid_sig, SIGNATURE_2];
    let result = multisig_dispatcher.verify_signatures(DIGEST, signatures.span());
    assert_panic_with_error(result, err_invalid_signature(@invalid_sig));
}

#[test]
#[feature("safe_dispatcher")]
fn test_verify_signatures_fails_with_invalid_r_entries() {
    let contract = deploy_multisig_with_three_signers_and_threshold_two_address();
    let multisig_dispatcher = IMultisigSafeDispatcher { contract_address: contract };

    let invalid_r_sig: Signature = Signature {
        r: 0, s: SIGNATURE_1.s, y_parity: SIGNATURE_1.y_parity,
    };
    let signatures: Array<Signature> = array![invalid_r_sig, SIGNATURE_2];
    let result = multisig_dispatcher.verify_signatures(DIGEST, signatures.span());
    assert_panic_with_error(result, err_invalid_signature(@invalid_r_sig));
}
