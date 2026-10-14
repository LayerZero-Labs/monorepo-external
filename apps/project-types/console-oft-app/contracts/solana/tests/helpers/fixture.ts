/**
 * The one OFT fixture every validator test starts from.
 *
 * A fixture is a fresh mint plus an initialized OFTStore wired to the base snapshot's LayerZero
 * protocol as a loopback pathway: the store is its own peer on DST_EID (outbound) and SRC_EID
 * (inbound), so a packet it sends can be verified, committed and received back on the same
 * validator. Fixtures are independent: each call derives its own keys from `name`, so several can
 * share one validator, and nothing is cached between calls or files.
 *
 * Configuration is deliberately minimal and identical for every token backend:
 * - `admin` is DefaultAdmin, Endpoint delegate, RateLimiterManager, mint co-authority (1-of-2
 *   multisig with the OFT store), freeze authority and transfer-hook authority.
 * - The rate limiter uses the global (id 0) state and is globally disabled: the program's default
 *   config has zero limits, so an unconfigured limiter would reject every transfer.
 * - No enforced options, fees or pause state: the caller's options are the message options.
 */

import {
    generateSigner,
    type KeypairSigner,
    type PublicKey,
    publicKeyBytes,
    sol,
    type Umi,
} from '@metaplex-foundation/umi';
import type { Connection } from '@solana/web3.js';

import { createSignerFromSeed, type InfraEnv } from '@layerzerolabs/test-utils-solana';

import { instructions, OftPda, types } from '../../sdk/oft';
import { DST_EID, EDDSA, endpoint, OFT_DECIMALS, OFT_PROGRAM_ID, SRC_EID } from '../constants';
import {
    ata,
    createAtaInstruction,
    createMint,
    type MintExtensions,
    mintToInstructions,
    type TokenProgram,
    tokenProgramId,
} from './token';
import { sendV1 } from './transaction-v1';

export interface OftFixture {
    umi: Umi;
    connection: Connection;
    pda: OftPda;
    tokenProgram: PublicKey;
    mint: PublicKey;
    /** 1-of-2 native multisig of `oftStore` and `admin`. */
    mintAuthority: PublicKey;
    oftStore: PublicKey;
    escrow: PublicKey;
    feeDeposit: PublicKey;
    admin: KeypairSigner;
}

