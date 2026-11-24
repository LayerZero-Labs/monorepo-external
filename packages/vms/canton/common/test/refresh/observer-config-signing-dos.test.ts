import { describe, expect, it, vi } from 'vitest';

import type { ICantonClient } from '../../src/client/interface';
import {
    CANTON_DEFERRED_SENDER,
    cantonActiveContractIdRef,
    encodeCantonDeferredValue,
    parseCantonDeferredValue,
} from '../../src/deferredValue';
import type { JsActiveContract } from '../../src/open-api/models';
import {
    createContractAddressResolver,
    matchesContractStateFilter,
    queryLiveContractsForRef,
} from '../../src/refresh/address-resolver';
import { buildCantonDeployedContractAddressRef } from '../../src/refresh/deployment-address';
import {
    areExpectedSignatories,
    isSignatoryOrigin,
    isTrustedOrigin,
} from '../../src/trusted-origin';

const HANDLER = 'lz-handler::namespace';
const ATTACKER = 'attacker::namespace';
const GATEWAY = 'lz-gateway::namespace';
const TEMPLATE_ID = '#layerzero-request-factory:RequestFactoryConfig:RequestFactoryConfig';

const configContract = ({
    contractId,
    handler,
    signatories,
    observers = [HANDLER],
    createArgument,
}: {
    contractId: string;
    handler: string;
    signatories: string[];
    observers?: string[];
    createArgument?: Record<string, unknown>;
}): JsActiveContract =>
    ({
        createdEvent: {
            offset: 1,
            nodeId: 0,
            contractId,
            templateId: 'pkg:RequestFactoryConfig:RequestFactoryConfig',
            createArgument: createArgument ?? {
                handler,
                minFee: '0.0000010000',
                minPayoutValue: '0.0000001000',
                observers,
                ledgerTimeValidityPeriod: { microseconds: '3600000000' },
            },
            signatories,
            observers,
            createdEventBlob: '',
            createdAt: '',
            packageName: 'layerzero-request-factory',
            representativePackageId: 'pkg',
            acsDelta: true,
        },
    }) as JsActiveContract;

const mockClient = (contracts: JsActiveContract[]): ICantonClient =>
    ({
        getLedgerEndOffset: vi.fn(async () => 42),
        queryActiveContracts: vi.fn(async () => contracts),
        createDisclosure: vi.fn(async () => null),
    }) as unknown as ICantonClient;

describe('areExpectedSignatories', () => {
    it('requires every listed party to be a signatory', () => {
        expect(areExpectedSignatories({ signatories: [HANDLER, ATTACKER] }, [HANDLER])).toBe(true);
        expect(
            areExpectedSignatories({ signatories: [HANDLER, ATTACKER] }, [HANDLER, ATTACKER]),
        ).toBe(true);
        expect(areExpectedSignatories({ signatories: [HANDLER] }, [HANDLER, ATTACKER])).toBe(false);
    });
});

describe('isSignatoryOrigin', () => {
    it('accepts when party is a signatory', () => {
        expect(isSignatoryOrigin({ signatories: [HANDLER] }, HANDLER)).toBe(true);
    });

    it('rejects observer-only visibility', () => {
        expect(isSignatoryOrigin({ signatories: [ATTACKER] }, HANDLER)).toBe(false);
    });
});

describe('isTrustedOrigin', () => {
    it('requires payload field match in addition to signatory (multi-signatory templates)', () => {
        expect(
            isTrustedOrigin(
                {
                    createArgument: { handler: HANDLER, sender: ATTACKER },
                    signatories: [HANDLER, ATTACKER],
                },
                HANDLER,
                'handler',
            ),
        ).toBe(true);
        expect(
            isTrustedOrigin(
                {
                    createArgument: { handler: ATTACKER, sender: HANDLER },
                    signatories: [HANDLER, ATTACKER],
                },
                HANDLER,
                'handler',
            ),
        ).toBe(false);
    });
});

