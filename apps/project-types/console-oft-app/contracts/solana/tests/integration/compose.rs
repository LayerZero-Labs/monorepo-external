//! COMPOSE: a composer plans and executes its own `lz_compose` with the OFT's exported hook and
//! ACL-activation helpers.

use crate::harness::*;

impl Harness {
    /// Run the forwarding composer's planner over an OFT-shaped compose payload whose tail
    /// names `final_recipient`.
    pub(crate) fn compose_plan(
        &self,
        store: Pubkey,
        composer_ata: Pubkey,
        final_recipient: Pubkey,
    ) -> oapp::lz_compose_types_v3::LzComposeTypesV3Result {
        let instruction = self.compose_planner(store, composer_ata, final_recipient);
        let plan_out = instruction.accounts[1].pubkey;
        let result = self.f.context.process_instruction(&instruction);
        assert!(result.program_result.is_ok(), "compose planner: {:?}", result.program_result);
        let required: u32 = decode_return(&result.return_data);
        let account = &result.resulting_accounts.iter().find(|(k, _)| k == &plan_out).unwrap().1;
        AnchorDeserialize::deserialize(&mut &account.data[..required as usize]).unwrap()
    }

    pub(crate) fn compose_planner(
        &self,
        store: Pubkey,
        composer_ata: Pubkey,
        final_recipient: Pubkey,
    ) -> Instruction {
        let params = self.forwarding_params(store, final_recipient);
        let plan_out = Pubkey::new_from_array([0x9f; 32]);
        let types_account = Pubkey::find_program_address(
            &[oapp::LZ_COMPOSE_TYPES_SEED, store.as_ref()],
            &host(forwarding_composer::ID),
        )
        .0;
        let info = ix(
            forwarding_composer::ID,
            forwarding_composer::accounts::LzComposeTypesInfo {
                composer_store: to_program_pubkey(&store),
                lz_compose_types_accounts: to_program_pubkey(&types_account),
                token_mint: to_program_pubkey(&self.f.token_mint),
            },
            forwarding_composer::instruction::LzComposeTypesInfo { params: params.clone() },
        );
        for meta in &info.accounts {
            self.f.context.account_store.borrow_mut().entry(meta.pubkey).or_default();
        }
        let result = self.f.context.process_instruction(&info);
        assert!(result.program_result.is_ok(), "compose info: {:?}", result.program_result);
        let (version, inputs): (u8, oapp::lz_compose_types_v3::LzComposeTypesV3Accounts) =
            decode_return(&result.return_data);
        assert_eq!(version, oapp::lz_compose_types_v3::LZ_COMPOSE_TYPES_VERSION);
        assert_eq!(host(inputs.accounts[2]), composer_ata);
        let mut accounts =
            vec![AccountMeta::new(self.f.payer, true), AccountMeta::new(plan_out, true)];
        accounts.extend(
            inputs
                .accounts
                .into_iter()
                .map(|key| AccountMeta::new_readonly(host(key), false)),
        );
        let instruction = Instruction {
            program_id: host(forwarding_composer::ID),
            accounts,
            data: forwarding_composer::instruction::LzComposeTypesV3 { params }.data(),
        };
        for meta in &instruction.accounts {
            self.f.context.account_store.borrow_mut().entry(meta.pubkey).or_default();
        }
        self.f
            .context
            .account_store
            .borrow_mut()
            .insert(plan_out, scratch_account(host(forwarding_composer::ID), PLAN_SCRATCH_BYTES));
        instruction
    }

    pub(crate) fn forwarding_params(
        &self,
        store: Pubkey,
        recipient: Pubkey,
    ) -> oapp::types::LzComposeParams {
        let mut message = console_oft::codec::compose_msg::encode(
            1, DST_EID, 1_000, &[0u8; 32], // compose_from
        );
        message.extend_from_slice(recipient.as_ref());
        let guid = self.params().guid;
        oapp::types::LzComposeParams {
            from: to_program_pubkey(&self.f.oft_store),
            to: to_program_pubkey(&store),
            guid,
            index: 0,
            message,
            extra_data: vec![],
        }
    }
}

