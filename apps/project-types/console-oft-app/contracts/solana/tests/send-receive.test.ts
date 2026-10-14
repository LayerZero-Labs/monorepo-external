/**
 * Send → DVN verify + commit → Executor-planned receive, all Transaction V1 on a live validator,
 * once per distinct custody path. Program-level send/receive rules (pause, slippage, rate-limit
 * selection, exemptions, redirect routing) are covered by the Rust suites; these cases prove that the
 * real client account planning, Endpoint/ULN/DVN/Executor and token programs agree end to end.
 */

import { generateSigner, type PublicKey } from '@metaplex-foundation/umi';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { accounts, instructions, types } from '../sdk/oft';
import { OFT_PROGRAM_ID, SRC_EID } from './constants';
import { createOftFixture, mintTo, type OftFixture } from './helpers/fixture';
import { events, oftReceivedEvent, receive, send, verifyAndCommit } from './helpers/oft';
import { oftPrograms } from './helpers/programs';
import { createInfraEnv, type InfraEnv } from './helpers/test-env';
import { ata, balance, supply, tokenAccount } from './helpers/token';
import { sendV1 } from './helpers/transaction-v1';

const AMOUNT = 1_000_000n;

/**
 * Enable the global (id 0) limiter in both directions with net accounting. Windows are so long
 * relative to the limits that nothing decays during a test (decay = limit * elapsed / window
 * rounds to 0), so usage is exactly what send and receive wrote.
 */
async function enableNetAccounting(oft: OftFixture): Promise<void> {
    const roleMember = oft.pda.roleMember(
        oft.oftStore,
        types.RoleType.RateLimiterManager,
        oft.admin.publicKey,
    );
    const common = {
        authority: oft.admin,
        oftStore: oft.oftStore,
        roleMember,
        eventAuthority: oft.pda.eventAuthority(),
        program: oft.pda.programId,
    };
    await sendV1(oft.connection, oft.admin, [
        instructions.setRateLimitConfig(oft.umi, {
            ...common,
            rateLimit: oft.pda.rateLimit(oft.oftStore, 0),
            id: 0,
            config: {
                overrideDefaultConfig: false,
                outboundEnabled: true,
                inboundEnabled: true,
                netAccountingEnabled: true,
                addressExemptionEnabled: false,
                outboundLimit: 1_000_000_000n,
                inboundLimit: 1_000_000_000n,
                outboundWindow: 1_000_000_000_000_000n,
                inboundWindow: 1_000_000_000_000_000n,
            },
        }),
        instructions.setRateLimitGlobalConfig(oft.umi, {
            ...common,
            useGlobalState: true,
            isGloballyDisabled: false,
        }),
    ]);
}

const usage = async (oft: OftFixture) =>
    (await accounts.fetchRateLimit(oft.umi, oft.pda.rateLimit(oft.oftStore, 0))).state;

describe('send → receive round trip (Transaction V1)', () => {
    let env: InfraEnv;

    beforeAll(async () => {
        env = await createInfraEnv({ programs: oftPrograms() });
    });

    afterAll(() => env?.teardown());

    it.each([
        { name: 'spl-lock-unlock', tokenProgram: 'spl', oftType: types.OftType.LockUnlock },
        { name: 'spl-burn-mint', tokenProgram: 'spl', oftType: types.OftType.BurnMint },
        { name: 't22-burn-mint', tokenProgram: 'token2022', oftType: types.OftType.BurnMint },
    ] as const)(
        '$name: debits the sender, credits a first-time recipient, and nets the inflow against outbound usage',
        async ({ name, tokenProgram, oftType }) => {
            const oft = await createOftFixture(env, { name, tokenProgram, oftType });
            await enableNetAccounting(oft);
            await mintTo(oft, oft.admin.publicKey, AMOUNT);
            const source = ata(oft.mint, oft.admin.publicKey, oft.tokenProgram);
            const recipient: PublicKey = generateSigner(env.umi).publicKey;
            const recipientAta = ata(oft.mint, recipient, oft.tokenProgram);
            const lockUnlock = oftType === types.OftType.LockUnlock;
            const read = async () => ({
                source: await balance(env.connection, source, oft.tokenProgram),
                escrow: await balance(env.connection, oft.escrow, oft.tokenProgram),
                supply: await supply(env.connection, oft.mint, oft.tokenProgram),
            });
            const initial = await read();

            const { packet } = await send(oft, oft.admin, recipient, AMOUNT);

            const afterSend = await read();
            expect(afterSend.source).toBe(initial.source - AMOUNT);
            // LockUnlock holds the amount in escrow; BurnMint burns it from the escrow hop.
            expect(afterSend.escrow).toBe(lockUnlock ? initial.escrow + AMOUNT : initial.escrow);
            expect(afterSend.supply).toBe(lockUnlock ? initial.supply : initial.supply - AMOUNT);
            expect(await usage(oft)).toMatchObject({ outboundUsage: AMOUNT, inboundUsage: 0n });

            await verifyAndCommit(env, packet);
            expect(await tokenAccount(env.connection, recipientAta, oft.tokenProgram)).toBeNull();

            const { signature } = await receive(env, packet);

            const afterReceive = await read();
            expect(await balance(env.connection, recipientAta, oft.tokenProgram)).toBe(AMOUNT);
            expect(afterReceive.escrow).toBe(initial.escrow);
            expect(afterReceive.supply).toBe(initial.supply);
            const [received] = await events(
                env.connection,
                signature,
                OFT_PROGRAM_ID,
                oftReceivedEvent,
            );
            expect(received).toMatchObject({
                srcEid: SRC_EID,
                to: recipient,
                amountReceivedLd: AMOUNT,
                oftStore: oft.oftStore,
            });
            // Net accounting: the inflow is charged inbound and credited back against outbound.
            expect(await usage(oft)).toMatchObject({ outboundUsage: 0n, inboundUsage: AMOUNT });
        },
    );
});
