import type { ChainType } from '@layerzerolabs/layerzero-definitions';

export type CatalogRoleTransfer =
    | 'oneStep'
    | 'twoStep'
    | 'replaceList'
    | 'senderless'
    | 'immutable';

export interface CatalogRole {
    holders: 'single' | 'multi';
    enumerable: boolean;
    transfer: CatalogRoleTransfer;
}

export type ContractRoleCatalog = Readonly<Record<string, CatalogRole>>;

export type RoleCatalog<Kind extends string = string> = Partial<
    Record<ChainType, Partial<Record<Kind, ContractRoleCatalog>>>
>;

export const getContractRoleCatalog = <Kind extends string>(
    catalog: RoleCatalog<Kind>,
    chainType: ChainType,
    kind: Kind,
): ContractRoleCatalog | undefined => {
    const byKind = Object.hasOwn(catalog, chainType) ? catalog[chainType] : undefined;
    if (!byKind) {
        return undefined;
    }
    return Object.hasOwn(byKind, kind) ? byKind[kind] : undefined;
};

export const UPGRADE_AUTHORITY_ROLE = 'upgradeAuthority';

export const proxiedRbac2StepRoleCatalog = (
    adminRole: string,
    roles: readonly string[],
): ContractRoleCatalog => ({
    [UPGRADE_AUTHORITY_ROLE]: { holders: 'single', enumerable: true, transfer: 'twoStep' },
    ...Object.fromEntries(
        roles.map((role): [string, CatalogRole] => [
            role,
            role === adminRole
                ? { holders: 'single', enumerable: true, transfer: 'twoStep' }
                : { holders: 'multi', enumerable: true, transfer: 'oneStep' },
        ]),
    ),
});
