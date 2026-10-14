//! Administration that needs the real cross-program stack: initialization, policy binding, and
//! the Endpoint-backed OApp operations.

use crate::harness::*;
use ::oft::types::OftType;
use console_oft::state::RoleType as OftRole;
use spl_token_2022_interface::extension::BaseStateWithExtensions;

fn init_ix(
    h: &Harness,
    initializer: Pubkey,
    shared_decimals: u8,
    oft_type: OftType,
) -> Instruction {
    let store = Pubkey::find_program_address(&[b"OFT", initializer.as_ref()], &program_id()).0;
    let endpoint_id = host(endpoint::ID);
    let mut instruction = ix(
        console_oft::ID,
        console_oft::accounts::InitConsoleOFT {
            payer: to_program_pubkey(&h.f.payer),
            initializer: to_program_pubkey(&initializer),
            oft_store: to_program_pubkey(&store),
            default_rate_limit: to_program_pubkey(&rate_limit_pda(&store, 0)),
            token_mint: to_program_pubkey(&h.f.token_mint),
            oft_escrow: to_program_pubkey(&oft_escrow_pda(&store)),
            fee_deposit: to_program_pubkey(&h.f.fee_deposit),
            token_program: to_program_pubkey(&h.token_program),
            system_program: Default::default(),
            admin_role_member: to_program_pubkey(&role_member_pda(
                &store,
                OftRole::DefaultAdmin,
                &h.f.admin,
            )),
            event_authority: to_program_pubkey(&event(program_id())),
            program: console_oft::ID,
        },
        console_oft::instruction::InitConsoleOft {
            params: console_oft::instructions::InitConsoleOFTParams {
                oft_type,
                admin: to_program_pubkey(&h.f.admin),
                shared_decimals,
            },
        },
    );
    // `endpoint_cpi::register_oapp` order: the store registers itself, delegating to the admin.
    instruction.accounts.extend([
        AccountMeta::new_readonly(endpoint_id, false),
        AccountMeta::new(h.f.payer, true),
        AccountMeta::new_readonly(store, false),
        AccountMeta::new(oapp_registry(store), false),
        AccountMeta::new_readonly(Pubkey::default(), false),
        AccountMeta::new_readonly(event(endpoint_id), false),
        AccountMeta::new_readonly(endpoint_id, false),
    ]);
    instruction
}

fn oapp_registry(oapp: Pubkey) -> Pubkey {
    Pubkey::find_program_address(&[b"OApp", oapp.as_ref()], &host(endpoint::ID)).0
}

/// The fixture writes an initialized store directly; this proves `init_console_oft` produces the
/// state that fixture stands in for, and registers the OApp with the admin as its delegate.
#[test]
fn init_creates_the_oft_accounts_and_registers_the_admin_as_endpoint_delegate() {
    let h = Harness::new(false, false);
    let initializer = Pubkey::new_unique();
    h.f.insert(initializer, Account::new(100_000_000, 0, &SYSTEM_PROGRAM));
    let store = Pubkey::find_program_address(&[b"OFT", initializer.as_ref()], &program_id()).0;
    let result = h.ok(&[init_ix(&h, initializer, TOKEN_DECIMALS - 2, OftType::BurnMint)]);
    let fee_deposit_set = result
        .inner_instructions
        .iter()
        .flatten()
        .find(|inner| {
            inner.instruction.data.get(8..16)
                == Some(console_oft::events::FeeDepositSet::DISCRIMINATOR)
        })
        .expect("init emits FeeDepositSet");
    assert_event(
        &fee_deposit_set.instruction.data,
        console_oft::events::FeeDepositSet {
            oft_store: to_program_pubkey(&store),
            fee_deposit: to_program_pubkey(&h.f.fee_deposit),
        },
    );

    let state: OFTStore = read_account(&h.f.context, &store);
    assert_eq!(state.ld2sd_rate, 100);
    assert_eq!(state.token_mint, to_program_pubkey(&h.f.token_mint));
    assert_eq!(state.token_program, to_program_pubkey(&h.token_program));
    assert_eq!(state.current_default_admin, to_program_pubkey(&h.f.admin));
    assert_eq!(state.fee_deposit, to_program_pubkey(&h.f.fee_deposit));
    assert_eq!(h.token(oft_escrow_pda(&store)).owner, store);
    assert!(!h.account(rate_limit_pda(&store, 0)).data.is_empty());
    assert!(!h
        .account(role_member_pda(&store, OftRole::DefaultAdmin, &h.f.admin))
        .data
        .is_empty());
    let registry: endpoint::accounts::OAppRegistry =
        read_account(&h.f.context, &oapp_registry(store));
    assert_eq!(registry.delegate, to_program_pubkey(&h.f.admin));
}

