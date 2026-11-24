import type { AmuletContextResult } from '../client/amulet';
import type { ICantonClient } from '../client/interface';
import {
    type CantonRefreshPartyFilter,
    cantonSenderPartyRef,
    isCantonDeferredSender,
    isCantonDeferredSentinel,
} from '../deferredValue';
import type { JsActiveContract } from '../open-api/models';
import { CantonSdk } from '../sdk/canton-sdk';
import type {
    CantonCommand,
    CantonDisclosedContract,
    CantonUnresolvedCommand,
} from '../transaction';
import { getCreateArgumentField } from '../trusted-origin';
import { type ActiveContractRef, createContractAddressResolver } from './address-resolver';
import { resolveCantonFinalizeCallback } from './callback';
import { resolveCantonOneSigConfigContext } from './onesig-config';
import { resolveCantonOneSigDiscoveryContext } from './onesig-discovery';
import { resolveCantonOneSigRequestContext } from './onesig-request';
import { resolveCantonOneSigScopeContext } from './onesig-scope';
import { resolveCantonOneSigTransferBatch } from './onesig-transfer';
import { resolveCantonOneSigTransferInstructionContext } from './onesig-transfer-instruction';
import {
    type CantonActiveContractRefresh,
    type CantonActiveContractSelection,
    type CantonActiveContractValue,
    type CantonActiveContractValueRefresh,
    type CantonAmuletContextRefresh,
    type CantonArgumentRefreshTarget,
    type CantonContractSelector,
    cantonFinalizeCallbackRefreshSchema,
    cantonOneSigConfigContextRefreshSchema,
    cantonOneSigDiscoveryContextRefreshSchema,
    cantonOneSigRequestContextRefreshSchema,
    cantonOneSigScopeContextRefreshSchema,
    cantonOneSigTransferBatchRefreshSchema,
    cantonOneSigTransferInstructionContextRefreshSchema,
    type CantonRefresh,
    type CantonRefreshPath,
    type CantonRefreshPlan,
    cantonRefreshPlanSchema,
    type CantonRefreshTarget,
    type CantonTimestampRefresh,
    cantonTransferInstructionAcceptContextRefreshSchema,
} from './plan';
import { parseDamlDecimal, selectContractAmounts } from './select-contracts';

const CANTON_TIME_PATTERN = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,9})?Z$/;
const TRANSFER_PREAPPROVAL_EXPIRY_MARGIN_MS = 5 * 60 * 1000;

const resolveParty = (
    partyRef: CantonRefreshPartyFilter,
    senderParty: string | undefined,
    label: string,
): string => {
    if (!isCantonDeferredSender(partyRef)) return partyRef.party;
    if (!senderParty) {
        throw new Error(`${label} requires a resolved sender party`);
    }
    return senderParty;
};

const getContractNumericField = (contract: JsActiveContract, field: string): bigint => {
    const raw = getCreateArgumentField(contract.createdEvent.createArgument, field);
    const value =
        raw !== null && typeof raw === 'object' && 'initialAmount' in raw
            ? (raw as { initialAmount?: unknown }).initialAmount
            : raw;
    return parseDamlDecimal(
        value,
        `Contract ${contract.createdEvent.contractId} numeric field ${field}`,
    );
};

export const selectContractsByGte = (
    contracts: JsActiveContract[],
    field: string,
    requestedValue: string,
): JsActiveContract[] =>
    selectContractAmounts(contracts, field, requestedValue, (contract) =>
        getContractNumericField(contract, field),
    );

const makeActiveContractRef = (selector: CantonContractSelector): ActiveContractRef => ({
    type: 'activeContractIds',
    partyToFilter: selector.queryAs,
    expectedSignatories: selector.expectedSignatories,
    templateId: selector.templateId ?? selector.interfaceId,
    interfaceId: selector.interfaceId,
    contractStateFilter: selector.stateFilter,
});

