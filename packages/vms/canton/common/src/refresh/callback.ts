import type { ContractId } from '@daml/types';
import { keccak_256 } from '@noble/hashes/sha3';

import { bytesToHex } from '@layerzerolabs/common-encoding-utils';

import { IOAppResolutionError } from '../errors';
import type { CreatedEvent, JsActiveContract } from '../open-api/models';
import type { CantonSdk } from '../sdk/canton-sdk';
import type { CantonDisclosedContract } from '../transaction';
import { areExpectedSignatories, isTrustedOrigin } from '../trusted-origin';
import { resolveBurnMintCallbackContext } from './callback-burn-mint';
import { callbackDisclosure } from './callback-contracts';
import { resolveLockUnlockCallbackContext } from './callback-lock-unlock';
import type { CantonFinalizeCallbackRefresh } from './plan';
import { partyIdFromRegistryFingerprint } from './registry-context';
export { callbackDisclosure, callbackInterfaceView } from './callback-contracts';

const IOAPP = '#layerzero-ioapp:IOApp:IOApp';
const CONFIG = '#layerzero-ioapp-config:IOAppConfig:IOAppConfig';
const REGISTRY = '#layerzero-iregistry:IRegistry:IRegistry';
const LIMITER = '#layerzero-irate-limiter:IRateLimitState:IRateLimitState';
const PENDING = '#layerzero-request:PendingCallback:PendingCallback';
const OFT_SELF = '#layerzero-oft:OftSelf:OftSelf';
const OFT_CONFIG = '#layerzero-oft:OftSelfConfig:OftSelfConfig';
const LOCK_UNLOCK = '#layerzero-lock-unlock-adapter:LockUnlockAdapter:LockUnlockAdapter';
const LOCK_UNLOCK_CONFIG = '#layerzero-lock-unlock-adapter:AdapterConfig:AdapterConfig';

const BURN_MINT = '#layerzero-burn-mint-adapter:BurnMintAdapter:BurnMintAdapter';
const BURN_MINT_CONFIG = '#layerzero-burn-mint-adapter:AdapterConfig:AdapterConfig';

export type CantonCallbackOAppId = { admin: string; id: string };
type CallbackArgs = Array<[string, { tag: string; value: unknown }]>;
type CallbackInput = CantonFinalizeCallbackRefresh['resolver'];
type CallbackContext = Array<
    [
        string,
        Array<
            [
                { tag: 'Addr_Text'; value: string },
                Array<
                    [
                        string,
                        Array<[{ tag: 'Addr_Text'; value: string }, Array<[string, CallbackArgs]>]>,
                    ]
                >,
            ]
        >,
    ]
>;
type CallbackIdentity = CallbackInput['identity'];
type PendingCallback = {
    handler: string;
    sender: string;
    oappId: CantonCallbackOAppId;
    callbackContext: unknown;
    isAccept: boolean;
};

export const cantonCallbackAppUid = (admin: string, id: string): string =>
    bytesToHex(keccak_256(new TextEncoder().encode(`${admin}|${id}`)));

export const getCantonCallbackFnArgs = (
    context: unknown,
    appUid: string,
    fnName: string,
): CallbackArgs | undefined => {
    let current = context;
    for (const key of ['OApp', appUid, 'OApp', appUid, fnName]) {
        if (!Array.isArray(current)) return undefined;
        current = current.find(
            ([candidate]: [unknown]) =>
                candidate === key ||
                (candidate !== null &&
                    typeof candidate === 'object' &&
                    'value' in candidate &&
                    candidate.value === key),
        )?.[1];
    }
    return current as CallbackArgs | undefined;
};

export const hasPositiveCantonCallbackOutflow = (
    callbackContext: unknown,
    appUid: string,
): boolean => {
    const outbound = getCantonCallbackFnArgs(callbackContext, appUid, 'LzSend_callback');
    const frozen = outbound?.find(([key]) => key === 'rlScaledAmount')?.[1].value;
    const amount =
        typeof frozen === 'number' || typeof frozen === 'string' || typeof frozen === 'bigint'
            ? Number(frozen)
            : NaN;
    return Number.isFinite(amount) && amount > 0;
};

