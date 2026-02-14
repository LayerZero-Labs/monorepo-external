//! DVN test utils

use core::dict::Felt252Dict;
use core::math::{u256_inv_mod, u256_mul_mod_n};
use core::nullable::NullableTrait;
use layerzero::common::constants::{BPS_DENOMINATOR, ZERO_ADDRESS};
use layerzero::workers::access_control::{ALLOW_LIST_ROLE, DENY_LIST_ROLE};
use layerzero::workers::base::interface::IWorkerBaseDispatcher;
use layerzero::workers::base::structs::QuoteParams;
use layerzero::workers::dvn::interface::{IDvnDispatcher, IDvnSafeDispatcher};
use layerzero::workers::dvn::options::{DVN_WORKER_ID, OPTION_TYPE_PRECRIME};
use layerzero::workers::interface::{ILayerZeroWorkerDispatcher, ILayerZeroWorkerSafeDispatcher};
use lz_utils::byte_array_ext::byte_array_ext::ByteArrayTraitExt;
use lz_utils::bytes::Bytes32;
use openzeppelin::access::accesscontrol::AccessControlComponent::InternalImpl;
use openzeppelin::access::accesscontrol::interface::{
    IAccessControlDispatcher, IAccessControlDispatcherTrait, IAccessControlSafeDispatcher,
};
use snforge_std::{ContractClassTrait, DeclareResultTrait, declare};
use starknet::eth_signature::public_key_point_to_eth_address;
use starknet::secp256_trait::{Secp256PointTrait, Secp256Trait, Signature};
use starknet::secp256k1::Secp256k1Point;
use starknet::{ContractAddress, EthAddress, SyscallResultTrait};
use starkware_utils_testing::test_utils::cheat_caller_address_once;
use crate::fuzzable::contract_address::FuzzableContractAddress;
use crate::fuzzable::eth_address::FuzzableEthAddress;
use crate::utils::sort;

// DVN worker test constant
pub(crate) const MULTISIG_THRESHOLD: u32 = 2;

/// DVN worker for testing
pub(crate) struct DvnDeploy {
    pub dvn: ContractAddress,
    pub dispatcher: IDvnDispatcher,
    pub safe_dispatcher: IDvnSafeDispatcher,
    pub base_worker: IWorkerBaseDispatcher,
    pub access_control: IAccessControlDispatcher,
    pub safe_access_control: IAccessControlSafeDispatcher,
    pub layerzero_worker: ILayerZeroWorkerDispatcher,
    pub safe_layerzero_worker: ILayerZeroWorkerSafeDispatcher,
}

/// Key pair for DVN workers
#[derive(Debug, Drop, PartialEq, Clone)]
pub(crate) struct KeyPair {
    pub private_key: u256,
    pub public_address: EthAddress,
}

/// Deploy a DVN worker with given roles, vid & random signers
pub(crate) fn deploy_dvn(
    message_libs: Span<ContractAddress>, vid: u32, admins: Span<ContractAddress>,
) -> DvnDeploy {
    let signers = array![
        FuzzableEthAddress::generate(), FuzzableEthAddress::generate(),
        FuzzableEthAddress::generate(),
    ];
    deploy_dvn_with_additional_roles(
        message_libs, vid, signers, admins, array![].span(), array![].span(),
    )
}

/// Deploy a DVN worker with given roles, vid & random signers
pub(crate) fn deploy_dvn_with_access_control_lists(
    message_libs: Span<ContractAddress>,
    vid: u32,
    price_feed: ContractAddress,
    admins: Span<ContractAddress>,
    allow_list: Span<ContractAddress>,
    deny_list: Span<ContractAddress>,
) -> DvnDeploy {
    let signers = array![
        FuzzableEthAddress::generate(), FuzzableEthAddress::generate(),
        FuzzableEthAddress::generate(),
    ];
    deploy_dvn_with_all_data(
        vid,
        message_libs,
        price_feed,
        BPS_DENOMINATOR.try_into().unwrap(),
        signers,
        MULTISIG_THRESHOLD,
        admins,
        allow_list,
        deny_list,
    )
}

