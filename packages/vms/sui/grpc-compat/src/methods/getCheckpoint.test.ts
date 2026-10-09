import { describe, expect, it } from 'vitest';

import { isSuiCompatProviderSpecificError } from '../errors';
import { type CheckpointGrpcClient, getCheckpoint } from './getCheckpoint';

const fakeGrpcClient = (checkpoint: unknown): CheckpointGrpcClient =>
    ({
        ledgerService: {
            getCheckpoint: async () => ({ response: { checkpoint } }),
        },
    }) as unknown as CheckpointGrpcClient;

describe('getCheckpoint', () => {
    it('throws a provider-specific error when the checkpoint is not found', async () => {
        await expect(getCheckpoint(fakeGrpcClient(undefined), ['10'])).rejects.toSatisfy(
            isSuiCompatProviderSpecificError,
        );
    });

    it('throws a provider-specific error when the response is missing required fields', async () => {
        await expect(getCheckpoint(fakeGrpcClient({ digest: 'abc123' }), ['10'])).rejects.toSatisfy(
            isSuiCompatProviderSpecificError,
        );
    });

    it('does not mark an invalid sequence-number request as provider-specific — it fails the same way on every provider', async () => {
        await expect(
            getCheckpoint(fakeGrpcClient(undefined), ['not-a-number']),
        ).rejects.not.toSatisfy(isSuiCompatProviderSpecificError);
    });
});
