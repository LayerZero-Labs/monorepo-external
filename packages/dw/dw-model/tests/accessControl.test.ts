import { describe, expect, it } from 'vitest';

import { NORMALIZED_HEX_ZERO, type NormalizedHexString } from '@layerzerolabs/common-chain-model';
import { NonRetryableError } from '@layerzerolabs/common-error-utils';
import { type ChainName, ChainType } from '@layerzerolabs/layerzero-definitions';

import {
    type AccessControlConfig,
    accessControlConfigSchema,
    assertAccessControlConfig,
    findAccessControlIssues,
    type RoleCatalog,
    withoutRole,
    withRole,
} from '../src/access-control';

type Kind = 'EXECUTOR' | 'ENDPOINT' | 'COUNTER' | 'ORACLE';

const catalog: RoleCatalog<Kind> = {
    [ChainType.EVM]: {
        EXECUTOR: {
            owner: { holders: 'single', enumerable: true, transfer: 'oneStep' },
            ADMIN_ROLE: { holders: 'multi', enumerable: false, transfer: 'oneStep' },
        },
        ENDPOINT: {
            owner: { holders: 'single', enumerable: true, transfer: 'oneStep' },
        },
        COUNTER: {},
    },
};

const ethereum = 'ethereum' as ChainName;
const sui = 'sui' as ChainName;
const executor = { id: 'executor-ethereum', type: 'EXECUTOR' as const, chainName: ethereum };
const endpoint = { id: 'endpoint-ethereum', type: 'ENDPOINT' as const, chainName: ethereum };
const counter = { id: 'counter-ethereum', type: 'COUNTER' as const, chainName: ethereum };
const oracle = { id: 'oracle-ethereum', type: 'ORACLE' as const, chainName: ethereum };
const suiEndpoint = { id: 'endpoint-sui', type: 'ENDPOINT' as const, chainName: sui };

const oneSig = { senderEntity: 'ProtocolOneSig' };
const relayer = '0xaa' as NormalizedHexString;
const deployer = '0xbb' as NormalizedHexString;

const valid: AccessControlConfig = {
    resources: {
        [executor.id]: {
            owner: [withRole(oneSig)],
            ADMIN_ROLE: [withRole(relayer), withRole(oneSig), withoutRole(deployer)],
        },
        [endpoint.id]: { owner: [withRole(oneSig)] },
    },
};

const issues = (config: AccessControlConfig, resources = [executor, endpoint]) =>
    findAccessControlIssues(config, resources, catalog);

describe('accessControlConfigSchema', () => {
    it('parses a per-resource role map', () => {
        expect(accessControlConfigSchema.parse(valid)).toEqual(valid);
    });

    it('rejects the zero address', () => {
        expect(() =>
            accessControlConfigSchema.parse({
                resources: { [endpoint.id]: { owner: [withRole('0x0' as NormalizedHexString)] } },
            }),
        ).toThrow(/zero address/);
    });
});

