import { RpcError } from '@protobuf-ts/runtime-rpc';
import { describe, expect, it, vi } from 'vitest';

import type { MultiGetObjectsGrpcClient } from './multiGetObjects';
import { multiGetObjects } from './multiGetObjects';

const ID_A = `0x${'1'.repeat(64)}`;
const ID_B = `0x${'2'.repeat(64)}`;

describe('multiGetObjects', () => {
    it('maps found and not-found results, preserving request order', async () => {
        const batchGetObjects = vi
            .fn()
            .mockResolvedValue({
                response: { objects: [{ result: { oneofKind: 'error', error: { code: 5 } } }] },
            })
            .mockResolvedValueOnce({
                response: {
                    objects: [
                        {
                            result: {
                                oneofKind: 'object',
                                object: { objectId: ID_A, version: 1n, digest: 'd1' },
                            },
                        },
                        {
                            result: {
                                oneofKind: 'error',
                                error: { code: 5, message: 'not found' },
                            },
                        },
                    ],
                },
            });
        const grpcClient = {
            ledgerService: {
                batchGetObjects,
                getServiceInfo: vi.fn().mockResolvedValue({
                    response: { chainId: '11111111111111111111111111111111', epoch: 1n },
                }),
                getObject: vi.fn().mockRejectedValue(new RpcError('missing', 'NOT_FOUND')),
            },
        } as unknown as MultiGetObjectsGrpcClient;

        const result = await multiGetObjects(grpcClient, [[ID_A, ID_B], undefined], undefined);

        expect(batchGetObjects).toHaveBeenCalledWith(
            { requests: [{ objectId: ID_A }, { objectId: ID_B }], readMask: expect.any(Object) },
            { abort: undefined },
        );
        expect(result).toEqual([
            {
                data: {
                    objectId: ID_A,
                    version: '1',
                    digest: 'd1',
                    type: undefined,
                    owner: undefined,
                    content: undefined,
                    previousTransaction: undefined,
                    storageRebate: undefined,
                },
            },
            { error: { code: 'notExists', object_id: ID_B } },
        ]);
    });

    it('returns an empty array without calling the grpc client for an empty id list', async () => {
        const batchGetObjects = vi.fn();
        const grpcClient = {
            ledgerService: { batchGetObjects },
        } as unknown as MultiGetObjectsGrpcClient;

        const result = await multiGetObjects(grpcClient, [[], undefined], undefined);

        expect(result).toEqual([]);
        expect(batchGetObjects).not.toHaveBeenCalled();
    });

    it('rethrows a non-NOT_FOUND per-item error rather than masking it as notExists', async () => {
        const batchGetObjects = vi.fn().mockResolvedValue({
            response: {
                objects: [
                    { result: { oneofKind: 'error', error: { code: 14, message: 'unavailable' } } },
                ],
            },
        });
        const grpcClient = {
            ledgerService: { batchGetObjects },
        } as unknown as MultiGetObjectsGrpcClient;

        await expect(multiGetObjects(grpcClient, [[ID_A], undefined], undefined)).rejects.toThrow(
            /code 14: unavailable/,
        );
    });

    it('accepts exactly 50 ids in a single batchGetObjects call', async () => {
        const ids = Array.from({ length: 50 }, (_, i) => `0x${i.toString(16).padStart(64, '0')}`);
        const batchGetObjects = vi
            .fn()
            .mockImplementation((request: { requests: { objectId: string }[] }) => ({
                response: {
                    objects: request.requests.map((r) => ({
                        result: {
                            oneofKind: 'object',
                            object: { objectId: r.objectId, version: 1n, digest: 'd' },
                        },
                    })),
                },
            }));
        const grpcClient = {
            ledgerService: { batchGetObjects },
        } as unknown as MultiGetObjectsGrpcClient;

        const result = await multiGetObjects(grpcClient, [ids, undefined], undefined);

        expect(batchGetObjects).toHaveBeenCalledTimes(1);
        expect(result).toHaveLength(50);
        expect(result.map((r) => (r as { data: { objectId: string } }).data.objectId)).toEqual(ids);
    });

    it('rejects more than 50 ids without calling the grpc client, matching legacy', async () => {
        const ids = Array.from({ length: 51 }, (_, i) => `0x${i.toString(16).padStart(64, '0')}`);
        const batchGetObjects = vi.fn();
        const grpcClient = {
            ledgerService: { batchGetObjects },
        } as unknown as MultiGetObjectsGrpcClient;

        await expect(multiGetObjects(grpcClient, [ids, undefined], undefined)).rejects.toThrow(
            /Input exceeds limit of 50/,
        );
        expect(batchGetObjects).not.toHaveBeenCalled();
    });
});
