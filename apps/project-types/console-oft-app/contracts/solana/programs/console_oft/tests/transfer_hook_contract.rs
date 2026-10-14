//! Planner -> checked group -> pinned native SPL helper, independent of our policy hook's recipe.
use anchor_lang::prelude::*;
use anchor_spl::token_interface::Mint;
use console_oft::{
    append_transfer_hook_accounts, token_account_seed_prefix, MintTransferHook,
    TransferHookAccounts, TransferHookDestination,
};
use spl_tlv_account_resolution::{
    account::ExtraAccountMeta, seeds::Seed, state::ExtraAccountMetaList,
};
use spl_token_2022::{
    extension::{
        transfer_hook::TransferHook, BaseStateWithExtensionsMut, ExtensionType,
        PodStateWithExtensionsMut,
    },
    pod::PodMint,
};
use spl_transfer_hook_interface::{
    get_extra_account_metas_address, instruction::ExecuteInstruction,
    onchain::add_extra_accounts_for_execute_cpi,
};

struct TestAccount {
    key: Pubkey,
    owner: Pubkey,
    data: Vec<u8>,
    lamports: u64,
    executable: bool,
}

impl TestAccount {
    fn new(key: Pubkey, owner: Pubkey, data: Vec<u8>) -> Self {
        Self { key, owner, data, lamports: 1, executable: false }
    }

    fn info(&mut self) -> AccountInfo<'_> {
        AccountInfo::new(
            &self.key,
            false,
            false,
            &mut self.lamports,
            &mut self.data,
            &self.owner,
            self.executable,
        )
    }
}

fn mint(hook: Option<Pubkey>) -> TestAccount {
    let mut data =
        vec![
            0;
            ExtensionType::try_calculate_account_len::<PodMint>(&[ExtensionType::TransferHook])
                .unwrap()
        ];
    let mut state = PodStateWithExtensionsMut::<PodMint>::unpack_uninitialized(&mut data).unwrap();
    state.init_extension::<TransferHook>(true).unwrap().program_id = hook.try_into().unwrap();
    state.base.is_initialized = true.into();
    state.base.decimals = 6;
    state.init_account_type().unwrap();
    TestAccount::new(Pubkey::new_unique(), spl_token_2022::ID, data)
}

fn manifest(mint: Pubkey, hook: Pubkey, metas: Option<&[ExtraAccountMeta]>) -> TestAccount {
    let mut data = vec![];
    if let Some(metas) = metas {
        data.resize(ExtraAccountMetaList::size_of(metas.len()).unwrap(), 0);
        ExtraAccountMetaList::init::<ExecuteInstruction>(&mut data, metas).unwrap();
    }
    TestAccount::new(
        get_extra_account_metas_address(&mint, &hook),
        if metas.is_some() { hook } else { System::id() },
        data,
    )
}

