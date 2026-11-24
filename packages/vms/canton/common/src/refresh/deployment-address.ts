import { cantonActiveContractIdRef, type CantonDeferredRef } from '../deferredValue';
import { getCreateArgumentField } from '../trusted-origin';

export interface CantonDeployedTemplateSpec {
    packageName: string;
    ownerField: string;
    // Immutable disambiguating fields only — mutable fields break recreate-survival.
    identityKeys: string[];
}

// Canton returns `<packageId>:Module:Entity`; the package id has no colon.
export const qualifiedTemplateName = (templateId: string): string => {
    const firstColon = templateId.indexOf(':');
    return firstColon === -1 ? templateId : templateId.slice(firstColon + 1);
};

/** Compare ledger vs filter template IDs, ignoring package-hash vs `#package-name` prefix. */
export const templateIdMatches = (eventTemplateId: string, filterTemplateId: string): boolean =>
    qualifiedTemplateName(eventTemplateId) === qualifiedTemplateName(filterTemplateId);

interface DeployedCreatedEvent {
    templateId: string;
    createArgument?: unknown;
}

export const buildCantonDeployedContractAddressRef = (
    createdEvent: DeployedCreatedEvent,
    spec: CantonDeployedTemplateSpec,
): CantonDeferredRef => {
    const qualifiedName = qualifiedTemplateName(createdEvent.templateId);
    const createArgument = (createdEvent.createArgument ?? {}) as Record<string, unknown>;
    const ownerParty = getCreateArgumentField(createArgument, spec.ownerField);
    if (typeof ownerParty !== 'string') {
        throw new Error(
            `Template '${qualifiedName}' create argument is missing string owner field '${spec.ownerField}'`,
        );
    }

    const contractStateFilter = spec.identityKeys.length
        ? Object.fromEntries(spec.identityKeys.map((key) => [key, createArgument[key]]))
        : undefined;

    return cantonActiveContractIdRef({
        partyToFilter: { party: ownerParty },
        // LZ deploy templates: ownerField is a create-argument signatory.
        expectedSignatories: [ownerParty],
        templateId: `#${spec.packageName}:${qualifiedName}`,
        ...(contractStateFilter ? { contractStateFilter } : {}),
    });
};
