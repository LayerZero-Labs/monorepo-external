import { describe, expect, it, vi } from 'vitest';

import type { GetBalanceGrpcClient } from './getBalance';
import { getBalance } from './getBalance';

const SUI_COIN_TYPE = '0x2::sui::SUI';
const OWNER = `0x${'1'.repeat(64)}`;

describe('getBalance', () => {
    it('maps owner/coinType params to the grpc call and balance (coin + address) to totalBalance', async () => {
        const grpcClient: GetBalanceGrpcClient = {
            getBalance: vi.fn().mockResolvedValue({
                balance: {
                    coinType: SUI_COIN_TYPE,
                    balance: '1200',
                    addressBalance: '200',
                    coinBalance: '1000',
                },
            }),
        };

        const result = await getBalance(grpcClient, [OWNER, undefined], undefined);

        expect(grpcClient.getBalance).toHaveBeenCalledWith({
            owner: OWNER,
            coinType: undefined,
            signal: undefined,
        });
        expect(result).toEqual({
            coinType: SUI_COIN_TYPE,
            totalBalance: '1200',
            coinObjectCount: 0,
            lockedBalance: {},
        });
    });

    it('forwards an explicit coinType param through to the grpc call', async () => {
        const usdcType = '0xabc::usdc::USDC';
        const grpcClient: GetBalanceGrpcClient = {
            getBalance: vi.fn().mockResolvedValue({
                balance: {
                    coinType: usdcType,
                    balance: '5',
                    addressBalance: '0',
                    coinBalance: '5',
                },
            }),
        };

        await getBalance(grpcClient, [OWNER, usdcType], undefined);

        expect(grpcClient.getBalance).toHaveBeenCalledWith({
            owner: OWNER,
            coinType: usdcType,
            signal: undefined,
        });
    });
});
