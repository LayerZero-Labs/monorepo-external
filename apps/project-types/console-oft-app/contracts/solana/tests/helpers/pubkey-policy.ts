/**
 * The pubkey-policy oracle (a per-(mint, initializer) blacklist/whitelist) and the optional
 * pubkey-policy transfer hook that enforces it on every Token-2022 transfer. The OFT
 * (`set_pubkey_policy`), the Token ACL gate (`init_acl`) and the hook (`init_transfer_hook`) each bind
 * a policy by address. Nothing checks that they agree; operators keep them on the same policy.
 */

import {
    type Instruction,
    type PublicKey,
    publicKey,
    publicKeyBytes,
} from '@metaplex-foundation/umi';
import { fromWeb3JsPublicKey, toWeb3JsPublicKey } from '@metaplex-foundation/umi-web3js-adapters';
import { getExtraAccountMetaAddress } from '@solana/spl-token';

import * as policyInstructions from '../../build/pubkey_policy/instructions';
import { PUBKEY_POLICY_PROGRAM_ID } from '../../build/pubkey_policy/programs';
import {
    PubkeyPolicyMode,
    RoleType as PubkeyPolicyRoleType,
} from '../../build/pubkey_policy/types';
import { PUBKEY_POLICY_HOOK_PROGRAM_ID } from '../../build/pubkey_policy_hook/programs';
import { EDDSA } from '../constants';
import type { OftFixture } from './fixture';
import { sendV1 } from './transaction-v1';

export { PUBKEY_POLICY_HOOK_PROGRAM_ID, PUBKEY_POLICY_PROGRAM_ID, PubkeyPolicyMode };

const seed = (text: string) => Uint8Array.from(Buffer.from(text, 'utf8'));
const eventAuthority = (program: PublicKey) =>
    EDDSA.findPda(program, [seed('__event_authority')])[0];

const pubkeyPolicyPda = (mint: PublicKey, initializer: PublicKey): PublicKey =>
    EDDSA.findPda(PUBKEY_POLICY_PROGRAM_ID, [
        seed('pubkey_policy'),
        publicKeyBytes(mint),
        publicKeyBytes(initializer),
    ])[0];

/** Canonical membership record for (policy, subject); absent means "no membership". */
const subjectRecord = (policy: PublicKey, subject: PublicKey): PublicKey =>
    EDDSA.findPda(PUBKEY_POLICY_PROGRAM_ID, [
        seed('subject'),
        publicKeyBytes(policy),
        publicKeyBytes(subject),
    ])[0];

const policyRoleMember = (policy: PublicKey, role: PubkeyPolicyRoleType, member: PublicKey) =>
    EDDSA.findPda(PUBKEY_POLICY_PROGRAM_ID, [
        seed('RoleMember'),
        publicKeyBytes(policy),
        Uint8Array.from([role]),
        publicKeyBytes(member),
    ])[0];

/** `oft.admin` creates the mint's policy in `mode` and holds DefaultAdmin and Blacklister on it. */
export async function createPubkeyPolicy(
    oft: OftFixture,
    mode: PubkeyPolicyMode,
): Promise<PublicKey> {
    const { umi, admin, mint } = oft;
    const policy = pubkeyPolicyPda(mint, admin.publicKey);
    const adminRoleMember = policyRoleMember(
        policy,
        PubkeyPolicyRoleType.DefaultAdmin,
        admin.publicKey,
    );
    await sendV1(oft.connection, admin, [
        policyInstructions.initPubkeyPolicy(umi, {
            payer: admin,
            initializer: admin,
            policy,
            adminRoleMember,
            eventAuthority: eventAuthority(PUBKEY_POLICY_PROGRAM_ID),
            program: PUBKEY_POLICY_PROGRAM_ID,
            mint,
            admin: admin.publicKey,
            mode,
        }),
        policyInstructions.grantRole(umi, {
            authority: admin,
            payer: admin,
            defaultAdmin: policy,
            roleAdminMember: adminRoleMember,
            roleMember: policyRoleMember(policy, PubkeyPolicyRoleType.Blacklister, admin.publicKey),
            eventAuthority: eventAuthority(PUBKEY_POLICY_PROGRAM_ID),
            program: PUBKEY_POLICY_PROGRAM_ID,
            role: PubkeyPolicyRoleType.Blacklister,
            account: admin.publicKey,
        }),
    ]);
    return policy;
}

export const setSubjectBlacklisted = (
    oft: OftFixture,
    policy: PublicKey,
    subject: PublicKey,
    blacklisted: boolean,
) =>
    sendV1(oft.connection, oft.admin, [
        policyInstructions.setBlacklisted(oft.umi, {
            payer: oft.admin,
            authority: oft.admin,
            policy,
            record: subjectRecord(policy, subject),
            roleMember: policyRoleMember(
                policy,
                PubkeyPolicyRoleType.Blacklister,
                oft.admin.publicKey,
            ),
            eventAuthority: eventAuthority(PUBKEY_POLICY_PROGRAM_ID),
            program: PUBKEY_POLICY_PROGRAM_ID,
            subject,
            blacklisted,
        }),
    ]);

/** The mint's hook manifest (SPL ExtraAccountMetaList) under the pubkey-policy hook. */
export const hookManifest = (mint: PublicKey): PublicKey =>
    fromWeb3JsPublicKey(
        getExtraAccountMetaAddress(
            toWeb3JsPublicKey(mint),
            toWeb3JsPublicKey(PUBKEY_POLICY_HOOK_PROGRAM_ID),
        ),
    );

/**
 * `pubkey_policy_hook::init_transfer_hook`: write the mint's manifest binding `policy`. The hook has no
 * generated client in this package, so the instruction is built from its IDL (no arguments).
 * `authority` must be the mint's transfer-hook authority.
 */
export function initTransferHookInstruction(oft: OftFixture, policy: PublicKey): Instruction {
    const { admin, mint } = oft;
    const meta = (pubkey: PublicKey, isSigner: boolean, isWritable: boolean) => ({
        pubkey,
        isSigner,
        isWritable,
    });
    return {
        programId: PUBKEY_POLICY_HOOK_PROGRAM_ID,
        keys: [
            meta(admin.publicKey, true, true), // payer
            meta(admin.publicKey, true, false), // authority
            meta(mint, false, false),
            meta(policy, false, false),
            meta(hookManifest(mint), false, true),
            meta(publicKey('11111111111111111111111111111111'), false, false),
            meta(eventAuthority(PUBKEY_POLICY_HOOK_PROGRAM_ID), false, false),
            meta(PUBKEY_POLICY_HOOK_PROGRAM_ID, false, false),
        ],
        data: Uint8Array.from([120, 26, 210, 65, 12, 71, 129, 188]),
    };
}
