use anchor_lang::prelude::*;

/// Tries to load and deserialize an account from an [`UncheckedAccount`].
///
/// Returns `Ok(Some(T))` if the account has data, `Ok(None)` if the account is
/// empty (PDA not initialized). Anchor must validate PDA seeds via constraints
/// before calling this.
pub fn try_load_account<T: AccountDeserialize>(account: &UncheckedAccount) -> Result<Option<T>> {
    if account.data_is_empty() {
        return Ok(None);
    }
    let data = account.try_borrow_data()?;
    T::try_deserialize(&mut &data[..]).map(Some)
}
