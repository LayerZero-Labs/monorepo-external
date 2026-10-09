import { describe, expect, it, vi } from 'vitest';

import type { GetAllBalancesGrpcClient } from './getAllBalances';
import { getAllBalances } from './getAllBalances';

const OWNER = `0x${'1'.repeat(64)}`;

describe('getAllBalances', () => {
    it('drains every page and maps balance (coin + address) to totalBalance', async () => {
        const listBalances = vi
            .fn()
            .mockResolvedValueOnce({
                balances: [
                    {
                        coinType: '0x2::sui::SUI',
                        balance: '1200',
                        addressBalance: '200',
                        coinBalance: '1000',
                    },
                ],
                hasNextPage: true,
                cursor: 'page-2',
            })
            .mockResolvedValueOnce({
                balances: [
                    {
                        coinType: '0xabc::usdc::USDC',
                        balance: '500',
                        addressBalance: '0',
                        coinBalance: '500',
                    },
                ],
                hasNextPage: false,
                cursor: null,
            });
        const grpcClient: GetAllBalancesGrpcClient = { listBalances };

        const result = await getAllBalances(grpcClient, [OWNER], undefined);

        expect(listBalances).toHaveBeenCalledTimes(2);
        expect(listBalances).toHaveBeenNthCalledWith(1, {
            owner: OWNER,
            cursor: undefined,
            limit: 1000,
            signal: undefined,
        });
        expect(listBalances).toHaveBeenNthCalledWith(2, {
            owner: OWNER,
            cursor: 'page-2',
            limit: 1000,
            signal: undefined,
        });
        expect(result).toEqual([
            {
                coinType: '0x2::sui::SUI',
                totalBalance: '1200',
                coinObjectCount: 0,
                lockedBalance: {},
            },
            {
                coinType: '0xabc::usdc::USDC',
                totalBalance: '500',
                coinObjectCount: 0,
                lockedBalance: {},
            },
        ]);
    });

    it('throws instead of looping forever when the cursor never advances to an end', async () => {
        const grpcClient: GetAllBalancesGrpcClient = {
            listBalances: vi.fn().mockResolvedValue({
                balances: [],
                hasNextPage: true,
                cursor: 'stuck',
            }),
        };

        await expect(getAllBalances(grpcClient, [OWNER], undefined)).rejects.toThrow(
            /exceeded 500 pages/,
        );
    });
});
