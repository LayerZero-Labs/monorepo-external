import { describe, expect, it, vi } from 'vitest';

import type { GetAllCoinsGrpcClient } from './getAllCoins';
import { getAllCoins } from './getAllCoins';

const OWNER = `0x${'1'.repeat(64)}`;

describe('getAllCoins', () => {
    it('requests every coin type, decodes the cursor, and stringifies bigint fields', async () => {
        const listOwnedObjects = vi.fn().mockResolvedValue({
            response: {
                objects: [
                    {
                        objectId: '0x1',
                        // v2 returns the wrapped, fully-padded object type for a Coin<T>.
                        objectType:
                            '0x0000000000000000000000000000000000000000000000000000000000000002::coin::Coin<0x0000000000000000000000000000000000000000000000000000000000000002::sui::SUI>',
                        balance: 100n,
                        digest: 'digest-1',
                        version: 5n,
                    },
                    {
                        objectId: '0x2',
                        // The adapter currently keeps non-system addresses at full width.
                        // This asserts existing behavior, not legacy formatting parity.
                        objectType:
                            '0x0000000000000000000000000000000000000000000000000000000000000002::coin::Coin<0x0000000000000000000000000000000000000000000000000000000000000abc::usdc::USDC>',
                        balance: 200n,
                        digest: 'digest-2',
                        version: 6n,
                    },
                ],
                nextPageToken: new Uint8Array([1, 2, 3]),
            },
        });
        const grpcClient: GetAllCoinsGrpcClient = {
            stateService: { listOwnedObjects } as unknown as GetAllCoinsGrpcClient['stateService'],
        };
        const cursor = 'CQk='; // [9, 9]

        const result = await getAllCoins(grpcClient, [OWNER, cursor, 50], undefined);

        expect(listOwnedObjects).toHaveBeenCalledWith(
            {
                owner: OWNER,
                objectType: '0x2::coin::Coin',
                pageToken: new Uint8Array([9, 9]),
                pageSize: 50,
                readMask: {
                    paths: ['object_id', 'version', 'digest', 'object_type', 'balance'],
                },
            },
            { abort: undefined },
        );
        expect(result).toEqual({
            data: [
                {
                    coinObjectId: '0x1',
                    coinType: '0x2::sui::SUI',
                    balance: '100',
                    digest: 'digest-1',
                    version: '5',
                    previousTransaction: '',
                },
                {
                    coinObjectId: '0x2',
                    coinType:
                        '0x0000000000000000000000000000000000000000000000000000000000000abc::usdc::USDC',
                    balance: '200',
                    digest: 'digest-2',
                    version: '6',
                    previousTransaction: '',
                },
            ],
            hasNextPage: true,
            nextCursor: 'AQID', // [1, 2, 3]
        });
    });

    it('treats a missing cursor/nextPageToken as the absence of pagination, and defaults the page size to the legacy cap', async () => {
        const listOwnedObjects = vi
            .fn()
            .mockResolvedValue({ response: { objects: [], nextPageToken: undefined } });
        const grpcClient: GetAllCoinsGrpcClient = {
            stateService: { listOwnedObjects } as unknown as GetAllCoinsGrpcClient['stateService'],
        };

        const result = await getAllCoins(grpcClient, [OWNER, null, null], undefined);

        expect(listOwnedObjects).toHaveBeenCalledWith(
            expect.objectContaining({ pageToken: undefined, pageSize: 50 }),
            { abort: undefined },
        );
        expect(result).toMatchObject({ hasNextPage: false, nextCursor: null });
    });

    it('caps a caller-provided limit above the legacy page size at 50', async () => {
        const listOwnedObjects = vi
            .fn()
            .mockResolvedValue({ response: { objects: [], nextPageToken: undefined } });
        const grpcClient: GetAllCoinsGrpcClient = {
            stateService: { listOwnedObjects } as unknown as GetAllCoinsGrpcClient['stateService'],
        };

        await getAllCoins(grpcClient, [OWNER, null, 1000], undefined);

        expect(listOwnedObjects).toHaveBeenCalledWith(expect.objectContaining({ pageSize: 50 }), {
            abort: undefined,
        });
    });

    it('throws instead of defaulting when a required field is missing from an object', async () => {
        const listOwnedObjects = vi.fn().mockResolvedValue({
            response: {
                objects: [{ objectId: undefined, objectType: '0x2::coin::Coin<0x2::sui::SUI>' }],
                nextPageToken: undefined,
            },
        });
        const grpcClient: GetAllCoinsGrpcClient = {
            stateService: { listOwnedObjects } as unknown as GetAllCoinsGrpcClient['stateService'],
        };

        await expect(getAllCoins(grpcClient, [OWNER, null, null], undefined)).rejects.toThrow(
            /objectId/,
        );
    });
});
