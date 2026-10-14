use crate::{
    authority::authorize_native, errors::TokenManagerError,
    instructions::acl::helpers::read_mint_config, TokenManagerStore, TokenManagerStoreInitialized,
    TOKEN_MANAGER_SEED,
};
use anchor_lang::prelude::*;
use anchor_spl::token_interface::Mint;
use spl_token_2022_interface::{
    extension::{
        permanent_delegate::PermanentDelegate, permissioned_burn::PermissionedBurnConfig,
        BaseStateWithExtensions, StateWithExtensions,
    },
    state::Mint as MintState,
};

#[derive(Clone, AnchorSerialize, AnchorDeserialize)]
pub struct InitTokenManagerParams {
    pub pending_admin: Pubkey,
}

/// Creates the mint's single root with no DefaultAdmin; `pending_admin` must accept.
/// Remaining accounts are ONLY native multisig members for `authority`.
#[event_cpi]
#[derive(Accounts)]
pub struct InitTokenManager<'info> {
    #[account(mut)]
    pub payer: Signer<'info>,

    /// CHECK: One of the mint's live native authorities (see `creation_authority`); authenticated
    /// by `authorize_native`. Pass it as a signer for a plain key or CPI-signing PDA, and as a
    /// non-signer for a native multisig, whose member signers are the remaining accounts.
    pub authority: UncheckedAccount<'info>,

    pub mint: InterfaceAccount<'info, Mint>,

    /// CHECK: Needed only when the freeze authority is Token ACL's MintConfig; `read_mint_config`
    /// checks it.
    pub mint_config: Option<UncheckedAccount<'info>>,

    #[account(
        init,
        payer = payer,
        space = 8 + TokenManagerStore::INIT_SPACE,
        seeds = [TOKEN_MANAGER_SEED, mint.key().as_ref()],
        bump,
    )]
    pub token_manager: Account<'info, TokenManagerStore>,

    pub system_program: Program<'info, System>,
}

impl<'info> InitTokenManager<'info> {
    pub fn apply(ctx: &mut Context<'info, Self>, params: &InitTokenManagerParams) -> Result<()> {
        require_keys_neq!(
            params.pending_admin,
            Pubkey::default(),
            rbac::RbacError::InvalidDefaultAdmin
        );
        let expected = ctx.accounts.creation_authority()?;
        authorize_native(&expected, &ctx.accounts.authority, ctx.remaining_accounts)?;

        ctx.accounts.token_manager.set_inner(TokenManagerStore {
            mint: ctx.accounts.mint.key(),
            current_default_admin: Pubkey::default(),
            pending_default_admin: params.pending_admin,
            bootstrap: expected,
        });

        emit_cpi!(TokenManagerStoreInitialized {
            token_manager: ctx.accounts.token_manager.key(),
            mint: ctx.accounts.mint.key(),
            bootstrap: expected,
            pending_admin: params.pending_admin,
        });
        Ok(())
    }

    /// The root's creator: whichever of the mint's live native authorities (freeze admin, mint
    /// authority, PB authority, Permanent Delegate) `authority` is. They are trusted alike; one
    /// that disagrees with the root can use another TokenManager program. Null authorities never
    /// match, so a mint with none of the four can never get a root, and one parked on this root's
    /// signer PDAs cannot sign before the root exists.
    fn creation_authority(&self) -> Result<Pubkey> {
        let freeze = Option::<Pubkey>::from(self.mint.freeze_authority)
            .map(|freeze| self.freeze_admin(freeze))
            .transpose()?;
        let info = self.mint.to_account_info();
        let data = info.try_borrow_data()?;
        let mint = StateWithExtensions::<MintState>::unpack(&data)?;
        let holder = [
            freeze,
            Option::<Pubkey>::from(mint.base.mint_authority),
            mint.get_extension::<PermissionedBurnConfig>()
                .ok()
                .and_then(|c| c.authority.into()),
            mint.get_extension::<PermanentDelegate>().ok().and_then(|c| c.delegate.into()),
        ]
        .into_iter()
        .flatten()
        .find(|holder| holder == self.authority.key)
        .ok_or(error!(TokenManagerError::InvalidAuthority))?;
        Ok(holder)
    }

    /// When Token ACL's MintConfig holds the freeze authority, its logical admin
    /// (`MintConfig.freeze_authority`) stands in for it. A null admin can never sign, so
    /// `authorize_native` rejects it.
    fn freeze_admin(&self, freeze: Pubkey) -> Result<Pubkey> {
        let Some(config) = self.mint_config.as_ref().filter(|c| c.key() == freeze) else {
            return Ok(freeze);
        };
        Ok(read_mint_config(config, &self.mint.key())?.freeze_authority)
    }
}
