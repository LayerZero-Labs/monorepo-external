import type { ICantonClient } from '../client/interface';
import {
    CANTON_DEFERRED_SENDER,
    type CantonDeferredValue,
    isCantonDeferredSender,
} from '../deferredValue';
import type { JsActiveContract } from '../open-api/models';
import type { CantonDisclosedContract } from '../transaction';
import { areExpectedSignatories, getCreateArgumentField } from '../trusted-origin';

/** CIP-56 Amulet holding — DSO is the sole signatory; owner is payload/observer. */
const isAmuletHoldingTemplateId = (templateId: string): boolean =>
    templateId.endsWith(':Splice.Amulet:Amulet');

export type ActiveContractRef = Extract<
    CantonDeferredValue,
    { type: 'activeContractId' | 'activeContractIds' }
> & { interfaceId?: string };

/** Active-contract ref whose handler party is concrete (not the sender sentinel). */
export type ConcreteActiveContractRef = ActiveContractRef & {
    partyToFilter: { party: string };
};

export const isConcreteActiveContractRef = (
    ref: CantonDeferredValue,
): ref is ConcreteActiveContractRef =>
    (ref.type === 'activeContractId' || ref.type === 'activeContractIds') &&
    ref.partyToFilter !== CANTON_DEFERRED_SENDER;

export interface ContractAddressResolverDeps {
    client: ICantonClient;
    senderParty?: string;
    /** A contract is only disclosed when none of these parties is already a stakeholder on it. */
    signingParties: string[];
    appendDisclosures: (disclosures: CantonDisclosedContract[]) => void;
}

/**
 * Match create-argument fields, including dotted paths (`instrumentId.admin`).
 */
export const matchesContractStateFilter = (
    contract: JsActiveContract,
    contractStateFilter: ActiveContractRef['contractStateFilter'],
): boolean => {
    if (!contractStateFilter) return true;
    const createArgument = contract.createdEvent.createArgument;
    return Object.entries(contractStateFilter).every(([key, value]) => {
        const actual = getCreateArgumentField(createArgument, key);
        // Missing / unresolvable paths must not match (fail closed).
        if (actual === undefined) return false;
        return JSON.stringify(actual) === JSON.stringify(value);
    });
};

/**
 * Resolve {@link CANTON_DEFERRED_SENDER} entries to the ACS query party.
 * Missing lists default to `[queryParty]` except CIP-56 Amulet holdings, where
 * the owner is not a signatory — omit the filter so pre-PR refs still resolve.
 */
export const resolveExpectedSignatories = (
    expectedSignatories: readonly string[] | undefined,
    queryParty: string,
    templateId: string,
): string[] | undefined => {
    if (expectedSignatories?.length) {
        return expectedSignatories.map((party) =>
            isCantonDeferredSender(party) ? queryParty : party,
        );
    }
    if (isAmuletHoldingTemplateId(templateId)) {
        return undefined;
    }
    return [queryParty];
};

/** Resolve {@link CANTON_DEFERRED_SENDER} values in `contractStateFilter` to the ACS query party. */
export const resolveContractStateFilter = (
    contractStateFilter: ActiveContractRef['contractStateFilter'],
    queryParty: string,
): ActiveContractRef['contractStateFilter'] => {
    if (!contractStateFilter) return contractStateFilter;
    return Object.fromEntries(
        Object.entries(contractStateFilter).map(([key, value]) => [
            key,
            isCantonDeferredSender(value) ? queryParty : value,
        ]),
    );
};

export const isRefAlive = async (
    client: ICantonClient,
    ref: CantonDeferredValue,
): Promise<boolean> => {
    if (!isConcreteActiveContractRef(ref)) return false;
    const contracts = await queryLiveContractsForRef(client, ref.partyToFilter.party, ref);
    return ref.type === 'activeContractId' ? contracts.length === 1 : contracts.length > 0;
};

/**
 * Query ACS for `party` + template, apply state filter, then
 * authenticate-then-count: keep only contracts where every resolved
 * `expectedSignatories` entry is a ledger signatory.
 *
 * `partyToFilter` is visibility (may be an observer). `expectedSignatories` is
 * authority (defaults to the query party when omitted, except Amulet holdings).
 * Optional `contractStateFilter` disambiguates / binds payload roles (supports
 * dotted paths; {@link CANTON_DEFERRED_SENDER} values resolve).
 */
