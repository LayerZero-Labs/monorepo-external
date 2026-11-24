import { z } from 'zod';

import type { TokenProvider } from '../auth/token-provider';
import { CantonProtocolError } from '../errors';
import { postRegistryJson, type TransferFactoryContext } from '../refresh/registry-context';
import { type CantonDisclosedContract, cantonDisclosedContractSchema } from '../transaction';

/** Validator-wallet access a {@link CantonClient} needs to serve amulet endpoints. */
export type CantonClientWalletConfig = {
    /** Validator wallet URL for scan-proxy CIP-56 endpoints. */
    walletUrl: string;
    /** Bearer-token source for wallet requests. */
    tokenProvider: TokenProvider;
};

/** The single Amulet instrument id used across Canton Network fee flows. */
export const AMULET_INSTRUMENT_ID = 'Amulet';

/** Instrument identifier for an amulet context probe. */
export type InstrumentId = { admin: string; id: string };

/** DAML ChoiceContext — a bag of named AnyValues passed to fee-bearing choices. */
export type ChoiceContext = { values: Record<string, unknown> };

export type AmuletTransferFactoryArgs = {
    instrumentId: InstrumentId;
    sender: string;
    receiver: string;
    amount: string;
    inputHoldingCids: string[];
    requestedAt: string;
    executeBefore: string;
};

const amuletFactoryResponseSchema = z.object({
    factoryId: z.string().min(1),
    choiceContext: z.object({
        choiceContextData: z
            .object({ values: z.record(z.string(), z.unknown()).optional() })
            .optional(),
        disclosedContracts: z
            .array(
                cantonDisclosedContractSchema.extend({
                    contractId: z.string().min(1),
                    createdEventBlob: z.string().min(1),
                    synchronizerId: z.string().min(1),
                }),
            )
            .optional(),
    }),
});

export const fetchAmuletTransferFactoryContext = async (
    walletUrl: string,
    token: string,
    args: AmuletTransferFactoryArgs,
): Promise<TransferFactoryContext> => {
    const parsed = amuletFactoryResponseSchema.safeParse(
        await postRegistryJson(
            new URL(
                '/api/validator/v0/scan-proxy/registry/transfer-instruction/v1/transfer-factory',
                walletUrl,
            ).toString(),
            {
                choiceArguments: {
                    expectedAdmin: args.instrumentId.admin,
                    transfer: { ...args, meta: { values: {} } },
                    extraArgs: { context: { values: {} }, meta: { values: {} } },
                },
            },
            { probeName: 'amulet transfer-factory', headers: { Authorization: `Bearer ${token}` } },
        ),
    );
    if (!parsed.success)
        throw new Error('Amulet transfer-factory response failed schema validation');
    return {
        factoryId: parsed.data.factoryId,
        choiceContext: { values: parsed.data.choiceContext.choiceContextData?.values ?? {} },
        disclosedContracts: parsed.data.choiceContext.disclosedContracts ?? [],
    };
};

export type AmuletContextResult = {
    amuletContext: ChoiceContext;
    disclosedContracts: CantonDisclosedContract[];
    externalPartyAmuletRulesCid: string;
};

// The probe never executes — it only fetches context; 1-hour window is ample.
const CONTEXT_PROBE_EXECUTE_BEFORE_WINDOW_MS = 60 * 60 * 1000;

/** Transfer fields for the amulet context probe. Omitted fields default to a zero-amount admin self-transfer. */
export type AmuletContextOptions = {
    /**
     * Transfer receiver. Defaults to `instrumentId.admin`. The registry includes a receiver's
     * TransferPreapproval in the context only when asked about that receiver.
     */
    receiver?: string;
    /** Daml Decimal amount string. Defaults to `'0'`. */
    amount?: string;
};

type AmuletContextResponse = {
    choiceContext: {
        disclosedContracts: CantonDisclosedContract[];
        choiceContextData: ChoiceContext;
    };
};