/// A composer that forwards what it received plans its own activation of a destination the OFT
/// knows nothing about: create + thaw on an ACL mint, hook groups resolved against the new account,
/// and its own screening, which alone stops a blocked final recipient whose account is already
/// thawed. The token-program and ACL axes are the ones that change the executed path.
#[test]
fn composer_forwards_to_a_new_destination_it_activates_itself() {
    for (program, acl, hook) in [
        (token2022::ID, true, true),
        (token2022::ID, true, false),
        (mollusk_svm_programs_token::token::ID, false, false),
    ] {
        let h = Harness::with_token_program(program, acl, hook, false);
        let final_recipient = Pubkey::new_unique();
        let (store, bump) = Pubkey::find_program_address(
            &[forwarding_composer::COMPOSER_SEED],
            &host(forwarding_composer::ID),
        );
        let ata = |owner: &Pubkey| {
            spl_associated_token_account_interface::address::get_associated_token_address_with_program_id(
                owner,
                &h.f.token_mint,
                &h.token_program,
            )
        };
        let composer_ata = ata(&store);
        let mut data = vec![];
        forwarding_composer::ComposerStore {
            token_mint: to_program_pubkey(&h.f.token_mint),
            pubkey_policy: to_program_pubkey(&h.pubkey_policy),
            oft_store: to_program_pubkey(&h.f.oft_store),
            forwarded_count: 0,
            bump,
        }
        .try_serialize(&mut data)
        .unwrap();
        h.f.insert(
            store,
            Account { data, ..Account::new(10_000_000, 0, &host(forwarding_composer::ID)) },
        );
        h.open_token_account(composer_ata, store);
        if acl {
            h.ok(&[h.thaw_for(composer_ata, store)]);
        }
        h.credit(composer_ata, 1_000); // stands in for the first hop's credit

        let plan = h.compose_plan(store, composer_ata, final_recipient);
        let [oapp::lz_compose_types_v3::ComposeInstruction::LzCompose { accounts }] =
            &plan.instructions[..]
        else {
            panic!("the composer activates its destination inside its single lz_compose")
        };
        let params = h.forwarding_params(store, final_recipient);
        let (compose_state, bump) = Pubkey::find_program_address(
            &[
                b"ComposedMessageHash",
                h.f.oft_store.as_ref(),
                store.as_ref(),
                &params.guid,
                &params.index.to_be_bytes(),
                &solana_keccak_hasher::hash(&params.message).to_bytes(),
            ],
            &host(endpoint::ID),
        );
        h.seed(compose_state, endpoint::accounts::ComposeMessageState { received: false, bump });
        let compose = |from| Instruction {
            program_id: host(forwarding_composer::ID),
            accounts: h.metas(accounts),
            data: forwarding_composer::instruction::LzCompose {
                params: oapp::types::LzComposeParams { from, ..params.clone() },
            }
            .data(),
        };
        // Anyone can queue a compose message; the composer acts only on its own OFT's.
        assert_eq!(
            h.run(&[compose(to_program_pubkey(&Pubkey::new_unique()))]).program_result,
            failure(forwarding_composer::ComposerError::UntrustedSender)
        );
        let compose = compose(params.from);

        let destination = ata(&final_recipient);
        let prethawed = acl && !hook;
        if prethawed {
            h.ok(&[
                spl_associated_token_account_interface::instruction::create_associated_token_account_idempotent(
                    &h.f.payer,
                    &final_recipient,
                    &h.f.token_mint,
                    &h.token_program,
                ),
                h.thaw_for(destination, final_recipient),
            ]);
            h.ok(&[h.membership(final_recipient, false, true)]);
            assert_eq!(
                h.run(std::slice::from_ref(&compose)).program_result,
                failure(forwarding_composer::ComposerError::RecipientBlocked)
            );
            assert_eq!((h.token(composer_ata).amount, h.token(destination).amount), (1_000, 0));
            h.ok(&[h.membership(final_recipient, false, false)]);
        }
        let result = h.ok(&[compose]);
        h.assert_inline_thaw(&result, acl && !prethawed);
        assert_eq!(h.token(destination).state, AccountState::Initialized);
        assert_eq!((h.token(destination).amount, h.token(composer_ata).amount), (1_000, 0));
        assert!(
            read_account::<endpoint::accounts::ComposeMessageState>(&h.f.context, &compose_state)
                .received
        );
    }
}
