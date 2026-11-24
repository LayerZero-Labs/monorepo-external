import { AMULET_INSTRUMENT_ID } from '../client/amulet';
import type { ICantonClient } from '../client/interface';
import { CANTON_DEFERRED_SENDER, cantonSenderPartyRef } from '../deferredValue';
import type { CantonPopulatedTransaction } from '../transaction';
import type { CantonArgumentRefreshTarget, CantonRefreshPlan } from './plan';

const AMULET_TEMPLATE_ID = '#splice-amulet:Splice.Amulet:Amulet';
const TRANSFER_FACTORY_TEMPLATE_ID =
    '#splice-api-token-transfer-instruction-v1:Splice.Api.Token.TransferInstructionV1:TransferFactory';
const TRANSFER_CHOICE = 'TransferFactory_Transfer';
const TRANSFER_WINDOW_MS = 24 * 60 * 60 * 1000;

const argumentTarget = (...fields: string[]): CantonArgumentRefreshTarget => ({
    commandIndex: 0,
    command: 'exercise',
    choice: TRANSFER_CHOICE,
    arguments: [{ path: fields.map((field) => ({ field })) }],
});

const amuletTransferRefreshPlan = ({
    dsoParty,
    receiverParty,
    amount,
}: {
    dsoParty: string;
    receiverParty: string;
    amount: string;
}): CantonRefreshPlan => ({
    replaceSentinels: [{ kind: 'senderParty', targets: [argumentTarget('transfer', 'sender')] }],
    commands: [
        {
            resolver: {
                type: 'activeContract',
                selector: {
                    queryAs: CANTON_DEFERRED_SENDER,
                    templateId: AMULET_TEMPLATE_ID,
                    expectedSignatories: [dsoParty],
                    stateFilter: { owner: CANTON_DEFERRED_SENDER },
                },
                selection: { kind: 'gte', field: 'amount', value: amount },
            },
            targets: [argumentTarget('transfer', 'inputHoldingCids')],
        },
        {
            resolver: { type: 'amuletContext', dsoParty, receiver: receiverParty, amount },
            targets: [argumentTarget('extraArgs', 'context')],
            contractIdTargets: [{ commandIndex: 0, command: 'exercise', field: 'contractId' }],
        },
        {
            resolver: { type: 'timestamp' },
            targets: [
                {
                    commandIndex: 0,
                    command: 'exercise',
                    choice: TRANSFER_CHOICE,
                    arguments: [
                        { path: [{ field: 'transfer' }, { field: 'requestedAt' }] },
                        {
                            path: [{ field: 'transfer' }, { field: 'executeBefore' }],
                            offsetMs: TRANSFER_WINDOW_MS,
                        },
                    ],
                },
            ],
        },
    ],
});

/** Sender binding and initial funding must resolve before preparing or signing this transfer. */
export const prepareRefreshableAmuletTransfer = async ({
    client,
    receiverParty,
    amount,
}: {
    client: ICantonClient;
    receiverParty: string;
    amount: string;
}): Promise<CantonPopulatedTransaction> => {
    const dsoParty = await client.getDsoParty();
    const instrumentId = { admin: dsoParty, id: AMULET_INSTRUMENT_ID };
    const bundle = await client.getAmuletContextWithExternalRules(instrumentId, {
        receiver: receiverParty,
        amount,
    });
    const now = new Date();

    return {
        actAs: [],
        unresolvedCommands: [
            {
                exerciseCommand: {
                    templateId: TRANSFER_FACTORY_TEMPLATE_ID,
                    contractId: bundle.externalPartyAmuletRulesCid,
                    choice: TRANSFER_CHOICE,
                    choiceArgument: {
                        expectedAdmin: dsoParty,
                        transfer: {
                            sender: cantonSenderPartyRef(),
                            receiver: receiverParty,
                            amount,
                            instrumentId,
                            lock: null,
                            requestedAt: now.toISOString(),
                            executeBefore: new Date(
                                now.getTime() + TRANSFER_WINDOW_MS,
                            ).toISOString(),
                            inputHoldingCids: [],
                            meta: { values: {} },
                        },
                        extraArgs: { context: bundle.amuletContext, meta: { values: {} } },
                    },
                },
            },
        ],
        unresolvedDisclosedContracts: bundle.disclosedContracts,
        refreshPlan: amuletTransferRefreshPlan({ dsoParty, receiverParty, amount }),
    };
};