export const shouldIncludeCantonCallbackRateLimiter = (args: {
    callbackContext: unknown;
    appUid: string;
    isGloballyDisabled: boolean;
    isAccept: boolean;
}): boolean => {
    if (hasPositiveCantonCallbackOutflow(args.callbackContext, args.appUid)) return true;
    return (
        !args.isGloballyDisabled &&
        args.isAccept &&
        getCantonCallbackFnArgs(args.callbackContext, args.appUid, 'LzReceive_callback') !==
            undefined
    );
};

export const cantonFinalizeCallbackBaseEntries = (args: {
    configCid: string;
    registryCid?: string;
    rateLimiterStateCid?: string;
}): Array<[string, Array<[string, { tag: 'AV_ContractId'; value: string }]>]> => {
    const entries: Array<[string, Array<[string, { tag: 'AV_ContractId'; value: string }]>]> = [];
    for (const key of ['configCid', 'registryCid', 'rateLimiterStateCid'] as const) {
        const cid = args[key];
        if (cid) entries.push([key, [[key, { tag: 'AV_ContractId', value: cid }]]]);
    }
    return entries;
};

const matchesId = (candidate: unknown, id: CantonCallbackOAppId): boolean => {
    const value = candidate as CantonCallbackOAppId | undefined;
    return value?.admin === id.admin && value.id === id.id;
};
const matchesTemplate = (event: CreatedEvent, template: string): boolean =>
    event.templateId === template ||
    (event.packageName === template.slice(1, template.indexOf(':')) &&
        event.templateId.endsWith(template.slice(template.indexOf(':'))));
const exactlyOne = (contracts: JsActiveContract[], label: string): JsActiveContract => {
    if (contracts.length !== 1)
        throw new Error(`Expected exactly one ${label}, found ${contracts.length}`);
    return contracts[0]!;
};
const requireDisclosure = async (
    sdk: CantonSdk,
    informee: string,
    cid: string,
): Promise<CantonDisclosedContract> => {
    const { created, archived } = await sdk.fetchEventsByContractId(cid, [informee]);
    if (!created || archived) throw new Error(`Callback dependency ${cid} is missing or archived`);
    const value = await sdk.createDisclosure(cid as ContractId<object>, [informee]);
    if (!value) throw new Error(`Missing disclosure for ${cid}`);
    return value;
};
const decimalSetting = (value: unknown): string => {
    if (typeof value !== 'string' || !/^\d+$/.test(value)) {
        throw new Error('Callback decimal settings must be Daml Int strings');
    }
    return value;
};

