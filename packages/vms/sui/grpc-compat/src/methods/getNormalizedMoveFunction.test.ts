import type { SuiGrpcClient } from '@mysten/sui-v2/grpc';
import { GrpcTypes } from '@mysten/sui-v2/grpc';
import { describe, expect, it, vi } from 'vitest';

import type { NormalizedMoveFunctionGrpcClient } from './getNormalizedMoveFunction';
import { getNormalizedMoveFunction } from './getNormalizedMoveFunction';

const PACKAGE_ID = '0x2';

const openSignature = (
    body: object,
    reference: GrpcTypes.OpenSignature_Reference = GrpcTypes.OpenSignature_Reference
        .REFERENCE_UNKNOWN,
): GrpcTypes.OpenSignature => ({ reference, body: body as GrpcTypes.OpenSignatureBody });

const grpcClientWith = (
    fn: Partial<GrpcTypes.FunctionDescriptor> | undefined,
): NormalizedMoveFunctionGrpcClient => ({
    movePackageService: {
        getFunction: vi.fn().mockResolvedValue({ response: { function: fn } }),
    } as unknown as SuiGrpcClient['movePackageService'],
});

describe('getNormalizedMoveFunction', () => {
    it('maps a generic function over a struct reference, matching public fun value<T>(self: &Coin<T>): u64', async () => {
        const grpcClient = grpcClientWith({
            visibility: GrpcTypes.FunctionDescriptor_Visibility.PUBLIC,
            isEntry: false,
            typeParameters: [{ constraints: [], isPhantom: false }],
            parameters: [
                openSignature(
                    {
                        type: GrpcTypes.OpenSignatureBody_Type.DATATYPE,
                        typeName: `0x${'0'.repeat(63)}2::coin::Coin`,
                        typeParameterInstantiation: [
                            {
                                type: GrpcTypes.OpenSignatureBody_Type.TYPE_PARAMETER,
                                typeParameter: 0,
                            },
                        ],
                    },
                    GrpcTypes.OpenSignature_Reference.IMMUTABLE,
                ),
            ],
            returns: [openSignature({ type: GrpcTypes.OpenSignatureBody_Type.U64 })],
        });

        const result = await getNormalizedMoveFunction(
            grpcClient,
            [PACKAGE_ID, 'coin', 'value'],
            undefined,
        );

        expect(grpcClient.movePackageService.getFunction).toHaveBeenCalledWith(
            { packageId: PACKAGE_ID, moduleName: 'coin', name: 'value' },
            { abort: undefined },
        );
        expect(result).toEqual({
            visibility: 'Public',
            isEntry: false,
            typeParameters: [{ abilities: [] }],
            parameters: [
                {
                    Reference: {
                        Struct: {
                            address: '0x2',
                            module: 'coin',
                            name: 'Coin',
                            typeArguments: [{ TypeParameter: 0 }],
                        },
                    },
                },
            ],
            return: ['U64'],
        });
    });

    it('maps abilities, a vector parameter, and a mutable reference', async () => {
        const grpcClient = grpcClientWith({
            visibility: GrpcTypes.FunctionDescriptor_Visibility.FRIEND,
            isEntry: true,
            typeParameters: [{ constraints: [GrpcTypes.Ability.COPY, GrpcTypes.Ability.DROP] }],
            parameters: [
                openSignature(
                    {
                        type: GrpcTypes.OpenSignatureBody_Type.VECTOR,
                        typeParameterInstantiation: [
                            {
                                type: GrpcTypes.OpenSignatureBody_Type.U8,
                                typeParameterInstantiation: [],
                            },
                        ],
                    },
                    GrpcTypes.OpenSignature_Reference.MUTABLE,
                ),
            ],
            returns: [],
        });

        const result = await getNormalizedMoveFunction(
            grpcClient,
            [PACKAGE_ID, 'm', 'f'],
            undefined,
        );

        expect(result).toEqual({
            visibility: 'Friend',
            isEntry: true,
            typeParameters: [{ abilities: ['Copy', 'Drop'] }],
            parameters: [{ MutableReference: { Vector: 'U8' } }],
            return: [],
        });
    });

    it('throws when the function is not found', async () => {
        const grpcClient = grpcClientWith(undefined);

        await expect(
            getNormalizedMoveFunction(grpcClient, [PACKAGE_ID, 'm', 'missing'], undefined),
        ).rejects.toThrow('function not found');
    });

    it('throws on an unrecognized signature body type instead of silently dropping it', async () => {
        const grpcClient = grpcClientWith({
            visibility: GrpcTypes.FunctionDescriptor_Visibility.PUBLIC,
            isEntry: false,
            typeParameters: [],
            parameters: [openSignature({ type: GrpcTypes.OpenSignatureBody_Type.TYPE_UNKNOWN })],
            returns: [],
        });

        await expect(
            getNormalizedMoveFunction(grpcClient, [PACKAGE_ID, 'm', 'f'], undefined),
        ).rejects.toThrow('unrecognized signature body type');
    });
});
