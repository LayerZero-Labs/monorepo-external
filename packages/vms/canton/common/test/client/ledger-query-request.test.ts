import { describe, expect, it, vi } from 'vitest';

import { CantonClient } from '../../src/client/canton-client';
import { Configuration } from '../../src/open-api/runtime';

const PARTY = 'alice::1220abcd';
const TEMPLATE_ID = '#pkg:Module:Template';
const INTERFACE_ID = '#pkg:Module:Interface';

/**
 * Builds a client whose fetch records each request body and answers with an empty stream.
 */
const clientCapturingBodies = (): { client: CantonClient; bodies: Record<string, unknown>[] } => {
    const bodies: Record<string, unknown>[] = [];
    const fetchApi = vi.fn(async (_url: RequestInfo | URL, init?: RequestInit) => {
        bodies.push(JSON.parse(String(init?.body)));
        return new Response('[]', {
            status: 200,
            headers: { 'Content-Type': 'application/json' },
        });
    });
    const client = new CantonClient(new Configuration({ basePath: 'http://mock', fetchApi }));
    return { client, bodies };
};

// Canton 3.6 rejects the legacy top-level `filter` / `verbose` fields with
// DEPRECATED_API_DISABLED.
const expectNoDeprecatedFields = (body: Record<string, unknown>): void => {
    expect(body).not.toHaveProperty('filter');
    expect(body).not.toHaveProperty('verbose');
};

describe('active contracts request shape', () => {
    it('sends template filters through eventFormat', async () => {
        const { client, bodies } = clientCapturingBodies();

        await client.queryActiveContractsByParties([PARTY], 42, [TEMPLATE_ID], {
            includeCreatedEventBlob: true,
        });

        expect(bodies).toHaveLength(1);
        expectNoDeprecatedFields(bodies[0]!);
        expect(bodies[0]).toMatchObject({
            activeAtOffset: 42,
            eventFormat: {
                verbose: false,
                filtersByParty: {
                    [PARTY]: {
                        cumulative: [
                            {
                                identifierFilter: {
                                    TemplateFilter: {
                                        value: {
                                            templateId: TEMPLATE_ID,
                                            includeCreatedEventBlob: true,
                                        },
                                    },
                                },
                            },
                        ],
                    },
                },
            },
        });
    });

    it('sends interface filters through eventFormat', async () => {
        const { client, bodies } = clientCapturingBodies();

        await client.queryActiveContractsByInterface([PARTY], 7, [INTERFACE_ID]);

        expect(bodies).toHaveLength(1);
        expectNoDeprecatedFields(bodies[0]!);
        expect(bodies[0]).toMatchObject({
            activeAtOffset: 7,
            eventFormat: {
                verbose: false,
                filtersByParty: {
                    [PARTY]: {
                        cumulative: [
                            {
                                identifierFilter: {
                                    InterfaceFilter: {
                                        value: { interfaceId: INTERFACE_ID },
                                    },
                                },
                            },
                        ],
                    },
                },
            },
        });
    });

    it('routes the single-party query through the same request shape', async () => {
        const { client, bodies } = clientCapturingBodies();

        await client.queryActiveContracts(PARTY, 3, { templateIds: [TEMPLATE_ID] });

        expect(bodies).toHaveLength(1);
        expectNoDeprecatedFields(bodies[0]!);
        expect(bodies[0]).toHaveProperty(['eventFormat', 'filtersByParty', PARTY]);
    });
});

describe('updates request shape', () => {
    it('sends filters through updateFormat only', async () => {
        const { client, bodies } = clientCapturingBodies();

        await client.getUpdates(PARTY, 5, 9, { templateIds: [TEMPLATE_ID] });

        expect(bodies).toHaveLength(1);
        expectNoDeprecatedFields(bodies[0]!);
        expect(bodies[0]).toMatchObject({
            beginExclusive: 5,
            endInclusive: 9,
            updateFormat: {
                includeTransactions: {
                    transactionShape: 'TRANSACTION_SHAPE_LEDGER_EFFECTS',
                    eventFormat: {
                        verbose: false,
                        filtersByParty: { [PARTY]: expect.any(Object) },
                    },
                },
            },
        });
    });
});