fn fresh_initializer(h: &Harness) -> (Pubkey, Pubkey) {
    let initializer = Pubkey::new_unique();
    h.f.insert(initializer, Account::new(100_000_000, 0, &SYSTEM_PROGRAM));
    (initializer, Pubkey::find_program_address(&[b"OFT", initializer.as_ref()], &program_id()).0)
}

/// Anchor's `token::` `init` sized the escrow through anchor-spl's Token-2022 interface 2.x, which
/// rejects the PermissionedBurn extension with `InvalidAccountData`, so no PB mint could get an
/// OFT. The escrow is sized with the program's own interface instead.
#[test]
fn init_creates_the_escrow_for_a_permissioned_burn_mint_in_both_custody_modes() {
    for oft_type in [OftType::BurnMint, OftType::LockUnlock] {
        let h = Harness::with_pb(false, false, true);
        let mint = h.account(h.f.token_mint);
        let extensions = StateWithExtensions::<Mint>::unpack(&mint.data)
            .unwrap()
            .get_extension_types()
            .unwrap();
        assert!(extensions.contains(&ExtensionType::PermissionedBurn));
        let (initializer, store) = fresh_initializer(&h);
        h.ok(&[init_ix(&h, initializer, TOKEN_DECIMALS - 2, oft_type)]);
        let escrow = h.token(oft_escrow_pda(&store));
        assert_eq!((escrow.mint, escrow.owner), (h.f.token_mint, store));
    }
}

/// Anyone can send lamports to the escrow's address before init; like Anchor's `init`, creation
/// tops it up to rent exemption instead of failing.
#[test]
fn init_creates_the_escrow_at_a_prefunded_address() {
    let h = Harness::new(false, false);
    let (initializer, store) = fresh_initializer(&h);
    let escrow = oft_escrow_pda(&store);
    h.f.insert(escrow, Account::new(1, 0, &SYSTEM_PROGRAM));
    h.ok(&[init_ix(&h, initializer, TOKEN_DECIMALS - 2, OftType::BurnMint)]);
    assert_eq!(h.token(escrow).owner, store);
    let account = h.account(escrow);
    assert_eq!(account.owner, h.token_program);
    assert!(
        account.lamports >= h.f.context.mollusk.sysvars.rent.minimum_balance(account.data.len())
    );
}

#[test]
fn init_rejects_a_frozen_fee_deposit_and_rolls_back_every_created_account() {
    let h = Harness::new(false, false);
    let initializer = Pubkey::new_unique();
    h.f.insert(initializer, Account::new(100_000_000, 0, &SYSTEM_PROGRAM));
    let store = Pubkey::find_program_address(&[b"OFT", initializer.as_ref()], &program_id()).0;
    let escrow = oft_escrow_pda(&store);
    let limiter = rate_limit_pda(&store, 0);
    let admin_role =
        role_member_pda(&store, console_oft::state::RoleType::DefaultAdmin, &h.f.admin);
    h.ok(&[token::freeze_account(
        &h.token_program,
        &h.f.fee_deposit,
        &h.f.token_mint,
        &h.f.admin,
        &[],
    )
    .unwrap()]);
    let instruction = ix(
        console_oft::ID,
        console_oft::accounts::InitConsoleOFT {
            payer: to_program_pubkey(&h.f.payer),
            initializer: to_program_pubkey(&initializer),
            oft_store: to_program_pubkey(&store),
            default_rate_limit: to_program_pubkey(&limiter),
            token_mint: to_program_pubkey(&h.f.token_mint),
            oft_escrow: to_program_pubkey(&escrow),
            fee_deposit: to_program_pubkey(&h.f.fee_deposit),
            token_program: to_program_pubkey(&h.token_program),
            system_program: Default::default(),
            admin_role_member: to_program_pubkey(&admin_role),
            event_authority: to_program_pubkey(&event(program_id())),
            program: console_oft::ID,
        },
        console_oft::instruction::InitConsoleOft {
            params: console_oft::instructions::InitConsoleOFTParams {
                oft_type: ::oft::types::OftType::BurnMint,
                admin: to_program_pubkey(&h.f.admin),
                shared_decimals: TOKEN_DECIMALS,
            },
        },
    );
    assert_eq!(
        h.run(&[instruction]).program_result,
        TransactionProgramResult::Failure(
            0,
            ProgramError::Custom(console_oft::errors::OFTError::FeeDepositFrozen.into())
        )
    );
    for address in [store, escrow, limiter, admin_role] {
        assert!(h.account(address).data.is_empty());
    }
}

