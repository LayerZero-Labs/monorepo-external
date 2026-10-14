/**
 * The largest supported receive configuration on a live validator: a Token-2022 BurnMint OFT whose
 * mint is governed by canonical Token ACL (DefaultAccountState = Frozen, `token_manager` gate),
 * enforces the pubkey-policy transfer hook, has credit redirect configured, and receives a
 * send-and-call. `lz_receive_types_v3` must plan the whole delivery (create the recipient's ATA,
 * thaw it through ACL, credit it or redirect, enqueue the compose message) as one lz_receive that
 * the Executor submits as a single Transaction V1 without address lookup tables.
 *
 * The Rust integration suite covers these branches in Mollusk; this is the live-runtime proof
 * that the maximal plan fits and executes as Transaction V1.
 */

import { generateSigner, type PublicKey } from '@metaplex-foundation/umi';
import { AccountState } from '@solana/spl-token';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { types } from '../sdk/oft';
import { endpoint, OFT_PROGRAM_ID } from './constants';
import {
    createOftFixture,
    createTokenAccount,
    mintTo,
    type OftFixture,
    setCreditRedirect,
} from './helpers/fixture';
import {
    composedAmountLd,
    composeSentEvent,
    creditRedirectedEvent,
    events,
    oftReceivedEvent,
    receive,
    send,
    verifyAndCommit,
} from './helpers/oft';
import { aclPrograms, oftPrograms } from './helpers/programs';
import {
    createPubkeyPolicy,
    initTransferHookInstruction,
    PUBKEY_POLICY_HOOK_PROGRAM_ID,
    PubkeyPolicyMode,
    setSubjectBlacklisted,
} from './helpers/pubkey-policy';
import { createInfraEnv, type InfraEnv } from './helpers/test-env';
import { ata, balance, tokenAccount } from './helpers/token';
import { governWithCanonicalAcl, selectPubkeyPolicy } from './helpers/token-manager';
import { fetchV1Transaction, sendV1 } from './helpers/transaction-v1';

const AMOUNT = 1_000_000n;
const COMPOSE_MSG = Uint8Array.from([0xc0, 0xde]);

describe('largest receive plan: canonical ACL + pubkey-policy hook + compose + credit redirect', () => {
    let env: InfraEnv;
    let oft: OftFixture;
    let policy: PublicKey;
    let redirectEscrow: PublicKey;

    beforeAll(async () => {
        env = await createInfraEnv({ programs: [...oftPrograms(), ...aclPrograms()] });
        oft = await createOftFixture(env, {
            name: 'acl-hook',
            tokenProgram: 'token2022',
            oftType: types.OftType.BurnMint,
            // Initialized for now: accounts that must stay usable are created before ACL governs.
            extensions: {
                defaultAccountState: AccountState.Initialized,
                transferHook: PUBKEY_POLICY_HOOK_PROGRAM_ID,
            },
        });
        await mintTo(oft, oft.admin.publicKey, 10n * AMOUNT);
        redirectEscrow = await createTokenAccount(oft, generateSigner(env.umi).publicKey);

        policy = await createPubkeyPolicy(oft, PubkeyPolicyMode.Blacklist);
        await governWithCanonicalAcl(oft, policy); // DefaultAccountState is Frozen from here on.
        await sendV1(env.connection, oft.admin, [initTransferHookInstruction(oft, policy)]);
        await selectPubkeyPolicy(oft, policy);
        await setCreditRedirect(oft, redirectEscrow);
    });

    afterAll(() => env?.teardown());

    /** Send-and-call to a recipient that has never held the token, delivered by the Executor. */
    async function deliverToNewRecipient(recipient: PublicKey) {
        expect(
            await tokenAccount(
                env.connection,
                ata(oft.mint, recipient, oft.tokenProgram),
                oft.tokenProgram,
            ),
        ).toBeNull();
        const { packet } = await send(oft, oft.admin, recipient, AMOUNT, COMPOSE_MSG);
        await verifyAndCommit(env, packet);
        const { signature, instructionCount } = await receive(env, packet);
        const landed = await fetchV1Transaction(env.connection, signature);
        return { signature, instructionCount, landed };
    }

    it('creates, thaws and credits an eligible first-time recipient and records its compose in one V1 transaction', async () => {
        const recipient = generateSigner(env.umi).publicKey;

        const { signature, instructionCount, landed } = await deliverToNewRecipient(recipient);

        expect(instructionCount).toBe(3); // pre_execute, lz_receive, post_execute
        expect(landed.version).toBe(1);
        expect(landed.staticAccounts.length).toBeLessThanOrEqual(64);
        const created = await tokenAccount(
            env.connection,
            ata(oft.mint, recipient, oft.tokenProgram),
            oft.tokenProgram,
        );
        expect(created?.isFrozen).toBe(false);
        expect(created?.amount).toBe(AMOUNT);

        const [received] = await events(
            env.connection,
            signature,
            OFT_PROGRAM_ID,
            oftReceivedEvent,
        );
        expect(received).toMatchObject({ to: recipient, amountReceivedLd: AMOUNT });
        expect(
            await events(env.connection, signature, OFT_PROGRAM_ID, creditRedirectedEvent),
        ).toEqual([]);
        const [composed] = await events(
            env.connection,
            signature,
            endpoint.programId,
            composeSentEvent,
        );
        expect(composed).toMatchObject({ from: oft.oftStore, to: recipient });
        expect(composedAmountLd(composed)).toBe(AMOUNT);
    });

    it('redirects a blacklisted first-time recipient to the escrow and reports zero received and composed', async () => {
        const recipient = generateSigner(env.umi).publicKey;
        const recipientAta = ata(oft.mint, recipient, oft.tokenProgram);
        await setSubjectBlacklisted(oft, policy, recipient, true);
        const escrowBefore = await balance(env.connection, redirectEscrow, oft.tokenProgram);

        const { signature, instructionCount, landed } = await deliverToNewRecipient(recipient);

        expect(instructionCount).toBe(3);
        expect(landed.version).toBe(1);
        expect(landed.staticAccounts.length).toBeLessThanOrEqual(64);
        // lz_receive created the ATA, declined to thaw it, and credited the redirect escrow.
        const created = await tokenAccount(env.connection, recipientAta, oft.tokenProgram);
        expect(created?.isFrozen).toBe(true);
        expect(created?.amount).toBe(0n);
        expect(await balance(env.connection, redirectEscrow, oft.tokenProgram)).toBe(
            escrowBefore + AMOUNT,
        );

        const [redirected] = await events(
            env.connection,
            signature,
            OFT_PROGRAM_ID,
            creditRedirectedEvent,
        );
        expect(redirected).toMatchObject({
            oftStore: oft.oftStore,
            recipient,
            tokenDest: recipientAta,
            redirectEscrow,
            amountLd: AMOUNT,
        });
        const [received] = await events(
            env.connection,
            signature,
            OFT_PROGRAM_ID,
            oftReceivedEvent,
        );
        expect(received).toMatchObject({ to: recipient, amountReceivedLd: 0n });
        const [composed] = await events(
            env.connection,
            signature,
            endpoint.programId,
            composeSentEvent,
        );
        expect(composed).toMatchObject({ from: oft.oftStore, to: recipient });
        expect(composedAmountLd(composed)).toBe(0n);
    });
});
