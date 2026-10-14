pubkey_policy_interface::declare_policy_errors! {
    pub enum TokenManagerError {
        #[msg("Invalid canonical Token ACL configuration")]
        InvalidConfig = 7000,
        #[msg("Permissionless thaw requires an empty token account; use administrative thaw")]
        NonEmptyAccount,
        #[msg("Permissionless ACL does not handle native or unrecognized token accounts")]
        UnsupportedExtension,
        #[msg("Invalid token manager signing authority")]
        InvalidAuthority,
        #[msg("New native authority is null or a key that could never move it again")]
        InvalidNewAuthority,
        #[msg("The bound pubkey policy is for another mint")]
        WrongPolicyMint,
        #[msg("Token ACL MintConfig and program accounts are required for the Acl signer")]
        MissingAclAccounts,
        #[msg("ACL activation requires DefaultAccountState to be Frozen")]
        DefaultAccountStateNotFrozen = 7008,
        #[msg("Token account is not the policy subject's account of this mint")]
        InvalidTokenAccount,
        #[msg("Token ACL's config authority cannot be a native multisig")]
        AclMultisigUnsupported,
        #[msg("The mint is already in the requested pause state")]
        PauseStateIdempotent,
        #[msg("Token source authority must sign independently of PB approval")]
        MissingBurnSourceSignature = 10002,
    }
}
