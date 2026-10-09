import { GrpcTypes } from '@mysten/sui-v2/grpc';
import { describe, expect, it } from 'vitest';

import { mapGrpcOwner } from './owner';

describe('mapGrpcOwner', () => {
    it('maps an address owner', () => {
        expect(mapGrpcOwner({ kind: GrpcTypes.Owner_OwnerKind.ADDRESS, address: '0x1' })).toEqual({
            AddressOwner: '0x1',
        });
    });

    it('maps an object owner', () => {
        expect(mapGrpcOwner({ kind: GrpcTypes.Owner_OwnerKind.OBJECT, address: '0x1' })).toEqual({
            ObjectOwner: '0x1',
        });
    });

    it('maps a shared owner with a numeric (not stringified) initial_shared_version', () => {
        expect(mapGrpcOwner({ kind: GrpcTypes.Owner_OwnerKind.SHARED, version: 7n })).toEqual({
            Shared: { initial_shared_version: 7 },
        });
    });

    it('maps an immutable owner', () => {
        expect(mapGrpcOwner({ kind: GrpcTypes.Owner_OwnerKind.IMMUTABLE })).toBe('Immutable');
    });

    it('maps a consensus address owner with a numeric (not stringified) start_version', () => {
        expect(
            mapGrpcOwner({
                kind: GrpcTypes.Owner_OwnerKind.CONSENSUS_ADDRESS,
                address: '0x1',
                version: 3n,
            }),
        ).toEqual({ ConsensusAddressOwner: { owner: '0x1', start_version: 3 } });
    });

    it('throws when the owner kind is missing', () => {
        expect(() => mapGrpcOwner(undefined)).toThrow(/missing owner kind/);
        expect(() => mapGrpcOwner({})).toThrow(/missing owner kind/);
    });

    it('throws when address is missing for an address owner', () => {
        expect(() => mapGrpcOwner({ kind: GrpcTypes.Owner_OwnerKind.ADDRESS })).toThrow(/address/);
    });

    it('throws when address is missing for an object owner', () => {
        expect(() => mapGrpcOwner({ kind: GrpcTypes.Owner_OwnerKind.OBJECT })).toThrow(/address/);
    });

    it('throws when version is missing for a shared owner', () => {
        expect(() => mapGrpcOwner({ kind: GrpcTypes.Owner_OwnerKind.SHARED })).toThrow(/version/);
    });

    it('throws when address or version is missing for a consensus address owner', () => {
        expect(() => mapGrpcOwner({ kind: GrpcTypes.Owner_OwnerKind.CONSENSUS_ADDRESS })).toThrow(
            /address/,
        );
        expect(() =>
            mapGrpcOwner({ kind: GrpcTypes.Owner_OwnerKind.CONSENSUS_ADDRESS, address: '0x1' }),
        ).toThrow(/version/);
    });
});