describe('matchesContractStateFilter dotted paths', () => {
    it('matches nested create-argument fields', () => {
        const contract = configContract({
            contractId: 'nested',
            handler: HANDLER,
            signatories: [HANDLER],
            createArgument: {
                instrumentId: { admin: HANDLER, id: 'oft' },
            },
        });
        expect(matchesContractStateFilter(contract, { 'instrumentId.admin': HANDLER })).toBe(true);
        expect(matchesContractStateFilter(contract, { 'instrumentId.admin': ATTACKER })).toBe(
            false,
        );
    });

    it('does not match a missing nested path (fail closed)', () => {
        const contract = configContract({
            contractId: 'no-nested',
            handler: HANDLER,
            signatories: [HANDLER],
            createArgument: { handler: HANDLER },
        });
        expect(matchesContractStateFilter(contract, { 'instrumentId.admin': HANDLER })).toBe(false);
        expect(matchesContractStateFilter(contract, { missing: undefined })).toBe(false);
    });
});

describe('sign-time refresh observer-config DoS', () => {
    const genuine = configContract({
        contractId: 'genuine-rfc',
        handler: HANDLER,
        signatories: [HANDLER],
        observers: [],
    });
    const poison = configContract({
        contractId: 'poison-rfc',
        handler: ATTACKER,
        signatories: [ATTACKER],
        observers: [HANDLER],
    });

    const ref = {
        type: 'activeContractId' as const,
        partyToFilter: { party: HANDLER },
        expectedSignatories: [HANDLER] as [string, ...string[]],
        templateId: TEMPLATE_ID,
    };

    it('ignores attacker-signed RequestFactoryConfig visible only as observer', async () => {
        const client = mockClient([poison, genuine]);
        const matches = await queryLiveContractsForRef(client, HANDLER, ref);
        expect(matches.map((c) => c.createdEvent.contractId)).toEqual(['genuine-rfc']);
    });

    it('resolves the genuine cid when poison is also ACS-visible', async () => {
        const client = mockClient([poison, genuine]);
        const { resolveActiveContractId } = createContractAddressResolver({
            client,
            signingParties: [HANDLER],
            appendDisclosures: () => undefined,
        });
        await expect(resolveActiveContractId(ref)).resolves.toBe('genuine-rfc');
    });

    it('throws cardinality only when multiple authenticated configs exist', async () => {
        const duplicate = configContract({
            contractId: 'genuine-rfc-2',
            handler: HANDLER,
            signatories: [HANDLER],
            observers: [],
        });
        const client = mockClient([genuine, duplicate, poison]);
        const { resolveActiveContractId } = createContractAddressResolver({
            client,
            signingParties: [HANDLER],
            appendDisclosures: () => undefined,
        });
        await expect(resolveActiveContractId(ref)).rejects.toThrow(/matched 2 contracts/);
    });

    it('returns no matches when only poison is visible (solo missing genuine)', async () => {
        const client = mockClient([poison]);
        expect(await queryLiveContractsForRef(client, HANDLER, ref)).toEqual([]);
    });

    it('can query as observer gateway while authenticating admin signatory', async () => {
        const oft = configContract({
            contractId: 'oft-self',
            handler: HANDLER,
            signatories: [HANDLER],
            observers: [GATEWAY],
            createArgument: {
                oappGateway: GATEWAY,
                instrumentId: { admin: HANDLER, id: 'oft' },
            },
        });
        const client = mockClient([oft, poison]);
        const matches = await queryLiveContractsForRef(client, GATEWAY, {
            type: 'activeContractId',
            partyToFilter: { party: GATEWAY },
            expectedSignatories: [HANDLER],
            templateId: TEMPLATE_ID,
            contractStateFilter: { 'instrumentId.admin': HANDLER },
        });
        expect(matches.map((c) => c.createdEvent.contractId)).toEqual(['oft-self']);
    });

    it('round-trips deployment identity refs with expectedSignatories', () => {
        const identifier = {
            cid: 'stale-rfc',
            templateId: TEMPLATE_ID,
            party: HANDLER,
            expectedSignatories: [HANDLER],
        };
        const encoded = cantonActiveContractIdRef({
            partyToFilter: { party: identifier.party },
            expectedSignatories: [HANDLER],
            templateId: identifier.templateId,
        });
        const parsed = parseCantonDeferredValue(encoded);
        expect(parsed).toMatchObject({
            type: 'activeContractId',
            partyToFilter: { party: HANDLER },
            expectedSignatories: [HANDLER],
            templateId: TEMPLATE_ID,
        });
        expect(parseCantonDeferredValue(encodeCantonDeferredValue(parsed!))).toEqual(parsed);
    });

    it('builds deployment address refs with expectedSignatories from ownerField', () => {
        const encoded = buildCantonDeployedContractAddressRef(
            {
                templateId: 'pkg:RequestFactoryConfig:RequestFactoryConfig',
                createArgument: { handler: HANDLER, minFee: '1.0' },
            },
            {
                packageName: 'layerzero-request-factory',
                ownerField: 'handler',
                identityKeys: [],
            },
        );
        expect(parseCantonDeferredValue(encoded)).toMatchObject({
            type: 'activeContractId',
            partyToFilter: { party: HANDLER },
            expectedSignatories: [HANDLER],
        });
    });

    it('parses pre-existing deploy artifact refs missing expectedSignatories', () => {
        expect(
            parseCantonDeferredValue(
                '<<CANTON_DEFERRED:{"type":"activeContractId","partyToFilter":{"party":"alice"},"templateId":"#pkg:T"}>>',
            ),
        ).toMatchObject({
            type: 'activeContractId',
            partyToFilter: { party: 'alice' },
            templateId: '#pkg:T',
        });
    });

    it('does not default missing expectedSignatories to the owner for Amulet holdings', async () => {
        const dso = 'dso::namespace';
        const owner = 'alice::namespace';
        const amulet = configContract({
            contractId: 'amulet-legacy',
            handler: owner,
            signatories: [dso],
            observers: [owner],
            createArgument: { owner, instrumentId: { admin: dso, id: 'Amulet' } },
        });
        const client = mockClient([amulet]);
        const matches = await queryLiveContractsForRef(client, owner, {
            type: 'activeContractIds',
            partyToFilter: { party: owner },
            templateId: '#splice-amulet:Splice.Amulet:Amulet',
            contractStateFilter: { owner: CANTON_DEFERRED_SENDER },
        });
        expect(matches.map((c) => c.createdEvent.contractId)).toEqual(['amulet-legacy']);
    });

    it('defaults missing expectedSignatories to the query party (still drops observer poison)', async () => {
        const client = mockClient([poison, genuine]);
        const legacyRef = {
            type: 'activeContractId' as const,
            partyToFilter: { party: HANDLER },
            templateId: TEMPLATE_ID,
        };
        const matches = await queryLiveContractsForRef(client, HANDLER, legacyRef);
        expect(matches.map((c) => c.createdEvent.contractId)).toEqual(['genuine-rfc']);
    });

    it('authenticates CIP-56 Amulet holdings by DSO signatory + owner payload', async () => {
        const dso = 'dso::namespace';
        const owner = 'alice::namespace';
        const amulet = configContract({
            contractId: 'amulet-1',
            handler: owner,
            signatories: [dso],
            observers: [owner],
            createArgument: { owner, instrumentId: { admin: dso, id: 'Amulet' } },
        });
        const foreign = configContract({
            contractId: 'amulet-foreign',
            handler: ATTACKER,
            signatories: [dso],
            observers: [owner],
            createArgument: { owner: ATTACKER, instrumentId: { admin: dso, id: 'Amulet' } },
        });
        const client = mockClient([amulet, foreign]);
        const matches = await queryLiveContractsForRef(client, owner, {
            type: 'activeContractIds',
            partyToFilter: { party: owner },
            expectedSignatories: [dso],
            templateId: '#splice-amulet:Splice.Amulet:Amulet',
            contractStateFilter: { owner: CANTON_DEFERRED_SENDER },
        });
        expect(matches.map((c) => c.createdEvent.contractId)).toEqual(['amulet-1']);
    });
});
