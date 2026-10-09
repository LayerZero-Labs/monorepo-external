import { RpcError } from '@protobuf-ts/runtime-rpc';
import { describe, expect, it, vi } from 'vitest';

import type { GetCoinsGrpcClient } from './getCoins';
import { getCoins } from './getCoins';

const emptyLedger = () =>
    ({
        getServiceInfo: vi.fn().mockResolvedValue({
            response: { chainId: '11111111111111111111111111111111', epoch: 1n },
        }),
        getObject: vi.fn().mockRejectedValue(new RpcError('missing', 'NOT_FOUND')),
    }) as unknown as GetCoinsGrpcClient['ledgerService'];

const OWNER = `0x${'1'.repeat(64)}`;

describe('getCoins', () => {
    it('maps owner/coinType/cursor/limit params to the grpc call and the response fields', async () => {
        const listCoins = vi.fn().mockResolvedValue({
            objects: [
                {
                    objectId: '0x1',
                    // v2 returns the wrapped, fully-padded object type for a Coin<T>.
                    type: '0x0000000000000000000000000000000000000000000000000000000000000002::coin::Coin<0x0000000000000000000000000000000000000000000000000000000000000002::sui::SUI>',
                    balance: '100',
                    digest: 'digest-1',
                    version: '5',
                    owner: { AddressOwner: OWNER },
                },
            ],
            hasNextPage: true,
            cursor: 'next-page',
        });
        const grpcClient: GetCoinsGrpcClient = { listCoins, ledgerService: emptyLedger() };

        const result = await getCoins(
            grpcClient,
            [OWNER, '0x2::sui::SUI', 'prev-cursor', 10],
            undefined,
        );

        expect(listCoins).toHaveBeenCalledWith({
            owner: OWNER,
            coinType: '0x2::sui::SUI',
            cursor: 'prev-cursor',
            limit: 10,
            signal: undefined,
        });
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
            ],
            hasNextPage: true,
            nextCursor: 'next-page',
        });
    });

    it('preserves existing non-system coin type formatting for ordinary coins', async () => {
        const coinType =
            '0x0041f9f9344cac094454cd574e333c4fdb132d7bcc9379bcd4aab485b2a63942::wbtc::WBTC';
        const listCoins = vi.fn().mockResolvedValue({
            objects: [
                {
                    objectId: '0x1',
                    type: `0x2::coin::Coin<${coinType}>`,
                    balance: '100',
                    digest: 'd',
                    version: '1',
                },
            ],
            hasNextPage: false,
            cursor: null,
        });
        const result = await getCoins({ listCoins, ledgerService: emptyLedger() }, [
            OWNER,
            coinType,
        ]);
        expect(result.data[0].coinType).toBe(coinType);
    });

    it('defaults coinType/cursor to undefined and limit to the legacy page cap when not provided', async () => {
        const listCoins = vi
            .fn()
            .mockResolvedValue({ objects: [], hasNextPage: false, cursor: null });
        const grpcClient: GetCoinsGrpcClient = { listCoins, ledgerService: emptyLedger() };

        await getCoins(grpcClient, [OWNER, null, null, null], undefined);

        expect(listCoins).toHaveBeenCalledWith({
            owner: OWNER,
            coinType: undefined,
            cursor: undefined,
            limit: 50,
            signal: undefined,
        });
    });

    it('caps a caller-provided limit above the legacy page size at 50', async () => {
        const listCoins = vi
            .fn()
            .mockResolvedValue({ objects: [], hasNextPage: false, cursor: null });
        const grpcClient: GetCoinsGrpcClient = { listCoins, ledgerService: emptyLedger() };

        await getCoins(grpcClient, [OWNER, null, null, 1000], undefined);

        expect(listCoins).toHaveBeenCalledWith(expect.objectContaining({ limit: 50 }));
    });
});
