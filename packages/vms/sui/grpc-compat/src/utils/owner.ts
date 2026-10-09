import type { ObjectOwner } from '@mysten/sui/client';
import { GrpcTypes } from '@mysten/sui-v2/grpc';

import { assertDefined } from './assert';

// Typed as `string` on `ObjectOwner`, but the full node sends unquoted numbers (verified via
// mainnet `sui_getObject`). `number`/`string` don't overlap, so bridge through `unknown`, cast to
// the SDK's own field type rather than a hardcoded `string`.
type SharedOwner = Extract<ObjectOwner, { Shared: unknown }>;
type ConsensusAddressOwnerVariant = Extract<ObjectOwner, { ConsensusAddressOwner: unknown }>;

/** Maps a gRPC `Owner` to the v1 JSON-RPC `ObjectOwner` shape. */
export const mapGrpcOwner = (owner: GrpcTypes.Owner | undefined): ObjectOwner => {
    if (owner?.kind === undefined) {
        throw new Error('Sui gRPC compat mapGrpcOwner: missing owner kind');
    }

    switch (owner.kind) {
        case GrpcTypes.Owner_OwnerKind.ADDRESS:
            return { AddressOwner: assertDefined(owner.address, 'mapGrpcOwner', 'address') };
        case GrpcTypes.Owner_OwnerKind.OBJECT:
            return { ObjectOwner: assertDefined(owner.address, 'mapGrpcOwner', 'address') };
        case GrpcTypes.Owner_OwnerKind.SHARED:
            return {
                Shared: {
                    initial_shared_version: Number(
                        assertDefined(owner.version, 'mapGrpcOwner', 'version'),
                    ) as unknown as SharedOwner['Shared']['initial_shared_version'],
                },
            };
        case GrpcTypes.Owner_OwnerKind.IMMUTABLE:
            return 'Immutable';
        case GrpcTypes.Owner_OwnerKind.CONSENSUS_ADDRESS:
            return {
                ConsensusAddressOwner: {
                    owner: assertDefined(owner.address, 'mapGrpcOwner', 'address'),
                    start_version: Number(
                        assertDefined(owner.version, 'mapGrpcOwner', 'version'),
                    ) as unknown as ConsensusAddressOwnerVariant['ConsensusAddressOwner']['start_version'],
                },
            };
        default:
            throw new Error(`Sui gRPC compat mapGrpcOwner: unknown owner kind ${owner.kind}`);
    }
};