const resolveSelectorContracts = async (
    resolver: ReturnType<typeof createContractAddressResolver>,
    selector: CantonContractSelector,
): Promise<JsActiveContract[]> => {
    const contracts = await resolver.resolveActiveContracts(makeActiveContractRef(selector));
    if (!selector.contractId) return contracts;
    const source = await resolver.resolveActiveContracts(
        makeActiveContractRef(selector.contractId.selector),
    );
    if (source.length !== 1)
        throw new Error(
            `Contract ID source matched ${source.length} contracts, expected exactly one`,
        );
    const contractId = getCreateArgumentField(
        source[0]!.createdEvent.createArgument,
        selector.contractId.field,
    );
    if (typeof contractId !== 'string' || !contractId)
        throw new Error('Contract ID source must contain a nonempty contract ID');
    return contracts.filter((contract) => contract.createdEvent.contractId === contractId);
};

const resolveContractValue = async (
    resolver: ReturnType<typeof createContractAddressResolver>,
    source: CantonActiveContractValue,
): Promise<string> => {
    const contracts = await resolveSelectorContracts(resolver, source.selector);
    if (contracts.length !== 1) {
        throw new Error(
            `Active contract value matched ${contracts.length} contracts, expected exactly one`,
        );
    }
    const value = getCreateArgumentField(contracts[0]!.createdEvent.createArgument, source.field);
    if (parseDamlDecimal(value, `Contract value ${source.field}`) <= 0n) {
        throw new Error(`Contract value ${source.field} must be positive`);
    }
    return value as string;
};

const selectActiveContracts = async (
    contracts: JsActiveContract[],
    selection: CantonActiveContractSelection,
    resolver: ReturnType<typeof createContractAddressResolver>,
): Promise<JsActiveContract[]> => {
    switch (selection.kind) {
        case 'exactlyOne':
            if (contracts.length !== 1) {
                throw new Error(
                    `Active contract selection matched ${contracts.length} contracts, expected exactly one`,
                );
            }
            return contracts;
        case 'all':
            return contracts;
        case 'gte':
            return selectContractsByGte(
                contracts,
                selection.field,
                typeof selection.value === 'string'
                    ? selection.value
                    : await resolveContractValue(resolver, selection.value),
            );
    }
};

export const resolveCantonActiveContracts = async (args: {
    client: ICantonClient;
    selector: CantonContractSelector;
    selection: CantonActiveContractSelection;
    senderParty?: string;
}): Promise<{ contractIds: string[] }> => {
    const queryParty = resolveParty(
        args.selector.queryAs,
        args.senderParty,
        'Active contract selection',
    );
    const resolver = createContractAddressResolver({
        client: args.client,
        senderParty: args.senderParty,
        signingParties: [queryParty],
        appendDisclosures: () => undefined,
    });
    const selected = await selectActiveContracts(
        await resolveSelectorContracts(resolver, args.selector),
        args.selection,
        resolver,
    );
    return {
        contractIds: selected.map(({ createdEvent }) => createdEvent.contractId),
    };
};

const isRecord = (value: unknown): value is Record<string, unknown> =>
    value !== null && typeof value === 'object' && !Array.isArray(value);

const isCantonTime = (value: unknown): value is string =>
    typeof value === 'string' &&
    CANTON_TIME_PATTERN.test(value) &&
    Number.isFinite(Date.parse(value));

const isActiveContractRefresh = (refresh: CantonRefresh): refresh is CantonActiveContractRefresh =>
    refresh.resolver.type === 'activeContract';

const isActiveContractValueRefresh = (
    refresh: CantonRefresh,
): refresh is CantonActiveContractValueRefresh => refresh.resolver.type === 'activeContractValue';

const isAmuletContextRefresh = (refresh: CantonRefresh): refresh is CantonAmuletContextRefresh =>
    refresh.resolver.type === 'amuletContext';

const isTimestampRefresh = (refresh: CantonRefresh): refresh is CantonTimestampRefresh =>
    refresh.resolver.type === 'timestamp';

