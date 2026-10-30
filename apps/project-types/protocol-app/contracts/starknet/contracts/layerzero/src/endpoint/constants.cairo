//! EndpointV2 constants

use lz_utils::bytes::Bytes32;

/// Represents an empty payload hash (default state after message execution)
///
/// Assumes computationally infeasible that payload can hash to 0
/// this is equivalent to Default::default() but we're making it explicit
pub const EMPTY_PAYLOAD_HASH: Bytes32 = Bytes32 { value: 0 };

/// Represents a nilified payload hash (message verified but execution prevented)
///
/// Assumes computational intractability of finding a payload that hashes to bytes32.max
pub const NIL_PAYLOAD_HASH: Bytes32 = Bytes32 { value: core::num::traits::Bounded::<u256>::MAX };