#[test]
fn absent_and_initialized_empty_manifests_round_trip_with_different_native_forwarding() {
    for initialized in [false, true] {
        let hook = Pubkey::new_unique();
        let mut mint = mint(Some(hook));
        let mut meta = manifest(mint.key, hook, initialized.then_some(&[]));
        let mut program = TestAccount::new(hook, Pubkey::new_unique(), vec![]);
        program.executable = true;
        let mut source = TestAccount::new(Pubkey::new_unique(), spl_token_2022::ID, vec![]);
        let mut dest = TestAccount::new(Pubkey::new_unique(), spl_token_2022::ID, vec![]);
        let mut authority = TestAccount::new(Pubkey::new_unique(), System::id(), vec![]);
        let (mi, pi, ei, si, di, ai) = (
            mint.info(),
            program.info(),
            meta.info(),
            source.info(),
            dest.info(),
            authority.info(),
        );
        let parsed =
            MintTransferHook::read(&InterfaceAccount::<Mint>::try_from(&mi).unwrap()).unwrap();
        let mut plan = vec![];
        append_transfer_hook_accounts(
            &mut plan,
            &hook,
            &si,
            &mi,
            TransferHookDestination { key: *di.key, data: &[] },
            &ai,
            &ei,
            1,
        )
        .unwrap();
        assert_eq!(plan.len(), 2, "canonical witness is always in the wire group");
        assert_eq!(plan[0].pubkey, hook.into());
        assert_eq!(plan[1].pubkey, (*ei.key).into());
        let group = [pi, ei];
        let checked = TransferHookAccounts::parse_exact(&parsed, &group).unwrap();
        assert_eq!(checked.cpi_accounts().len(), if initialized { 2 } else { 1 });
        let mut ix = spl_token_2022::instruction::transfer_checked(
            &spl_token_2022::ID,
            si.key,
            mi.key,
            di.key,
            ai.key,
            &[],
            1,
            6,
        )
        .unwrap();
        let mut infos = vec![si.clone(), mi.clone(), di.clone(), ai.clone()];
        add_extra_accounts_for_execute_cpi(
            &mut ix,
            &mut infos,
            &hook,
            si.clone(),
            mi.clone(),
            di.clone(),
            ai.clone(),
            1,
            checked.cpi_accounts(),
        )
        .unwrap();
        assert_eq!(ix.accounts.iter().any(|a| a.pubkey == *group[1].key), initialized);
        if !initialized {
            assert!(
                add_extra_accounts_for_execute_cpi(
                    &mut ix,
                    &mut infos,
                    &hook,
                    si,
                    mi.clone(),
                    di,
                    ai,
                    1,
                    &group
                )
                .is_err(),
                "forwarding the unallocated witness would fail native TLV parsing"
            );
        }
    }
}

#[test]
fn complete_groups_preserve_tail_and_reject_missing_short_wrong_or_surplus_accounts() {
    let hook = Pubkey::new_unique();
    let extra = Pubkey::new_unique();
    let mut mint = mint(Some(hook));
    let mut meta = manifest(
        mint.key,
        hook,
        Some(&[ExtraAccountMeta::new_with_pubkey(&extra, false, false).unwrap()]),
    );
    let mut program = TestAccount::new(hook, Pubkey::new_unique(), vec![]);
    program.executable = true;
    let mut extra = TestAccount::new(extra, System::id(), vec![]);
    let mut tail = TestAccount::new(Pubkey::new_unique(), System::id(), vec![]);
    let mi = mint.info();
    let parsed = MintTransferHook::read(&InterfaceAccount::<Mint>::try_from(&mi).unwrap()).unwrap();
    let group = [program.info(), meta.info(), extra.info(), tail.info()];
    for len in 0..3 {
        assert!(TransferHookAccounts::take_prefix(&parsed, &group[..len]).is_err());
    }
    let (hooks, rest) = TransferHookAccounts::take_prefix(&parsed, &group).unwrap();
    assert_eq!(hooks.cpi_accounts().len(), 3);
    assert_eq!(rest[0].key, group[3].key);
    assert!(TransferHookAccounts::parse_exact(&parsed, &group).is_err());
    assert!(TransferHookAccounts::parse_exact(&parsed, &group[..3]).is_ok());
    assert!(TransferHookAccounts::parse_exact(
        &parsed,
        &[group[3].clone(), group[1].clone(), group[2].clone()]
    )
    .is_err());
    assert!(TransferHookAccounts::parse_exact(
        &parsed,
        &[group[0].clone(), group[3].clone(), group[2].clone()]
    )
    .is_err());
    let mut nonexecutable = group[0].clone();
    nonexecutable.executable = false;
    assert!(TransferHookAccounts::parse_exact(
        &parsed,
        &[nonexecutable, group[1].clone(), group[2].clone()]
    )
    .is_err());
}