/** Amulet ChoiceContext from the validator scan-proxy — same call for all fee-bearing choices. */
export const fetchAmuletContext = async (
    walletUrl: string,
    token: string,
    instrumentId: InstrumentId,
    { receiver = instrumentId.admin, amount = '0' }: AmuletContextOptions = {},
): Promise<{ amuletContext: ChoiceContext; disclosedContracts: CantonDisclosedContract[] }> => {
    const now = new Date();
    const later = new Date(now.getTime() + CONTEXT_PROBE_EXECUTE_BEFORE_WINDOW_MS);

    const response = await fetch(
        new URL(
            '/api/validator/v0/scan-proxy/registry/transfer-instruction/v1/transfer-factory',
            walletUrl,
        ),
        {
            method: 'POST',
            headers: {
                Authorization: `Bearer ${token}`,
                'Content-Type': 'application/json',
            },
            body: JSON.stringify({
                choiceArguments: {
                    expectedAdmin: instrumentId.admin,
                    transfer: {
                        sender: instrumentId.admin,
                        receiver,
                        amount,
                        instrumentId,
                        requestedAt: now.toISOString(),
                        executeBefore: later.toISOString(),
                        inputHoldingCids: [],
                        meta: { values: {} },
                    },
                    extraArgs: { context: { values: {} }, meta: { values: {} } },
                },
            }),
        },
    );

    if (!response.ok) {
        const text = await response.text();
        throw new CantonProtocolError(`Failed to get amulet context: ${response.status} ${text}`);
    }

    const data = (await response.json()) as AmuletContextResponse;
    const { disclosedContracts, choiceContextData: amuletContext } = data.choiceContext;

    return { amuletContext, disclosedContracts };
};

const findDisclosure = (
    disclosedContracts: CantonDisclosedContract[],
    templateSuffix: string,
): CantonDisclosedContract => {
    const contract = disclosedContracts.find(({ templateId }) =>
        templateId?.endsWith(templateSuffix),
    );

    if (!contract) {
        throw new CantonProtocolError(`${templateSuffix} not found in amulet context`);
    }

    return contract;
};

/** The AmuletRules and OpenMiningRound an amulet context discloses, as `AmuletRules_*` choices need. */
export const findAmuletRulesDisclosures = (
    disclosedContracts: CantonDisclosedContract[],
): { amuletRules: CantonDisclosedContract; openMiningRound: CantonDisclosedContract } => ({
    amuletRules: findDisclosure(disclosedContracts, ':Splice.AmuletRules:AmuletRules'),
    openMiningRound: findDisclosure(disclosedContracts, ':Splice.Round:OpenMiningRound'),
});

// Validators disagree on where they nest the accept context: some return it under
// `choiceContext.choiceContextData`, others at the top level, with or without a `values` wrapper.
type AcceptContextResponse = {
    choiceContextData?: { values?: Record<string, unknown> } | Record<string, unknown>;
    choiceContext?: {
        choiceContextData?: { values?: Record<string, unknown> };
        disclosedContracts?: CantonDisclosedContract[];
    };
    disclosedContracts?: CantonDisclosedContract[];
};

export type TransferInstructionAcceptContextResult = {
    choiceContext: ChoiceContext;
    disclosedContracts: CantonDisclosedContract[];
};

export type TransferInstructionChoice = 'accept' | 'reject' | 'withdraw';

export const fetchTransferInstructionContext = async (args: {
    walletUrl: string;
    token: string;
    contractId: string;
    choice: TransferInstructionChoice;
}): Promise<TransferInstructionAcceptContextResult> => {
    const response = await fetch(
        new URL(
            `/api/validator/v0/scan-proxy/registry/transfer-instruction/v1/${encodeURIComponent(
                args.contractId,
            )}/choice-contexts/${args.choice}`,
            args.walletUrl,
        ),
        {
            method: 'POST',
            headers: {
                Authorization: `Bearer ${args.token}`,
                'Content-Type': 'application/json',
            },
            body: JSON.stringify({ excludeDebugFields: true }),
        },
    );

    if (!response.ok) {
        const text = await response.text();
        throw new CantonProtocolError(
            `Failed to get ${args.choice} context: ${response.status} ${text}`,
        );
    }

    const data = (await response.json()) as AcceptContextResponse;
    const choiceContextData = data.choiceContext?.choiceContextData ??
        data.choiceContextData ?? { values: {} };
    const disclosedContracts =
        data.choiceContext?.disclosedContracts ?? data.disclosedContracts ?? [];
    const values =
        'values' in choiceContextData &&
        choiceContextData.values &&
        typeof choiceContextData.values === 'object'
            ? (choiceContextData.values as Record<string, unknown>)
            : choiceContextData;

    return { choiceContext: { values }, disclosedContracts };
};

