import { PreparedTransaction as PreparedTransactionProto } from '@canton-network/core-ledger-proto';
import { afterEach, beforeEach, describe, expect, expectTypeOf, it, vi } from 'vitest';

import { CantonClient } from '../../src/client/canton-client';
import type { ICantonClient } from '../../src/client/interface';
import { Configuration } from '../../src/open-api/runtime';
import type { PreparedTransaction, PreparedTransactionWithExpiry } from '../../src/types';

const expiry = {
    maxRecordTime: '2026-10-19T12:05:00.000Z',
    synchronizerId: 'sync',
    userId: 'participant_admin',
    participantId: 'participant',
    completionOffset: 40,
};
const completion = (code = 0, offset = 41, commandId = 'command') => ({
    completionResponse: {
        Completion: {
            value: { commandId, offset, updateId: 'update', status: { code, message: 'rejected' } },
        },
    },
});
const checkpoint = (recordTime = '2026-10-19T12:05:00.001Z', synchronizerId = 'sync') => ({
    completionResponse: {
        OffsetCheckpoint: {
            value: { offset: 1000, synchronizerTimes: [{ recordTime, synchronizerId }] },
        },
    },
});
const fixture = (batches: unknown[][] = [], user = expiry.userId) => {
    const requests: Record<string, unknown>[] = [];
    const fetchApi = vi.fn(
        async (url: Parameters<typeof fetch>[0], init?: Parameters<typeof fetch>[1]) => {
            if (String(url).includes('participant-id'))
                return Response.json({ participantId: 'participant' });
            if (String(url).includes('ledger-end')) return Response.json({ offset: 40 });
            if (String(url).includes('connected-synchronizers'))
                return Response.json({
                    connectedSynchronizers: [
                        { synchronizerId: 'sync', permission: 'PARTICIPANT_PERMISSION_SUBMISSION' },
                    ],
                });
            requests.push(JSON.parse(String(init?.body)));
            return Response.json(batches.shift() ?? []);
        },
    );
    const client = new CantonClient(new Configuration({ basePath: 'http://mock', fetchApi }), user);
    return { client, fetchApi, requests };
};
const options = {
    parties: ['party'],
    expiry,
    timeoutMs: 10,
    poll: { backoffMs: { initial: 1, max: 1 } },
};
const prepared: PreparedTransactionWithExpiry = {
    commandId: 'command',
    preparedTransaction: 'bytes',
    preparedTransactionHash: 'hash',
    hashingSchemeVersion: 'HASHING_SCHEME_VERSION_V3',
    expiry,
};

beforeEach(() => vi.useFakeTimers());
afterEach(() => vi.useRealTimers());
describe('expiry-aware command waiting', () => {
    it.each([
        { entries: [] },
        { entries: [checkpoint(expiry.maxRecordTime)] },
        { entries: [checkpoint(undefined, 'other')] },
        { entries: [completion(6)] },
    ])(
        'does not equate local time or insufficient ledger evidence with expiry: %j',
        async ({ entries }) => {
            vi.useFakeTimers({ now: new Date('2026-10-19T13:00:00Z') });
            const { client } = fixture([entries]);
            const result = client.waitForCommandWithExpiry('command', options);
            await vi.runAllTimersAsync();
            await expect(result).resolves.toMatchObject({ status: 'timeout' });
        },
    );

    it('finds acceptance after a rejected resubmission across pages', async () => {
        const { client, requests } = fixture([[completion(6)], [checkpoint(), completion(0, 42)]]);
        await expect(client.waitForCommandWithExpiry('command', options)).resolves.toMatchObject({
            status: 'accepted',
            updateId: 'update',
        });
        expect(requests.map((request) => request.beginExclusive)).toEqual([40, 41]);
    });

    it.each([false, true])(
        'finishes only at the expiry checkpoint, with rejected=%s',
        async (rejected) => {
            const { client } = fixture([rejected ? [completion(3), checkpoint()] : [checkpoint()]]);
            await expect(
                client.waitForCommandWithExpiry('command', options),
            ).resolves.toMatchObject({ status: rejected ? 'rejected' : 'expired' });
        },
    );

    it('drains a busy completion stream without sleeping between progress pages', async () => {
        vi.useFakeTimers();
        const batches = Array.from({ length: 700 }, (_, index) => [
            completion(0, 41 + index, 'other'),
        ]);
        const { client, requests } = fixture([...batches, [checkpoint()]]);
        await expect(client.waitForCommandWithExpiry('command', options)).resolves.toMatchObject({
            status: 'expired',
        });
        expect(requests).toHaveLength(701);
        expect(vi.getTimerCount()).toBe(0);
    });

    it.each(['participantId', 'userId'] as const)(
        'refuses a different %s for submission and monitoring',
        async (field) => {
            const { client, requests } = fixture();
            const different = { ...expiry, [field]: 'other' };
            await expect(
                client.waitForCommandWithExpiry('command', { ...options, expiry: different }),
            ).rejects.toThrow('Command source differs');
            await expect(
                client.submitSigned({ ...prepared, expiry: different }, []),
            ).rejects.toThrow('Command source differs');
            expect(requests).toEqual([]);
        },
    );

    it('preserves original submission cursor and does not execute after local expiry', async () => {
        vi.useFakeTimers({ now: new Date('2026-10-19T12:04:00Z') });
        const { client, requests } = fixture();
        await expect(client.submitSigned(prepared, [])).resolves.toEqual({
            commandId: 'command',
            completionOffset: 40,
        });
        vi.setSystemTime(new Date('2026-10-19T12:06:00Z'));
        await expect(client.submitSigned(prepared, [])).resolves.toEqual({
            commandId: 'command',
            completionOffset: 40,
        });
        expect(requests).toHaveLength(1);
    });
});

