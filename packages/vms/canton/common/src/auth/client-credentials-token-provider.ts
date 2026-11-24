import type { TokenProvider } from './token-provider';

export interface ClientCredentialsTokenProviderConfig {
    /** Full URL of the IdP token endpoint */
    tokenUrl: string;
    clientId: string;
    clientSecret: string;
    /** OAuth scope to request (e.g. "daml_ledger_api"). */
    scope?: string;
    /** Audience parameter — required by some IdPs (Auth0, Okta). */
    audience?: string;
    /** Re-acquire this many seconds before actual expiry. Default: 60. */
    bufferSeconds?: number;
}

interface TokenResponse {
    access_token: string;
    token_type: string;
    expires_in: number;
}

const DEFAULT_BUFFER_SECONDS = 60;

/**
 * Token provider for production environments using the OAuth2 Client
 * Credentials flow (RFC 6749 Section 4.4).
 *
 * Acquires tokens from an external identity provider (Keycloak, Okta, etc.),
 * caches them in memory, and re-acquires automatically before expiry.
 * Concurrent callers are coalesced into a single in-flight fetch to prevent
 * thundering herd on token expiry.
 */
export class ClientCredentialsTokenProvider implements TokenProvider {
    readonly #config: ClientCredentialsTokenProviderConfig;
    readonly #bufferSeconds: number;
    #token: Promise<string> | null = null;

    constructor(config: ClientCredentialsTokenProviderConfig) {
        this.#config = config;
        this.#bufferSeconds = config.bufferSeconds ?? DEFAULT_BUFFER_SECONDS;
    }

    async getToken(): Promise<string> {
        this.#token ??= this.#acquireToken().catch((err) => {
            this.#token = null;
            throw err;
        });
        return this.#token;
    }

    async #acquireToken(): Promise<string> {
        const { access_token, expires_in } = await this.#fetchToken();
        const delayMs = (expires_in - this.#bufferSeconds) * 1000;
        // Remove the token from cache before it expires
        setTimeout(() => (this.#token = null), delayMs);
        return access_token;
    }

    async #fetchToken(): Promise<TokenResponse> {
        const params = new URLSearchParams({
            grant_type: 'client_credentials',
            client_id: this.#config.clientId,
            client_secret: this.#config.clientSecret,
        });
        if (this.#config.scope) params.set('scope', this.#config.scope);
        if (this.#config.audience) params.set('audience', this.#config.audience);

        // OAuth2 token endpoints require form-encoded bodies, not JSON (RFC 6749 §4.4)
        const response = await fetch(this.#config.tokenUrl, {
            method: 'POST',
            headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
            body: params.toString(),
        });

        if (!response.ok) {
            // Fallback to empty string if reading the error body itself fails (e.g. connection reset)
            const body = await response.text().catch(() => '');
            throw new Error(
                `Client credentials token request failed: ${response.status} ${response.statusText}${body ? ` — ${body}` : ''}`,
            );
        }

        return (await response.json()) as TokenResponse;
    }
}