export const resolveCantonFinalizeCallback = async (
    sdk: CantonSdk,
    input: Omit<CallbackInput, 'type' | 'oappId' | 'identity'> & {
        oappId?: CantonCallbackOAppId;
        identity?: CallbackIdentity;
    },
) => {
    const { created, archived } = await sdk.fetchEventsByContractId(input.pendingCallbackCid, [
        input.informee,
    ]);
    if (
        !created ||
        archived ||
        created.contractId !== input.pendingCallbackCid ||
        !matchesTemplate(created, PENDING) ||
        !isTrustedOrigin(created, input.informee, 'handler')
    ) {
        throw new Error(
            'PendingCallback is missing, archived, or not from the expected handler/template',
        );
    }
    const pending = created.createArgument as PendingCallback;
    if (
        !pending.oappId?.admin ||
        !pending.oappId.id ||
        (input.oappId && !matchesId(pending.oappId, input.oappId))
    ) {
        throw new Error('PendingCallback OApp identity mismatch');
    }
    const oappId = pending.oappId;
    const offset = await sdk.getLedgerEndOffset();
    const query = async (interfaceId: string, gateway?: string) => {
        const [packageName, moduleName, entityName] = interfaceId.slice(1).split(':');
        const packageId = await sdk.getPackageId(packageName!, [input.informee]);
        const resolvedInterfaceId = `${packageId}:${moduleName}:${entityName}`;
        return (
            await sdk.queryActiveContractsByInterface([input.informee], offset, [interfaceId], {
                includeCreatedEventBlob: true,
            })
        ).filter((contract) => {
            const views =
                contract.createdEvent.interfaceViews?.filter(
                    (view) => view.interfaceId === resolvedInterfaceId,
                ) ?? [];
            const view = views[0]?.viewValue as Record<string, unknown> | undefined;
            return (
                views.length === 1 &&
                views[0]?.viewStatus?.code === 0 &&
                view != null &&
                areExpectedSignatories(contract.createdEvent, [oappId.admin]) &&
                matchesId(view.oappId, oappId) &&
                (gateway === undefined || view.oappGateway === gateway)
            );
        });
    };
    const [callbacks, configs] = await Promise.all([query(IOAPP, input.informee), query(CONFIG)]);
    let callback: JsActiveContract;
    let config: JsActiveContract;
    try {
        callback = exactlyOne(callbacks, 'callback for OApp/gateway');
        config = exactlyOne(configs, 'callback config for OApp');
    } catch (error) {
        throw IOAppResolutionError.wrap(error, 'Could not resolve callback contracts');
    }
    const kind =
        matchesTemplate(callback.createdEvent, OFT_SELF) &&
        matchesTemplate(config.createdEvent, OFT_CONFIG)
            ? 'oft-self'
            : matchesTemplate(callback.createdEvent, LOCK_UNLOCK) &&
                matchesTemplate(config.createdEvent, LOCK_UNLOCK_CONFIG)
              ? 'lock-unlock-adapter'
              : matchesTemplate(callback.createdEvent, BURN_MINT) &&
                  matchesTemplate(config.createdEvent, BURN_MINT_CONFIG)
                ? 'burn-mint-adapter'
                : undefined;
    if (!kind)
        throw new Error('Callback kind changed or is unsupported; repopulate the transaction');
    const payload = config.createdEvent.createArgument as {
        instrumentId?: CantonCallbackOAppId;
        assetInstrumentId?: CantonCallbackOAppId;
        localDecimals: string;
        sharedDecimals: string;
        rateLimiterConfig: { scaleDecimals: string; isGloballyDisabled: boolean };
    };
    const instrumentId = kind === 'oft-self' ? payload.instrumentId : payload.assetInstrumentId;
    if (
        !instrumentId?.admin ||
        !instrumentId.id ||
        (kind === 'oft-self' && !matchesId(instrumentId, oappId))
    ) {
        throw new Error('Callback instrument changed; repopulate the transaction');
    }
    const decimals = {
        instrumentId: { ...instrumentId },
        localDecimals: decimalSetting(payload.localDecimals),
        sharedDecimals: decimalSetting(payload.sharedDecimals),
        rateLimiterScaleDecimals: decimalSetting(payload.rateLimiterConfig.scaleDecimals),
    };
    const treasury = (callback.createdEvent.createArgument as { treasury?: unknown }).treasury;
    if (kind === 'lock-unlock-adapter' && (typeof treasury !== 'string' || !treasury)) {
        throw new Error('Lock/unlock callback treasury is required');
    }
    const mintEscrow = (callback.createdEvent.createArgument as { mintEscrow?: unknown })
        .mintEscrow;
    if (kind === 'burn-mint-adapter' && (typeof mintEscrow !== 'string' || !mintEscrow)) {
        throw new Error('Burn/mint callback mintEscrow is required');
    }
    const identity: CallbackIdentity =
        kind === 'oft-self'
            ? { kind, ...decimals }
            : kind === 'lock-unlock-adapter'
              ? { kind, ...decimals, treasury: treasury as string }
              : { kind, ...decimals, mintEscrow: mintEscrow as string };
    if (
        input.identity &&
        (input.identity.kind !== identity.kind ||
            !matchesId(input.identity.instrumentId, identity.instrumentId) ||
            input.identity.localDecimals !== identity.localDecimals ||
            input.identity.sharedDecimals !== identity.sharedDecimals ||
            input.identity.rateLimiterScaleDecimals !== identity.rateLimiterScaleDecimals ||
            (input.identity.kind === 'lock-unlock-adapter' &&
                identity.kind === 'lock-unlock-adapter' &&
                input.identity.treasury !== identity.treasury) ||
            (input.identity.kind === 'burn-mint-adapter' &&
                identity.kind === 'burn-mint-adapter' &&
                input.identity.mintEscrow !== identity.mintEscrow))
    ) {
        throw new Error('Callback economic identity changed; repopulate the transaction');
    }
    const pendingDisclosure = await sdk.createDisclosure(
        input.pendingCallbackCid as ContractId<object>,
        [input.informee],
    );
    if (!pendingDisclosure) throw new Error(`Missing disclosure for ${input.pendingCallbackCid}`);
    const disclosedContracts = [
        pendingDisclosure,
        callbackDisclosure(callback),
        callbackDisclosure(config),
    ];
    const appUid = cantonCallbackAppUid(oappId.admin, oappId.id);
    let registryCid: string | undefined;
    let lzReceiveParty: string | undefined;
    const receiveArgs = getCantonCallbackFnArgs(
        pending.callbackContext,
        appUid,
        'LzReceive_callback',
    );
    if (pending.isAccept && receiveArgs) {
        const message = receiveArgs.find(([key]) => key === 'lzMessage')?.[1].value;
        if (typeof message !== 'string') throw new Error('lzMessage not found in callbackContext');
        const fingerprint = message.slice(0, 64);
        const registries = (await query(REGISTRY)).filter((registry) => {
            const hints = (registry.createdEvent.createArgument as { fingerprintToHint: unknown })
                .fingerprintToHint;
            return Array.isArray(hints)
                ? hints.some(([key]) => key === fingerprint)
                : hints !== null && typeof hints === 'object' && fingerprint in hints;
        });
        const registry = exactlyOne(registries, `Registry for fingerprint ${fingerprint}`);
        registryCid = registry.createdEvent.contractId;
        if (identity.kind !== 'oft-self') {
            lzReceiveParty = partyIdFromRegistryFingerprint(
                registry.createdEvent.createArgument as { fingerprintToHint: unknown },
                fingerprint,
            );
        }
        disclosedContracts.push(callbackDisclosure(registry));
    }
    let rateLimiterStateCid: string | undefined;
    if (
        shouldIncludeCantonCallbackRateLimiter({
            callbackContext: pending.callbackContext,
            appUid,
            isGloballyDisabled: payload.rateLimiterConfig.isGloballyDisabled,
            isAccept: pending.isAccept,
        })
    ) {
        const limiter = exactlyOne(await query(LIMITER), 'callback rate limiter');
        rateLimiterStateCid = limiter.createdEvent.contractId;
        disclosedContracts.push(callbackDisclosure(limiter));
    }
    let adapterContext: Awaited<ReturnType<typeof resolveLockUnlockCallbackContext>> | undefined;
    let burnMintContext: Awaited<ReturnType<typeof resolveBurnMintCallbackContext>> | undefined;
    if (identity.kind === 'oft-self') {
        const sendArgs = getCantonCallbackFnArgs(
            pending.callbackContext,
            appUid,
            'LzSend_callback',
        );
        for (const key of ['oftHoldingCid', 'payoutHoldingCid']) {
            const cid = sendArgs?.find(([name]) => name === key)?.[1].value;
            if (typeof cid === 'string' && cid)
                disclosedContracts.push(await requireDisclosure(sdk, input.informee, cid));
        }
    } else if (identity.kind === 'lock-unlock-adapter') {
        adapterContext = await resolveLockUnlockCallbackContext({
            sdk,
            informee: input.informee,
            appUid,
            treasury: identity.treasury,
            instrumentId: identity.instrumentId,
            offset,
            environment: input.environment,
            receivers: cantonAdapterCallbackReceivers({
                pendingCallback: pending,
                appUid,
                lzReceiveParty,
                treasury: identity.treasury,
            }),
        });
        disclosedContracts.push(...adapterContext.disclosedContracts);
    } else {
        burnMintContext = await resolveBurnMintCallbackContext({
            sdk,
            informee: input.informee,
            appUid,
            oappAdmin: oappId.admin,
            mintEscrow: identity.mintEscrow,
            instrumentId: identity.instrumentId,
            offset,
            environment: input.environment,
            receivers: cantonAdapterCallbackReceivers({
                pendingCallback: pending,
                appUid,
                lzReceiveParty,
            }),
        });
        disclosedContracts.push(...burnMintContext.disclosedContracts);
    }
    const address = { tag: 'Addr_Text' as const, value: appUid };
    const entries: Array<[string, CallbackArgs]> = cantonFinalizeCallbackBaseEntries({
        configCid: config.createdEvent.contractId,
        registryCid,
        rateLimiterStateCid,
    });
    if (adapterContext) entries.push(...cantonLockUnlockCallbackEntries(adapterContext));
    if (burnMintContext)
        entries.push(
            ...cantonLockUnlockCallbackEntries(burnMintContext),
            ...cantonBurnMintCallbackEntries(burnMintContext),
        );
    const executeContext: CallbackContext = [
        ['OApp', [[address, [['OApp', [[address, entries]]]]]]],
    ];
    return {
        callbackCid: callback.createdEvent.contractId,
        executeContext,
        disclosedContracts,
        oappId,
        identity,
    };
};

