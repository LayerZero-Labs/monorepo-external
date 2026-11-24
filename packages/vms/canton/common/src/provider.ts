import {
    ClientCredentialsTokenProvider,
    type ClientCredentialsTokenProviderConfig,
} from './auth/client-credentials-token-provider';
import { LocalTokenProvider } from './auth/local-token-provider';
import type { TokenProvider } from './auth/token-provider';
import { CantonClient } from './client/canton-client';
import { CantonGrpcClient } from './client/grpc';
import type { ICantonClient } from './client/interface';
import { Configuration } from './open-api/runtime';

// ─────────────────────────────────────────────────────────────────────────────
// Provider Type
// ─────────────────────────────────────────────────────────────────────────────

/**
 * - {@link client} — JSON Ledger API (commands, queries, updates)
 * - {@link grpcClient} — gRPC Admin API (topology transactions, namespace queries)
 * - {@link tokenProvider} — Shared Bearer-token source used by both transports
 * - {@link walletUrl} — Canton Network validator wallet (scan-proxy CIP-56 endpoints)
 */
export type CantonChainProvider = {
    client: ICantonClient;
    grpcClient: CantonGrpcClient;
    tokenProvider: TokenProvider;
    /** Validator wallet URL for scan-proxy CIP-56 endpoints. Required. */
    walletUrl: string;
};

// ─────────────────────────────────────────────────────────────────────────────
// URI Parsing
// ─────────────────────────────────────────────────────────────────────────────

export type CantonChainUriParams = {
    /** Base URL of the JSON Ledger API (e.g. "http://localhost:5975") */
    jsonApiUrl: string;
    /** Host:port of the gRPC Admin API (e.g. "localhost:5076") */
    adminApiHost: string;
    /** Ledger API user ID (default: "participant_admin") */
    userId: string;
    /** Parties granted `actAs` on localnet tokens (comma-separated in the URI). */
    actAs: string[];
    /** Validator wallet URL for scan-proxy CIP-56 endpoints (e.g. "http://localhost:7201"). Required. */
    walletUrl: string;
    /** OAuth2 client credentials config — present only for non-local environments */
    oauth2?: ClientCredentialsTokenProviderConfig;
};

/**
 * Parse a Canton chain provider URI into its constituent parts.
 *
 * URI format:
 *   `<json-api-base>?admin-api=<host:port>&user-id=<id>&wallet-url=<url>[&token-url=...&client-id=...&client-secret=...&scope=...&audience=...]`
 *
 * The base URL (everything before the query string) is the JSON Ledger API endpoint.
 * Canton-specific params are extracted and removed; any remaining query params are
 * preserved on the JSON API URL.
 *
 * When `client-secret` is omitted from the URI, `CANTON_CLIENT_SECRET` is read from the
 * environment.
 */
export function parseCantonChainUri(uri: string): CantonChainUriParams {
    const url = new URL(uri);

    const adminApiHost = url.searchParams.get('admin-api');
    if (!adminApiHost) {
        throw new Error('Canton provider URI missing required "admin-api" query parameter');
    }

    const userId = url.searchParams.get('user-id') ?? 'participant_admin';
    const actAsParam = url.searchParams.get('act-as');
    const actAs =
        actAsParam
            ?.split(',')
            .map((party) => party.trim())
            .filter((party) => party.length > 0) ?? [];
    const walletUrl = url.searchParams.get('wallet-url');
    if (!walletUrl) {
        throw new Error('Canton provider URI missing required "wallet-url" query parameter');
    }
    const tokenUrl = url.searchParams.get('token-url') ?? undefined;
    const clientId = url.searchParams.get('client-id') ?? undefined;
    // Prefer URI param; fall back to env.
    const clientSecret =
        url.searchParams.get('client-secret') ??
        // eslint-disable-next-line turbo/no-undeclared-env-vars -- runtime OAuth secret, not a turbo task input
        process.env.CANTON_CLIENT_SECRET ??
        undefined;
    const scope = url.searchParams.get('scope') ?? undefined;
    const audience = url.searchParams.get('audience') ?? undefined;

    for (const key of [
        'admin-api',
        'user-id',
        'act-as',
        'wallet-url',
        'sequencer-url',
        'sequencer-validators',
        'sequencer-quorum',
        'token-url',
        'client-id',
        'client-secret',
        'scope',
        'audience',
    ]) {
        url.searchParams.delete(key);
    }

    const jsonApiUrl = url.toString().replace(/\/$/, '');

    const oauth2 =
        tokenUrl && clientId && clientSecret
            ? { tokenUrl, clientId, clientSecret, scope, audience }
            : undefined;

    return {
        jsonApiUrl,
        adminApiHost,
        userId,
        actAs,
        walletUrl,
        oauth2,
    };
}

// ─────────────────────────────────────────────────────────────────────────────
// Provider Factory
// ─────────────────────────────────────────────────────────────────────────────

export type CreateCantonChainProviderOptions = {
    /** Raw provider URI (from provider config) */
    uri: string;
    /** When true, uses LocalTokenProvider (self-signed JWTs) instead of OAuth2 */
    isLocal: boolean;
};

/**
 * Create a {@link CantonChainProvider} from a provider URI.
 *
 * - **isLocal=true**: Uses {@link LocalTokenProvider} with admin-level access (self-signed JWTs)
 *   over an unencrypted admin channel, allowed for a loopback admin host only.
 * - **isLocal=false**: Uses {@link ClientCredentialsTokenProvider} with OAuth2 client
 *   credentials extracted from the URI query parameters, over a TLS admin channel.
 */
export function createCantonChainProvider({
    uri,
    isLocal,
}: CreateCantonChainProviderOptions): CantonChainProvider {
    const params = parseCantonChainUri(uri);

    const tokenProvider = createTokenProvider(params, isLocal);

    // ── JSON Ledger API Client ──────────────────────────────────────────
    const configuration = new Configuration({
        basePath: params.jsonApiUrl,
        accessToken: () => tokenProvider.getToken(),
    });
    const client = new CantonClient(configuration, params.userId, {
        walletUrl: params.walletUrl,
        tokenProvider,
    });

    // ── gRPC Admin API Client ───────────────────────────────────────────
    const grpcClient = new CantonGrpcClient({
        host: params.adminApiHost,
        tokenProvider,
        insecureTransport: isLocal,
    });

    return {
        client,
        grpcClient,
        tokenProvider,
        walletUrl: params.walletUrl,
    };
}

function createTokenProvider(params: CantonChainUriParams, isLocal: boolean): TokenProvider {
    if (isLocal) {
        return new LocalTokenProvider({
            userId: params.userId,
            actAs: params.actAs,
            admin: true,
        });
    }

    // TODO(canton): add other prod auth methods (direct JWT passthrough, etc.).
    if (!params.oauth2) {
        throw new Error(
            'Canton provider requires OAuth2 credentials (token-url, client-id, client-secret in URI or CANTON_CLIENT_SECRET)',
        );
    }

    return new ClientCredentialsTokenProvider(params.oauth2);
}
