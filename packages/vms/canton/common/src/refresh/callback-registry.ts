import { AMULET_INSTRUMENT_ID, type InstrumentId } from '../client/amulet';
import type { CantonSdk } from '../sdk';
import {
    discoveryUrlsForAppUid,
    fetchMergedTransferFactoryContext,
    type FetchMergedTransferFactoryContextOptions,
    mergeProbedTransferFactoryContexts,
    resolveProbeWindow,
    type TransferFactoryContext,
} from './registry-context';

export type CantonCallbackRegistry =
    | { kind: 'amulet' }
    | { kind: 'url'; url: string; source: 'discovery-registry' | 'da-utilities' };

// DA's documented off-ledger registrar roots: https://docs.digitalasset.com/registry/apis/token-standard/off-ledger-api
const DA_UTILITIES_REGISTRAR_ROOTS: Partial<Record<string, string>> = {
    mainnet: 'https://api.utilities.digitalasset.com/api/token-standard/v0/registrars/',
    testnet: 'https://api.utilities.digitalasset-staging.com/api/token-standard/v0/registrars/',
};

export const daUtilitiesRegistryUrl = (
    environment: string | undefined,
    admin: string,
): string | undefined => {
    const root = environment === undefined ? undefined : DA_UTILITIES_REGISTRAR_ROOTS[environment];
    // Party IDs (`hint::fingerprint`) keep their colons, as in DA's documented paths.
    return root && `${root}${encodeURIComponent(admin).replaceAll('%3A', ':')}`;
};

const errorMessage = (error: unknown): string =>
    error instanceof Error ? error.message : String(error);

/**
 * Runs `attempt` against the callback instrument's CIP-56 registry. Canonical Amulet uses
 * only the validator wallet. Otherwise the OApp's DiscoveryRegistry URL is tried, then
 * DA Utilities; any failure moves on to the next registry, and the error lists each reason.
 */
export const withCantonCallbackRegistry = async <T>(
    {
        sdk,
        informee,
        offset,
        appUid,
        instrumentId,
        environment,
    }: {
        sdk: CantonSdk;
        informee: string;
        offset: number;
        appUid: string;
        instrumentId: InstrumentId;
        environment?: string;
    },
    attempt: (registry: CantonCallbackRegistry) => Promise<T>,
): Promise<T> => {
    if (
        instrumentId.id === AMULET_INSTRUMENT_ID &&
        instrumentId.admin === (await sdk.getDsoParty())
    ) {
        return attempt({ kind: 'amulet' });
    }
    const candidates: Array<{
        source: 'discovery-registry' | 'da-utilities';
        url: () => Promise<string>;
    }> = [
        {
            source: 'discovery-registry',
            url: async () => {
                const urls = await discoveryUrlsForAppUid(sdk, informee, offset, appUid);
                if (urls.length !== 1) {
                    throw new Error(`expected one discovery URL, found ${urls.length}`);
                }
                return urls[0]!;
            },
        },
        {
            source: 'da-utilities',
            url: async () => {
                const url = daUtilitiesRegistryUrl(environment, instrumentId.admin);
                if (!url)
                    throw new Error(`no registrar for environment ${environment ?? '(unset)'}`);
                return url;
            },
        },
    ];
    const failures: string[] = [];
    for (const { source, url } of candidates) {
        try {
            return await attempt({ kind: 'url', url: await url(), source });
        } catch (error) {
            failures.push(`${source}: ${errorMessage(error)}`);
        }
    }
    throw new Error(
        `No registry for appUid ${appUid} instrument ${instrumentId.admin}/${instrumentId.id} ` +
            `(${failures.join('; ')})`,
    );
};

export const fetchCallbackTransferFactoryContext = async (
    registry: CantonCallbackRegistry,
    sdk: Pick<CantonSdk, 'getAmuletTransferFactoryContext'>,
    instrumentId: InstrumentId,
    options: FetchMergedTransferFactoryContextOptions,
): Promise<TransferFactoryContext> => {
    if (registry.kind === 'url') {
        return fetchMergedTransferFactoryContext(registry.url, instrumentId, options);
    }
    const { requestedAt, executeBefore } = resolveProbeWindow(options);
    return mergeProbedTransferFactoryContexts(options.receivers, (receiver) =>
        sdk.getAmuletTransferFactoryContext({
            instrumentId,
            sender: options.sender,
            receiver,
            amount: options.amount,
            inputHoldingCids: options.inputHoldingCids,
            requestedAt,
            executeBefore,
        }),
    );
};
