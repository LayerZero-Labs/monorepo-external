use anchor_lang::prelude::*;

/// Trait for role type enums.
/// Implement this trait on your program-specific role enum.
///
/// Aligned with OpenZeppelin's AccessControl pattern where `DEFAULT_ADMIN_ROLE`
/// is a special role that administers all other roles.
///
/// # Example
/// ```ignore
/// #[derive(
///     Clone,
///     Copy,
///     PartialEq,
///     Eq,
///     AnchorSerialize,
///     AnchorDeserialize,
///     InitSpace,
///     Default,
///     num_enum::TryFromPrimitive,
///     num_enum::IntoPrimitive,
/// )]
/// #[repr(u8)]
/// pub enum RoleType {
///     #[default]
///     DefaultAdmin = 0,
///     Pauser = 1,
/// }
///
/// impl RoleType for RoleType {
///     // Optional: override for hierarchical admins.
///     // Omit this method to use the default implementation.
/// }
/// ```
pub trait RoleType:
    AnchorSerialize
    + AnchorDeserialize
    + Clone
    + Copy
    + PartialEq
    + Space
    + TryFrom<u8>
    + Into<u8>
    + Default
{
    /// Get the admin role for this role.
    /// The admin role has authority to grant/revoke this role.
    /// By default this returns `default_admin_role()`.
    /// Override this when you need hierarchical admins (e.g., `DefaultAdmin -> MinterManager ->
    /// Minter`).
    fn role_admin(&self) -> Self {
        Self::default_admin_role()
    }

    /// Returns the root admin role.
    ///
    /// Default implementation returns `Self::default()`, so the enum variant marked
    /// with `#[default]` acts as `DEFAULT_ADMIN_ROLE`.
    ///
    /// **Recommended**: pin the `#[default]` variant to discriminant `0`. The
    /// LayerZero SDK and tooling assume the default-admin PDA seed is `[0]`, so a
    /// non-zero discriminant will break SDK compatibility. `#[derive(RoleType)]`
    /// enforces discriminant `0` at compile time when you use the built-in derive.
    ///
    /// If you intentionally want the root admin to be a non-zero discriminant, implement this
    /// method yourself — and accept that the stock SDK helpers may need adjustment to find the
    /// right PDA.
    fn default_admin_role() -> Self {
        Self::default()
    }

    /// Check if this is the default admin role.
    /// The default admin role is special: it administers itself and all other roles.
    /// Aligned with OpenZeppelin's `DEFAULT_ADMIN_ROLE`.
    ///
    /// Default implementation checks if `role_admin()` returns self.
    fn is_default_admin(&self) -> bool {
        Self::default_admin_role() == *self
    }

    /// Returns the single-byte seed for PDA derivation.
    fn seed(&self) -> [u8; 1] {
        let v: u8 = (*self).into();
        v.to_be_bytes()
    }
}

/// Trait for program state accounts that embed default admin management.
pub trait DefaultAdmin {
    fn set_current_default_admin(&mut self, admin: Pubkey);
    fn current_default_admin(&self) -> &Pubkey;
    fn set_pending_default_admin(&mut self, admin: Pubkey);
    fn pending_default_admin(&self) -> &Pubkey;
}
