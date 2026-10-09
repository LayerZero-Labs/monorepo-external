import { GrpcTypes } from '@mysten/sui-v2/grpc';
import { RpcError } from '@protobuf-ts/runtime-rpc';
import { describe, expect, it, vi } from 'vitest';

import type { GetObjectGrpcClient } from './getObject';
import { getObject } from './getObject';

const OBJECT_ID = `0x${'1'.repeat(64)}`;
const OWNER_ADDRESS = `0x${'2'.repeat(64)}`;
// Not a system address (0x1/0x2/0x3), so `toShortStructTag` leaves it at full width.
const OFT_TYPE = `0x${'0'.repeat(63)}abc::oft::OFT`;

const mockOftDatatype = () =>
    vi.fn().mockResolvedValue({
        response: {
            datatype: {
                kind: GrpcTypes.DatatypeDescriptor_DatatypeKind.STRUCT,
                fields: [
                    {
                        name: 'oapp_object',
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

describe('getObject', () => {
    it('maps a Move object, requesting only the fields the options ask for', async () => {
        const getObjectFn = vi.fn().mockResolvedValue({
            response: {
                object: {
                    objectId: OBJECT_ID,
                    version: 5n,
                    digest: 'digest-1',
                    objectType: OFT_TYPE,
                    hasPublicTransfer: false,
                    json: {
                        kind: {
                            oneofKind: 'structValue',
                            structValue: {
                                fields: {
                                    oapp_object: {
                                        kind: {
                                            oneofKind: 'stringValue',
                                            stringValue: OWNER_ADDRESS,
                                        },
                                    },
                                },
                            },
                        },
                    },
                    owner: { kind: 1, address: OWNER_ADDRESS },
                },
            },
        });
        const grpcClient = {
            ledgerService: { getObject: getObjectFn },
            movePackageService: { getDatatype: mockOftDatatype() },
        } as unknown as GetObjectGrpcClient;

        const result = await getObject(
            grpcClient,
            [OBJECT_ID, { showType: true, showOwner: true, showContent: true }],
            undefined,
        );

        expect(getObjectFn).toHaveBeenCalledWith(
            {
                objectId: OBJECT_ID,
                readMask: {
                    paths: expect.arrayContaining([
                        'object_id',
                        'version',
                        'digest',
                        'object_type',
                        'owner',
                        'json',
                        'has_public_transfer',
                    ]),
                },
            },
            { abort: undefined },
        );
        expect(result).toEqual({
            data: {
                objectId: OBJECT_ID,
                version: '5',
                digest: 'digest-1',
                type: OFT_TYPE,
                owner: { AddressOwner: OWNER_ADDRESS },
                content: {
                    dataType: 'moveObject',
                    type: OFT_TYPE,
                    hasPublicTransfer: false,
                    fields: { oapp_object: OWNER_ADDRESS },
                },
                previousTransaction: undefined,
                storageRebate: undefined,
            },
        });
    });

    it('omits fields the options did not request', async () => {
        const grpcClient = {
            ledgerService: {
                getObject: vi.fn().mockResolvedValue({
                    response: { object: { objectId: OBJECT_ID, version: 1n, digest: 'd' } },
                }),
            },
        } as unknown as GetObjectGrpcClient;

        const result = await getObject(grpcClient, [OBJECT_ID, undefined], undefined);

        expect(result).toEqual({
            data: {
                objectId: OBJECT_ID,
                version: '1',
                digest: 'd',
                type: undefined,
                owner: undefined,
                content: undefined,
                previousTransaction: undefined,
                storageRebate: undefined,
            },
        });
    });

    it('maps a NOT_FOUND status to the legacy notExists shape instead of throwing', async () => {
        const grpcClient = {
            ledgerService: {
                getObject: vi.fn().mockRejectedValue(new RpcError('missing', 'NOT_FOUND')),
                getServiceInfo: vi.fn().mockResolvedValue({
                    response: { chainId: '11111111111111111111111111111111', epoch: 1n },
                }),
            },
        } as unknown as GetObjectGrpcClient;

        const result = await getObject(grpcClient, [OBJECT_ID, undefined], undefined);

        expect(result).toEqual({ error: { code: 'notExists', object_id: OBJECT_ID } });
    });

    it('rethrows a non-NOT_FOUND error', async () => {
        const grpcClient = {
            ledgerService: {
                getObject: vi.fn().mockRejectedValue(new RpcError('unavailable', 'UNAVAILABLE')),
            },
        } as unknown as GetObjectGrpcClient;

        await expect(getObject(grpcClient, [OBJECT_ID, undefined], undefined)).rejects.toThrow(
            'unavailable',
        );
    });

    it('throws rather than silently ignoring showBcs/showDisplay', async () => {
        const grpcClient = {
            ledgerService: { getObject: vi.fn() },
        } as unknown as GetObjectGrpcClient;

        await expect(
            getObject(grpcClient, [OBJECT_ID, { showBcs: true }], undefined),
        ).rejects.toThrow(/showBcs and showDisplay are not yet supported/);
        await expect(
            getObject(grpcClient, [OBJECT_ID, { showDisplay: true }], undefined),
        ).rejects.toThrow(/showBcs and showDisplay are not yet supported/);
    });
});
