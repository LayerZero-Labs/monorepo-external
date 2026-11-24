import { NonEmittableError } from '@layerzerolabs/common-error-utils';

import type { CantonTransaction, ICantonClient } from './client';
import type { CreatedEvent, ExercisedEvent } from './open-api/models';
import { templateIdMatches } from './refresh/deployment-address';
import { cantonTransactionWithResultSchema } from './transaction';

/**
 * Finds a CreatedEvent matching the expected templateId whose signatories
 * are a subset of the provided actAs parties (ledger signatories ⊆ expected).
 * Opposite of `areExpectedSignatories` on the refresh path.
 */
export const findMatchingCreatedEvent = (
    createdEvents: CreatedEvent[],
    expectedTemplateId: string,
    expectedSignatories: string[],
): CreatedEvent | undefined => {
    const expectedSet = new Set(expectedSignatories);
    return createdEvents.find((event) => {
        if (!templateIdMatches(event.templateId, expectedTemplateId)) return false;
        const signatories = event.signatories ?? [];
        return signatories.length > 0 && signatories.every((s) => expectedSet.has(s));
    });
};

/**
 * Fetches a transaction by updateId and returns all CreatedEvents.
 */
export const fetchCreatedEvents = async (
    client: ICantonClient,
    updateId: string,
    parties: string[],
): Promise<CreatedEvent[]> => {
    const cantonTx = await client.fetchTransactionByUpdateId(updateId, parties);
    return (
        cantonTx.events
            ?.filter((event): event is { CreatedEvent: CreatedEvent } => 'CreatedEvent' in event)
            .map((event) => event.CreatedEvent) ?? []
    );
};

/**
 * Parses a Canton transaction-with-result, fetches the created events from the ledger,
 * and returns the first CreatedEvent matching the submitted command's templateId and actAs
 * signatories. Returns null if the transaction is falsy, not successful, or has no match.
 */
export const findMatchingCreatedEventFromTx = async (
    client: ICantonClient,
    tx: unknown,
): Promise<CreatedEvent | null> => {
    const parsed = cantonTransactionWithResultSchema.safeParse(tx);
    if (!parsed.success) return null;

    if (parsed.data.result.type !== 'success') return null;

    const {
        populatedTransaction: { actAs, unresolvedCommands },
    } = parsed.data;
    const updateId = parsed.data.result.minedTxHash;

    if (!updateId || !actAs.length) return null;

    const createCommand = unresolvedCommands.find((cmd) => 'createCommand' in cmd);
    if (!createCommand || !('createCommand' in createCommand)) return null;

    const createdEvents = await fetchCreatedEvents(client, updateId, actAs);
    return (
        findMatchingCreatedEvent(createdEvents, createCommand.createCommand.templateId, actAs) ??
        null
    );
};

/**
 * Checks that a Canton deploy transaction resulted in a CreatedEvent
 * matching the submitted command's templateId and actAs signatories.
 */
export const cantonDeploymentSucceeded = async (
    client: ICantonClient,
    txWithResult: unknown,
): Promise<boolean> => {
    return (await findMatchingCreatedEventFromTx(client, txWithResult)) != null;
};

/**
 * Waits for a contract to be archived and returns the transaction that archived it.
 * Throws NonEmittableError if the contract is not yet archived.
 */
export const waitForArchival = async (
    client: ICantonClient,
    contractId: string,
    parties: string[],
): Promise<CantonTransaction> => {
    const { archived } = await client.fetchEventsByContractId(contractId, parties);
    if (archived) {
        return client.fetchTransactionByOffset(archived.offset, parties);
    }
    throw new NonEmittableError(`Contract ${contractId} is not archived yet`);
};

/** Returns the first exercised event on `contractId` in a transaction tree, if any. */
export const getExercisedEvent = (
    transaction: CantonTransaction,
    contractId: string,
): ExercisedEvent | undefined => {
    for (const event of transaction.events ?? []) {
        if (!('ExercisedEvent' in event)) continue;
        const { ExercisedEvent: exercised } = event;
        if (exercised.contractId === contractId) {
            return exercised;
        }
    }
    return undefined;
};
