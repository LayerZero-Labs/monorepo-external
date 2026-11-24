import { describe, expect, it, vi } from 'vitest';

import type { ICantonClient } from '../../src/client/interface';
import type { JsActiveContract } from '../../src/open-api/models';
import {
    type ActiveContractRef,
    queryLiveContractsForRef,
} from '../../src/refresh/address-resolver';

const ref = (interfaceId = '#trusted:Config:Config'): ActiveContractRef => ({
    type: 'activeContractIds',
    partyToFilter: { party: 'observer' },
    templateId: interfaceId,
    interfaceId,
    expectedSignatories: ['admin'],
    contractStateFilter: { owner: 'admin' },
});
const contract = (interfaceId: string): JsActiveContract =>
    ({
        createdEvent: {
            contractId: 'config',
            signatories: ['admin'],
            createArgument: {},
            interfaceViews: [
                { interfaceId, viewStatus: { code: 0 }, viewValue: { owner: 'admin' } },
            ],
        },
    }) as JsActiveContract;

describe('interface package identity', () => {
    it('resolves a newly preferred vetted package on the next refresh without accepting old versions', async () => {
        let preferred = 'hash-v1';
        let actual = 'hash-v1';
        const getPackageId = vi.fn(async () => preferred);
        const query = vi.fn(async () => [contract(`${actual}:Config:Config`)]);
        const client = {
            getPackageId,
            getLedgerEndOffset: async () => 1,
            queryActiveContractsByInterface: query,
        } as unknown as ICantonClient;
        expect(await queryLiveContractsForRef(client, 'observer', ref())).toHaveLength(1);
        preferred = 'hash-v2';
        expect(await queryLiveContractsForRef(client, 'observer', ref())).toEqual([]);
        actual = 'hash-v2';
        expect(await queryLiveContractsForRef(client, 'observer', ref())).toHaveLength(1);
        expect(getPackageId).toHaveBeenCalledWith('trusted', ['observer']);
        expect(getPackageId).toHaveBeenCalledTimes(3);
        expect(query).toHaveBeenLastCalledWith(['observer'], 1, ['#trusted:Config:Config'], {
            includeCreatedEventBlob: true,
        });
    });
    it('uses an explicit package ID without preferred-package resolution', async () => {
        const getPackageId = vi.fn();
        const client = {
            getPackageId,
            getLedgerEndOffset: async () => 1,
            queryActiveContractsByInterface: async () => [
                contract('pinned:Config:Config'),
                contract('other:Config:Config'),
            ],
        } as unknown as ICantonClient;
        expect(
            await queryLiveContractsForRef(client, 'observer', ref('pinned:Config:Config')),
        ).toHaveLength(1);
        expect(getPackageId).not.toHaveBeenCalled();
    });
    it('fails before querying contracts when preferred package resolution fails', async () => {
        const query = vi.fn();
        const client = {
            getPackageId: vi.fn(async () => {
                throw new Error('Package not vetted');
            }),
            queryActiveContractsByInterface: query,
        } as unknown as ICantonClient;
        await expect(queryLiveContractsForRef(client, 'observer', ref())).rejects.toThrow(
            'not vetted',
        );
        expect(query).not.toHaveBeenCalled();
    });
});