/// Deploy a DVN worker with given role admin, vid & signers
pub(crate) fn deploy_dvn_with_additional_roles(
    message_libs: Span<ContractAddress>,
    vid: u32,
    signers: Array<EthAddress>,
    admins: Span<ContractAddress>,
    allow_list: Span<ContractAddress>,
    deny_list: Span<ContractAddress>,
) -> DvnDeploy {
    deploy_dvn_with_all_data(
        vid,
        message_libs,
        ZERO_ADDRESS,
        BPS_DENOMINATOR.try_into().unwrap(),
        signers,
        MULTISIG_THRESHOLD,
        admins,
        allow_list,
        deny_list,
    )
}

/// Deploy a DVN worker
pub fn deploy_dvn_with_all_data(
    vid: u32,
    message_libs: Span<ContractAddress>,
    price_feed: ContractAddress,
    default_multiplier_bps: u16,
    signers: Array<EthAddress>,
    multisig_threshold: u32,
    admins: Span<ContractAddress>,
    allow_list: Span<ContractAddress>,
    deny_list: Span<ContractAddress>,
) -> DvnDeploy {
    // Serialize calldata
    let mut calldata = array![];
    vid.serialize(ref calldata);
    message_libs.serialize(ref calldata);
    price_feed.serialize(ref calldata);
    default_multiplier_bps.serialize(ref calldata);
    signers.serialize(ref calldata);
    multisig_threshold.serialize(ref calldata);
    admins.serialize(ref calldata);

    // Deploy contract
    let contract = declare("Dvn").unwrap_syscall().contract_class();
    let (contract_address, _) = contract.deploy(@calldata).unwrap_syscall();

    // Grant allow list roles
    let access_control = IAccessControlDispatcher { contract_address };
    for allow_address in allow_list {
        cheat_caller_address_once(contract_address, contract_address);
        access_control.grant_role(ALLOW_LIST_ROLE, *allow_address);
    }

    // Grant deny list roles
    for deny_address in deny_list {
        cheat_caller_address_once(contract_address, contract_address);
        access_control.grant_role(DENY_LIST_ROLE, *deny_address);
    }

    DvnDeploy {
        dvn: contract_address,
        access_control,
        dispatcher: IDvnDispatcher { contract_address },
        safe_dispatcher: IDvnSafeDispatcher { contract_address },
        base_worker: IWorkerBaseDispatcher { contract_address },
        safe_access_control: IAccessControlSafeDispatcher { contract_address },
        layerzero_worker: ILayerZeroWorkerDispatcher { contract_address },
        safe_layerzero_worker: ILayerZeroWorkerSafeDispatcher { contract_address },
    }
}

/// Create a mock quote params
pub(crate) fn create_mock_quote_params(sender: ContractAddress, dst_eid: u32) -> QuoteParams {
    QuoteParams { sender, dst_eid, confirmations: 0, calldata_size: 0, options: Default::default() }
}

/// Build sorted signatures based on key pairs and a hash.
pub(crate) fn build_signatures(key_pairs: Span<KeyPair>, hash: Bytes32) -> Array<Signature> {
    let mut dict = key_pairs
        .into_iter()
        .map(
            |pair| (
                Into::into(*pair.public_address),
                NullableTrait::new(sign_for_test_k1(*pair.private_key, hash.into(), 2)),
            ),
        )
        .collect::<Felt252Dict<Nullable<Signature>>>();

    let addresses = sort::<
        u256,
    >(
        key_pairs
            .into_iter()
            .map(|pair| Into::<_, felt252>::into(*pair.public_address).into())
            .collect(),
    );
    let mut signatures = array![];

    for address in addresses {
        signatures.append(dict[address.try_into().unwrap()].deref());
    }

    signatures
}

