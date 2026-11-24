import { describe, expect, it, vi } from 'vitest';

import type { ICantonClient } from '../../src/client/interface';
import {
    daUtilitiesRegistryUrl,
    fetchCallbackTransferFactoryContext,
    withCantonCallbackRegistry,
} from '../../src/refresh/callback-registry';
import { CantonSdk } from '../../src/sdk/canton-sdk';

describe('daUtilitiesRegistryUrl', () => {
    it.each([
        ['mainnet', 'https://api.utilities.digitalasset.com'],
        ['testnet', 'https://api.utilities.digitalasset-staging.com'],
    ])('maps %s to the DA registrar for the admin party', (environment, origin) => {
        expect(daUtilitiesRegistryUrl(environment, 'issuer::1220abcd')).toBe(
            `${origin}/api/token-standard/v0/registrars/issuer::1220abcd`,
        );
    });

    it.each(['sandbox', 'localnet', undefined])('has no registrar for %s', (environment) => {
        expect(daUtilitiesRegistryUrl(environment, 'issuer::1220abcd')).toBeUndefined();
    });

    it('keeps the admin within one path segment', () => {
        expect(daUtilitiesRegistryUrl('testnet', '../x?y#z')).toBe(
            'https://api.utilities.digitalasset-staging.com/api/token-standard/v0/registrars/..%2Fx%3Fy%23z',
        );
    });
});

describe('withCantonCallbackRegistry', () => {
    it('reaches the Amulet wallet through the CantonSdk client', async () => {
        const context = {
            factoryId: 'rules',
            choiceContext: { values: {} },
            disclosedContracts: [],
        };
        const client = {
            getDsoParty: vi.fn(async () => 'dso'),
            getAmuletTransferFactoryContext: vi.fn(async () => context),
            queryActiveContracts: vi.fn(),
        };
        const sdk = new CantonSdk(client as unknown as ICantonClient);
        const instrumentId = { admin: 'dso', id: 'Amulet' };
        const result = await withCantonCallbackRegistry(
            { sdk, informee: 'gateway', offset: 1, appUid: 'app', instrumentId },
            (registry) =>
                fetchCallbackTransferFactoryContext(registry, sdk, instrumentId, {
                    sender: 'treasury',
                    receivers: ['alice'],
                    amount: '1',
                    inputHoldingCids: [],
                }),
        );
        expect(result.factoryId).toBe('rules');
        expect(client.getAmuletTransferFactoryContext).toHaveBeenCalledWith(
            expect.objectContaining({ instrumentId, sender: 'treasury', receiver: 'alice' }),
        );
        expect(client.queryActiveContracts).not.toHaveBeenCalled();
    });
});
