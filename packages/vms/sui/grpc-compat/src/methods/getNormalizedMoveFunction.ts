import type {
    SuiClient,
    SuiMoveAbility,
    SuiMoveNormalizedType,
    SuiMoveVisibility,
} from '@mysten/sui/client';
import { GrpcTypes, type SuiGrpcClient } from '@mysten/sui-v2/grpc';

import { toShortAddress } from '../utils';

export type NormalizedMoveFunctionGrpcClient = Pick<SuiGrpcClient, 'movePackageService'>;

type V1NormalizedMoveFunction = Awaited<ReturnType<SuiClient['getNormalizedMoveFunction']>>;

const mapAbility = (ability: GrpcTypes.Ability): SuiMoveAbility => {
    switch (ability) {
        case GrpcTypes.Ability.COPY:
            return 'Copy';
        case GrpcTypes.Ability.DROP:
            return 'Drop';
        case GrpcTypes.Ability.STORE:
            return 'Store';
        case GrpcTypes.Ability.KEY:
            return 'Key';
        default:
            throw new Error(
                `Sui gRPC compat getNormalizedMoveFunction: unrecognized ability ${ability}`,
            );
    }
};

const mapVisibility = (visibility: GrpcTypes.FunctionDescriptor_Visibility): SuiMoveVisibility => {
    switch (visibility) {
        case GrpcTypes.FunctionDescriptor_Visibility.PRIVATE:
            return 'Private';
        case GrpcTypes.FunctionDescriptor_Visibility.PUBLIC:
            return 'Public';
        case GrpcTypes.FunctionDescriptor_Visibility.FRIEND:
            return 'Friend';
        default:
            throw new Error(
                `Sui gRPC compat getNormalizedMoveFunction: unrecognized visibility ${visibility}`,
            );
    }
};

/** DATATYPE's `typeName` is `address::module::name`, address zero-padded like gRPC renders it. */
const parseDatatypeTypeName = (
    typeName: string | undefined,
): { address: string; module: string; name: string } => {
    const parts = typeName?.split('::');
    if (parts?.length !== 3) {
        throw new Error(
            `Sui gRPC compat getNormalizedMoveFunction: expected an "address::module::name" datatype, received ${JSON.stringify(typeName)}`,
        );
    }
    const [address, module, name] = parts;
    return { address: toShortAddress(address), module, name };
};

/** No `Signer` case: the v2 enum has no SIGNER variant, since Sui Move never types a param `signer`. */
const mapBody = (body: GrpcTypes.OpenSignatureBody | undefined): SuiMoveNormalizedType => {
    switch (body?.type) {
        case GrpcTypes.OpenSignatureBody_Type.BOOL:
            return 'Bool';
        case GrpcTypes.OpenSignatureBody_Type.U8:
            return 'U8';
        case GrpcTypes.OpenSignatureBody_Type.U16:
            return 'U16';
        case GrpcTypes.OpenSignatureBody_Type.U32:
            return 'U32';
        case GrpcTypes.OpenSignatureBody_Type.U64:
            return 'U64';
        case GrpcTypes.OpenSignatureBody_Type.U128:
            return 'U128';
        case GrpcTypes.OpenSignatureBody_Type.U256:
            return 'U256';
        case GrpcTypes.OpenSignatureBody_Type.ADDRESS:
            return 'Address';
        case GrpcTypes.OpenSignatureBody_Type.VECTOR: {
            const [element] = body.typeParameterInstantiation;
            return { Vector: mapBody(element) };
        }
        case GrpcTypes.OpenSignatureBody_Type.DATATYPE: {
            const { address, module, name } = parseDatatypeTypeName(body.typeName);
            return {
                Struct: {
                    address,
                    module,
                    name,
                    typeArguments: body.typeParameterInstantiation.map(mapBody),
                },
            };
        }
        case GrpcTypes.OpenSignatureBody_Type.TYPE_PARAMETER:
            if (body.typeParameter === undefined) {
                throw new Error(
                    'Sui gRPC compat getNormalizedMoveFunction: missing typeParameter index on a TYPE_PARAMETER body',
                );
            }
            return { TypeParameter: body.typeParameter };
        default:
            throw new Error(
                `Sui gRPC compat getNormalizedMoveFunction: unrecognized signature body type ${body?.type}`,
            );
    }
};

const mapSignature = (signature: GrpcTypes.OpenSignature): SuiMoveNormalizedType => {
    const body = mapBody(signature.body);
    switch (signature.reference) {
        case GrpcTypes.OpenSignature_Reference.IMMUTABLE:
            return { Reference: body };
        case GrpcTypes.OpenSignature_Reference.MUTABLE:
            return { MutableReference: body };
        default:
            return body;
    }
};

export const getNormalizedMoveFunction = async (
    grpcClient: NormalizedMoveFunctionGrpcClient,
    params: unknown[],
    signal?: AbortSignal,
): Promise<V1NormalizedMoveFunction> => {
    const [packageId, moduleName, name] = params as [string, string, string];

    const { response } = await grpcClient.movePackageService.getFunction(
        { packageId, moduleName, name },
        { abort: signal },
    );

    const fn = response.function;
    if (!fn || fn.visibility === undefined || fn.isEntry === undefined) {
        throw new Error(
            `Sui gRPC compat getNormalizedMoveFunction: function not found for ${packageId}::${moduleName}::${name}`,
        );
    }

    return {
        visibility: mapVisibility(fn.visibility),
        isEntry: fn.isEntry,
        typeParameters: fn.typeParameters.map((typeParameter) => ({
            abilities: typeParameter.constraints.map(mapAbility),
        })),
        parameters: fn.parameters.map(mapSignature),
        return: fn.returns.map(mapSignature),
    };
};