#[test]
fn absence_requires_canonical_system_owned_empty_witness() {
    let hook = Pubkey::new_unique();
    for case in 0..5 {
        let mut mint = mint(Some(hook));
        let mut meta = manifest(mint.key, hook, None);
        match case {
            0 => meta.key = Pubkey::new_unique(),
            1 => meta.owner = Pubkey::new_unique(),
            2 => meta.owner = hook, // Hook-owned empty bytes are malformed, not absence.
            3 => meta.data = vec![0; 8],
            _ => meta.executable = true,
        }
        let mut program = TestAccount::new(hook, Pubkey::new_unique(), vec![]);
        program.executable = true;
        let mi = mint.info();
        let parsed =
            MintTransferHook::read(&InterfaceAccount::<Mint>::try_from(&mi).unwrap()).unwrap();
        let group = [program.info(), meta.info()];
        assert!(TransferHookAccounts::parse_exact(&parsed, &group).is_err(), "case {case}");
        let mut plan = vec![];
        assert!(
            append_transfer_hook_accounts(
                &mut plan,
                &hook,
                &mi,
                &mi,
                TransferHookDestination { key: Pubkey::new_unique(), data: &[] },
                &mi,
                &group[1],
                1
            )
            .is_err(),
            "planner case {case}"
        );
    }
}

#[test]
fn no_hook_consumes_nothing_but_exact_group_rejects_surplus() {
    let mut mint = mint(None);
    let mut tail = TestAccount::new(Pubkey::new_unique(), System::id(), vec![]);
    let mi = mint.info();
    let parsed = MintTransferHook::read(&InterfaceAccount::<Mint>::try_from(&mi).unwrap()).unwrap();
    let group = [tail.info()];
    let (hooks, rest) = TransferHookAccounts::take_prefix(&parsed, &group).unwrap();
    assert!(hooks.cpi_accounts().is_empty());
    assert_eq!(rest.len(), 1);
    assert!(TransferHookAccounts::parse_exact(&parsed, &[]).is_ok());
    assert!(TransferHookAccounts::parse_exact(&parsed, &group).is_err());
}

#[test]
fn missing_destination_keeps_real_key_and_synthetic_owner_for_seed_resolution() {
    let hook = Pubkey::new_unique();
    let destination = Pubkey::new_unique();
    let owner = Pubkey::new_unique();
    let mut mint = mint(Some(hook));
    let metas = [
        ExtraAccountMeta::new_with_seeds(&[Seed::AccountKey { index: 2 }], false, false).unwrap(),
        ExtraAccountMeta::new_with_seeds(
            &[Seed::AccountData { account_index: 2, data_index: 32, length: 32 }],
            false,
            false,
        )
        .unwrap(),
        ExtraAccountMeta::new_with_seeds(
            &[Seed::AccountKey { index: 5 }, Seed::InstructionData { index: 8, length: 8 }],
            false,
            false,
        )
        .unwrap(),
    ];
    let mut meta = manifest(mint.key, hook, Some(&metas));
    let bytes = token_account_seed_prefix(mint.key, owner);
    let mi = mint.info();
    let mut plan = vec![];
    append_transfer_hook_accounts(
        &mut plan,
        &hook,
        &mi,
        &mi,
        TransferHookDestination { key: destination, data: &bytes },
        &mi,
        &meta.info(),
        9,
    )
    .unwrap();
    let key_pda = Pubkey::find_program_address(&[destination.as_ref()], &hook).0;
    assert_eq!(plan[2].pubkey, key_pda.into());
    assert_eq!(plan[3].pubkey, Pubkey::find_program_address(&[owner.as_ref()], &hook).0.into());
    assert_eq!(
        plan[4].pubkey,
        Pubkey::find_program_address(&[key_pda.as_ref(), &9u64.to_le_bytes()], &hook)
            .0
            .into()
    );
}

#[test]
fn seed_data_outside_missing_destination_prefix_fails_deliberately() {
    let hook = Pubkey::new_unique();
    let mut mint = mint(Some(hook));
    let mut meta = manifest(
        mint.key,
        hook,
        Some(&[ExtraAccountMeta::new_with_seeds(
            &[Seed::AccountData { account_index: 2, data_index: 64, length: 1 }],
            false,
            false,
        )
        .unwrap()]),
    );
    let bytes = token_account_seed_prefix(mint.key, Pubkey::new_unique());
    let mi = mint.info();
    assert!(append_transfer_hook_accounts(
        &mut vec![],
        &hook,
        &mi,
        &mi,
        TransferHookDestination { key: Pubkey::new_unique(), data: &bytes },
        &mi,
        &meta.info(),
        1
    )
    .is_err());
}