export const queryLiveContractsForRef = async (
    client: ICantonClient,
    party: string,
    ref: ActiveContractRef,
): Promise<JsActiveContract[]> => {
    let interfaceId = ref.interfaceId;
    if (interfaceId?.startsWith('#')) {
        const [packageName, moduleName, entityName, ...extra] = interfaceId.slice(1).split(':');
        if (!packageName || !moduleName || !entityName || extra.length) {
            throw new Error(`Invalid package-name-qualified interface ID: ${interfaceId}`);
        }
        const packageId = await client.getPackageId(packageName, [party]);
        interfaceId = `${packageId}:${moduleName}:${entityName}`;
    }
    const offset = await client.getLedgerEndOffset();
    const expectedSignatories = resolveExpectedSignatories(
        ref.expectedSignatories,
        party,
        ref.templateId,
    );
    const contractStateFilter = resolveContractStateFilter(ref.contractStateFilter, party);
    // The Ledger API filters interfaces by package name, so query by the reference as given; the
    // view filter below pins a name-qualified interface to its resolved `interfaceId`.
    const contracts = ref.interfaceId
        ? await client.queryActiveContractsByInterface([party], offset, [ref.interfaceId], {
              includeCreatedEventBlob: true,
          })
        : await client.queryActiveContracts(party, offset, {
              templateIds: [ref.templateId],
              includeCreatedEventBlob: true,
          });
    return contracts.filter((contract) => {
        if (
            expectedSignatories !== undefined &&
            !areExpectedSignatories(contract.createdEvent, expectedSignatories)
        )
            return false;
        if (!interfaceId) return matchesContractStateFilter(contract, contractStateFilter);
        const views = (contract.createdEvent.interfaceViews ?? []).filter(
            (view) => view.interfaceId === interfaceId,
        );
        if (views.length !== 1 || views[0]!.viewValue == null || views[0]!.viewStatus?.code !== 0) {
            return false;
        }
        return matchesContractStateFilter(
            {
                ...contract,
                createdEvent: { ...contract.createdEvent, createArgument: views[0]!.viewValue },
            },
            contractStateFilter,
        );
    });
};

/**
 * Returns the contractIds of all live contracts matching ref.
 * Resolves {@link CANTON_DEFERRED_SENDER} to senderParty when provided; returns [] if unresolvable.
 */
export const queryLiveContractIdsForRef = async (
    client: ICantonClient,
    ref: CantonDeferredValue,
    senderParty?: string,
): Promise<string[]> => {
    if (ref.type !== 'activeContractId' && ref.type !== 'activeContractIds') return [];
    const party =
        ref.partyToFilter === CANTON_DEFERRED_SENDER ? senderParty : ref.partyToFilter.party;
    if (!party) return [];
    const contracts = await queryLiveContractsForRef(client, party, ref);
    return contracts.map((c) => c.createdEvent.contractId);
};

export const createContractAddressResolver = (deps: ContractAddressResolverDeps) => {
    const { client, senderParty, signingParties, appendDisclosures } = deps;

    const requireSender = (templateId: string): string => {
        if (!senderParty) {
            throw new Error(
                `Refresh entry for ${templateId} needs a resolved sender party, but none was provided`,
            );
        }
        return senderParty;
    };

    const resolveQueryParty = ({ partyToFilter, templateId }: ActiveContractRef): string =>
        partyToFilter === CANTON_DEFERRED_SENDER ? requireSender(templateId) : partyToFilter.party;

    const queryCache = new Map<string, Promise<JsActiveContract[]>>();
    const queryAsParty = async (ref: ActiveContractRef): Promise<JsActiveContract[]> => {
        const party = resolveQueryParty(ref);
        const cacheKey = JSON.stringify({ ...ref, party });
        const cached = queryCache.get(cacheKey);
        if (cached) return cached;

        const query = (async () => {
            const contracts = await queryLiveContractsForRef(client, party, ref);
            if (contracts.length === 0) {
                throw new Error(
                    `Party ${party} has no matching active contracts of ${ref.templateId}`,
                );
            }
            return contracts;
        })();
        queryCache.set(cacheKey, query);
        return query;
    };

    // A signing party that is already a stakeholder can see the contract on its
    // own stream, so only disclose to parties that aren't signatories/observers.
    const needsDisclosure = (contract: JsActiveContract): boolean => {
        const stakeholders = new Set([
            ...(contract.createdEvent.signatories ?? []),
            ...(contract.createdEvent.observers ?? []),
        ]);
        return !signingParties.some((party) => stakeholders.has(party));
    };

    const discloseContracts = async (
        ref: ActiveContractRef,
        contracts: JsActiveContract[],
    ): Promise<void> => {
        const toDisclose = contracts.filter(needsDisclosure);
        if (toDisclose.length === 0) return;

        const disclosures = toDisclose.map((contract) => {
            const contractId = contract.createdEvent.contractId;
            const createdEventBlob = contract.createdEvent.createdEventBlob;
            if (!createdEventBlob) {
                throw new Error(
                    `Could not disclose ${contractId} (template ${ref.templateId}) — ACS result omitted createdEventBlob`,
                );
            }
            return {
                contractId,
                templateId: contract.createdEvent.templateId,
                createdEventBlob,
                synchronizerId: contract.synchronizerId,
            };
        });
        appendDisclosures(disclosures);
    };

    const resolveActiveContractId = async (ref: ActiveContractRef): Promise<string> => {
        const contracts = await queryAsParty(ref);
        if (contracts.length !== 1) {
            throw new Error(
                `Refresh for ${ref.templateId} matched ${contracts.length} contracts, but a scalar ref expects exactly one`,
            );
        }
        await discloseContracts(ref, contracts);
        return contracts[0]!.createdEvent.contractId;
    };

    return {
        resolveActiveContractId,
        resolveActiveContracts: queryAsParty,
        discloseActiveContracts: discloseContracts,
    };
};
