import type { ContractId } from '@daml/types';
import { z } from 'zod';

import type { ChoiceContext, InstrumentId } from '../client/amulet';
import type { JsActiveContract } from '../open-api/models';
import type { CantonSdk } from '../sdk';
import type { CantonDisclosedContract } from '../transaction';
import { isTrustedOrigin } from '../trusted-origin';
import { callbackInterfaceView } from './callback-contracts';
import { parseDamlDecimal } from './select-contracts';

const TEMPLATE_ID_DISCOVERY_REGISTRY =
    '#layerzero-discovery-registry:DiscoveryRegistry:DiscoveryRegistry';
const TRANSFER_FACTORY_RELATIVE_PATH = 'registry/transfer-instruction/v1/transfer-factory';
const CONTEXT_PROBE_EXECUTE_BEFORE_WINDOW_MS = 60 * 60 * 1000;
const TRANSFER_FACTORY_MAX_SENDER_CREDENTIALS = 8;
const MAX_RESPONSE_BYTES = 256 * 1024;

export type TransferFactoryContext = {
    factoryId: string;
    choiceContext: ChoiceContext;
    disclosedContracts: CantonDisclosedContract[];
};

const textMapToRecord = (map: unknown): Record<string, string> => {
    const entries = Array.isArray(map)
        ? map.filter(
              (entry): entry is [unknown, unknown] => Array.isArray(entry) && entry.length >= 2,
          )
        : map && typeof map === 'object'
          ? Object.entries(map)
          : map == null
            ? []
            : undefined;
    if (!entries) throw new Error(`Unexpected Daml map shape: ${String(map)}`);
    return Object.fromEntries(entries.map(([key, value]) => [String(key), String(value)]));
};

const nonEmptyString = z.string().min(1);
const factoryResponseSchema = z.object({
    factoryId: nonEmptyString,
    choiceContext: z.object({
        choiceContextData: z
            .object({ values: z.record(z.string(), z.unknown()).optional() })
            .optional(),
        disclosedContracts: z
            .array(
                z.object({
                    templateId: nonEmptyString,
                    contractId: nonEmptyString,
                    createdEventBlob: nonEmptyString,
                    synchronizerId: nonEmptyString,
                }),
            )
            .optional(),
    }),
});

export const assertSafeRegistryUrl = (
    registryBaseUrl: string,
    opts: { environment?: string; label: string },
): URL => {
    let parsed: URL;
    try {
        parsed = new URL(registryBaseUrl);
    } catch {
        throw new Error(`${opts.label} is not a valid URL`);
    }
    if (parsed.username !== '' || parsed.password !== '') {
        throw new Error(`${opts.label} must not include credentials`);
    }
    const protocol = parsed.protocol.toLowerCase();
    if (protocol === 'https:') return parsed;
    const host = parsed.hostname.toLowerCase();
    const isLoopback = host === 'localhost' || host === '127.0.0.1' || host === '::1';
    if (opts.environment === 'sandbox' && protocol === 'http:' && isLoopback) return parsed;
    throw new Error(
        opts.environment === 'sandbox'
            ? `${opts.label} must use https (http only allowed for localhost / 127.0.0.1 / ::1)`
            : `${opts.label} must use https`,
    );
};

export const postRegistryJson = async (
    url: string,
    body: unknown,
    options: { timeoutMs?: number; probeName: string; headers?: Record<string, string> },
): Promise<unknown> => {
    const signal = AbortSignal.timeout(options.timeoutMs ?? 10_000);
    const response = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...options.headers },
        signal,
        redirect: 'error',
        body: JSON.stringify(body),
    });
    const reader = response.body?.getReader();
    const chunks: Uint8Array[] = [];
    let size = 0;
    try {
        while (reader) {
            const { done, value } = await reader.read();
            if (done) break;
            size += value.byteLength;
            if (size > MAX_RESPONSE_BYTES) {
                await reader.cancel();
                throw new Error(
                    `${options.probeName} response from ${url} exceeds ${MAX_RESPONSE_BYTES} bytes`,
                );
            }
            chunks.push(value);
        }
    } finally {
        reader?.releaseLock();
    }
    if (!response.ok) {
        throw new Error(
            `Failed to fetch ${options.probeName} context from ${url}: HTTP ${response.status}`,
        );
    }
    if (!(response.headers.get('content-type') ?? '').toLowerCase().includes('application/json')) {
        throw new Error(`${options.probeName} response from ${url} must be application/json`);
    }
    const bytes = new Uint8Array(size);
    let offset = 0;
    for (const chunk of chunks) {
        bytes.set(chunk, offset);
        offset += chunk.byteLength;
    }
    let data: unknown;
    try {
        data = JSON.parse(new TextDecoder().decode(bytes));
    } catch {
        throw new Error(`${options.probeName} response from ${url} is not valid JSON`);
    }
    return data;
};

