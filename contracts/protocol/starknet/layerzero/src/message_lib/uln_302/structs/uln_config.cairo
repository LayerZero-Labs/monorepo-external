use lz_utils::error::assert_with_byte_array;
use starknet::ContractAddress;
use crate::message_lib::uln_302::errors::{
    err_invalid_confirmations, err_invalid_optional_dvn_threshold, err_must_have_at_least_one_dvn,
    err_too_many_dvns, err_unsorted_dvns,
};

#[derive(Debug, Drop, Serde, Clone, PartialEq)]
pub struct UlnConfig {
    // Using the has_* method instead of *_is_null (as we did in TON), because
    // The Starknet Map<Key, Value> will always fall back to the default of <Value> if
    // we haven't explicitly set the relevant <Key> in there.
    // If we use the *_is_null method, all of the unset custom configurations will
    // fall back to being not_null, which means an unset custom OApp configuration will overwrite
    // the set default configuration
    // the has_* fields are ignored in the `defaultConfig` variations.
    pub confirmations: u64,
    pub has_confirmations: bool,
    // no duplicates. sorted in ascending order. allowed overlap with optionalDVNs
    pub required_dvns: Array<ContractAddress>,
    pub has_required_dvns: bool,
    // no duplicates. sorted in ascending order. allowed overlap with requiredDVNs
    pub optional_dvns: Array<ContractAddress>,
    pub optional_dvn_threshold: u8, // (0, optionalDvnCount]
    pub has_optional_dvns: bool,
}

/// Total number of DVNs to prevent exceeding uint8.max
/// by limiting the total size, it would help constraint the design of DVNOptions
pub const MAX_DVN_COUNT: u32 = 255;

#[derive(Drop, Serde, Clone, PartialEq)]
pub struct SetDefaultUlnConfigParam {
    pub eid: u32, // endpoint ID
    pub config: UlnConfig,
}

pub trait UlnConfigUtils {
    /// Resolves a ULN configuration by merging default and custom configurations
    /// Following the same logic as getUlnConfig in the Solidity implementation
    fn resolve(default_config: @UlnConfig, custom_config: @UlnConfig) -> UlnConfig;

    /// Asserts that both dvn arrays of the config have no duplicates
    fn assert_no_duplicate_dvns(config: @UlnConfig);

    /// Asserts that DVNs are sorted in ascending order with no duplicates
    fn assert_no_duplicates_in_dvn_array(dvns: @Array<ContractAddress>);

    /// Asserts that at least one DVN is configured
    fn assert_at_least_one_dvn(config: @UlnConfig);

    /// Asserts that the optional DVN threshold is valid
    fn assert_valid_optional_threshold(config: @UlnConfig);

    /// Asserts that the total DVN count doesn't exceed the maximum
    fn assert_max_dvn_count(config: @UlnConfig);

    /// Asserts that the config confirmations are valid
    fn assert_valid_confirmations(config: @UlnConfig);

    // Asserts that a standalone config (post-resolve / default) is valid
    fn assert_valid_standalone_config(config: @UlnConfig);

    /// Asserts that a send/receive config is valid
    fn assert_valid_config(config: @UlnConfig);
}

pub impl UlnConfigUtilsImpl of UlnConfigUtils {
    fn resolve(default_config: @UlnConfig, custom_config: @UlnConfig) -> UlnConfig {
        let mut resolved_config = default_config.clone();

        // Resolve confirmations
        if *custom_config.has_confirmations {
            resolved_config.confirmations = *custom_config.confirmations;
        }

        // Resolve required DVNs
        if *custom_config.has_required_dvns {
            resolved_config.required_dvns = custom_config.required_dvns.clone();
        }

        // Resolve optional DVNs
        if *custom_config.has_optional_dvns {
            resolved_config.optional_dvns = custom_config.optional_dvns.clone();
            resolved_config.optional_dvn_threshold = *custom_config.optional_dvn_threshold;
        }

        Self::assert_valid_standalone_config(@resolved_config);

        resolved_config
    }

    fn assert_no_duplicate_dvns(config: @UlnConfig) {
        Self::assert_no_duplicates_in_dvn_array(config.required_dvns);
        Self::assert_no_duplicates_in_dvn_array(config.optional_dvns);
    }

    fn assert_no_duplicates_in_dvn_array(dvns: @Array<ContractAddress>) {
        if dvns.len() < 2 {
            return;
        }

        // Pair each DVN with its next DVN, and iterate over the pairs.
        for (current, next) in dvns.into_iter().zip(dvns.span().slice(1, dvns.len() - 1)) {
            // Check that consecutive DVNs are different and sorted.
            assert_with_byte_array(current < next, err_unsorted_dvns());
        }
    }

    fn assert_at_least_one_dvn(config: @UlnConfig) {
        let required_count = config.required_dvns.len();
        let optional_threshold = *config.optional_dvn_threshold;

        assert_with_byte_array(
            required_count != 0 || optional_threshold != 0, err_must_have_at_least_one_dvn(),
        );
    }

    fn assert_valid_optional_threshold(config: @UlnConfig) {
        let optional_count = config.optional_dvns.len();
        let threshold = *config.optional_dvn_threshold;

        assert_with_byte_array(
            optional_count >= threshold.into(),
            err_invalid_optional_dvn_threshold(optional_count, threshold),
        );

        assert_with_byte_array(
            optional_count == 0 || threshold > 0,
            err_invalid_optional_dvn_threshold(optional_count, threshold),
        );
    }

    fn assert_max_dvn_count(config: @UlnConfig) {
        let required_count = config.required_dvns.len();
        let optional_count = config.optional_dvns.len();

        assert_with_byte_array(
            optional_count + required_count <= MAX_DVN_COUNT,
            err_too_many_dvns(required_count, optional_count),
        );
    }

    fn assert_valid_confirmations(config: @UlnConfig) {
        assert_with_byte_array(*config.confirmations > 0, err_invalid_confirmations());
    }

    fn assert_valid_standalone_config(config: @UlnConfig) {
        Self::assert_at_least_one_dvn(config);
        Self::assert_valid_optional_threshold(config);
        Self::assert_max_dvn_count(config);
    }

    fn assert_valid_config(config: @UlnConfig) {
        Self::assert_no_duplicate_dvns(config);
        Self::assert_valid_standalone_config(config);
        Self::assert_valid_confirmations(config);
    }
}
