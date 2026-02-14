/// Role identifier for addresses that can mint new tokens
/// In Solidity, this would be: bytes32 public constant MINTER_ROLE = keccak256("MINTER_ROLE")
pub const MINTER_ROLE: felt252 = 'MINTER_ROLE';

/// Role identifier for addresses that can burn tokens without approval
/// In Solidity, this would be: bytes32 public constant BURNER_ROLE = keccak256("BURNER_ROLE")
pub const BURNER_ROLE: felt252 = 'BURNER_ROLE';

/// Role identifier for addresses that can pause the contract
/// In Solidity, this would be: bytes32 public constant PAUSE_MANAGER_ROLE =
/// keccak256("PAUSE_MANAGER_ROLE")
pub const PAUSE_MANAGER_ROLE: felt252 = 'PAUSE_MANAGER_ROLE';

/// Role identifier for addresses that can manage the allowlist
/// In Solidity, this would be: bytes32 public constant ALLOWLIST_MANAGER_ROLE =
/// keccak256("ALLOWLIST_MANAGER_ROLE")
pub const ALLOWLIST_MANAGER_ROLE: felt252 = 'ALLOWLIST_MANAGER_ROLE';
