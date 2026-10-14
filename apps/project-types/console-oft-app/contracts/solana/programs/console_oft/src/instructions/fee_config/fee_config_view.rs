use crate::{FeeConfig, OFTError, OFTStore};
use anchor_lang::prelude::*;
use oapp::utils::try_load_account;

use super::MAX_FEE_BASIS_POINTS;

/// Shared accounts struct for fee config view instructions:
/// `fee_bps`, `get_fee`, `get_amount_before_fee`.
#[derive(Accounts)]
pub struct FeeConfigView<'info> {
    pub oft_store: Account<'info, OFTStore>,

    /// CHECK: Per-EID fee config PDA. Seeds validated in each handler via
    /// `find_program_address`.
    pub fee_config: UncheckedAccount<'info>,
}

impl FeeConfigView<'_> {
    /// Returns the effective fee basis points (BPS) for a specific destination EID.
    /// If a per-EID config exists, returns Some(fee_bps); otherwise returns None.
    pub fn fee_bps(ctx: &Context<Self>, id: &u128) -> Result<Option<u16>> {
        verify_fee_config_pda(ctx, *id)?;
        let cfg: Option<FeeConfig> = try_load_account(&ctx.accounts.fee_config)?;
        Ok(cfg.map(|c| c.fee_bps))
    }

    /// Returns the fee for a given EID and amount.
    pub fn get_fee(ctx: &Context<Self>, params: &GetFeeParams) -> Result<u64> {
        verify_fee_config_pda(ctx, params.id)?;
        Ok(get_oft_fee(
            ctx.accounts.oft_store.default_fee_bps,
            try_load_account(&ctx.accounts.fee_config)?.as_ref(),
            params.amount,
        ))
    }

    /// Returns a conservative representative of the pre-fee amount corresponding to the specified
    /// post-fee amount.
    ///
    /// Due to the use of integer arithmetic in fee calculation, the fee inverse is not always
    /// unique or exactly representable. If `amount_after_fee` is zero or if the configured fee
    /// rate is 100%, this function returns `0` as a conservative representative.
    /// If the mathematically exact pre-fee amount would exceed `u64::MAX`, the result is saturated
    /// at `u64::MAX`.
    pub fn get_amount_before_fee(
        ctx: &Context<Self>,
        params: &GetAmountBeforeFeeParams,
    ) -> Result<u64> {
        verify_fee_config_pda(ctx, params.id)?;
        Ok(get_amount_before_fee(
            ctx.accounts.oft_store.default_fee_bps,
            try_load_account(&ctx.accounts.fee_config)?.as_ref(),
            params.amount_after_fee,
        ))
    }
}

fn verify_fee_config_pda(ctx: &Context<FeeConfigView>, id: u128) -> Result<()> {
    let (expected, _) = Pubkey::find_program_address(
        FeeConfig::seeds(&ctx.accounts.oft_store.key(), id),
        ctx.program_id,
    );
    require_keys_eq!(ctx.accounts.fee_config.key(), expected, OFTError::InvalidFeeConfigAccount);
    Ok(())
}

/// Returns the OFT fee for the given amount.
pub fn get_oft_fee(default_fee_bps: u16, cfg: Option<&FeeConfig>, amount: u64) -> u64 {
    let bps = get_fee_bps(default_fee_bps, cfg);
    if amount == 0 || bps == 0 {
        return 0;
    }
    ((amount as u128) * (bps as u128) / (MAX_FEE_BASIS_POINTS as u128)) as u64
}

/// Returns a conservative representative of the pre-fee amount corresponding to the given post-fee
/// amount.
///
/// Due to the use of integer arithmetic in fee calculation, the fee inverse is not always
/// unique or exactly representable. If `amount_after_fee` is zero or the configured fee rate is
/// 100%, this function returns `0` as a conservative representative. If the mathematically exact
/// pre-fee amount exceeds `u64::MAX`, the result is saturated at `u64::MAX`.
pub fn get_amount_before_fee(
    default_fee_bps: u16,
    cfg: Option<&FeeConfig>,
    amount_after_fee: u64,
) -> u64 {
    let bps = get_fee_bps(default_fee_bps, cfg) as u128;
    let denom = MAX_FEE_BASIS_POINTS as u128;
    if bps >= denom {
        return 0;
    }
    if bps == 0 {
        return amount_after_fee;
    }
    let amount_before_fee = (amount_after_fee as u128) * denom / (denom - bps);
    u64::try_from(amount_before_fee).unwrap_or(u64::MAX)
}

/// Returns the effective fee bps for a destination EID.
fn get_fee_bps(default_fee_bps: u16, cfg: Option<&FeeConfig>) -> u16 {
    cfg.map_or(default_fee_bps, |c| c.fee_bps)
}

/// Parameters for retrieving the fee for a destination ID and amount.
#[derive(Clone, AnchorSerialize, AnchorDeserialize)]
pub struct GetFeeParams {
    /// Destination ID.
    pub id: u128,
    /// Amount to calculate the fee for.
    pub amount: u64,
}

/// Parameters for retrieving the pre-fee amount required to yield a given post-fee amount.
#[derive(Clone, AnchorSerialize, AnchorDeserialize)]
pub struct GetAmountBeforeFeeParams {
    /// Destination ID.
    pub id: u128,
    /// Desired amount after fees.
    pub amount_after_fee: u64,
}

#[cfg(test)]
mod tests {
    use super::*;

    /// Quote turns remaining rate-limit capacity into a pre-fee amount. Sending that amount must
    /// deliver exactly the capacity: less under-reports, more would exceed the limit.
    #[test]
    fn amount_before_fee_delivers_exactly_the_requested_amount_after_fee() {
        for bps in [1, 25, 500, 3_333, MAX_FEE_BASIS_POINTS - 1] {
            for after in [1, 7, 950, 999_999, 1 << 40] {
                let before = get_amount_before_fee(bps, None, after);
                assert_eq!(before - get_oft_fee(bps, None, before), after, "bps {bps}, {after}");
            }
        }
    }

    #[test]
    fn amount_before_fee_edges() {
        assert_eq!(get_amount_before_fee(0, None, 950), 950);
        // A 100% fee delivers nothing, whatever is sent.
        assert_eq!(get_amount_before_fee(MAX_FEE_BASIS_POINTS, None, 950), 0);
        assert_eq!(get_amount_before_fee(MAX_FEE_BASIS_POINTS - 1, None, u64::MAX), u64::MAX);
    }

    /// A per-EID override replaces the default, including an override of zero.
    #[test]
    fn per_eid_fee_overrides_the_default_fee() {
        assert_eq!(get_oft_fee(100, None, 10_000), 100);
        assert_eq!(get_oft_fee(100, Some(&FeeConfig { fee_bps: 500 }), 10_000), 500);
        assert_eq!(get_oft_fee(100, Some(&FeeConfig { fee_bps: 0 }), 10_000), 0);
    }
}
