//! Token ACL gate manifests and a mint's canonical Token ACL configuration.
use super::{AclError, AclResult, TOKEN_ACL_ID};
use anchor_lang::{
    prelude::*,
    solana_program::{instruction::AccountMeta, program_option::COption},
};
use pubkey_policy_interface::SUBJECT_SEED;
use spl_tlv_account_resolution::{
    account::ExtraAccountMeta, seeds::Seed, state::ExtraAccountMetaList,
};
use spl_type_length_value::state::TlvStateBorrowed;
use token_acl_client::accounts::MintConfig;
use token_acl_interface::{
    instruction::{CanThawPermissionlessInstruction, EfficientBlockAllowInstruction},
    FLAG_ACCOUNT_SEED,
};

/// Gate-instruction account indices of the token owner, pubkey policy and policy program, which the
/// record meta uses as seeds.
const OWNER_SEED_METAS_INDEX: u8 = 3;
const PUBKEY_POLICY_METAS_INDEX: u8 = 6;
const POLICY_PROGRAM_METAS_INDEX: u8 = 7;
/// Extra accounts in each gate manifest: see [`gate_account_metas`].
pub const ACL_EXTRA_COUNT: usize = 3;

pub fn mint_config_address(mint: &Pubkey) -> Pubkey {
    MintConfig::find_pda(mint).0
}

/// The thaw manifest Token ACL resolves for `mint` when `gating_program` is its gate.
pub fn thaw_metas_address(mint: &Pubkey, gating_program: &Pubkey) -> Pubkey {
    token_acl_interface::get_thaw_extra_account_metas_address(mint, gating_program)
}

/// Whether `gate` has a thaw manifest for `mint`. `manifest` must be the account Token ACL looks
/// up, `gate`'s canonical thaw manifest; unallocated there means none, and Token ACL then calls the
/// gate with no extra accounts.
pub fn has_thaw_manifest(manifest: &AccountInfo, mint: &Pubkey, gate: &Pubkey) -> AclResult<bool> {
    if manifest.key != &thaw_metas_address(mint, gate) {
        return Err(AclError::InvalidManifest);
    }
    if manifest.owner == &System::id() && manifest.data_is_empty() {
        return Ok(false);
    }
    if manifest.owner != gate {
        return Err(AclError::InvalidManifest);
    }
    Ok(true)
}

/// How many extra accounts the thaw manifest of the gate `config` names lists; zero without a
/// manifest. `config` is `mint`'s canonical MintConfig and `manifest` that gate's thaw manifest.
pub fn thaw_extra_count(
    config: &AccountInfo,
    manifest: &AccountInfo,
    mint: &Pubkey,
) -> AclResult<usize> {
    let gate = read_mint_config(config, mint)?.gating_program;
    if !has_thaw_manifest(manifest, mint, &gate)? {
        return Ok(0);
    }
    let data = manifest.try_borrow_data()?;
    let tlv = TlvStateBorrowed::unpack(&data)?;
    Ok(ExtraAccountMetaList::unpack_with_tlv_state::<CanThawPermissionlessInstruction>(&tlv)?.len())
}

/// A permissionless thaw of `token_account` that a planner must name the accounts for without
/// running it. `manifest` is `gate`'s thaw manifest for `mint`; `token_account_data` stands in for
/// an account not created yet.
pub struct ThawPlan<'a, 'info> {
    pub manifest: &'a AccountInfo<'info>,
    pub mint: &'a AccountInfo<'info>,
    pub gate: &'a Pubkey,
    pub token_account: &'a Pubkey,
    pub token_account_data: &'a [u8],
    pub owner: &'a Pubkey,
}

