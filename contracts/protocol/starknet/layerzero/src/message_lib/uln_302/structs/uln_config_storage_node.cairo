// UlnConfigStorageNode - Storage-compatible version of UlnConfig
//
// This is a different version of UlnConfig specifically designed for contract storage.
// While UlnConfig uses Array<ContractAddress> for DVN lists (which are suitable for
// function parameters and return values), UlnConfigStorageNode uses Vec<ContractAddress>
// which is the proper storage type in Starknet for dynamic arrays.
//
// Key differences:
// - UlnConfig: Uses Array<ContractAddress> - suitable for function parameters/returns
// - UlnConfigStorageNode: Uses Vec<ContractAddress> - required for contract storage
//
// We need both because:
// 1. Arrays cannot be directly stored in contract storage in Starknet
// 2. Vecs are storage-native but cannot be used in function signatures
// 3. This provides conversion methods between the two representations
// 4. Allows efficient storage operations while maintaining clean external interfaces

use starknet::ContractAddress;
use starknet::storage::{
    Mutable, MutableVecTrait, StoragePath, StoragePointerReadAccess, StoragePointerWriteAccess, Vec,
    VecTrait,
};
use crate::message_lib::uln_302::structs::uln_config::UlnConfig;

#[starknet::storage_node]
pub struct UlnConfigStorageNode {
    pub confirmations: u64,
    pub has_confirmations: bool,
    // no duplicates. sorted in ascending order. allowed overlap with optionalDVNs
    pub required_dvns: Vec<ContractAddress>,
    pub has_required_dvns: bool,
    // no duplicates. sorted in ascending order. allowed overlap with requiredDVNs
    pub optional_dvns: Vec<ContractAddress>,
    pub optional_dvn_threshold: u8, // (0, optionalDvnCount]
    pub has_optional_dvns: bool,
}

#[generate_trait]
pub impl UlnConfigStorageNodeImpl of UlnConfigStorageNodeTrait {
    // This function is used to take in a UlnConfig and store in a
    // contract storage which has a ConfigNode for storing the config.
    fn set_uln_config(self: StoragePath<Mutable<UlnConfigStorageNode>>, config: UlnConfig) {
        self.confirmations.write(config.confirmations);
        self.has_confirmations.write(config.has_confirmations);
        self.optional_dvn_threshold.write(config.optional_dvn_threshold);
        self.has_required_dvns.write(config.has_required_dvns);
        self.has_optional_dvns.write(config.has_optional_dvns);

        // convert from Array to Vec
        self._clear_dvns();
        for dvn in config.required_dvns {
            self.required_dvns.push(dvn);
        }
        for dvn in config.optional_dvns {
            self.optional_dvns.push(dvn);
        }
    }

    fn _clear_dvns(self: StoragePath<Mutable<UlnConfigStorageNode>>) {
        while self.required_dvns.len() != 0 {
            let _ = self.required_dvns.pop();
        }
        while self.optional_dvns.len() != 0 {
            let _ = self.optional_dvns.pop();
        }
    }

    // This function is used to get the UlnConfig from a
    // contract storage which has a ConfigNode for storing the config.
    fn get_uln_config(self: StoragePath<UlnConfigStorageNode>) -> UlnConfig {
        let mut required_dvns_array = array![];
        let mut optional_dvns_array = array![];

        for i in 0..self.required_dvns.len() {
            required_dvns_array.append(self.required_dvns.at(i).read());
        }
        for i in 0..self.optional_dvns.len() {
            optional_dvns_array.append(self.optional_dvns.at(i).read());
        }

        UlnConfig {
            confirmations: self.confirmations.read(),
            has_confirmations: self.has_confirmations.read(),
            required_dvns: required_dvns_array,
            has_required_dvns: self.has_required_dvns.read(),
            optional_dvns: optional_dvns_array,
            optional_dvn_threshold: self.optional_dvn_threshold.read(),
            has_optional_dvns: self.has_optional_dvns.read(),
        }
    }
}
