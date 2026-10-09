import type { SuiGrpcClient } from '@mysten/sui-v2/grpc';
import { describe, expect, it, vi } from 'vitest';

import type { LatestSuiSystemStateGrpcClient } from './getLatestSuiSystemState';
import { getLatestSuiSystemState } from './getLatestSuiSystemState';

describe('getLatestSuiSystemState', () => {
    it('maps the current epoch off Epoch.epoch, ignoring params', async () => {
        const grpcClient: LatestSuiSystemStateGrpcClient = {
            ledgerService: {
                getEpoch: vi.fn().mockResolvedValue({ response: { epoch: { epoch: 42n } } }),
            } as unknown as SuiGrpcClient['ledgerService'],
        };

        const result = await getLatestSuiSystemState(grpcClient, [], undefined);

        expect(grpcClient.ledgerService.getEpoch).toHaveBeenCalledWith({}, { abort: undefined });
        expect(result).toEqual({ epoch: '42' });
    });

    it('throws when the gRPC response omits the epoch number', async () => {
        const grpcClient: LatestSuiSystemStateGrpcClient = {
            ledgerService: {
                getEpoch: vi.fn().mockResolvedValue({ response: {} }),
            } as unknown as SuiGrpcClient['ledgerService'],
        };

        await expect(getLatestSuiSystemState(grpcClient, [], undefined)).rejects.toThrow(
            'missing epoch',
        );
    });
});