export type CantonAdapterReceiversInput = {
    pendingCallback: {
        isAccept: boolean;
        sender: string;
        callbackContext: unknown;
    };
    appUid: string;
    lzReceiveParty?: string;
    treasury?: string;
};

export const cantonAdapterCallbackReceivers = ({
    pendingCallback,
    appUid,
    lzReceiveParty,
    treasury,
}: CantonAdapterReceiversInput): string[] => {
    const lzSendArgs = getCantonCallbackFnArgs(
        pendingCallback.callbackContext,
        appUid,
        'LzSend_callback',
    );
    if (lzSendArgs) {
        if (pendingCallback.isAccept) {
            const parties = [...new Set(parseIndexedPayoutParties(lzSendArgs))];
            return parties.length > 0 ? parties : treasury ? [treasury] : [];
        }
        return [pendingCallback.sender];
    }

    const lzReceiveArgs = getCantonCallbackFnArgs(
        pendingCallback.callbackContext,
        appUid,
        'LzReceive_callback',
    );
    if (lzReceiveArgs) {
        if (!pendingCallback.isAccept) {
            return [];
        }
        if (!lzReceiveParty) {
            throw new Error('lzReceiveParty is required for LzReceive accept');
        }
        return [lzReceiveParty];
    }

    throw new Error('callbackContext is neither LzSend nor LzReceive');
};