export const postFactoryContext = async (
    url: string,
    body: unknown,
    options: { timeoutMs?: number; probeName: string; headers?: Record<string, string> },
): Promise<TransferFactoryContext> => {
    const parsed = factoryResponseSchema.safeParse(await postRegistryJson(url, body, options));
    if (!parsed.success)
        throw new Error(`${options.probeName} response from ${url} failed schema validation`);
    return {
        factoryId: parsed.data.factoryId,
        choiceContext: { values: parsed.data.choiceContext.choiceContextData?.values ?? {} },
        disclosedContracts: parsed.data.choiceContext.disclosedContracts ?? [],
    };
};

export const fetchTransferInstructionRegistryContext = async (
    registryBaseUrl: string,
    contractId: string,
    choice: 'accept' | 'reject' | 'withdraw',
    environment?: string,
): Promise<Omit<TransferFactoryContext, 'factoryId'>> => {
    assertSafeRegistryUrl(registryBaseUrl, {
        environment,
        label: 'transfer-instruction discovery URL',
    });
    const base = registryBaseUrl.endsWith('/') ? registryBaseUrl : `${registryBaseUrl}/`;
    const url = new URL(
        `registry/transfer-instruction/v1/${encodeURIComponent(contractId)}/choice-contexts/${choice}`,
        base,
    ).toString();
    const parsed = factoryResponseSchema.shape.choiceContext.safeParse(
        await postRegistryJson(
            url,
            { excludeDebugFields: true },
            { probeName: `transfer-instruction ${choice}` },
        ),
    );
    if (!parsed.success)
        throw new Error(`transfer-instruction ${choice} response failed schema validation`);
    return {
        choiceContext: { values: parsed.data.choiceContextData?.values ?? {} },
        disclosedContracts: parsed.data.disclosedContracts ?? [],
    };
};

export const discoveryUrlsForAppUid = async (
    sdk: CantonSdk,
    informee: string,
    offset: number,
    appUid: string,
): Promise<string[]> => {
    const registries = await sdk.queryActiveContracts(informee, offset, {
        templateIds: [TEMPLATE_ID_DISCOVERY_REGISTRY],
    });
    return registries.flatMap((registry) => {
        if (!isTrustedOrigin(registry.createdEvent, informee, 'handler')) {
            return [];
        }
        const urlMap = textMapToRecord(
            (registry.createdEvent.createArgument as { urlMap: unknown }).urlMap,
        );
        const url = urlMap[appUid];
        return url ? [url] : [];
    });
};

export type FetchTransferFactoryContextOptions = {
    environment?: string;
    inputHoldingCids: string[];
    sender: string;
    receiver: string;
    amount: string;
    timeoutMs?: number;
    requestedAt?: string;
    executeBefore?: string;
};

export type FetchMergedTransferFactoryContextOptions = Omit<
    FetchTransferFactoryContextOptions,
    'receiver'
> & {
    receivers: string[];
};

export const resolveProbeWindow = (
    options: Pick<FetchTransferFactoryContextOptions, 'requestedAt' | 'executeBefore'>,
): { requestedAt: string; executeBefore: string } => {
    const requestedAt = options.requestedAt ?? new Date().toISOString();
    const executeBefore =
        options.executeBefore ??
        new Date(Date.parse(requestedAt) + CONTEXT_PROBE_EXECUTE_BEFORE_WINDOW_MS).toISOString();
    return { requestedAt, executeBefore };
};

