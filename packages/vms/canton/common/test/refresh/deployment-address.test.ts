import { describe, expect, it } from 'vitest';

import { parseCantonDeferredValue } from '../../src/deferredValue';
import { buildCantonDeployedContractAddressRef } from '../../src/refresh/deployment-address';

const HANDLER = 'lz-handler::namespace';
const OFT_ADMIN = 'oft-admin::namespace';
const OFT_SELF_TEMPLATE_ID = '1220deadbeef:OftSelf:OftSelf';
const OFT_SPEC = { packageName: 'layerzero-oft', identityKeys: [] };

describe('buildCantonDeployedContractAddressRef', () => {
    it.each([
        {
            name: 'a flat owner field',
            ownerField: 'handler',
            createArgument: { handler: HANDLER, minFee: '1.0' },
            owner: HANDLER,
        },
        {
            name: 'a dotted owner path into a nested record',
            ownerField: 'instrumentId.admin',
            createArgument: { instrumentId: { admin: OFT_ADMIN, id: 'OFT' } },
            owner: OFT_ADMIN,
        },
    ])(
        'filters and signs the ref by the party at $name',
        ({ ownerField, createArgument, owner }) => {
            const encoded = buildCantonDeployedContractAddressRef(
                { templateId: OFT_SELF_TEMPLATE_ID, createArgument },
                { ...OFT_SPEC, ownerField },
            );
            expect(parseCantonDeferredValue(encoded)).toEqual({
                type: 'activeContractId',
                partyToFilter: { party: owner },
                expectedSignatories: [owner],
                templateId: '#layerzero-oft:OftSelf:OftSelf',
            });
        },
    );

    it.each([
        {
            name: 'the top-level field is absent',
            ownerField: 'owner',
            createArgument: { instrumentId: { admin: OFT_ADMIN, id: 'OFT' } },
        },
        {
            name: 'the nested field is absent',
            ownerField: 'instrumentId.owner',
            createArgument: { instrumentId: { admin: OFT_ADMIN, id: 'OFT' } },
        },
        {
            name: 'the path ends at a record',
            ownerField: 'instrumentId',
            createArgument: { instrumentId: { admin: OFT_ADMIN, id: 'OFT' } },
        },
        {
            name: 'the path walks through a non-record',
            ownerField: 'instrumentId.admin',
            createArgument: { instrumentId: 'OFT' },
        },
    ])('throws Error when $name', ({ ownerField, createArgument }) => {
        const build = () =>
            buildCantonDeployedContractAddressRef(
                { templateId: OFT_SELF_TEMPLATE_ID, createArgument },
                { ...OFT_SPEC, ownerField },
            );
        expect(build).toThrow(expect.objectContaining({ constructor: Error }));
        expect(build).toThrow(
            `Template 'OftSelf:OftSelf' create argument is missing string owner field '${ownerField}'`,
        );
    });
});