/// Helper function to build DVN options (similar to OptionsUtil in Solidity)
/// ```
/// Format: [dvn_worker_id][option_size][dvn_idx][option_type][option_data]
/// where
/// - dvn_worker_id: 1 byte
/// - option_size:   2 bytes
/// - dvn_idx:       1 byte
/// - option_type:   1 byte
/// - option_data:   variable length
pub(crate) fn add_dvn_option(
    mut options: ByteArray, dvn_idx: u8, option_type: u8, option_data: ByteArray,
) -> ByteArray {
    let option_size: u16 = 2 // dvn_idx + option_type
    + option_data.len().try_into().unwrap();

    options.append_u8(DVN_WORKER_ID);
    options.append_u16(option_size);
    options.append_u8(dvn_idx);
    options.append_u8(option_type);
    options.append(@option_data);

    options
}

/// Add a DVN precrime option to the given options
pub(crate) fn add_dvn_precrime_option(options: ByteArray, dvn_idx: u8) -> ByteArray {
    let mut mock_options_data: ByteArray = Default::default();
    mock_options_data.append_byte(0x1);
    add_dvn_option(options, dvn_idx, OPTION_TYPE_PRECRIME, mock_options_data)
}

/// Computes (a + b) % n in a safe way to prevent overflow.
/// Assumes a < n and b < n.
pub(crate) fn u256_add_mod(a: u256, b: u256, n: u256) -> u256 {
    let c = n - a;
    if b < c {
        // a + b < n, so no overflow over n.
        a + b
    } else {
        // a + b >= n, so result is (a + b) - n, which is b - (n - a).
        b - c
    }
}

/// Derives the public key from a given private key for Secp256k1.
/// FOR TESTING PURPOSES ONLY.
pub(crate) fn get_public_address(private_key: u256) -> EthAddress {
    let G = Secp256Trait::<Secp256k1Point>::get_generator_point();
    let public_key_point = G.mul(private_key).unwrap_syscall();
    public_key_point_to_eth_address(public_key_point)
}

pub(crate) fn key_pair_from_private_key(private_key: u256) -> KeyPair {
    KeyPair { private_key, public_address: get_public_address(private_key) }
}

/// Signs a message hash with a given private key using Secp256k1.
/// FOR TESTING PURPOSES ONLY. DO NOT USE IN PRODUCTION.
pub(crate) fn sign_for_test_k1(private_key: u256, msg_hash: u256, k: u256) -> Signature {
    let N = Secp256Trait::<Secp256k1Point>::get_curve_size();
    let G = Secp256Trait::<Secp256k1Point>::get_generator_point();

    // 1. Calculate R = k * G
    let R = G.mul(k).unwrap_syscall();
    let (r, y) = R.get_coordinates().unwrap_syscall();

    assert(r != 0, 'r is zero');

    // 2. Calculate s = k^-1 * (msg_hash + r * private_key) mod N
    let n_nz = N.try_into().unwrap();
    let k_inv = u256_inv_mod(k, n_nz).unwrap().into();

    let r_mul_pk = u256_mul_mod_n(r, private_key, n_nz);
    let msg_hash_mod_n = msg_hash % N;

    let hash_plus_r_pk = u256_add_mod(msg_hash_mod_n, r_mul_pk, N);
    let s = u256_mul_mod_n(k_inv, hash_plus_r_pk, n_nz);

    assert(s != 0, 's is zero');

    // 3. Determine y_parity from the y-coordinate of R.
    let y_parity = {
        let (_, rem) = DivRem::div_rem(y, 2);
        rem == 1
    };

    // 4. Canonicalize to low-s form: if s > N/2, set s = N - s and flip parity
    let mut s_canonical = s;
    let mut y_parity_canonical = y_parity;
    if s > N / 2 {
        s_canonical = N - s;
        y_parity_canonical = !y_parity;
    }

    Signature { r, s: s_canonical, y_parity: y_parity_canonical }
}
