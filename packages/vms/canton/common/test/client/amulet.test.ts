import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
    fetchAmuletContext,
    fetchAmuletRules,
    fetchDsoParty,
    fetchOpenAndIssuingMiningRounds,
    findAmuletRulesDisclosures,
    injectExternalPartyAmuletRules,
    toDisclosedContract,
} from '../../src/client/amulet';
import { CantonProtocolError } from '../../src/errors';
import type { CantonDisclosedContract } from '../../src/transaction';

const TOKEN = 'test-token';
const DSO_PARTY_PATH = '/api/validator/v0/scan-proxy/dso-party-id';
const AMULET_RULES_PATH = '/api/validator/v0/scan-proxy/amulet-rules';
const MINING_ROUNDS_PATH = '/api/validator/v0/scan-proxy/open-and-issuing-mining-rounds';
const TRANSFER_FACTORY_PATH =
    '/api/validator/v0/scan-proxy/registry/transfer-instruction/v1/transfer-factory';

const scanEntry = {
    contract: {
        template_id: '#splice-amulet:Splice.AmuletRules:AmuletRules',
        contract_id: 'cid-rules',
        created_event_blob: 'blob',
    },
    domain_id: 'sync',
};

const disclosure = (templateId: string, contractId: string): CantonDisclosedContract => ({
    templateId,
    contractId,
    createdEventBlob: 'blob',
    synchronizerId: 'sync',
});

const AMULET_RULES = disclosure('pkg:Splice.AmuletRules:AmuletRules', 'cid-rules');
const EXTERNAL_PARTY_AMULET_RULES = disclosure(
    'pkg:Splice.ExternalPartyAmuletRules:ExternalPartyAmuletRules',
    'cid-external-rules',
);
const OPEN_MINING_ROUND = disclosure('pkg:Splice.Round:OpenMiningRound', 'cid-round');

const okResponse = (body: unknown): Response =>
    ({
        ok: true,
        status: 200,
        json: async () => body,
        text: async () => JSON.stringify(body),
    }) as unknown as Response;

const requestedUrl = (): string => String(vi.mocked(fetch).mock.calls[0]![0]);

describe('amulet scan-proxy request URLs', () => {
    beforeEach(() => {
        vi.stubGlobal('fetch', vi.fn());
    });

    afterEach(() => {
        vi.restoreAllMocks();
    });

    describe('DSO party endpoint', () => {
        it('targets the scan-proxy DSO party path on the wallet origin', async () => {
            vi.mocked(fetch).mockResolvedValueOnce(okResponse({ dso_party_id: 'dso::123' }));

            await fetchDsoParty('https://wallet.example.com', TOKEN);

            expect(requestedUrl()).toBe(`https://wallet.example.com${DSO_PARTY_PATH}`);
        });

        it('collapses a trailing slash on the wallet URL instead of doubling it', async () => {
            vi.mocked(fetch).mockResolvedValueOnce(okResponse({ dso_party_id: 'dso::123' }));

            await fetchDsoParty('https://wallet.example.com/', TOKEN);

            expect(requestedUrl()).toBe(`https://wallet.example.com${DSO_PARTY_PATH}`);
            expect(new URL(requestedUrl()).host).toBe('wallet.example.com');
        });
    });

    describe('amulet context endpoint', () => {
        it('targets the transfer factory path regardless of a trailing slash', async () => {
            vi.mocked(fetch).mockResolvedValueOnce(
                okResponse({
                    choiceContext: { disclosedContracts: [], choiceContextData: { values: {} } },
                }),
            );

            await fetchAmuletContext('https://wallet.example.com/', TOKEN, {
                admin: 'dso::123',
                id: 'Amulet',
            });

            expect(requestedUrl()).toBe(`https://wallet.example.com${TRANSFER_FACTORY_PATH}`);
        });

        const instrumentId = { admin: 'dso::123', id: 'Amulet' };
        const requestedBody = (): unknown =>
            JSON.parse(String(vi.mocked(fetch).mock.calls[0]![1]!.body));
        const probeBody = (transfer: { receiver: string; amount: string }) => ({
            choiceArguments: {
                expectedAdmin: 'dso::123',
                transfer: {
                    sender: 'dso::123',
                    ...transfer,
                    instrumentId,
                    requestedAt: expect.any(String),
                    executeBefore: expect.any(String),
                    inputHoldingCids: [],
                    meta: { values: {} },
                },
                extraArgs: { context: { values: {} }, meta: { values: {} } },
            },
        });

        it('probes a zero-amount admin self-transfer by default', async () => {
            vi.mocked(fetch).mockResolvedValueOnce(
                okResponse({
                    choiceContext: { disclosedContracts: [], choiceContextData: { values: {} } },
                }),
            );

            await fetchAmuletContext('https://wallet.example.com', TOKEN, instrumentId);

            expect(requestedBody()).toEqual(probeBody({ receiver: 'dso::123', amount: '0' }));
        });

        it('probes with the given receiver and amount', async () => {
            vi.mocked(fetch).mockResolvedValueOnce(
                okResponse({
                    choiceContext: { disclosedContracts: [], choiceContextData: { values: {} } },
                }),
            );

            await fetchAmuletContext('https://wallet.example.com', TOKEN, instrumentId, {
                receiver: 'receiver::1',
                amount: '2.5',
            });

            expect(requestedBody()).toEqual(probeBody({ receiver: 'receiver::1', amount: '2.5' }));
        });
    });

    describe('amulet-rules endpoint', () => {
        it('targets the scan-proxy amulet-rules path on the wallet origin', async () => {
            vi.mocked(fetch).mockResolvedValueOnce(okResponse({ amulet_rules: scanEntry }));

            const rules = await fetchAmuletRules('https://wallet.example.com/', TOKEN);

            expect(requestedUrl()).toBe(`https://wallet.example.com${AMULET_RULES_PATH}`);
            expect(rules.contract.contract_id).toBe('cid-rules');
        });
    });

    describe('open-and-issuing-mining-rounds endpoint', () => {
        it('defaults missing maps to empty objects', async () => {
            vi.mocked(fetch).mockResolvedValueOnce(okResponse({}));

            const rounds = await fetchOpenAndIssuingMiningRounds(
                'https://wallet.example.com/',
                TOKEN,
            );

            expect(requestedUrl()).toBe(`https://wallet.example.com${MINING_ROUNDS_PATH}`);
            expect(rounds).toEqual({ open_mining_rounds: {}, issuing_mining_rounds: {} });
        });
    });
});

