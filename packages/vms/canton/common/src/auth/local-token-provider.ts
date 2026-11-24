import crypto from 'node:crypto';

import type { TokenProvider } from './token-provider';

export interface LocalTokenProviderConfig {
    userId: string;
    actAs: string[];
    secret?: string;
    audience?: string;
    /** Token lifetime in seconds. */
    expiresIn?: number;
    admin?: boolean;
}

const DEFAULT_SECRET = 'unsafe';
const DEFAULT_AUDIENCE = 'https://canton.network.global';
const DEFAULT_EXPIRES_IN = 3600; // 1 hour
const BUFFER_SECONDS = 60;

// ─────────────────────────────────────────────────────────────────────────────
// JWT helpers (HMAC-SHA256, Canton "unsafe" mode)
// ─────────────────────────────────────────────────────────────────────────────

function base64UrlEncode(data: string | Buffer): string {
    const base64 = Buffer.from(data).toString('base64');
    return base64.replace(/\+/g, '-').replace(/\//g, '_').replace(/=/g, '');
}

function generateJwt(payload: object, secret: string): string {
    const header = { alg: 'HS256', typ: 'JWT' };
    const headerEncoded = base64UrlEncode(JSON.stringify(header));
    const payloadEncoded = base64UrlEncode(JSON.stringify(payload));
    const signatureInput = `${headerEncoded}.${payloadEncoded}`;
    const signature = crypto.createHmac('sha256', secret).update(signatureInput).digest();
    return `${headerEncoded}.${payloadEncoded}.${base64UrlEncode(signature)}`;
}

/**
 * Token provider for local development and sandbox environments.
 *
 * Generates short-lived HMAC-SHA256 JWTs on the fly using the Canton
 * participant node's "unsafe" identity provider manager shared secret.
 * Tokens are cached in memory and regenerated automatically before expiry.
 */
export class LocalTokenProvider implements TokenProvider {
    readonly #config: Required<LocalTokenProviderConfig>;
    #token: string | null = null;

    constructor(config: LocalTokenProviderConfig) {
        this.#config = {
            userId: config.userId,
            actAs: config.actAs,
            secret: config.secret ?? DEFAULT_SECRET,
            audience: config.audience ?? DEFAULT_AUDIENCE,
            expiresIn: config.expiresIn ?? DEFAULT_EXPIRES_IN,
            admin: config.admin ?? true,
        };
    }

    async getToken(): Promise<string> {
        this.#token ??= this.#generateToken();
        return this.#token;
    }

    #generateToken(): string {
        const nowSeconds = Math.floor(Date.now() / 1000);
        const payload = {
            sub: this.#config.userId,
            aud: this.#config.audience,
            iat: nowSeconds,
            exp: nowSeconds + this.#config.expiresIn,
            'https://daml.com/ledger-api': {
                ledgerId: null,
                participantId: null,
                applicationId: null,
                actAs: this.#config.actAs,
                readAs: this.#config.actAs,
                admin: this.#config.admin,
            },
        };
        const delayMs = (this.#config.expiresIn - BUFFER_SECONDS) * 1000;
        setTimeout(() => (this.#token = null), delayMs);
        return generateJwt(payload, this.#config.secret);
    }
}