export const fetchTransferFactoryContext = async (
    registryBaseUrl: string,
    instrumentId: InstrumentId,
    options: FetchTransferFactoryContextOptions,
): Promise<TransferFactoryContext> => {
    assertSafeRegistryUrl(registryBaseUrl, {
        environment: options.environment,
        label: 'transfer-factory discovery URL',
    });

    const base = registryBaseUrl.endsWith('/') ? registryBaseUrl : `${registryBaseUrl}/`;
    const url = new URL(TRANSFER_FACTORY_RELATIVE_PATH, base).toString();

    const { sender, receiver, amount, inputHoldingCids } = options;
    const { requestedAt, executeBefore } = resolveProbeWindow(options);

    return postFactoryContext(
        url,
        {
            choiceArguments: {
                expectedAdmin: instrumentId.admin,
                transfer: {
                    sender,
                    receiver,
                    amount,
                    instrumentId,
                    requestedAt,
                    executeBefore,
                    inputHoldingCids,
                    meta: { values: {} },
                },
                extraArgs: { context: { values: {} }, meta: { values: {} } },
            },
        },
        { timeoutMs: options.timeoutMs, probeName: 'transfer-factory' },
    );
};

export const fetchMergedTransferFactoryContext = async (
    registryBaseUrl: string,
    instrumentId: InstrumentId,
    options: FetchMergedTransferFactoryContextOptions,
): Promise<TransferFactoryContext> => {
    const { receivers, ...probeOptions } = options;
    return mergeProbedTransferFactoryContexts(receivers, (receiver) =>
        fetchTransferFactoryContext(registryBaseUrl, instrumentId, { ...probeOptions, receiver }),
    );
};

export const mergeProbedTransferFactoryContexts = async (
    receivers: string[],
    probe: (receiver: string) => Promise<TransferFactoryContext>,
): Promise<TransferFactoryContext> => {
    const uniqueReceivers = [...new Set(receivers)].sort();
    if (uniqueReceivers.length === 0) {
        throw new Error('fetchMergedTransferFactoryContext requires at least one receiver');
    }
    return mergeTransferFactoryContexts(await Promise.all(uniqueReceivers.map(probe)));
};

export const mergeTransferFactoryContexts = (
    contexts: TransferFactoryContext[],
): TransferFactoryContext => {
    if (contexts.length === 0) {
        throw new Error(
            'mergeTransferFactoryContexts requires at least one transfer-factory context',
        );
    }

    const factoryId = contexts[0]!.factoryId;
    for (const context of contexts) {
        if (context.factoryId !== factoryId) {
            throw new Error(
                `transfer-factory factoryId mismatch: ${factoryId} vs ${context.factoryId}`,
            );
        }
    }

    return {
        factoryId,
        choiceContext: {
            values: mergeChoiceContextValues(
                contexts.map((context) => context.choiceContext.values),
            ),
        },
        disclosedContracts: mergeDisclosedContracts(
            contexts.flatMap((context) => context.disclosedContracts),
        ),
    };
};

const isAvList = (value: unknown): value is { tag: 'AV_List'; value: unknown[] } =>
    value !== null &&
    typeof value === 'object' &&
    'tag' in value &&
    value.tag === 'AV_List' &&
    'value' in value &&
    Array.isArray(value.value);

export const contractIdsFromAnyValue = (value: unknown): string[] => {
    if (value == null || typeof value !== 'object' || !('tag' in value)) {
        return [];
    }
    if (value.tag === 'AV_ContractId' && 'value' in value && typeof value.value === 'string') {
        return [value.value];
    }
    if (isAvList(value)) {
        return value.value.flatMap(contractIdsFromAnyValue);
    }
    return [];
};