describe('toDisclosedContract', () => {
    it('maps scan-proxy fields onto a disclosed contract', () => {
        expect(toDisclosedContract(scanEntry)).toEqual({
            contractId: 'cid-rules',
            templateId: '#splice-amulet:Splice.AmuletRules:AmuletRules',
            createdEventBlob: 'blob',
            synchronizerId: 'sync',
        });
    });
});

describe('AmuletRules disclosures', () => {
    it('finds the AmuletRules and the open mining round', () => {
        expect(findAmuletRulesDisclosures([OPEN_MINING_ROUND, AMULET_RULES])).toEqual({
            amuletRules: AMULET_RULES,
            openMiningRound: OPEN_MINING_ROUND,
        });
    });

    it('matches template IDs qualified by package names', () => {
        const amuletRules = disclosure('#splice-amulet:Splice.AmuletRules:AmuletRules', 'cid');

        expect(findAmuletRulesDisclosures([amuletRules, OPEN_MINING_ROUND]).amuletRules).toBe(
            amuletRules,
        );
    });

    it('skips the external party AmuletRules listed first', () => {
        expect(
            findAmuletRulesDisclosures([
                EXTERNAL_PARTY_AMULET_RULES,
                AMULET_RULES,
                OPEN_MINING_ROUND,
            ]).amuletRules,
        ).toBe(AMULET_RULES);
    });

    it('throws without the AmuletRules', () => {
        expect(() =>
            findAmuletRulesDisclosures([EXTERNAL_PARTY_AMULET_RULES, OPEN_MINING_ROUND]),
        ).toThrow(CantonProtocolError);
    });

    it('throws without an open mining round', () => {
        expect(() => findAmuletRulesDisclosures([AMULET_RULES])).toThrow(CantonProtocolError);
    });
});

describe('external party AmuletRules injection', () => {
    it('adds the external party AmuletRules to the choice context', () => {
        expect(
            injectExternalPartyAmuletRules({ values: { 'amulet-rules': 'cid-rules' } }, [
                AMULET_RULES,
                EXTERNAL_PARTY_AMULET_RULES,
            ]),
        ).toEqual({
            amuletContext: {
                values: {
                    'amulet-rules': 'cid-rules',
                    'external-party-amulet-rules': {
                        tag: 'AV_ContractId',
                        value: 'cid-external-rules',
                    },
                },
            },
            externalPartyAmuletRulesCid: 'cid-external-rules',
        });
    });

    it('throws without the external party AmuletRules', () => {
        expect(() =>
            injectExternalPartyAmuletRules({ values: {} }, [AMULET_RULES, OPEN_MINING_ROUND]),
        ).toThrow(CantonProtocolError);
    });
});
