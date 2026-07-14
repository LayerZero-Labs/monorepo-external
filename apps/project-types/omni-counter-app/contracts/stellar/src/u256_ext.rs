use soroban_sdk::U256;

pub trait U256Ext {
    /// Converts U256 to i128 if the value fits.
    /// Returns None if the value is too large to fit in an i128.
    fn to_i128(&self) -> Option<i128>;
}

impl U256Ext for U256 {
    fn to_i128(&self) -> Option<i128> {
        // First try to convert to u128 (checks if high 128 bits are zero)
        let u128_val = self.to_u128()?;

        // Check if the u128 value fits within i128::MAX
        if u128_val <= i128::MAX as u128 {
            Some(u128_val as i128)
        } else {
            None
        }
    }
}