impl ThawPlan<'_, '_> {
    /// The accounts to supply after the manifest, resolved from it as Token ACL will resolve
    /// them; empty without a manifest.
    ///
    /// Seeds may read the gate instruction's own accounts (token account, mint, owner, flag and
    /// manifest) and earlier extras' keys. Token ACL's caller, the transaction's payer, is unknown
    /// to a planner, so a manifest whose seeds read it cannot be resolved here.
    pub fn extras(&self) -> AclResult<Vec<AccountMeta>> {
        if !has_thaw_manifest(self.manifest, self.mint.key, self.gate)? {
            return Ok(vec![]);
        }
        let manifest_data = self.manifest.try_borrow_data()?;
        let tlv = TlvStateBorrowed::unpack(&manifest_data)?;
        let metas =
            ExtraAccountMetaList::unpack_with_tlv_state::<CanThawPermissionlessInstruction>(&tlv)?;
        let mint_data = self.mint.try_borrow_data()?;
        let flag = flag_address(self.token_account);
        let ix_data = EfficientBlockAllowInstruction::CanThawPermissionless.pack();
        let mut resolved: Vec<AccountMeta> = Vec::with_capacity(metas.len());
        for meta in metas.iter() {
            // The gate instruction's accounts, then the extras resolved so far.
            let account = meta.resolve(&ix_data, self.gate, |i| match i {
                0 => None,
                1 => Some((self.token_account, Some(self.token_account_data))),
                2 => Some((self.mint.key, Some(mint_data.as_ref()))),
                3 => Some((self.owner, None)),
                4 => Some((&flag, None)),
                5 => Some((self.manifest.key, Some(manifest_data.as_ref()))),
                i => resolved.get(i - 6).map(|meta| (&meta.pubkey, None)),
            })?;
            resolved.push(account);
        }
        Ok(resolved)
    }
}

pub fn flag_address(token_account: &Pubkey) -> Pubkey {
    Pubkey::find_program_address(&[FLAG_ACCOUNT_SEED, token_account.as_ref()], &TOKEN_ACL_ID).0
}

/// Whether a consumer with a selected pubkey policy must go through Token ACL for `mint`: true when
/// Token ACL's MintConfig holds the mint's native freeze authority. Take both inputs from the mint
/// and the consumer's stored configuration, never from optional accounts, so a transaction cannot
/// opt out by omitting them.
pub fn requires_acl(
    mint: &Pubkey,
    freeze_authority: COption<Pubkey>,
    policy_selected: bool,
) -> bool {
    policy_selected && freeze_authority == COption::Some(mint_config_address(mint))
}

/// Gate order: caller, token, mint, owner, flag, manifest, pubkey policy (6), policy program (7),
/// record (8). The record is a PDA of `policy_program`, the program that owns `pubkey_policy`.
pub fn gate_account_metas(
    pubkey_policy: &Pubkey,
    policy_program: &Pubkey,
) -> core::result::Result<Vec<ExtraAccountMeta>, ProgramError> {
    Ok(vec![
        ExtraAccountMeta::new_with_pubkey(pubkey_policy, false, false)?,
        ExtraAccountMeta::new_with_pubkey(policy_program, false, false)?,
        ExtraAccountMeta::new_external_pda_with_seeds(
            POLICY_PROGRAM_METAS_INDEX,
            &[
                Seed::Literal { bytes: SUBJECT_SEED.to_vec() },
                Seed::AccountKey { index: PUBKEY_POLICY_METAS_INDEX },
                Seed::AccountKey { index: OWNER_SEED_METAS_INDEX },
            ],
            false,
            false,
        )?,
    ])
}

/// `mint`'s canonical Token ACL MintConfig. Token ACL writes one only at this address, for this
/// mint, so its address and owner identify it.
pub fn read_mint_config(config: &AccountInfo, mint: &Pubkey) -> AclResult<MintConfig> {
    if config.key != &mint_config_address(mint) || config.owner != &TOKEN_ACL_ID {
        return Err(AclError::InvalidConfig);
    }
    MintConfig::from_bytes(&config.try_borrow_data()?).map_err(|_| AclError::InvalidConfig)
}

#[cfg(test)]
mod tests {
    use super::*;
    use token_acl_client::accounts::MINT_CONFIG_DISCRIMINATOR;

