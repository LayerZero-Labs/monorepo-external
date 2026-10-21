pubkey_policy_interface::declare_policy_errors! {
pub enum HookError {
    #[msg("Only the mint transfer-hook authority may configure its pubkey policy")]
    Unauthorized = 9000,
    #[msg("The bound pubkey policy is for another mint")]
    WrongPolicyMint,
    #[msg("The hook only runs inside a Token-2022 transfer")]
    NotTransferring,
}
}
