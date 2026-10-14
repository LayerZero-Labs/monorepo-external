use crate::{codec, OFTStore};
use anchor_lang::prelude::*;
use anchor_spl::associated_token::get_associated_token_address_with_program_id;
use oapp::{
    lz_receive_types_seeds,
    lz_receive_types_v3::{LzReceiveTypesV3Accounts, LZ_RECEIVE_TYPES_VERSION},
    types::LzReceiveParams,
};
use spl_transfer_hook_interface::get_extra_account_metas_address;
use token_manager_interface::acl;

/// Step 1 of receive planning: returns the protocol version and the accounts `lz_receive_types_v3`
/// needs after the caller's payer and scratch.
#[derive(Accounts)]
pub struct LzReceiveTypesInfo<'info> {
    pub oft_store: Account<'info, OFTStore>,

    /// CHECK: The LzReceiveTypes discovery PDA the Executor passes; seeds checked, never read.
    #[account(
        seeds = lz_receive_types_seeds(&oft_store.key()),
        bump
    )]
    pub lz_receive_types_accounts: UncheckedAccount<'info>,
}

impl LzReceiveTypesInfo<'_> {
    pub fn apply(
        ctx: &Context<LzReceiveTypesInfo>,
        params: &LzReceiveParams,
    ) -> Result<(u8, LzReceiveTypesV3Accounts)> {
        // Everything `lz_receive_types_v3` needs, from its generated client struct so the order
        // follows its definition. The caller supplies the payer and scratch itself, so those two
        // placeholder slots are dropped; omitted optionals become the program-ID sentinel.
        let store = &ctx.accounts.oft_store;
        let hook_program = store.transfer_hook_program;
        let accounts = crate::accounts::LzReceiveTypesV3 {
            payer: Pubkey::default(),
            plan_out: Pubkey::default(),
            oft_store: store.key(),
            oft_escrow: Pubkey::find_program_address(
                OFTStore::oft_escrow_seeds(&store.key()),
                &crate::ID,
            )
            .0,
            token_mint: store.token_mint,
            token_dest: get_associated_token_address_with_program_id(
                &Pubkey::from(codec::msg::send_to(&params.message)?),
                &store.token_mint,
                &store.token_program,
            ),
            token_program: store.token_program,
            extra_account_meta_list: (hook_program != Pubkey::default())
                .then(|| get_extra_account_metas_address(&store.token_mint, &hook_program)),
            pubkey_policy: store.pubkey_policy,
            // ACL applies only with a policy selected; the planner reads these only then. The
            // manifest is named even for a cached `Pubkey::default()`, which is ambiguous: no
            // MintConfig, or one with no gate. The planner ignores it in the first case and, in
            // the second, finds it unallocated and plans no gate accounts.
            acl_mint_config: store
                .pubkey_policy
                .map(|_| acl::mint_config_address(&store.token_mint)),
            acl_thaw_metas: store
                .pubkey_policy
                .map(|_| acl::thaw_metas_address(&store.token_mint, &store.acl_gating_program)),
            redirect_escrow: store.credit_redirect_config.map(|config| config.redirect_escrow),
        };
        let metas = accounts.to_account_metas(None);
        // `payer` and `plan_out` are the struct's first two fields: the placeholders dropped here.
        debug_assert!(metas[..2].iter().all(|meta| meta.pubkey == Pubkey::default()));
        let required_accounts = metas.into_iter().skip(2).map(|meta| meta.pubkey).collect();
        Ok((LZ_RECEIVE_TYPES_VERSION, LzReceiveTypesV3Accounts { accounts: required_accounts }))
    }
}