    fn account(key: Pubkey, owner: Pubkey, data: Vec<u8>) -> AccountInfo<'static> {
        AccountInfo::new(
            Box::leak(Box::new(key)),
            false,
            false,
            Box::leak(Box::new(1)),
            Box::leak(data.into_boxed_slice()),
            Box::leak(Box::new(owner)),
            false,
        )
    }

    fn config_data(mint: Pubkey) -> Vec<u8> {
        let mut data = vec![];
        MintConfig {
            discriminator: MINT_CONFIG_DISCRIMINATOR,
            bump: MintConfig::find_pda(&mint).1,
            enable_permissionless_thaw: true,
            enable_permissionless_freeze: true,
            mint,
            freeze_authority: Pubkey::new_unique(),
            gating_program: Pubkey::new_unique(),
        }
        .serialize(&mut data)
        .unwrap();
        data
    }

    #[test]
    fn selection_and_native_mint_authority_determine_required_inputs() {
        let mint = Pubkey::new_unique();
        assert!(requires_acl(&mint, COption::Some(mint_config_address(&mint)), true));
        assert!(!requires_acl(&mint, COption::Some(mint_config_address(&mint)), false));
        assert!(!requires_acl(&mint, COption::Some(Pubkey::new_unique()), true));
        assert!(!requires_acl(&mint, COption::None, true));
    }

    /// A manifest listing [`gate_account_metas`], as this TokenManager writes one, under `gate`.
    fn gate_manifest(mint: &Pubkey, gate: Pubkey, policy: &Pubkey) -> AccountInfo<'static> {
        let metas = gate_account_metas(policy, &pubkey_policy_interface::ID).unwrap();
        let mut data = vec![0; ExtraAccountMetaList::size_of(metas.len()).unwrap()];
        ExtraAccountMetaList::init::<CanThawPermissionlessInstruction>(&mut data, &metas).unwrap();
        account(thaw_metas_address(mint, &gate), gate, data)
    }

    #[test]
    fn only_the_configured_gates_canonical_manifest_is_read() {
        let (mint, gate, policy) =
            (Pubkey::new_unique(), Pubkey::new_unique(), Pubkey::new_unique());
        let canonical = thaw_metas_address(&mint, &gate);
        assert!(has_thaw_manifest(&gate_manifest(&mint, gate, &policy), &mint, &gate).unwrap());
        assert!(
            !has_thaw_manifest(&account(canonical, System::id(), vec![]), &mint, &gate).unwrap()
        );
        for invalid in [
            account(Pubkey::new_unique(), gate, vec![]),
            account(canonical, Pubkey::new_unique(), vec![0; 8]),
        ] {
            assert!(matches!(
                has_thaw_manifest(&invalid, &mint, &gate),
                Err(AclError::InvalidManifest)
            ));
        }
    }

    /// Resolution follows the manifest alone: the record is derived from the owner and the
    /// policy the manifest names, under the policy program it names.
    #[test]
    fn thaw_extras_resolve_from_the_gates_manifest() {
        let (mint, gate, policy) =
            (Pubkey::new_unique(), Pubkey::new_unique(), Pubkey::new_unique());
        let (token_account, owner) = (Pubkey::new_unique(), Pubkey::new_unique());
        let mint_info = account(mint, spl_token_2022_interface::ID, vec![0; 82]);
        let manifest = gate_manifest(&mint, gate, &policy);
        let plan = |manifest| ThawPlan {
            manifest,
            mint: &mint_info,
            gate: &gate,
            token_account: &token_account,
            token_account_data: &[0; 64],
            owner: &owner,
        };
        let keys: Vec<_> = plan(&manifest)
            .extras()
            .unwrap()
            .into_iter()
            .map(|meta| (meta.pubkey, meta.is_signer, meta.is_writable))
            .collect();
        let record = pubkey_policy_interface::subject_address(&policy, &owner).0;
        assert_eq!(
            keys,
            [
                (policy, false, false),
                (pubkey_policy_interface::ID, false, false),
                (record, false, false)
            ]
        );
        let absent = account(thaw_metas_address(&mint, &gate), System::id(), vec![]);
        assert!(plan(&absent).extras().unwrap().is_empty());
    }

    #[test]
    fn only_the_mints_canonical_token_acl_config_is_read() {
        let mint = Pubkey::new_unique();
        let canonical = mint_config_address(&mint);
        assert!(
            read_mint_config(&account(canonical, TOKEN_ACL_ID, config_data(mint)), &mint).is_ok()
        );
        for invalid in [
            account(Pubkey::new_unique(), TOKEN_ACL_ID, config_data(mint)),
            account(canonical, System::id(), config_data(mint)),
            account(canonical, TOKEN_ACL_ID, vec![0]),
        ] {
            assert!(matches!(read_mint_config(&invalid, &mint), Err(AclError::InvalidConfig)));
        }
    }
}