const parseIndexedPayoutParties = (
    args: NonNullable<ReturnType<typeof getCantonCallbackFnArgs>>,
): string[] => {
    const count = Number(args.find(([key]) => key === 'receiverCount')?.[1].value ?? 0);

    const parties: string[] = [];
    for (let index = 0; index < count; index += 1) {
        const party = args.find(([key]) => key === `receiver_${index}`)?.[1].value;
        if (typeof party !== 'string' || party === '') {
            throw new Error(`LzSend callback missing receiver_${index}`);
        }
        parties.push(party);
    }
    return parties;
};

export const cantonLockUnlockCallbackEntries = (args: {
    treasuryAssetCids?: string[];
    transferFactoryCid?: string;
    assetTransferContext?: Record<string, unknown>;
}): Array<[string, CallbackArgs]> => {
    const entries: Array<[string, CallbackArgs]> = [];
    if (args.treasuryAssetCids)
        entries.push([
            'treasuryAssetCids',
            [
                [
                    'treasuryAssetCids',
                    {
                        tag: 'AV_List',
                        value: args.treasuryAssetCids.map((value) => ({
                            tag: 'AV_ContractId',
                            value,
                        })),
                    },
                ],
            ],
        ]);
    if (args.transferFactoryCid)
        entries.push([
            'transferFactoryCid',
            [
                [
                    'transferFactoryCid',
                    {
                        tag: 'AV_ContractId',
                        value: args.transferFactoryCid,
                    },
                ],
            ],
        ]);
    if (args.assetTransferContext)
        entries.push([
            'assetTransferContext',
            [
                [
                    'assetTransferContext',
                    {
                        tag: 'AV_Map',
                        value: args.assetTransferContext,
                    },
                ],
            ],
        ]);
    return entries;
};

export const cantonBurnMintCallbackEntries = (args: {
    burnMintFactoryCid?: string;
    burnMintExtraArgs?: Record<string, unknown>;
    burnMintOutputContext?: Record<string, unknown>;
}): Array<[string, CallbackArgs]> => {
    const entries: Array<[string, CallbackArgs]> = [];
    if (args.burnMintFactoryCid)
        entries.push([
            'burnMintFactoryCid',
            [['burnMintFactoryCid', { tag: 'AV_ContractId', value: args.burnMintFactoryCid }]],
        ]);
    for (const key of ['burnMintExtraArgs', 'burnMintOutputContext'] as const) {
        if (args[key]) entries.push([key, [[key, { tag: 'AV_Map', value: args[key] }]]]);
    }
    return entries;
};
