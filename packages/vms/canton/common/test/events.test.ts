import { describe, expect, it } from 'vitest';

import { findMatchingCreatedEvent } from '../src/events';
import type { CreatedEvent } from '../src/open-api/models';

const OFT_ADMIN = 'oft-admin::namespace';
const OTHER = 'other::namespace';
const LEDGER_OFT_SELF = '1220deadbeef:OftSelf:OftSelf';
const PACKAGE_NAME_OFT_SELF = '#layerzero-oft:OftSelf:OftSelf';

const createdEvent = (templateId: string, signatories = [OFT_ADMIN]): CreatedEvent => ({
    offset: 1,
    nodeId: 0,
    contractId: `cid-${templateId}`,
    templateId,
    createArgument: { instrumentId: { admin: OFT_ADMIN, id: 'OFT' } },
    createdEventBlob: '',
    signatories,
    observers: [],
    witnessParties: [],
    createdAt: '',
    packageName: 'layerzero-oft',
    representativePackageId: '1220deadbeef',
    acsDelta: true,
});

describe('findMatchingCreatedEvent', () => {
    it.each([
        { name: 'its #package-name form', expectedTemplateId: PACKAGE_NAME_OFT_SELF },
        { name: 'the identical package-id form', expectedTemplateId: LEDGER_OFT_SELF },
    ])('matches a package-id ledger event against $name', ({ expectedTemplateId }) => {
        const event = createdEvent(LEDGER_OFT_SELF);
        expect(findMatchingCreatedEvent([event], expectedTemplateId, [OFT_ADMIN])).toBe(event);
    });

    it.each([
        {
            name: 'a different template in the same package',
            event: createdEvent('1220deadbeef:OftSelfConfig:OftSelfConfig'),
        },
        {
            name: 'the same entity name in a different module',
            event: createdEvent('1220deadbeef:OftSelfConfig:OftSelf'),
        },
        {
            name: 'a signatory outside the expected parties',
            event: createdEvent(LEDGER_OFT_SELF, [OFT_ADMIN, OTHER]),
        },
        { name: 'no signatories', event: createdEvent(LEDGER_OFT_SELF, []) },
    ])('rejects an event with $name', ({ event }) => {
        expect(
            findMatchingCreatedEvent([event], PACKAGE_NAME_OFT_SELF, [OFT_ADMIN]),
        ).toBeUndefined();
    });
});
