//! Worker access control roles

/// Default admin role
/// - can grant and revoke all roles
pub use openzeppelin::access::accesscontrol::DEFAULT_ADMIN_ROLE;

/// Admin role
pub const ADMIN_ROLE: felt252 = 'ADMIN_ROLE';

/// Message lib role
pub const MESSAGE_LIB_ROLE: felt252 = 'MESSAGE_LIB_ROLE';

/// Allow list role
pub const ALLOW_LIST_ROLE: felt252 = 'ALLOW_LIST_ROLE';

/// Deny list role
pub const DENY_LIST_ROLE: felt252 = 'DENY_LIST_ROLE';
