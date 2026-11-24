import { describe, expect, it } from 'vitest';

import type { ICantonClient } from '../../src/client/interface';
import { cantonActiveContractIdRef, cantonSenderPartyRef } from '../../src/deferredValue';
import { resolveCantonTransaction } from '../../src/refresh/resolve';
import type { CantonCommand, CantonDisclosedContract } from '../../src/transaction';

const command: CantonCommand = {
    exerciseCommand: {
        templateId: 'pkg:T:T',
        contractId: 'concrete-cid',
        choice: 'Act',
        choiceArgument: { sender: 'party', value: ['fixed'] },
    },
};
const disclosure: CantonDisclosedContract = {
    contractId: 'original-cid',
    templateId: 'pkg:T:T',
    createdEventBlob: 'blob',
    synchronizerId: 'sync',
};
const args = () => ({
    unresolvedCommands: [structuredClone(command)],
    unresolvedDisclosedContracts: [structuredClone(disclosure)],
    signingParties: ['party'],
    client: {} as ICantonClient,
});

describe('Canton transactions without a refresh plan', () => {
    it('preserves concrete commands and disclosures without any dependency reads', async () => {
        const populated = args();
        const result = await resolveCantonTransaction(populated);
        expect(result).toEqual({ commands: [command], disclosedContracts: [disclosure] });
        expect(result.commands).not.toBe(populated.unresolvedCommands);
        (result.commands[0] as typeof command).exerciseCommand.choiceArgument.value.push('changed');
        expect(populated.unresolvedCommands).toEqual([command]);
    });

    it.each([
        cantonSenderPartyRef(),
        cantonActiveContractIdRef({
            partyToFilter: { party: 'party' },
            templateId: '#pkg:T:T',
            expectedSignatories: ['party'],
        }),
        '<<CANTON_DEFERRED:{"type":"amuletContext"}>>',
        '<<CANTON_DEFERRED:{"type":"amuletRulesCid"}>>',
        '<<CANTON_DEFERRED:{"type":"activeContractIds"}>>',
    ])('rejects implicit command substitution: %s', async (sentinel) => {
        const populated = args();
        (populated.unresolvedCommands[0] as typeof command).exerciseCommand.choiceArgument.value = [
            sentinel,
        ];
        await expect(resolveCantonTransaction(populated)).rejects.toThrow(
            'cannot be combined with deferred sentinels',
        );
    });

    it('deduplicates identical original disclosures', async () => {
        const populated = args();
        populated.unresolvedDisclosedContracts.push({ ...disclosure });
        expect((await resolveCantonTransaction(populated)).disclosedContracts).toEqual([
            disclosure,
        ]);
    });

    it.each(['templateId', 'createdEventBlob', 'synchronizerId'] as const)(
        'rejects conflicting original disclosure %s',
        async (field) => {
            const populated = args();
            populated.unresolvedDisclosedContracts.push({ ...disclosure, [field]: 'different' });
            await expect(resolveCantonTransaction(populated)).rejects.toThrow(
                'Conflicting disclosures for contract original-cid',
            );
        },
    );
});
