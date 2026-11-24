import type { ICantonClient } from '../client/interface';
import type {
    CantonCommand,
    CantonDisclosedContract,
    CantonUnresolvedCommand,
} from '../transaction';
import type { CantonRefreshPlan } from './plan';
import { resolveCantonRefreshPlan } from './resolve-plan';

export interface ResolveCantonAddressParams {
    unresolvedCommands: CantonUnresolvedCommand[];
    unresolvedDisclosedContracts: CantonDisclosedContract[];
    refreshPlan?: CantonRefreshPlan;
    senderParty?: string;
    /** A contract is only disclosed when none of these parties is already a stakeholder on it. */
    signingParties: string[];
    client: ICantonClient;
}

export const resolveCantonTransaction = async ({
    unresolvedCommands,
    unresolvedDisclosedContracts,
    refreshPlan,
    senderParty,
    signingParties,
    client,
}: ResolveCantonAddressParams): Promise<{
    commands: CantonCommand[];
    disclosedContracts: CantonDisclosedContract[];
}> => {
    return resolveCantonRefreshPlan({
        unresolvedCommands,
        unresolvedDisclosedContracts,
        refreshPlan: refreshPlan ?? { commands: [] },
        senderParty,
        signingParties,
        client,
    });
};
