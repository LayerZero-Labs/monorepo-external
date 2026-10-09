import { TransactionDataBuilder } from '@mysten/sui-v2/transactions';
import { toBase64 } from '@mysten/sui-v2/utils';
import { describe, expect, it, vi } from 'vitest';

import {
    executeTransactionBlock,
    type ExecuteTransactionBlockGrpcClient,
} from './executeTransactionBlock';

const fakeGrpcClient = (transaction: unknown) => {
    const executeTransaction = vi.fn(async (_request: unknown) => ({ response: { transaction } }));
    const client = {
        transactionExecutionService: { executeTransaction },
    } as unknown as ExecuteTransactionBlockGrpcClient;
    return { client, executeTransaction };
};

const TX_BYTES = new TextEncoder().encode('fake-tx-bytes');
const TX_BYTES_B64 = toBase64(TX_BYTES);
const SIGNATURE_BYTES = new TextEncoder().encode('fake-signature');
const SIGNATURE_B64 = toBase64(SIGNATURE_BYTES);
// The digest the handler is expected to compute locally from `TX_BYTES` — the same
// `TransactionDataBuilder.getDigestFromBytes` used by `Transaction.getDigest()`.
const EXPECTED_DIGEST = TransactionDataBuilder.getDigestFromBytes(TX_BYTES);

describe('executeTransactionBlock', () => {
    it('broadcasts exactly once, decoding the base64 transaction and signature into bcs bytes', async () => {
        const { client, executeTransaction } = fakeGrpcClient({ digest: EXPECTED_DIGEST });

        await executeTransactionBlock(client, [TX_BYTES_B64, [SIGNATURE_B64], undefined]);

        expect(executeTransaction).toHaveBeenCalledTimes(1);
        const [request] = executeTransaction.mock.calls[0]!;
        expect(request).toMatchObject({
            transaction: { bcs: { value: TX_BYTES } },
            signatures: [{ bcs: { value: SIGNATURE_BYTES } }],
            readMask: { paths: ['digest', 'checkpoint', 'timestamp', 'effects.status'] },
        });
    });

    it('rejects unsupported options before broadcasting', async () => {
        const { client, executeTransaction } = fakeGrpcClient({ digest: EXPECTED_DIGEST });

        await expect(
            executeTransactionBlock(client, [
                TX_BYTES_B64,
                [SIGNATURE_B64],
                { showRawEffects: true },
            ]),
        ).rejects.toThrow(/not yet supported/);

        expect(executeTransaction).not.toHaveBeenCalled();
    });

    it('returns the locally-computed digest when the response has no transaction and nothing else was requested', async () => {
        const { client } = fakeGrpcClient(undefined);

        const result = await executeTransactionBlock(client, [
            TX_BYTES_B64,
            [SIGNATURE_B64],
            undefined,
        ]);

        expect(result).toEqual({ digest: EXPECTED_DIGEST, checkpoint: null, timestampMs: null });
    });

    it('throws when the response has no transaction but showEffects was requested', async () => {
        const { client } = fakeGrpcClient(undefined);

        await expect(
            executeTransactionBlock(client, [TX_BYTES_B64, [SIGNATURE_B64], { showEffects: true }]),
        ).rejects.toThrow(/cannot honor the requested options/);
    });

    it('throws when the response carries a different digest than the broadcast one', async () => {
        const { client } = fakeGrpcClient({ digest: 'some-other-digest' });

        await expect(
            executeTransactionBlock(client, [TX_BYTES_B64, [SIGNATURE_B64], undefined]),
        ).rejects.toThrow(/cannot confirm this response is for the right transaction/);
    });

    it('throws when the response transaction omits its digest', async () => {
        const { client } = fakeGrpcClient({
            digest: undefined,
            checkpoint: 10n,
            timestamp: { seconds: 1700000000n, nanos: 0 },
        });

        await expect(
            executeTransactionBlock(client, [TX_BYTES_B64, [SIGNATURE_B64], undefined]),
        ).rejects.toThrow(/carried digest <missing>/);
    });

    it('builds events when showEvents is requested', async () => {
        const { client } = fakeGrpcClient({
            digest: EXPECTED_DIGEST,
            events: {
                events: [
                    {
                        packageId: '0x3',
                        module: 'validator',
                        sender: '0xsender',
                        eventType:
                            '0x0000000000000000000000000000000000000000000000000000000000000003::validator::SomeEvent',
                    },
                ],
            },
        });

        const result = await executeTransactionBlock(client, [
            TX_BYTES_B64,
            [SIGNATURE_B64],
            { showEvents: true },
        ]);

        expect(result.events?.[0]?.type).toBe('0x3::validator::SomeEvent');
    });
});
