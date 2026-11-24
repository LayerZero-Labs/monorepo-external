import { NORMALIZED_HEX_ZERO } from '@layerzerolabs/common-chain-model';
import { NonRetryableError } from '@layerzerolabs/common-error-utils';
import { type ChainName, getChainTypeForChainName } from '@layerzerolabs/layerzero-definitions';

import { getContractRoleCatalog, type RoleCatalog } from './catalog';
import {
    type AccessControlConfig,
    describeAccessControlAddress,
    isSenderEntityAccessControlAddress,
} from './schema';

export interface AccessControlResource<Kind extends string = string> {
    id: string;
    type: Kind;
    chainName: ChainName;
}

export const findAccessControlIssues = <Kind extends string>(
    config: AccessControlConfig,
    resources: readonly AccessControlResource<Kind>[],
    catalog: RoleCatalog<Kind>,
): string[] => {
    const issues: string[] = [];
    const byId = new Map(resources.map((resource) => [resource.id, resource]));
    for (const resourceId of Object.keys(config.resources)) {
        if (!byId.has(resourceId)) {
            issues.push(`accessControl declares unknown resource "${resourceId}"`);
        }
    }
    for (const resource of resources) {
        const chainType = getChainTypeForChainName(resource.chainName);
        const roles = getContractRoleCatalog(catalog, chainType, resource.type);
        const map = Object.hasOwn(config.resources, resource.id)
            ? config.resources[resource.id]
            : undefined;
        const where = `${resource.type} on ${resource.chainName}`;
        if (!roles) {
            if (Object.hasOwn(catalog, chainType) && catalog[chainType] !== undefined) {
                issues.push(
                    `${resource.id}: ${where} is not in the role catalog; add it, with an empty entry if it has no roles`,
                );
            } else if (map) {
                issues.push(`${resource.id}: access control is not implemented on ${chainType}`);
            }
            continue;
        }
        for (const role of Object.keys(roles)) {
            if (!map || !Object.hasOwn(map, role)) {
                issues.push(
                    `${resource.id}: ${where} has role ${role}, which the access-control map does not name`,
                );
            }
        }
        for (const [role, members] of Object.entries(map ?? {})) {
            const catalogRole = Object.hasOwn(roles, role) ? roles[role] : undefined;
            if (!catalogRole) {
                issues.push(`${resource.id}: ${where} has no role ${role}`);
                continue;
            }
            const declared = new Map<string, boolean>();
            const literal = new Set<string>();
            const conflicting = new Set<string>();
            for (const { address, hasRole } of members) {
                const key = describeAccessControlAddress(address);
                if (!isSenderEntityAccessControlAddress(address)) literal.add(key);
                if (
                    !isSenderEntityAccessControlAddress(address) &&
                    address === NORMALIZED_HEX_ZERO
                ) {
                    issues.push(`${resource.id}: ${role} names the zero address`);
                    continue;
                }
                if (declared.has(key) && declared.get(key) !== hasRole && !conflicting.has(key)) {
                    issues.push(`${resource.id}: ${key} is declared both with and without ${role}`);
                    conflicting.add(key);
                }
                declared.set(key, declared.get(key) === true || hasRole);
            }
            const holders = [...declared].filter(([, hasRole]) => hasRole).map(([key]) => key);
            if (
                catalogRole.holders === 'single' &&
                holders.filter((key) => literal.has(key)).length > 1
            ) {
                issues.push(
                    `${resource.id}: ${role} has a single holder on ${where}, but the map gives it to ${holders.join(', ')}`,
                );
            }
            if (catalogRole.holders === 'single' && holders.length === 0 && declared.size > 0) {
                issues.push(
                    `${resource.id}: ${role} has a single holder on ${where}, but the map only removes holders; name the new holder, or leave the list empty to keep the current one`,
                );
            }
        }
    }
    return issues;
};

export const assertAccessControlConfig = <Kind extends string>(
    config: AccessControlConfig,
    resources: readonly AccessControlResource<Kind>[],
    catalog: RoleCatalog<Kind>,
): void => {
    const issues = findAccessControlIssues(config, resources, catalog);
    if (issues.length > 0) {
        throw new NonRetryableError(`Invalid access-control config:\n${issues.join('\n')}`);
    }
};