const replaceAtPath = (root: unknown, path: CantonRefreshPath, value: unknown): unknown => {
    if (path.length === 0) return value;

    let current = root;
    for (const [position, segment] of path.entries()) {
        const isLast = position === path.length - 1;
        if ('field' in segment) {
            if (!isRecord(current) || !(segment.field in current)) {
                throw new Error(`Refresh target field "${segment.field}" does not exist`);
            }
            if (isLast) {
                current[segment.field] = value;
                return root;
            }
            current = current[segment.field];
            continue;
        }
        if ('index' in segment) {
            if (!Array.isArray(current) || segment.index >= current.length) {
                throw new Error(`Refresh target array index ${segment.index} does not exist`);
            }
            if (isLast) {
                current[segment.index] = value;
                return root;
            }
            current = current[segment.index];
            continue;
        }

        if (!Array.isArray(current)) {
            throw new Error(`Refresh target DAML map "${segment.damlMapKey}" is not an array`);
        }
        const matches = current.filter(
            (entry): entry is [string, unknown] =>
                Array.isArray(entry) && entry.length === 2 && entry[0] === segment.damlMapKey,
        );
        if (matches.length !== 1) {
            throw new Error(
                `Refresh target DAML map key "${segment.damlMapKey}" matched ${matches.length} entries`,
            );
        }
        if (isLast) {
            matches[0]![1] = value;
            return root;
        }
        current = matches[0]![1];
    }
    return root;
};

const readAtPath = (root: unknown, path: CantonRefreshPath): unknown => {
    let current = root;
    for (const segment of path) {
        if ('field' in segment) {
            if (!isRecord(current) || !(segment.field in current)) {
                throw new Error(`Refresh target field "${segment.field}" does not exist`);
            }
            current = current[segment.field];
            continue;
        }
        if ('index' in segment) {
            if (!Array.isArray(current) || segment.index >= current.length) {
                throw new Error(`Refresh target array index ${segment.index} does not exist`);
            }
            current = current[segment.index];
            continue;
        }

        if (!Array.isArray(current)) {
            throw new Error(`Refresh target DAML map "${segment.damlMapKey}" is not an array`);
        }
        const matches = current.filter(
            (entry): entry is [string, unknown] =>
                Array.isArray(entry) && entry.length === 2 && entry[0] === segment.damlMapKey,
        );
        if (matches.length !== 1) {
            throw new Error(
                `Refresh target DAML map key "${segment.damlMapKey}" matched ${matches.length} entries`,
            );
        }
        current = matches[0]![1];
    }
    return current;
};

const readTarget = (
    commands: CantonUnresolvedCommand[],
    target: CantonArgumentRefreshTarget,
    path: CantonRefreshPath,
): unknown => {
    const command = commands[target.commandIndex];
    if (!command) {
        throw new Error(`Refresh command index ${target.commandIndex} does not exist`);
    }

    if (target.command === 'exercise') {
        if (!('exerciseCommand' in command)) {
            throw new Error(`Refresh command index ${target.commandIndex} is not an exercise`);
        }
        if (command.exerciseCommand.choice !== target.choice) {
            throw new Error(
                `Refresh command index ${target.commandIndex} expected choice ${target.choice}, found ${command.exerciseCommand.choice}`,
            );
        }
        return readAtPath(command.exerciseCommand.choiceArgument, path);
    }

    if (!('createCommand' in command)) {
        throw new Error(`Refresh command index ${target.commandIndex} is not a create`);
    }
    if (command.createCommand.templateId !== target.template) {
        throw new Error(
            `Refresh command index ${target.commandIndex} expected template ${target.template}, found ${command.createCommand.templateId}`,
        );
    }
    return readAtPath(command.createCommand.createArguments, path);
};

const applyPatch = (
    commands: CantonUnresolvedCommand[],
    target: CantonArgumentRefreshTarget,
    path: CantonRefreshPath,
    value: unknown,
): void => {
    const command = commands[target.commandIndex];
    if (!command) {
        throw new Error(`Refresh command index ${target.commandIndex} does not exist`);
    }

    if (target.command === 'exercise') {
        if (!('exerciseCommand' in command)) {
            throw new Error(`Refresh command index ${target.commandIndex} is not an exercise`);
        }
        if (command.exerciseCommand.choice !== target.choice) {
            throw new Error(
                `Refresh command index ${target.commandIndex} expected choice ${target.choice}, found ${command.exerciseCommand.choice}`,
            );
        }
        command.exerciseCommand.choiceArgument = replaceAtPath(
            command.exerciseCommand.choiceArgument,
            path,
            value,
        );
        return;
    }

    if (!('createCommand' in command)) {
        throw new Error(`Refresh command index ${target.commandIndex} is not a create`);
    }
    if (command.createCommand.templateId !== target.template) {
        throw new Error(
            `Refresh command index ${target.commandIndex} expected template ${target.template}, found ${command.createCommand.templateId}`,
        );
    }
    command.createCommand.createArguments = replaceAtPath(
        command.createCommand.createArguments,
        path,
        value,
    );
};

