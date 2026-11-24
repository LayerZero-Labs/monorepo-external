import { z } from 'zod';

/** Filter / authority token resolved to the ACS query (funding) party at refresh. */
export const CANTON_DEFERRED_SENDER = 'sender' as const;
export type CantonDeferredSender = typeof CANTON_DEFERRED_SENDER;

export const cantonDeferredSenderSchema = z.literal(CANTON_DEFERRED_SENDER);

export const isCantonDeferredSender = (value: unknown): value is CantonDeferredSender =>
    value === CANTON_DEFERRED_SENDER;

export const cantonRefreshPartyFilterSchema = z.union([
    cantonDeferredSenderSchema,
    z.object({ party: z.string() }),
]);

/** Non-empty list of parties that must all appear in created-event signatories. */
export const cantonExpectedSignatoriesSchema = z
    .array(z.union([cantonDeferredSenderSchema, z.string().min(1)]))
    .nonempty();

const cantonActiveContractRefFields = {
    partyToFilter: cantonRefreshPartyFilterSchema,
    /**
     * Authority parties that must all be ledger signatories (authenticate-then-count).
     * Use {@link CANTON_DEFERRED_SENDER} for the resolved funding/query party.
     * Omitted on pre-existing persisted refs; refresh then defaults to the query
     * party, except CIP-56 Amulet holdings (owner is not a signatory).
     */
    expectedSignatories: cantonExpectedSignatoriesSchema.optional(),
    templateId: z.string(),
    contractStateFilter: z.partialRecord(z.string(), z.any()).optional(),
};

export const cantonDeferredValueSchema = z.discriminatedUnion('type', [
    z.object({ type: z.literal('senderParty') }),
    z.object({
        type: z.literal('activeContractId'),
        ...cantonActiveContractRefFields,
    }),
    z.object({
        type: z.literal('activeContractIds'),
        ...cantonActiveContractRefFields,
    }),
]);

export type CantonRefreshPartyFilter = z.infer<typeof cantonRefreshPartyFilterSchema>;
export type CantonExpectedSignatories = z.infer<typeof cantonExpectedSignatoriesSchema>;
export type CantonDeferredValue = z.infer<typeof cantonDeferredValueSchema>;
type CantonActiveContractIdRef = Omit<
    Extract<CantonDeferredValue, { type: 'activeContractId' }>,
    'type'
>;
/**
 * Encoded deployment identity or explicitly declared sender-binding token.
 */
export type CantonDeferredRef = string & { readonly __cantonDeferredRef: unique symbol };

export const CANTON_DEFERRED_VALUE_PREFIX = '<<CANTON_DEFERRED:';
export const CANTON_DEFERRED_VALUE_SUFFIX = '>>';

/** True when `value` has deferred-ref framing, whether or not the payload parses. */
export const isCantonDeferredSentinel = (value: unknown): value is string =>
    typeof value === 'string' &&
    value.startsWith(CANTON_DEFERRED_VALUE_PREFIX) &&
    value.endsWith(CANTON_DEFERRED_VALUE_SUFFIX);

export const encodeCantonDeferredValue = (value: CantonDeferredValue): CantonDeferredRef =>
    `${CANTON_DEFERRED_VALUE_PREFIX}${JSON.stringify(value)}${CANTON_DEFERRED_VALUE_SUFFIX}` as CantonDeferredRef;

export const parseCantonDeferredValue = (value: unknown): CantonDeferredValue | undefined => {
    if (!isCantonDeferredSentinel(value)) {
        return undefined;
    }

    try {
        const parsedJson = JSON.parse(
            value.slice(CANTON_DEFERRED_VALUE_PREFIX.length, -CANTON_DEFERRED_VALUE_SUFFIX.length),
        );
        return cantonDeferredValueSchema.parse(parsedJson);
    } catch {
        return undefined;
    }
};

export const cantonSenderPartyRef = (): CantonDeferredRef =>
    encodeCantonDeferredValue({ type: 'senderParty' });

export const cantonActiveContractIdRef = (value: CantonActiveContractIdRef): CantonDeferredRef =>
    encodeCantonDeferredValue({ type: 'activeContractId', ...value });

/** Returns true if `value` is a valid Canton deferred-value sentinel. */
export const isCantonPlaceholder = (value: string): boolean =>
    parseCantonDeferredValue(value) !== undefined;