export const fetchAcceptContext = (args: {
    walletUrl: string;
    token: string;
    contractId: string;
}): Promise<TransferInstructionAcceptContextResult> =>
    fetchTransferInstructionContext({ ...args, choice: 'accept' });

/** Injects ExternalPartyAmuletRules cid into the ChoiceContext — required by every flow hitting FeeUtils.validateContext. */
export const injectExternalPartyAmuletRules = (
    amuletContext: ChoiceContext,
    disclosedContracts: CantonDisclosedContract[],
): { amuletContext: ChoiceContext; externalPartyAmuletRulesCid: string } => {
    const externalRulesContract = findDisclosure(
        disclosedContracts,
        ':Splice.ExternalPartyAmuletRules:ExternalPartyAmuletRules',
    );

    return {
        amuletContext: {
            values: {
                ...amuletContext.values,
                'external-party-amulet-rules': {
                    tag: 'AV_ContractId',
                    value: externalRulesContract.contractId,
                },
            },
        },
        externalPartyAmuletRulesCid: externalRulesContract.contractId,
    };
};

/** Fetch the DSO party id from the validator scan-proxy API. */
export const fetchDsoParty = async (walletUrl: string, token: string): Promise<string> => {
    const response = await fetch(new URL('/api/validator/v0/scan-proxy/dso-party-id', walletUrl), {
        headers: { Authorization: `Bearer ${token}` },
    });
    if (!response.ok) {
        throw new CantonProtocolError(`Failed to get DSO party: ${response.status}`);
    }
    const data = (await response.json()) as { dso_party_id: string };
    return data.dso_party_id;
};

/** Scan-proxy contract envelope (`amulet-rules`, mining rounds). */
export type ScanContractEntry = {
    contract: {
        template_id: string;
        contract_id: string;
        payload?: unknown;
        created_event_blob: string;
        created_at?: string;
    };
    domain_id: string;
};

export type OpenAndIssuingMiningRounds = {
    open_mining_rounds: Record<string, ScanContractEntry>;
    issuing_mining_rounds: Record<string, ScanContractEntry>;
};

const scanProxyGet = async <T>(walletUrl: string, token: string, path: string): Promise<T> => {
    const response = await fetch(new URL(path, walletUrl), {
        method: 'GET',
        headers: {
            Authorization: `Bearer ${token}`,
            'Content-Type': 'application/json',
        },
    });
    if (!response.ok) {
        const text = await response.text();
        throw new CantonProtocolError(`Scan-proxy ${path} failed: ${response.status} ${text}`);
    }
    return (await response.json()) as T;
};

export const fetchAmuletRules = async (
    walletUrl: string,
    token: string,
): Promise<ScanContractEntry> => {
    const data = await scanProxyGet<{ amulet_rules: ScanContractEntry }>(
        walletUrl,
        token,
        '/api/validator/v0/scan-proxy/amulet-rules',
    );
    return data.amulet_rules;
};

export const fetchOpenAndIssuingMiningRounds = async (
    walletUrl: string,
    token: string,
): Promise<OpenAndIssuingMiningRounds> => {
    const data = await scanProxyGet<OpenAndIssuingMiningRounds>(
        walletUrl,
        token,
        '/api/validator/v0/scan-proxy/open-and-issuing-mining-rounds',
    );
    return {
        open_mining_rounds: data.open_mining_rounds ?? {},
        issuing_mining_rounds: data.issuing_mining_rounds ?? {},
    };
};

export const toDisclosedContract = (entry: ScanContractEntry): CantonDisclosedContract => ({
    contractId: entry.contract.contract_id,
    templateId: entry.contract.template_id,
    createdEventBlob: entry.contract.created_event_blob,
    synchronizerId: entry.domain_id,
});
