import { SuiClient } from '@mysten/sui/client';
import { Transaction } from '@mysten/sui/transactions';
import { type SuiGrpcClient } from '@mysten/sui-v2/grpc';
import { RpcError } from '@protobuf-ts/runtime-rpc';
import { describe, expect, it, vi } from 'vitest';

import fixture from './fixtures/wbtcAddressBalance.json';
import { getCoins } from './getCoins';
import { getObject } from './getObject';
import { multiGetObjects } from './multiGetObjects';

const OWNER = fixture.reservation.owner.AddressOwner;
const COIN_TYPE = fixture.reservation.type.slice('0x2::coin::Coin<'.length, -1);
const ID = fixture.reservation.objectId;

const makeClient = () => {
    const ledgerService = {
        getServiceInfo: vi.fn().mockResolvedValue({
            response: { chainId: fixture.chainId, epoch: BigInt(fixture.epoch) },
        }),
        getObject: vi.fn().mockImplementation(({ objectId }: { objectId: string }) => {
            if (objectId !== fixture.accumulator.objectId) {
                throw new RpcError('missing', 'NOT_FOUND');
            }
            return {
                response: {
                    object: {
                        ...fixture.accumulator,
                        version: BigInt(fixture.accumulator.version),
                        previousTransaction: fixture.reservation.previousTransaction,
                    },
                },
            };
        }),
        batchGetObjects: vi
            .fn()
            .mockImplementation(({ requests }: { requests: { objectId: string }[] }) => ({
                response: {
                    objects: requests.map(({ objectId }) => ({
                        result:
                            objectId === fixture.accumulator.objectId
                                ? {
                                      oneofKind: 'object',
                                      object: {
                                          ...fixture.accumulator,
                                          version: BigInt(fixture.accumulator.version),
                                          previousTransaction:
                                              fixture.reservation.previousTransaction,
                                      },
                                  }
                                : { oneofKind: 'error', error: { code: 5 } },
                    })),
                },
            })),
    };
    const listCoins = vi.fn().mockResolvedValue({
        objects: [],
        hasNextPage: false,
        cursor: null,
    });
    return {
        grpc: { ledgerService, listCoins } as unknown as SuiGrpcClient,
        ledgerService,
        listCoins,
    };
};