export async function createOftFixture(
    { umi, connection }: InfraEnv,
    {
        name,
        tokenProgram,
        oftType,
        extensions,
    }: {
        name: string;
        tokenProgram: TokenProgram;
        oftType: types.OftType;
        extensions?: MintExtensions;
    },
): Promise<OftFixture> {
    const admin = createSignerFromSeed(`${name}-admin`);
    const initializer = createSignerFromSeed(`${name}-initializer`);
    const feeCollector = createSignerFromSeed(`${name}-fee-collector`);
    const mint = generateSigner({ eddsa: EDDSA });
    const multisig = generateSigner({ eddsa: EDDSA });
    const pda = new OftPda(OFT_PROGRAM_ID);
    const [oftStore] = pda.oftStore(initializer.publicKey);
    const [escrow] = pda.oftEscrow(oftStore);
    const programId = tokenProgramId(tokenProgram);
    await umi.rpc.airdrop(admin.publicKey, sol(100));

    await createMint(
        connection,
        admin,
        { mint, multisig, oftStore },
        tokenProgram,
        OFT_DECIMALS,
        extensions,
    );
    const feeDeposit = ata(mint.publicKey, feeCollector.publicKey, programId);
    await sendV1(connection, admin, [
        createAtaInstruction(admin.publicKey, mint.publicKey, feeCollector.publicKey, programId),
    ]);

    const adminRoleMember = pda.roleMember(oftStore, types.RoleType.DefaultAdmin, admin.publicKey);
    await sendV1(
        connection,
        admin,
        [
            instructions
                .initConsoleOft(umi, {
                    payer: admin,
                    initializer,
                    oftStore,
                    defaultRateLimit: pda.rateLimit(oftStore, 0),
                    tokenMint: mint.publicKey,
                    oftEscrow: escrow,
                    feeDeposit,
                    tokenProgram: programId,
                    adminRoleMember,
                    eventAuthority: pda.eventAuthority(),
                    program: pda.programId,
                    oftType,
                    admin: admin.publicKey,
                    sharedDecimals: OFT_DECIMALS,
                })
                .addRemainingAccounts(
                    endpoint.getRegisterOappIxAccountMetaForCPI(admin.publicKey, oftStore),
                ),
        ],
        { signers: [initializer] },
    );

    // Endpoint pathway: default libraries (ULN from the snapshot) and nonces in both directions.
    await sendV1(connection, admin, [
        endpoint.initOAppSendLibrary(admin, { sender: oftStore, remote: DST_EID }),
        endpoint.initOAppReceiveLibrary(admin, { receiver: oftStore, remote: SRC_EID }),
        endpoint.initOAppNonce(admin, {
            localOApp: oftStore,
            remote: DST_EID,
            remoteOApp: publicKeyBytes(oftStore),
        }),
        endpoint.initOAppNonce(admin, {
            localOApp: oftStore,
            remote: SRC_EID,
            remoteOApp: publicKeyBytes(oftStore),
        }),
    ]);

    const eventAuthority = pda.eventAuthority();
    const rateLimiterManager = pda.roleMember(
        oftStore,
        types.RoleType.RateLimiterManager,
        admin.publicKey,
    );
    await sendV1(connection, admin, [
        instructions.grantRole(umi, {
            authority: admin,
            defaultAdmin: oftStore,
            roleAdminMember: adminRoleMember,
            roleMember: rateLimiterManager,
            eventAuthority,
            program: pda.programId,
            role: types.RoleType.RateLimiterManager,
            account: admin.publicKey,
        }),
        instructions.setRateLimitGlobalConfig(umi, {
            authority: admin,
            oftStore,
            roleMember: rateLimiterManager,
            eventAuthority,
            program: pda.programId,
            useGlobalState: true,
            isGloballyDisabled: true,
        }),
        ...[DST_EID, SRC_EID].map((eid) =>
            instructions.setPeer(
                umi,
                {
                    authority: admin,
                    oapp: oftStore,
                    peer: pda.peer(oftStore, eid),
                    roleMember: adminRoleMember,
                    eventAuthority,
                    program: pda.programId,
                },
                { eid, peer: publicKeyBytes(oftStore) },
            ),
        ),
    ]);

    return {
        umi,
        connection,
        pda,
        tokenProgram: programId,
        mint: mint.publicKey,
        mintAuthority: multisig.publicKey,
        oftStore,
        escrow,
        feeDeposit,
        admin,
    };
}

/** Mint `amount` to `owner`'s ATA through the admin's multisig membership. */
export const mintTo = (oft: OftFixture, owner: PublicKey, amount: bigint) =>
    sendV1(oft.connection, oft.admin, mintToInstructions(oft, oft.admin, owner, amount));

/** Create `owner`'s (thawed, unless the mint defaults to Frozen) ATA and return its address. */
export async function createTokenAccount(oft: OftFixture, owner: PublicKey): Promise<PublicKey> {
    await sendV1(oft.connection, oft.admin, [
        createAtaInstruction(oft.admin.publicKey, oft.mint, owner, oft.tokenProgram),
    ]);
    return ata(oft.mint, owner, oft.tokenProgram);
}

/** Point credit redirect at `redirectEscrow` (a token account of this mint, never the OFT escrow). */
export const setCreditRedirect = (oft: OftFixture, redirectEscrow: PublicKey) =>
    sendV1(oft.connection, oft.admin, [
        instructions.setCreditRedirectConfig(oft.umi, {
            authority: oft.admin,
            oftStore: oft.oftStore,
            tokenMint: oft.mint,
            redirectEscrow,
            roleMember: oft.pda.roleMember(
                oft.oftStore,
                types.RoleType.DefaultAdmin,
                oft.admin.publicKey,
            ),
            eventAuthority: oft.pda.eventAuthority(),
            program: oft.pda.programId,
        }),
    ]);