const applyTarget = (
    commands: CantonUnresolvedCommand[],
    target: CantonRefreshTarget,
    value: unknown,
): void => {
    if ('field' in target) {
        const command = commands[target.commandIndex];
        if (!command) {
            throw new Error(`Refresh command index ${target.commandIndex} does not exist`);
        }
        if (!('exerciseCommand' in command)) {
            throw new Error(`Refresh command index ${target.commandIndex} is not an exercise`);
        }
        if (target.choice !== undefined && command.exerciseCommand.choice !== target.choice) {
            throw new Error(
                `Refresh command index ${target.commandIndex} expected choice ${target.choice}, found ${command.exerciseCommand.choice}`,
            );
        }
        if (typeof value !== 'string') {
            throw new Error('Exercise contract ID refresh must resolve to a string');
        }
        command.exerciseCommand.contractId = value;
        return;
    }

    for (const argument of target.arguments) {
        applyPatch(commands, target, argument.path, value);
    }
};

const containsDeferredSentinel = (value: unknown): boolean => {
    if (isCantonDeferredSentinel(value)) return true;
    if (Array.isArray(value)) return value.some((item) => containsDeferredSentinel(item));
    if (!isRecord(value)) return false;
    return Object.values(value).some((child) => containsDeferredSentinel(child));
};

const transferPreapprovalExpiry = ({
    amuletContext,
    disclosedContracts,
}: AmuletContextResult): string | undefined => {
    const preapproval = amuletContext.values['transfer-preapproval'];
    if (!isRecord(preapproval) || typeof preapproval.value !== 'string') return undefined;
    const disclosure: unknown = disclosedContracts.find(
        ({ contractId }) => contractId === preapproval.value,
    );
    const debugPayload = isRecord(disclosure) ? disclosure.debugPayload : undefined;
    const expiresAt = isRecord(debugPayload) ? debugPayload.expiresAt : undefined;
    return isCantonTime(expiresAt) ? expiresAt : undefined;
};

const resolveAmuletContext = async (
    client: ICantonClient,
    { dsoParty, receiver, amount }: CantonAmuletContextRefresh['resolver'],
): Promise<AmuletContextResult> => {
    const instrumentId = { admin: dsoParty, id: 'Amulet' };
    const bundle = await client.getAmuletContextWithExternalRules(instrumentId, {
        receiver,
        amount,
    });
    if (!receiver) return bundle;
    const expiresAt = transferPreapprovalExpiry(bundle);
    if (!expiresAt || Date.parse(expiresAt) > Date.now() + TRANSFER_PREAPPROVAL_EXPIRY_MARGIN_MS) {
        return bundle;
    }
    console.warn(
        `TransferPreapproval for receiver ${receiver} expires at ${expiresAt}; using the generic Amulet context`,
    );
    return client.getAmuletContextWithExternalRules(instrumentId);
};

const disclosuresEqual = (left: CantonDisclosedContract, right: CantonDisclosedContract): boolean =>
    left.contractId === right.contractId &&
    left.templateId === right.templateId &&
    left.createdEventBlob === right.createdEventBlob &&
    left.synchronizerId === right.synchronizerId;