describe('findAccessControlIssues', () => {
    it('accepts a map that names every catalog role', () => {
        expect(issues(valid)).toEqual([]);
    });

    it('reports a catalog role the map does not name', () => {
        const { ADMIN_ROLE: _, ...withoutAdmin } = valid.resources[executor.id]!;
        expect(issues({ resources: { ...valid.resources, [executor.id]: withoutAdmin } })).toEqual([
            'executor-ethereum: EXECUTOR on ethereum has role ADMIN_ROLE, which the access-control map does not name',
        ]);
    });

    it('reports every catalog role of a resource with no map', () => {
        expect(issues({ resources: { [executor.id]: valid.resources[executor.id]! } })).toEqual([
            'endpoint-ethereum: ENDPOINT on ethereum has role owner, which the access-control map does not name',
        ]);
    });

    it('treats an empty list as named', () => {
        expect(
            issues({
                resources: { ...valid.resources, [executor.id]: { owner: [], ADMIN_ROLE: [] } },
            }),
        ).toEqual([]);
    });

    it('reports a role the contract does not have', () => {
        expect(
            issues({
                resources: {
                    ...valid.resources,
                    [endpoint.id]: { owner: [withRole(oneSig)], ADMIN_ROLE: [withRole(relayer)] },
                },
            }),
        ).toEqual(['endpoint-ethereum: ENDPOINT on ethereum has no role ADMIN_ROLE']);
    });

    it('reports a role on a contract kind with no roles', () => {
        expect(
            issues(
                { resources: { ...valid.resources, [counter.id]: { owner: [withRole(oneSig)] } } },
                [executor, endpoint, counter],
            ),
        ).toEqual(['counter-ethereum: COUNTER on ethereum has no role owner']);
    });

    it('requires nothing of a contract kind with no roles', () => {
        expect(issues(valid, [executor, endpoint, counter])).toEqual([]);
    });

    it('reports a contract kind missing from the catalog of a covered chain type', () => {
        expect(issues(valid, [executor, endpoint, oracle])).toEqual([
            'oracle-ethereum: ORACLE on ethereum is not in the role catalog; add it, with an empty entry if it has no roles',
        ]);
    });

    it('treats a chain type whose catalog entry is undefined as not covered', () => {
        const partial: RoleCatalog<Kind> = { ...catalog, [ChainType.SUIMOVE]: undefined };
        expect(findAccessControlIssues(valid, [executor, endpoint, suiEndpoint], partial)).toEqual(
            [],
        );
        expect(
            findAccessControlIssues(
                { resources: { ...valid.resources, [suiEndpoint.id]: { owner: [] } } },
                [executor, endpoint, suiEndpoint],
                partial,
            ),
        ).toEqual([`endpoint-sui: access control is not implemented on ${ChainType.SUIMOVE}`]);
    });

    it('reports a single-holder role that the map only removes', () => {
        expect(
            issues({
                resources: {
                    ...valid.resources,
                    [endpoint.id]: { owner: [withoutRole(deployer)] },
                },
            }),
        ).toEqual([
            'endpoint-ethereum: owner has a single holder on ENDPOINT on ethereum, but the map only removes holders; name the new holder, or leave the list empty to keep the current one',
        ]);
    });

    it('reports more than one literal holder of a single-holder role', () => {
        expect(
            issues({
                resources: {
                    ...valid.resources,
                    [endpoint.id]: {
                        owner: [withRole(oneSig), withRole(relayer), withRole(deployer)],
                    },
                },
            }),
        ).toEqual([
            `endpoint-ethereum: owner has a single holder on ENDPOINT on ethereum, but the map gives it to sender entity ProtocolOneSig, ${relayer}, ${deployer}`,
        ]);
    });

    it.each([
        [withRole(oneSig), withRole(relayer)],
        [withRole(oneSig), withRole({ senderEntity: 'Relayer' })],
    ])(
        'leaves a single-holder role named by a sender entity and another form to the planner, which compares resolved addresses',
        (...owner) => {
            expect(issues({ resources: { ...valid.resources, [endpoint.id]: { owner } } })).toEqual(
                [],
            );
        },
    );

    it('allows a single-holder role with one holder and explicit non-holders', () => {
        expect(
            issues({
                resources: {
                    ...valid.resources,
                    [endpoint.id]: { owner: [withRole(oneSig), withoutRole(deployer)] },
                },
            }),
        ).toEqual([]);
    });

    it('reports an address declared both with and without a role', () => {
        expect(
            issues({
                resources: {
                    ...valid.resources,
                    [executor.id]: {
                        owner: [withRole(oneSig)],
                        ADMIN_ROLE: [withRole(relayer), withoutRole(relayer)],
                    },
                },
            }),
        ).toEqual([`executor-ethereum: ${relayer} is declared both with and without ADMIN_ROLE`]);
    });

    it.each([
        [withRole(relayer), withoutRole(relayer)],
        [withoutRole(relayer), withRole(relayer)],
        [withRole(relayer), withoutRole(relayer), withoutRole(relayer)],
    ])('reports a conflicting single-holder entry once, whatever the order', (...owner) => {
        expect(issues({ resources: { ...valid.resources, [endpoint.id]: { owner } } })).toEqual([
            `endpoint-ethereum: ${relayer} is declared both with and without owner`,
        ]);
    });

    it.each(['constructor', 'toString', 'hasOwnProperty', 'valueOf'])(
        'reports a role named like an Object.prototype key (%s) that the contract does not have',
        (role) => {
            expect(
                issues({
                    resources: {
                        ...valid.resources,
                        [endpoint.id]: { owner: [withRole(oneSig)], [role]: [withRole(relayer)] },
                    },
                }),
            ).toEqual([`endpoint-ethereum: ENDPOINT on ethereum has no role ${role}`]);
        },
    );

    it('reports the zero address', () => {
        expect(
            issues({
                resources: {
                    ...valid.resources,
                    [endpoint.id]: { owner: [withRole(NORMALIZED_HEX_ZERO)] },
                },
            }),
        ).toEqual(['endpoint-ethereum: owner names the zero address']);
    });

    it('reports an unknown resource id', () => {
        expect(
            issues({ resources: { ...valid.resources, 'dvn-ethereum': { owner: [] } } }),
        ).toEqual(['accessControl declares unknown resource "dvn-ethereum"']);
    });

    it('reports a map on a chain type the catalog does not cover', () => {
        expect(
            issues(
                {
                    resources: {
                        ...valid.resources,
                        [suiEndpoint.id]: { owner: [withRole(oneSig)] },
                    },
                },
                [executor, endpoint, suiEndpoint],
            ),
        ).toEqual(['endpoint-sui: access control is not implemented on suiMove']);
    });

    it('requires nothing on a chain type the catalog does not cover', () => {
        expect(issues(valid, [executor, endpoint, suiEndpoint])).toEqual([]);
    });
});

describe('assertAccessControlConfig', () => {
    it('throws a non-retryable error listing every issue', () => {
        const run = () =>
            assertAccessControlConfig({ resources: {} }, [executor, endpoint], catalog);
        expect(run).toThrow(NonRetryableError);
        expect(run).toThrow(/ADMIN_ROLE[\s\S]*owner/);
    });

    it('passes a valid config', () => {
        expect(() => assertAccessControlConfig(valid, [executor, endpoint], catalog)).not.toThrow();
    });
});
