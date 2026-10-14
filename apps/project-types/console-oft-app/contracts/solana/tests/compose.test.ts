/**
 * Send-and-call on a live validator: the receive delivers to example_composer's store and enqueues
 * the compose message at the Endpoint; the Executor then plans (`lz_compose_types_v3`) and runs
 * `lz_compose`, which clears the message and bumps the composer's counter. Every transaction is V1.
 */

import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { fetchComposerStore } from '../build/example_composer/accounts';
import { init as initComposer } from '../build/example_composer/instructions';
import { types } from '../sdk/oft';
import { COMPOSER_PROGRAM_ID, EDDSA, endpoint } from './constants';
import { createOftFixture, mintTo } from './helpers/fixture';
import {
    compose,
    composedAmountLd,
    composeSentEvent,
    events,
    receive,
    send,
    verifyAndCommit,
} from './helpers/oft';
import { composerPrograms, oftPrograms } from './helpers/programs';
import { createInfraEnv, type InfraEnv } from './helpers/test-env';
import { ata, balance } from './helpers/token';
import { sendV1 } from './helpers/transaction-v1';

const AMOUNT = 1_000_000n;
// The OFT treats an empty compose message as "no compose", so the payload must be non-empty.
const COMPOSE_MSG = Uint8Array.from([0x01]);

describe('compose (Transaction V1)', () => {
    let env: InfraEnv;

    beforeAll(async () => {
        env = await createInfraEnv({ programs: [...oftPrograms(), ...composerPrograms()] });
    });

    afterAll(() => env?.teardown());

    it('delivers a send-and-call to the composer store, then executes lz_compose from the ComposeSent event', async () => {
        const oft = await createOftFixture(env, {
            name: 'compose',
            tokenProgram: 'token2022',
            oftType: types.OftType.BurnMint,
        });
        const [composerStore] = EDDSA.findPda(COMPOSER_PROGRAM_ID, [Buffer.from('Composer')]);
        await sendV1(env.connection, oft.admin, [
            initComposer(env.umi, { payer: oft.admin, composerStore, oftStore: oft.oftStore }),
        ]);
        await mintTo(oft, oft.admin.publicKey, AMOUNT);

        const { packet } = await send(oft, oft.admin, composerStore, AMOUNT, COMPOSE_MSG);
        await verifyAndCommit(env, packet);
        const { signature } = await receive(env, packet);

        expect(
            await balance(
                env.connection,
                ata(oft.mint, composerStore, oft.tokenProgram),
                oft.tokenProgram,
            ),
        ).toBe(AMOUNT);
        const [composed] = await events(
            env.connection,
            signature,
            endpoint.programId,
            composeSentEvent,
        );
        expect(composed).toMatchObject({ from: oft.oftStore, to: composerStore, index: 0 });
        expect(composedAmountLd(composed)).toBe(AMOUNT);

        await compose(env, composed);

        expect(
            (await fetchComposerStore(env.umi, composerStore, { commitment: 'confirmed' }))
                .composeCount,
        ).toBe(1n);
    });
});