export const resolveCantonRefreshPlan = async (args: {
    unresolvedCommands: CantonUnresolvedCommand[];
    unresolvedDisclosedContracts: CantonDisclosedContract[];
    refreshPlan: CantonRefreshPlan;
    senderParty?: string;
    signingParties: string[];
    client: ICantonClient;
}): Promise<{ commands: CantonCommand[]; disclosedContracts: CantonDisclosedContract[] }> => {
    const replacements = cantonRefreshPlanSchema.shape.replaceSentinels.parse(
        args.refreshPlan.replaceSentinels,
    );
    const commands = structuredClone(args.unresolvedCommands);
    if (replacements) {
        if (
            typeof args.senderParty !== 'string' ||
            !args.senderParty.trim() ||
            isCantonDeferredSentinel(args.senderParty)
        ) {
            throw new Error('Sender binding requires a resolved sender party');
        }
        for (const replacement of replacements) {
            for (const target of replacement.targets) {
                for (const { path } of target.arguments) {
                    if (readTarget(commands, target, path) !== cantonSenderPartyRef()) {
                        throw new Error(
                            'Sender binding target must contain cantonSenderPartyRef()',
                        );
                    }
                    applyPatch(commands, target, path, args.senderParty);
                }
            }
        }
    }
    if (containsDeferredSentinel(commands)) {
        throw new Error('Canton refreshPlan cannot be combined with deferred sentinels');
    }

    for (const entry of args.refreshPlan.commands) {
        if (entry.resolver.type !== 'finalizeCallback') continue;
        const callback = cantonFinalizeCallbackRefreshSchema.parse(entry);
        const contextIndices = callback.targets.map((target) => target.commandIndex).sort();
        const cidIndices = callback.callbackCidTargets.map((target) => target.commandIndex).sort();
        if (JSON.stringify(contextIndices) !== JSON.stringify(cidIndices)) {
            throw new Error(
                'Callback context and contract ID targets must address the same commands',
            );
        }
        for (const target of [...callback.targets, ...callback.callbackCidTargets]) {
            readTarget(commands, target, target.arguments[0].path);
            const command = commands[target.commandIndex]!;
            if (
                !('exerciseCommand' in command) ||
                !isRecord(command.exerciseCommand.choiceArgument) ||
                command.exerciseCommand.choiceArgument.pendingCallbackCid !==
                    callback.resolver.pendingCallbackCid
            ) {
                throw new Error('Callback target must match the pinned PendingCallback');
            }
        }
    }

    const disclosureMap = new Map<string, CantonDisclosedContract>();
    const appendDisclosures = (disclosures: CantonDisclosedContract[]): void => {
        for (const disclosure of disclosures) {
            const existing = disclosureMap.get(disclosure.contractId);
            if (existing && !disclosuresEqual(existing, disclosure)) {
                throw new Error(`Conflicting disclosures for contract ${disclosure.contractId}`);
            }
            disclosureMap.set(disclosure.contractId, disclosure);
        }
    };
    appendDisclosures(args.unresolvedDisclosedContracts);

    const resolver = createContractAddressResolver({
        client: args.client,
        senderParty: args.senderParty,
        signingParties: args.signingParties,
        appendDisclosures,
    });

    for (const refresh of args.refreshPlan.commands) {
        if (isActiveContractRefresh(refresh)) {
            const ref = makeActiveContractRef(refresh.resolver.selector);
            const selected = await selectActiveContracts(
                await resolveSelectorContracts(resolver, refresh.resolver.selector),
                refresh.resolver.selection,
                resolver,
            );
            await resolver.discloseActiveContracts(ref, selected);
            const contractIds = selected.map(({ createdEvent }) => createdEvent.contractId);
            const resolved =
                refresh.resolver.selection.kind === 'exactlyOne' ? contractIds[0]! : contractIds;
            for (const target of refresh.targets) applyTarget(commands, target, resolved);
            continue;
        }

        if (isActiveContractValueRefresh(refresh)) {
            const value = await resolveContractValue(resolver, refresh.resolver);
            for (const target of refresh.targets) applyTarget(commands, target, value);
            continue;
        }

        if (refresh.resolver.type === 'oneSigTransferBatch') {
            const transfer = cantonOneSigTransferBatchRefreshSchema.parse(refresh);
            const firstTarget = transfer.targets[0]!;
            const commandIndex = firstTarget.commandIndex;
            const calls = readTarget(commands, firstTarget, [
                { field: 'transaction' },
                { field: 'calls' },
            ]);
            if (!Array.isArray(calls)) throw new Error('OneSig transfer target requires calls');
            const transferIndices = calls.flatMap((entry, index) =>
                isRecord(entry) && isRecord(entry.call) && entry.call.tag === 'OpTransfer'
                    ? [index]
                    : [],
            );
            const indices = transfer.targets.map((target) => target.arguments[0].path[2].index);
            if (
                transfer.targets.some((target) => target.commandIndex !== commandIndex) ||
                indices.length !== transferIndices.length ||
                new Set(indices).size !== indices.length ||
                transferIndices.some((index) => !indices.includes(index)) ||
                args.refreshPlan.commands.filter(
                    (entry) =>
                        entry.resolver.type === 'oneSigTransferBatch' &&
                        entry.targets.some((target) => target.commandIndex === commandIndex),
                ).length !== 1
            ) {
                throw new Error(
                    'OneSig transfer targets must cover every Transfer context exactly once',
                );
            }
            for (const target of transfer.targets) {
                const current = readTarget(commands, target, target.arguments[0].path);
                if (
                    !isRecord(current) ||
                    current.tag !== 'TransferFactoryContext' ||
                    !isRecord(current.value)
                )
                    throw new Error('OneSig transfer target context mismatch');
            }
            const bundle = await resolveCantonOneSigTransferBatch(
                new CantonSdk(args.client),
                transfer.resolver,
                indices.map((index) => calls[index].call),
                args.client,
            );
            appendDisclosures(bundle.disclosedContracts);
            transfer.targets.forEach((target, index) =>
                applyTarget(commands, target, bundle.contexts[index]),
            );
            continue;
        }

        if (refresh.resolver.type === 'oneSigTransferInstructionContext') {
            const instruction = cantonOneSigTransferInstructionContextRefreshSchema.parse(refresh);
            const target = instruction.targets[0]!;
            const path = target.arguments[0].path;
            const current = readTarget(commands, target, path);
            const call = readTarget(commands, target, [...path.slice(0, -1), { field: 'call' }]);
            if (
                !isRecord(current) ||
                current.tag !== 'TransferInstructionContext' ||
                !isRecord(current.value) ||
                current.value.transferInstructionCid !== instruction.resolver.transferInstructionCid
            ) {
                throw new Error(
                    'OneSig instruction target must match the pinned transfer instruction',
                );
            }
            const bundle = await resolveCantonOneSigTransferInstructionContext(
                new CantonSdk(args.client),
                instruction.resolver,
                call,
                args.client,
            );
            appendDisclosures(bundle.disclosedContracts);
            applyTarget(commands, target, bundle.context);
            continue;
        }

        if (refresh.resolver.type === 'oneSigConfigContext') {
            const config = cantonOneSigConfigContextRefreshSchema.parse(refresh);
            for (const target of config.targets) {
                const path = target.arguments[0].path;
                const current = readTarget(commands, target, path);
                const call = readTarget(commands, target, [
                    ...path.slice(0, -1),
                    { field: 'call' },
                ]);
                const expected = config.resolver;
                if (
                    !isRecord(call) ||
                    !isRecord(call.value) ||
                    call.tag !== expected.operation ||
                    !isRecord(call.value.oappId) ||
                    call.value.oappId.admin !== expected.oappId.admin ||
                    call.value.oappId.id !== expected.oappId.id ||
                    !isRecord(current) ||
                    current.tag !== 'ConfigContext' ||
                    !isRecord(current.value) ||
                    (expected.operation === 'OpSetRequestFactory' &&
                        call.value.expectedHandler !== expected.expectedHandler)
                ) {
                    throw new Error('OneSig config target does not match signed call identity');
                }
                const bundle = await resolveCantonOneSigConfigContext(
                    new CantonSdk(args.client),
                    expected,
                );
                appendDisclosures(bundle.disclosedContracts);
                applyTarget(commands, target, bundle.context);
            }
            continue;
        }

        if (refresh.resolver.type === 'oneSigScopeContext') {
            const scope = cantonOneSigScopeContextRefreshSchema.parse(refresh);
            for (const target of scope.targets) {
                const path = target.arguments[0].path;
                const current = readTarget(commands, target, path);
                const call = readTarget(commands, target, [
                    ...path.slice(0, -1),
                    { field: 'call' },
                ]);
                const expected = scope.resolver;
                const contextTag =
                    expected.operation === 'OpSetMinFee'
                        ? 'MinFeeContext'
                        : expected.operation === 'OpSetMinPayoutValue'
                          ? 'MinPayoutValueContext'
                          : expected.operation === 'OpSetProtocolLedgerTimeValidityPeriod'
                            ? 'LedgerTimeValidityContext'
                            : 'AccessControlContext';
                if (
                    !isRecord(call) ||
                    !isRecord(call.value) ||
                    call.tag !== expected.operation ||
                    !isRecord(call.value.scope) ||
                    call.value.scope.category !== expected.scope.category ||
                    call.value.scope.admin !== expected.scope.admin ||
                    call.value.scope.id !== expected.scope.id ||
                    (expected.operation === 'OpAcceptDefaultAdmin' &&
                        expected.scope.category === 'oapp') ||
                    !isRecord(current) ||
                    current.tag !== contextTag ||
                    !isRecord(current.value)
                ) {
                    throw new Error('OneSig scope target does not match signed call identity');
                }
                const bundle = await resolveCantonOneSigScopeContext(
                    new CantonSdk(args.client),
                    expected,
                );
                appendDisclosures(bundle.disclosedContracts);
                applyTarget(commands, target, bundle.context);
            }
            continue;
        }

        if (refresh.resolver.type === 'oneSigDiscoveryContext') {
            const discovery = cantonOneSigDiscoveryContextRefreshSchema.parse(refresh);
            for (const target of discovery.targets) {
                const path = target.arguments[0].path;
                const current = readTarget(commands, target, path);
                const call = readTarget(commands, target, [
                    ...path.slice(0, -1),
                    { field: 'call' },
                ]);
                const expected = discovery.resolver;
                if (
                    !isRecord(call) ||
                    call.tag !== 'OpSetDiscoveryUrl' ||
                    !isRecord(call.value) ||
                    !isRecord(call.value.oappId) ||
                    call.value.oappId.admin !== expected.oappId.admin ||
                    call.value.oappId.id !== expected.oappId.id ||
                    !isRecord(current) ||
                    current.tag !== 'OAppDiscoveryContext' ||
                    !isRecord(current.value) ||
                    !isCantonTime(current.value.timestamp) ||
                    (parseDamlDecimal(call.value.feeAmount, 'Discovery fee') > 0n
                        ? expected.feeDsoParty !== call.value.dso
                        : expected.feeDsoParty !== undefined)
                ) {
                    throw new Error('OneSig discovery target does not match signed call identity');
                }
                const bundle = await resolveCantonOneSigDiscoveryContext(
                    new CantonSdk(args.client),
                    expected,
                    current.value.timestamp,
                );
                appendDisclosures(bundle.disclosedContracts);
                applyTarget(commands, target, bundle.context);
            }
            continue;
        }

        if (refresh.resolver.type === 'oneSigRequestContext') {
            const request = cantonOneSigRequestContextRefreshSchema.parse(refresh);
            for (const target of request.targets) {
                const path = target.arguments[0].path;
                const current = readTarget(commands, target, path);
                const call = readTarget(commands, target, [
                    ...path.slice(0, -1),
                    { field: 'call' },
                ]);
                const expected = request.resolver.request;
                const requestTags = [
                    'OpCreateOAppRequest',
                    'OpSkip',
                    'OpBurn',
                    'OpClear',
                    'OpNilify',
                ];
                if (
                    !isRecord(call) ||
                    !isRecord(call.value) ||
                    call.value.dso !== request.resolver.dsoParty ||
                    !isRecord(current) ||
                    !isRecord(current.value) ||
                    !isCantonTime(current.value.timestamp) ||
                    (expected.kind === 'request'
                        ? call.tag !== 'OpCreateRequest' || current.tag !== 'RequestContext'
                        : expected.kind === 'oappAccept'
                          ? call.tag !== 'OpAcceptDefaultAdmin' ||
                            current.tag !== 'OAppRequestContext' ||
                            !isRecord(call.value.scope) ||
                            call.value.scope.category !== 'oapp' ||
                            call.value.scope.admin !== expected.oappId.admin ||
                            call.value.scope.id !== expected.oappId.id ||
                            parseDamlDecimal(call.value.feeAmount, 'OApp Accept fee') <= 0n
                          : !requestTags.includes(String(call.tag)) ||
                            current.tag !== 'OAppRequestContext' ||
                            !isRecord(call.value.oappId) ||
                            call.value.oappId.admin !== expected.oappId.admin ||
                            call.value.oappId.id !== expected.oappId.id)
                ) {
                    throw new Error('OneSig request target does not match signed call identity');
                }
                const bundle = await resolveCantonOneSigRequestContext(
                    new CantonSdk(args.client),
                    request.resolver,
                    current.value.timestamp,
                );
                appendDisclosures(bundle.disclosedContracts);
                applyTarget(commands, target, bundle.context);
            }
            continue;
        }

        if (refresh.resolver.type === 'finalizeCallback') {
            const callback = cantonFinalizeCallbackRefreshSchema.parse(refresh);
            const bundle = await resolveCantonFinalizeCallback(
                new CantonSdk(args.client),
                callback.resolver,
            );
            appendDisclosures(bundle.disclosedContracts);
            for (const target of callback.targets)
                applyTarget(commands, target, bundle.executeContext);
            for (const target of callback.callbackCidTargets)
                applyTarget(commands, target, bundle.callbackCid);
            continue;
        }

        if (refresh.resolver.type === 'transferInstructionAcceptContext') {
            const acceptance = cantonTransferInstructionAcceptContextRefreshSchema.parse(refresh);
            for (const target of acceptance.targets) {
                readTarget(commands, target, target.arguments[0]!.path);
                const command = commands[target.commandIndex]!;
                if (
                    !('exerciseCommand' in command) ||
                    command.exerciseCommand.contractId !== acceptance.resolver.contractId
                ) {
                    throw new Error(
                        'Accept context target must match the pinned transfer instruction',
                    );
                }
            }
            const bundle = await args.client.getTransferInstructionAcceptContext({
                contractId: acceptance.resolver.contractId,
            });
            appendDisclosures(bundle.disclosedContracts);
            for (const target of acceptance.targets) {
                applyTarget(commands, target, bundle.choiceContext);
            }
            continue;
        }

        if (isAmuletContextRefresh(refresh)) {
            const bundle = await resolveAmuletContext(args.client, refresh.resolver);
            appendDisclosures(bundle.disclosedContracts);
            for (const target of refresh.targets) {
                applyTarget(commands, target, bundle.amuletContext);
            }
            for (const target of refresh.contractIdTargets ?? []) {
                applyTarget(commands, target, bundle.externalPartyAmuletRulesCid);
            }
        }
    }

    // Timestamp refreshes run after all external reads so their shared instant is
    // as close as possible to prepareForSigning, regardless of declaration order.
    const now = new Date();
    for (const refresh of args.refreshPlan.commands) {
        if (!isTimestampRefresh(refresh)) continue;

        for (const target of refresh.targets) {
            for (const { path, offsetMs = 0 } of target.arguments) {
                const iso = new Date(now.getTime() + offsetMs).toISOString();
                const current = readTarget(commands, target, path);
                let value: unknown;
                if (isCantonTime(current)) {
                    value = iso;
                } else if (
                    isRecord(current) &&
                    current.tag === 'AV_Time' &&
                    isCantonTime(current.value)
                ) {
                    value = { ...current, value: iso };
                } else {
                    throw new Error('Timestamp refresh target must contain a Canton Time value');
                }
                applyPatch(commands, target, path, value);
            }
        }
    }

    for (const refresh of args.refreshPlan.commands) {
        if (refresh.resolver.type !== 'transferInstructionAcceptContext') continue;
        for (const target of refresh.targets) {
            const command = commands[target.commandIndex]!;
            if (
                !('exerciseCommand' in command) ||
                command.exerciseCommand.contractId !== refresh.resolver.contractId
            ) {
                throw new Error('Accept context target must match the pinned transfer instruction');
            }
        }
    }

    for (const refresh of args.refreshPlan.commands) {
        if (refresh.resolver.type !== 'finalizeCallback') continue;
        const callback = cantonFinalizeCallbackRefreshSchema.parse(refresh);
        for (const target of [...callback.targets, ...callback.callbackCidTargets]) {
            const command = commands[target.commandIndex]!;
            if (
                !('exerciseCommand' in command) ||
                !isRecord(command.exerciseCommand.choiceArgument) ||
                command.exerciseCommand.choiceArgument.pendingCallbackCid !==
                    callback.resolver.pendingCallbackCid
            ) {
                throw new Error('Callback target must match the pinned PendingCallback');
            }
        }
    }

    for (const replacement of replacements ?? []) {
        for (const target of replacement.targets) {
            for (const { path } of target.arguments) {
                if (readTarget(commands, target, path) !== args.senderParty) {
                    throw new Error('Refresh cannot change the bound sender party');
                }
            }
        }
    }
    const disclosedContracts = [...disclosureMap.values()];
    if (containsDeferredSentinel(commands)) {
        throw new Error('Canton refreshPlan cannot return deferred sentinels');
    }

    return {
        commands: commands as CantonCommand[],
        disclosedContracts,
    };
};