/// The OFT's selection is the admin's choice alone: keeping it the same as the policy the mint's
/// hook and ACL gate bind is operational, not enforced here. A same-mint copy models another
/// policy, which could as well live under a newer policy program.
#[test]
fn the_admin_selects_a_policy_without_matching_the_hook_or_acl_gate() {
    for (acl, hook) in [(false, true), (true, false)] {
        let h = Harness::new(acl, hook);
        let other = Pubkey::new_unique();
        let copy = h.account(h.pubkey_policy);
        h.f.insert(other, copy);
        h.ok(&[set_policy(&h, Some(other))]);
        assert_eq!(h.f.store().pubkey_policy, Some(to_program_pubkey(&other)));
    }
}

fn channel_signer(h: &Harness, role: OftRole) -> Pubkey {
    let who = Pubkey::new_unique();
    h.f.insert(who, Account::new(100_000_000, 0, &SYSTEM_PROGRAM));
    for other in ALL_ROLES.into_iter().filter(|other| *other != role) {
        h.f.grant(other, who);
    }
    who
}

fn clear_ix(h: &Harness, authority: Pubkey) -> Instruction {
    let p = h.params();
    let mut instruction = ix(
        console_oft::ID,
        console_oft::accounts::StdClear {
            authority: to_program_pubkey(&authority),
            oapp: to_program_pubkey(&h.f.oft_store),
            role_member: to_program_pubkey(&role_member_pda(
                &h.f.oft_store,
                OftRole::MessagingChannelManager,
                &authority,
            )),
        },
        console_oft::instruction::Clear {
            params: oapp::types::ClearParams {
                src_eid: p.src_eid,
                sender: p.sender,
                nonce: p.nonce,
                guid: p.guid,
                message: p.message.clone(),
            },
        },
    );
    instruction
        .accounts
        .extend(h.metas(&oapp::lz_receive_types_v3::get_accounts_for_clear(
            endpoint::ID,
            &to_program_pubkey(&h.f.oft_store),
            p.src_eid,
            &p.sender,
            p.nonce,
        )));
    instruction
}

fn nilify_ix(h: &Harness, authority: Pubkey) -> Instruction {
    let p = h.params();
    let endpoint_id = host(endpoint::ID);
    let channel = |seed: &[u8]| {
        Pubkey::find_program_address(
            &[seed, h.f.oft_store.as_ref(), &p.src_eid.to_be_bytes(), &p.sender],
            &endpoint_id,
        )
    };
    let (pending, bump) = channel(b"PendingNonce");
    h.seed(pending, endpoint::accounts::PendingInboundNonce { nonces: vec![], bump });
    let mut instruction = ix(
        console_oft::ID,
        console_oft::accounts::StdNilify {
            authority: to_program_pubkey(&authority),
            oapp: to_program_pubkey(&h.f.oft_store),
            role_member: to_program_pubkey(&role_member_pda(
                &h.f.oft_store,
                OftRole::MessageNilifier,
                &authority,
            )),
        },
        console_oft::instruction::Nilify {
            params: oapp::types::NilifyParams {
                src_eid: p.src_eid,
                sender: p.sender,
                nonce: p.nonce,
                payload_hash: solana_keccak_hasher::hashv(&[&p.guid, &p.message]).to_bytes(),
            },
        },
    );
    // `endpoint_cpi::nilify` order.
    instruction.accounts.extend([
        AccountMeta::new_readonly(endpoint_id, false),
        AccountMeta::new_readonly(h.f.oft_store, false),
        AccountMeta::new_readonly(oapp_registry(h.f.oft_store), false),
        AccountMeta::new(channel(b"Nonce").0, false),
        AccountMeta::new(pending, false),
        AccountMeta::new(h.payload(), false),
        AccountMeta::new_readonly(event(endpoint_id), false),
        AccountMeta::new_readonly(endpoint_id, false),
    ]);
    instruction
}

