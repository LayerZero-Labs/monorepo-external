import { GrpcTypes } from '@mysten/sui-v2/grpc';
import { describe, expect, it } from 'vitest';

import { isSuiCompatProviderSpecificError } from '../errors';
import { getTransactionBlock, type TransactionBlockGrpcClient } from './getTransactionBlock';

const fakeGrpcClient = (transaction: unknown): TransactionBlockGrpcClient =>
    ({
        ledgerService: {
            getTransaction: async () => ({ response: { transaction } }),
        },
    }) as unknown as TransactionBlockGrpcClient;

describe('getTransactionBlock', () => {
    it('throws when the gRPC response has no transaction at all', async () => {
        await expect(
            getTransactionBlock(fakeGrpcClient(undefined), ['abc123', {}]),
        ).rejects.toThrow(/transaction not found/);
    });

    it('marks the not-found error as provider-specific, not a request-shape problem', async () => {
        await expect(
            getTransactionBlock(fakeGrpcClient(undefined), ['abc123', {}]),
        ).rejects.toSatisfy(isSuiCompatProviderSpecificError);
    });

    it('throws when the response transaction carries no digest', async () => {
        await expect(
            getTransactionBlock(fakeGrpcClient({ digest: undefined }), ['abc123', {}]),
        ).rejects.toThrow(/cannot confirm this response is for the right transaction/);
    });

    it('does not mark the digest-mismatch guard as provider-specific — it fails the same way on every provider', async () => {
        await expect(
            getTransactionBlock(fakeGrpcClient({ digest: undefined }), ['abc123', {}]),
        ).rejects.not.toSatisfy(isSuiCompatProviderSpecificError);
    });

    it('throws when the response transaction carries a different digest than requested', async () => {
        await expect(
            getTransactionBlock(fakeGrpcClient({ digest: 'other456' }), ['abc123', {}]),
        ).rejects.toThrow(/cannot confirm this response is for the right transaction/);
    });

    it('throws rather than reporting a false failure when effects.status is missing', async () => {
        await expect(
            getTransactionBlock(fakeGrpcClient({ digest: 'abc123', effects: {} }), [
                'abc123',
                { showEffects: true },
            ]),
        ).rejects.toThrow(/no effects\.status/);
    });

    it('substitutes the v1 zero-address placeholder when effects carries no gas object', async () => {
        const result = await getTransactionBlock(
            fakeGrpcClient({
                digest: 'abc123',
                effects: {
                    status: { success: true },
                    epoch: 1n,
                    gasUsed: {
                        computationCost: 1n,
                        storageCost: 1n,
                        storageRebate: 1n,
                        nonRefundableStorageFee: 1n,
                    },
                    transactionDigest: 'abc123',
                    // No `gasObject` — the transaction paid gas from the sender's address balance.
                },
            }),
            ['abc123', { showEffects: true }],
        );

        expect(result.effects?.gasObject).toEqual({
            owner: { AddressOwner: `0x${'0'.repeat(64)}` },
            reference: {
                objectId: `0x${'0'.repeat(64)}`,
                version: '0',
                digest: '1'.repeat(32),
            },
        });
    });

    it('normalizes a created object change objectType to the v1 short-address form', async () => {
        const result = await getTransactionBlock(
            fakeGrpcClient({
                digest: 'abc123',
                transaction: { sender: '0xsender' },
                effects: {
                    changedObjects: [
                        {
                            objectId: '0x1',
                            objectType:
                                '0x0000000000000000000000000000000000000000000000000000000000000002::coin::Coin<0x0000000000000000000000000000000000000000000000000000000000000002::sui::SUI>',
                            outputVersion: 1n,
                            outputDigest: 'digest1',
                            idOperation: GrpcTypes.ChangedObject_IdOperation.CREATED,
                            outputState: GrpcTypes.ChangedObject_OutputObjectState.OBJECT_WRITE,
                            outputOwner: {
                                kind: GrpcTypes.Owner_OwnerKind.ADDRESS,
                                address: '0xsender',
                            },
                        },
                    ],
                },
            }),
            ['abc123', { showObjectChanges: true }],
        );

        expect(result.objectChanges?.[0]).toMatchObject({
            objectType: '0x2::coin::Coin<0x2::sui::SUI>',
        });
    });

    it('omits every deleted object from objectChanges, matching legacy', async () => {
        const deletedChange = (objectId: string) => ({
            objectId,
            objectType: '0x2::coin::Coin<0x2::sui::SUI>',
            idOperation: GrpcTypes.ChangedObject_IdOperation.DELETED,
            outputState: GrpcTypes.ChangedObject_OutputObjectState.DOES_NOT_EXIST,
            inputState: GrpcTypes.ChangedObject_InputObjectState.EXISTS,
        });
        const mutatedChange = (objectId: string) => ({
            objectId,
            objectType: '0x2::coin::Coin<0x2::sui::SUI>',
            outputVersion: 2n,
            outputDigest: 'digest2',
            inputVersion: 1n,
            idOperation: GrpcTypes.ChangedObject_IdOperation.NONE,
            outputState: GrpcTypes.ChangedObject_OutputObjectState.OBJECT_WRITE,
            outputOwner: { kind: GrpcTypes.Owner_OwnerKind.ADDRESS, address: '0xsender' },
        });

        const result = await getTransactionBlock(
            fakeGrpcClient({
                digest: 'abc123',
                transaction: { sender: '0xsender' },
                effects: {
                    changedObjects: [
                        mutatedChange('0xprimary'),
                        // A coin deleted by gas-smashing and a plain, unrelated deleted coin —
                        // v1 leaves both out, not just the gas-smashing case.
                        deletedChange('0xsmashed'),
                        deletedChange('0xunrelated'),
                    ],
                },
            }),
            ['abc123', { showObjectChanges: true }],
        );

        expect(result.objectChanges).toEqual([
            expect.objectContaining({ type: 'mutated', objectId: '0xprimary' }),
        ]);
    });

    it('omits a wrapped object from objectChanges, matching legacy', async () => {
        const result = await getTransactionBlock(
            fakeGrpcClient({
                digest: 'abc123',
                transaction: { sender: '0xsender' },
                effects: {
                    changedObjects: [
                        {
                            objectId: '0xwrapped',
                            objectType: '0x2::coin::Coin<0x2::sui::SUI>',
                            idOperation: GrpcTypes.ChangedObject_IdOperation.NONE,
                            outputState: GrpcTypes.ChangedObject_OutputObjectState.DOES_NOT_EXIST,
                            inputState: GrpcTypes.ChangedObject_InputObjectState.EXISTS,
                        },
                    ],
                },
            }),
            ['abc123', { showObjectChanges: true }],
        );

        expect(result.objectChanges).toEqual([]);
    });

    it('shortens a system-package event type, matching legacy', async () => {
        const result = await getTransactionBlock(
            fakeGrpcClient({
                digest: 'abc123',
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
            }),
            ['abc123', { showEvents: true }],
        );

        expect(result.events?.[0]?.type).toBe('0x3::validator::SomeEvent');
    });
});