describe('optional signed expiry preparation', () => {
    it.each(['valid', 'missing', 'different', 'v2'])(
        'requires V3 and the requested signed deadline: %s',
        async (variant) => {
            let request: Record<string, unknown> | undefined;
            const fetchApi = vi.fn(
                async (url: Parameters<typeof fetch>[0], init?: Parameters<typeof fetch>[1]) => {
                    if (String(url).includes('participant-id'))
                        return Response.json({ participantId: 'participant' });
                    if (String(url).includes('ledger-end')) return Response.json({ offset: 40 });
                    if (String(url).includes('connected-synchronizers'))
                        return Response.json({
                            connectedSynchronizers: [{ synchronizerId: 'sync' }],
                        });
                    request = JSON.parse(String(init?.body));
                    return Response.json({
                        preparedTransaction: Buffer.from(
                            PreparedTransactionProto.toBinary(
                                PreparedTransactionProto.create({
                                    metadata: {
                                        maxRecordTime:
                                            variant === 'missing'
                                                ? undefined
                                                : BigInt(Date.parse(expiry.maxRecordTime)) * 1000n +
                                                  (variant === 'different' ? 1n : 0n),
                                    },
                                }),
                            ),
                        ).toString('base64'),
                        preparedTransactionHash: 'hash',
                        hashingSchemeVersion:
                            variant === 'v2'
                                ? 'HASHING_SCHEME_VERSION_V2'
                                : 'HASHING_SCHEME_VERSION_V3',
                    });
                },
            );
            const client = new CantonClient(
                new Configuration({ basePath: 'http://mock', fetchApi }),
            );
            const result = client.prepareForSigning({ actAs: ['party'] }, [], {
                maxRecordTime: expiry.maxRecordTime,
            });
            if (variant === 'valid') await expect(result).resolves.toMatchObject({ expiry });
            else await expect(result).rejects.toThrow('requested signed maxRecordTime');
            expect(request).toMatchObject({
                maxRecordTime: expiry.maxRecordTime,
                hashingSchemeVersion: 'HASHING_SCHEME_VERSION_V3',
            });
        },
    );

    it('keeps ordinary preparation and waiting behavior unchanged', async () => {
        const { client, fetchApi } = fixture();
        fetchApi.mockImplementation(async (url) =>
            String(url).includes('connected-synchronizers')
                ? Response.json({ connectedSynchronizers: [{ synchronizerId: 'sync' }] })
                : String(url).includes('prepare')
                  ? Response.json({
                        preparedTransaction: 'existing-blob',
                        preparedTransactionHash: 'hash',
                        hashingSchemeVersion: 'HASHING_SCHEME_VERSION_V2',
                    })
                  : Response.json([completion(3)]),
        );
        await expect(
            client.prepareForSigning({ actAs: ['party'] }, []),
        ).resolves.not.toHaveProperty('expiry');
        await expect(
            client.waitForCommand('command', { parties: ['party'] }),
        ).resolves.toMatchObject({ status: 'rejected' });
    });
});

it('keeps default preparation types compatible while narrowing opt-in expiry types', () => {
    const { client } = fixture();
    const asInterface: ICantonClient = client;
    expectTypeOf(() => client.prepareForSigning({ actAs: ['party'] }, [])).returns.toEqualTypeOf<
        Promise<PreparedTransaction>
    >();
    expectTypeOf(() =>
        asInterface.prepareForSigning({ actAs: ['party'] }, []),
    ).returns.toEqualTypeOf<Promise<PreparedTransaction>>();
    expectTypeOf(() =>
        client.prepareForSigning({ actAs: ['party'] }, [], { maxRecordTime: expiry.maxRecordTime }),
    ).returns.toEqualTypeOf<Promise<PreparedTransactionWithExpiry>>();
    expectTypeOf(() =>
        asInterface.prepareForSigning({ actAs: ['party'] }, [], {
            maxRecordTime: expiry.maxRecordTime,
        }),
    ).returns.toEqualTypeOf<Promise<PreparedTransactionWithExpiry>>();
});