/// EVM `MessagingChannelManager` and `MessageNilifier` are separate roles: each operation is
/// refused to a signer holding every other OFT role, and leaves the verified payload untouched.
#[test]
fn clear_and_nilify_each_require_their_own_messaging_channel_role() {
    for (name, role, build) in [
        (
            "clear",
            OftRole::MessagingChannelManager,
            clear_ix as fn(&Harness, Pubkey) -> Instruction,
        ),
        ("nilify", OftRole::MessageNilifier, nilify_ix),
    ] {
        let h = Harness::new(false, false);
        h.verify();
        let who = channel_signer(&h, role);
        let payload = h.account(h.payload());
        assert_eq!(
            h.run(&[build(&h, who)]).program_result,
            failure(anchor_lang::error::ErrorCode::AccountNotInitialized),
            "{name} accepted a signer without its role"
        );
        assert_eq!(h.account(h.payload()), payload);

        h.f.grant(role, who);
        h.ok(&[build(&h, who)]);
        let after = h.account(h.payload());
        if role == OftRole::MessagingChannelManager {
            assert!(after.data.is_empty(), "clear consumes the payload");
        } else {
            let hash: endpoint::accounts::PayloadHash = read_account(&h.f.context, &h.payload());
            assert_eq!(hash.hash, [0xff; 32], "nilify marks the payload NIL");
        }
    }
}

/// EVM `OAppCoreRBACUpgradeable`: accepting the default-admin transfer also moves the Endpoint
/// delegate, so the new admin can manage the messaging channel directly.
#[test]
fn accepting_the_default_admin_transfer_moves_the_endpoint_delegate() {
    let h = Harness::new(false, false);
    h.verify(); // seeds the OApp registry with the admin as delegate
    let (old, new) = (h.f.admin, h.f.user);
    let endpoint_id = host(endpoint::ID);
    let mut accept = ix(
        console_oft::ID,
        console_oft::accounts::StdAcceptDefaultAdminTransfer {
            authority: to_program_pubkey(&new),
            payer: to_program_pubkey(&h.f.payer),
            default_admin: to_program_pubkey(&h.f.oft_store),
            old_admin_role_member: to_program_pubkey(&role_member_pda(
                &h.f.oft_store,
                OftRole::DefaultAdmin,
                &old,
            )),
            new_admin_role_member: to_program_pubkey(&role_member_pda(
                &h.f.oft_store,
                OftRole::DefaultAdmin,
                &new,
            )),
            system_program: Default::default(),
            event_authority: to_program_pubkey(&event(program_id())),
            program: console_oft::ID,
        },
        console_oft::instruction::AcceptDefaultAdminTransfer {},
    );
    // `endpoint_cpi::set_delegate` order.
    accept.accounts.extend([
        AccountMeta::new_readonly(endpoint_id, false),
        AccountMeta::new_readonly(h.f.oft_store, false),
        AccountMeta::new(oapp_registry(h.f.oft_store), false),
        AccountMeta::new_readonly(event(endpoint_id), false),
        AccountMeta::new_readonly(endpoint_id, false),
    ]);
    h.ok(&[
        ix(
            console_oft::ID,
            console_oft::accounts::StdBeginDefaultAdminTransfer {
                authority: to_program_pubkey(&old),
                default_admin: to_program_pubkey(&h.f.oft_store),
                event_authority: to_program_pubkey(&event(program_id())),
                program: console_oft::ID,
            },
            console_oft::instruction::BeginDefaultAdminTransfer { params: to_program_pubkey(&new) },
        ),
        accept,
    ]);
    assert_eq!(h.f.store().current_default_admin, to_program_pubkey(&new));
    let registry: endpoint::accounts::OAppRegistry =
        read_account(&h.f.context, &oapp_registry(h.f.oft_store));
    assert_eq!(registry.delegate, to_program_pubkey(&new));
}