describe('address balance coin reservations', () => {
    it('exposes address-only WBTC as the same spendable reference as JSON-RPC', async () => {
        const { grpc } = makeClient();
        const coins = await getCoins(grpc, [OWNER, COIN_TYPE]);
        const legacy = fixture.legacyGetCoins.data.find((coin) => coin.coinObjectId === ID)!;
        expect(legacy).toBeDefined();
        expect(coins.data).toEqual([
            expect.objectContaining({
                ...legacy,
                // Keep the adapter's pre-existing formatting; compare the actual spendable
                // reference against the captured legacy response without rewriting it.
                coinType: COIN_TYPE,
            }),
        ]);
        expect(coins.hasNextPage).toBe(false);
    });

    it('resolves a reservation on a different client without an in-memory cache', async () => {
        const { grpc } = makeClient();
        expect(
            await getObject(grpc, [
                ID,
                {
                    showOwner: true,
                    showType: true,
                    showContent: true,
                    showPreviousTransaction: true,
                    showStorageRebate: true,
                },
            ]),
        ).toEqual({ data: fixture.reservation });
    });

    it('paginates mixed coin and address balances without duplicates or exceeding the limit', async () => {
        const { grpc, listCoins, ledgerService } = makeClient();
        const coin = {
            objectId: '0x1',
            type: fixture.reservation.type,
            balance: '500',
            digest: 'd',
            version: '1',
        };
        listCoins.mockResolvedValueOnce({
            objects: [coin],
            hasNextPage: true,
            cursor: 'grpc-next',
        });
        listCoins.mockResolvedValueOnce({
            objects: [coin],
            hasNextPage: true,
            cursor: 'grpc-next',
        });
        listCoins.mockResolvedValueOnce({
            objects: [{ ...coin, objectId: '0x2' }],
            hasNextPage: false,
            cursor: null,
        });
        const first = await getCoins(grpc, [OWNER, COIN_TYPE, null, 1]);
        expect(first.data[0]?.coinObjectId).toBe(ID);
        const second = await getCoins(grpc, [OWNER, COIN_TYPE, first.nextCursor, 1]);
        expect(second.hasNextPage).toBe(true);
        const third = await getCoins(grpc, [OWNER, COIN_TYPE, second.nextCursor, 1]);
        expect([first, second, third].map((p) => p.data.length)).toEqual([1, 1, 1]);
        expect([first, second, third].flatMap((p) => p.data.map((c) => c.coinObjectId))).toEqual([
            ID,
            '0x1',
            '0x2',
        ]);
        expect(third.hasNextPage).toBe(false);
        expect(third.nextCursor).toBeNull();
        expect(listCoins).toHaveBeenCalledTimes(3);
        expect(ledgerService.getServiceInfo).toHaveBeenCalledTimes(1);
        expect(first.data[0]?.coinType).toBe(second.data[0]?.coinType);
    });

    it('does not invent a coin for a missing or zero address balance', async () => {
        const { grpc, ledgerService } = makeClient();
        ledgerService.getObject.mockRejectedValueOnce(new RpcError('missing', 'NOT_FOUND'));
        expect((await getCoins(grpc, [OWNER, COIN_TYPE])).data).toEqual([]);
        const accumulator = structuredClone(fixture.accumulator);
        accumulator.json.kind.structValue.fields.value.kind.structValue.fields.value.kind.stringValue =
            '0';
        ledgerService.getObject.mockResolvedValueOnce({
            response: {
                object: {
                    ...accumulator,
                    version: BigInt(accumulator.version),
                    previousTransaction: fixture.reservation.previousTransaction,
                },
            },
        });
        expect((await getCoins(grpc, [OWNER, COIN_TYPE])).data).toEqual([]);
    });

    it('resumes a reservation-only page on another provider without shared state', async () => {
        const firstClient = makeClient();
        const nextClient = makeClient();
        const realCoin = {
            objectId: '0x1',
            type: fixture.reservation.type,
            balance: '500',
            digest: 'd',
            version: '1',
        };
        for (const client of [firstClient, nextClient]) {
            client.listCoins.mockResolvedValue({
                objects: [realCoin],
                hasNextPage: false,
                cursor: null,
            });
        }
        const first = await getCoins(firstClient.grpc, [OWNER, COIN_TYPE, null, 1]);
        const next = await getCoins(nextClient.grpc, [OWNER, COIN_TYPE, first.nextCursor, 1]);
        expect(first.hasNextPage).toBe(true);
        expect(first.data.map((coin) => coin.coinObjectId)).toEqual([ID]);
        expect(next.data.map((coin) => coin.coinObjectId)).toEqual(['0x1']);
        expect(next.hasNextPage).toBe(false);
        expect(nextClient.ledgerService.getServiceInfo).not.toHaveBeenCalled();
        expect(nextClient.listCoins).toHaveBeenCalledWith(
            expect.objectContaining({ cursor: undefined, limit: 1 }),
        );
    });

    it('ends a one-item page when only the address balance exists', async () => {
        const { grpc } = makeClient();
        const page = await getCoins(grpc, [OWNER, COIN_TYPE, null, 1]);
        expect(page.data.map((coin) => coin.coinObjectId)).toEqual([ID]);
        expect(page.hasNextPage).toBe(false);
        expect(page.nextCursor).toBeNull();
    });

    it('keeps reservation IDs bound to the chain genesis digest', async () => {
        const { grpc, ledgerService } = makeClient();
        ledgerService.getServiceInfo.mockResolvedValue({
            response: { chainId: '11111111111111111111111111111111', epoch: BigInt(fixture.epoch) },
        });
        const coins = await getCoins(grpc, [OWNER, COIN_TYPE]);
        expect(coins.data[0]?.coinObjectId).not.toBe(ID);
        expect(await getObject(grpc, [ID])).toEqual({
            error: { code: 'notExists', object_id: ID },
        });
    });

    it('preserves mixed batch positions and only resolves missing objects as reservations', async () => {
        const { grpc, ledgerService } = makeClient();
        const realId = `0x${'1'.repeat(64)}`;
        const missingId = `0x${'2'.repeat(64)}`;
        ledgerService.batchGetObjects.mockResolvedValueOnce({
            response: {
                objects: [
                    { result: { oneofKind: 'error', error: { code: 5 } } },
                    {
                        result: {
                            oneofKind: 'object',
                            object: { objectId: realId, version: 1n, digest: 'd' },
                        },
                    },
                    { result: { oneofKind: 'error', error: { code: 5 } } },
                ],
            },
        });
        const result = await multiGetObjects(grpc, [[ID, realId, missingId]]);
        expect(result).toMatchObject([
            { data: { objectId: ID, digest: fixture.reservation.digest } },
            { data: { objectId: realId, digest: 'd' } },
            { error: { code: 'notExists', object_id: missingId } },
        ]);
        expect(ledgerService.getServiceInfo).toHaveBeenCalledTimes(1);
        expect(ledgerService.batchGetObjects).toHaveBeenCalledTimes(2);
        expect(ledgerService.getObject).not.toHaveBeenCalled();
    });

    it('resolves 50 missing IDs with two extra RPCs instead of 100', async () => {
        const { grpc, ledgerService } = makeClient();
        const ids = Array.from(
            { length: 50 },
            (_, i) => `0x${(i + 1).toString(16).padStart(64, '0')}`,
        );
        const result = await multiGetObjects(grpc, [ids]);
        expect(result).toEqual(ids.map((id) => ({ error: { code: 'notExists', object_id: id } })));
        expect(ledgerService.getServiceInfo).toHaveBeenCalledTimes(1);
        expect(ledgerService.batchGetObjects).toHaveBeenCalledTimes(2);
        expect(ledgerService.getObject).not.toHaveBeenCalled();
        expect(ledgerService.batchGetObjects.mock.calls[1][0].requests).toHaveLength(50);
    });

    it('includes the address balance before the SDK can hit its 200-coin selection limit', async () => {
        const { grpc, listCoins } = makeClient();
        listCoins.mockImplementation(({ limit, cursor }: { limit: number; cursor?: string }) => {
            const start = Number(cursor ?? 0);
            const end = Math.min(start + limit, 250);
            return {
                objects: Array.from({ length: end - start }, (_, i) => ({
                    objectId: `0x${(start + i + 1).toString(16)}`,
                    type: fixture.reservation.type,
                    balance: '0',
                    digest: 'd',
                    version: '1',
                })),
                cursor: end < 250 ? String(end) : null,
                hasNextPage: end < 250,
            };
        });
        const first = await getCoins(grpc, [OWNER, COIN_TYPE, null, 50]);
        expect(first.data).toHaveLength(50);
        expect(first.data[0]).toMatchObject({ coinObjectId: ID, balance: '1061' });
        const all = [...first.data];
        let page = first;
        while (page.hasNextPage) {
            page = await getCoins(grpc, [OWNER, COIN_TYPE, page.nextCursor, 50]);
            all.push(...page.data);
        }
        expect(all).toHaveLength(251);
        expect(new Set(all.map((c) => c.coinObjectId)).size).toBe(251);
    });

    it('returns notExists for a reservation whose address balance has been spent', async () => {
        const { grpc, ledgerService } = makeClient();
        const accumulator = structuredClone(fixture.accumulator);
        accumulator.json.kind.structValue.fields.value.kind.structValue.fields.value.kind.stringValue =
            '0';
        ledgerService.getObject.mockRejectedValueOnce(new RpcError('missing', 'NOT_FOUND'));
        ledgerService.getObject.mockResolvedValueOnce({
            response: {
                object: {
                    ...accumulator,
                    version: BigInt(accumulator.version),
                    previousTransaction: fixture.reservation.previousTransaction,
                },
            },
        });
        expect(await getObject(grpc, [ID])).toEqual({
            error: { code: 'notExists', object_id: ID },
        });
    });

    it('recomputes the reservation for the current epoch and propagates abort signals', async () => {
        const { grpc, ledgerService } = makeClient();
        ledgerService.getServiceInfo.mockResolvedValueOnce({
            response: {
                chainId: fixture.chainId,
                epoch: BigInt(fixture.epoch) + 1n,
            },
        });
        const signal = new AbortController().signal;
        const result = await getCoins(grpc, [OWNER, COIN_TYPE], signal);
        expect(result.data[0]?.digest).not.toBe(fixture.reservation.digest);
        expect(ledgerService.getServiceInfo).toHaveBeenCalledWith({}, { abort: signal });
        expect(ledgerService.getObject).toHaveBeenCalledWith(expect.anything(), { abort: signal });
    });

    it('does not hide transport failures as an empty balance or missing object', async () => {
        const { grpc, ledgerService } = makeClient();
        ledgerService.getObject.mockRejectedValue(new RpcError('unavailable', 'UNAVAILABLE'));
        await expect(getCoins(grpc, [OWNER, COIN_TYPE])).rejects.toThrow('unavailable');
        ledgerService.batchGetObjects
            .mockResolvedValueOnce({
                response: { objects: [{ result: { oneofKind: 'error', error: { code: 5 } } }] },
            })
            .mockRejectedValueOnce(new RpcError('unavailable', 'UNAVAILABLE'));
        await expect(multiGetObjects(grpc, [[ID]])).rejects.toThrow('unavailable');
    });

    it('does not treat an arbitrary unmasked object as a reservation', async () => {
        const { grpc, ledgerService } = makeClient();
        ledgerService.getObject.mockRejectedValueOnce(new RpcError('missing', 'NOT_FOUND'));
        ledgerService.getObject.mockResolvedValueOnce({
            response: {
                object: {
                    ...fixture.accumulator,
                    objectType: '0x2::coin::Coin<0x2::sui::SUI>',
                },
            },
        });
        expect(await getObject(grpc, [ID])).toEqual({
            error: { code: 'notExists', object_id: ID },
        });
    });

    it('builds a v1 PTB using the address-only balance and embeds the resolved reservation', async () => {
        const { grpc } = makeClient();
        const client = new SuiClient({
            transport: {
                async request<T>({
                    method,
                    params,
                }: {
                    method: string;
                    params: unknown[];
                }): Promise<T> {
                    if (method === 'suix_getCoins') {
                        return (await getCoins(grpc, params)) as T;
                    }
                    if (method === 'sui_multiGetObjects') {
                        return (await multiGetObjects(grpc, params)) as T;
                    }
                    throw new Error(`Unexpected RPC: ${method}`);
                },
                async subscribe() {
                    throw new Error('unused');
                },
            },
        });
        const { data: coins } = await client.getCoins({ owner: OWNER, coinType: COIN_TYPE });
        expect(coins).toHaveLength(1);
        const tx = new Transaction();
        tx.setSender(OWNER);
        const [coin] = tx.splitCoins(tx.object(coins[0]!.coinObjectId), [1061]);
        tx.transferObjects([coin], OWNER);
        const bytes = await tx.build({ client, onlyTransactionKind: true });
        const rebuilt = Transaction.fromKind(bytes).getData();
        expect(rebuilt.inputs[0]).toMatchObject({
            Object: {
                ImmOrOwnedObject: {
                    objectId: ID,
                    digest: fixture.reservation.digest,
                    version: fixture.reservation.version,
                },
            },
        });
    });
});
