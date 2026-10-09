import { GrpcTypes } from '@mysten/sui-v2/grpc';
import { describe, expect, it, vi } from 'vitest';

import type { GetOwnedObjectsGrpcClient } from './getOwnedObjects';
import { getOwnedObjects } from './getOwnedObjects';

const OWNER = `0x${'1'.repeat(64)}`;
const UPGRADE_CAP_ID = `0x${'2'.repeat(64)}`;
const UPGRADE_CAP_TYPE = '0x2::package::UpgradeCap';

const mockUpgradeCapDatatype = () =>
    vi.fn().mockResolvedValue({
        response: {
            datatype: {
                kind: GrpcTypes.DatatypeDescriptor_DatatypeKind.STRUCT,
                fields: [
                    {
                        name: 'package',
                        type: {
                            type: GrpcTypes.OpenSignatureBody_Type.ADDRESS,
                            typeParameterInstantiation: [],
                        },
                    },
                ],
                variants: [],
            } as GrpcTypes.DatatypeDescriptor,
        },
    });

describe('getOwnedObjects', () => {
    it('maps a StructType filter to the v2 objectType param and pages results', async () => {
        const listOwnedObjects = vi.fn().mockResolvedValue({
            response: {
                objects: [
                    {
                        objectId: UPGRADE_CAP_ID,
                        version: 3n,
                        digest: 'd',
                        objectType: UPGRADE_CAP_TYPE,
                        json: {
                            kind: {
                                oneofKind: 'structValue',
                                structValue: {
                                    fields: {
                                        package: {
                                            kind: {
                                                oneofKind: 'stringValue',
                                                stringValue: '0xabc',
                                            },
                                        },
                                    },
                                },
                            },
                        },
                    },
                ],
                nextPageToken: new Uint8Array([1, 2]),
            },
        });
        const grpcClient = {
            stateService: { listOwnedObjects },
            movePackageService: { getDatatype: mockUpgradeCapDatatype() },
        } as unknown as GetOwnedObjectsGrpcClient;

        const result = await getOwnedObjects(
            grpcClient,
            [
                OWNER,
                { filter: { StructType: UPGRADE_CAP_TYPE }, options: { showContent: true } },
                null,
                undefined,
            ],
            undefined,
        );

        expect(listOwnedObjects).toHaveBeenCalledWith(
            {
                owner: OWNER,
                objectType: UPGRADE_CAP_TYPE,
                pageToken: undefined,
                pageSize: 50,
                readMask: expect.any(Object),
            },
            { abort: undefined },
        );
        expect(result).toEqual({
            data: [
                {
                    data: {
                        objectId: UPGRADE_CAP_ID,
                        version: '3',
                        digest: 'd',
                        type: undefined,
                        owner: undefined,
                        content: {
                            dataType: 'moveObject',
                            type: UPGRADE_CAP_TYPE,
                            hasPublicTransfer: false,
                            fields: { package: '0xabc' },
                        },
                        previousTransaction: undefined,
                        storageRebate: undefined,
                    },
                },
            ],
            hasNextPage: true,
            nextCursor: 'AQI=', // [1, 2]
        });
    });

    it('decodes a base64 cursor back to page bytes', async () => {
        const listOwnedObjects = vi
            .fn()
            .mockResolvedValue({ response: { objects: [], nextPageToken: undefined } });
        const grpcClient = {
            stateService: { listOwnedObjects },
        } as unknown as GetOwnedObjectsGrpcClient;
        const cursor = 'CQk='; // [9, 9]

        const result = await getOwnedObjects(grpcClient, [OWNER, undefined, cursor, 10], undefined);

        expect(listOwnedObjects).toHaveBeenCalledWith(
            expect.objectContaining({
                pageToken: new Uint8Array([9, 9]),
                pageSize: 10,
                objectType: undefined,
            }),
            { abort: undefined },
        );
        expect(result).toMatchObject({ hasNextPage: false, nextCursor: null });
    });

    it('throws on a filter shape other than StructType instead of silently ignoring it', async () => {
        const grpcClient = {
            stateService: { listOwnedObjects: vi.fn() },
        } as unknown as GetOwnedObjectsGrpcClient;

        await expect(
            getOwnedObjects(
                grpcClient,
                [OWNER, { filter: { AddressOwner: OWNER } }, null, null],
                undefined,
            ),
        ).rejects.toThrow(/is not yet supported/);
    });
});