export const discloseUtilityCredentials = async (
    sdk: CantonSdk,
    choiceValue: unknown,
    party: string,
    kind: string,
): Promise<CantonDisclosedContract[]> => {
    const label = `${kind} credential`;
    const cids = contractIdsFromAnyValue(choiceValue);
    if (cids.length > TRANSFER_FACTORY_MAX_SENDER_CREDENTIALS) {
        throw new Error(`${label} exceeds ${TRANSFER_FACTORY_MAX_SENDER_CREDENTIALS} CIDs`);
    }
    return Promise.all(
        cids.map(async (cid) => {
            const { created, archived } = await sdk.fetchEventsByContractId(cid, [party]);
            if (!created || archived) throw new Error(`${label} ${cid} is missing or archived`);
            if (!created.templateId.endsWith(':Utility.Credential.V0.Credential:Credential')) {
                throw new Error(`${label} ${cid} is not the expected template`);
            }
            if (!isTrustedOrigin(created, party, 'holder')) {
                throw new Error(`${label} ${cid} is not a trusted holder origin`);
            }
            const disclosure = await sdk.createDisclosure(cid as ContractId<object>, [party]);
            if (!disclosure) throw new Error(`Failed to create disclosure for ${label}: ${cid}`);
            return disclosure;
        }),
    );
};

const mergeChoiceContextValues = (maps: ChoiceContext['values'][]): ChoiceContext['values'] => {
    const merged: ChoiceContext['values'] = {};
    for (const map of maps) {
        for (const [key, incoming] of Object.entries(map)) {
            const existing = merged[key];
            if (existing === undefined) {
                merged[key] = incoming;
                continue;
            }
            if (isAvList(existing) && isAvList(incoming)) {
                const seen = new Set(existing.value.map((element) => JSON.stringify(element)));
                const value = [...existing.value];
                for (const element of incoming.value) {
                    const elementKey = JSON.stringify(element);
                    if (seen.has(elementKey)) continue;
                    seen.add(elementKey);
                    value.push(element);
                }
                merged[key] = { tag: 'AV_List', value };
                continue;
            }
            if (JSON.stringify(existing) !== JSON.stringify(incoming)) {
                throw new Error(
                    `transfer-factory choice context key "${key}" has conflicting values`,
                );
            }
        }
    }
    return merged;
};

export const mergeDisclosedContracts = (
    contracts: CantonDisclosedContract[],
): CantonDisclosedContract[] => {
    const byId = new Map<string, CantonDisclosedContract>();
    for (const contract of contracts) {
        const existing = byId.get(contract.contractId);
        if (!existing) {
            byId.set(contract.contractId, contract);
            continue;
        }
        if (
            existing.createdEventBlob !== contract.createdEventBlob ||
            existing.templateId !== contract.templateId ||
            existing.synchronizerId !== contract.synchronizerId
        ) {
            throw new Error(
                `transfer-factory disclosed contract ${contract.contractId} has conflicting disclosure`,
            );
        }
    }
    return [...byId.values()];
};

export const callbackHoldingAmount = (holding: JsActiveContract): bigint =>
    parseDamlDecimal(
        callbackInterfaceView(
            holding,
            '#splice-api-token-holding-v1:Splice.Api.Token.HoldingV1:Holding',
        )?.amount,
        `Holding ${holding.createdEvent.contractId} amount`,
    );

export const fetchCallbackHoldings = async (
    sdk: CantonSdk,
    owner: string,
    offset: number,
    instrumentId: InstrumentId,
): Promise<JsActiveContract[]> => {
    const interfaceId = '#splice-api-token-holding-v1:Splice.Api.Token.HoldingV1:Holding';
    const contracts = await sdk.queryActiveContractsByInterface([owner], offset, [interfaceId], {
        includeCreatedEventBlob: true,
    });
    return contracts.filter((contract) => {
        const view = callbackInterfaceView(contract, interfaceId);
        const asset = view?.instrumentId as { admin?: unknown; id?: unknown } | undefined;
        return (
            view?.owner === owner &&
            asset?.admin === instrumentId.admin &&
            asset?.id === instrumentId.id &&
            view.lock == null
        );
    });
};

export const partyIdFromRegistryFingerprint = (
    registry: { fingerprintToHint: unknown },
    fingerprint: string,
): string => {
    const canonical = fingerprint.toLowerCase();
    const hints = textMapToRecord(registry.fingerprintToHint);
    const hint = hints[canonical] ?? hints[fingerprint];
    if (!hint) throw new Error(`Fingerprint ${canonical} not found in registry fingerprintToHint`);
    return `${hint}::1220${canonical}`;
};
