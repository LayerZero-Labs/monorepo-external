/**
 * Provides Bearer tokens for Canton API authentication.
 *
 * Implementations handle acquisition, caching, and refresh internally.
 * Callers should invoke {@link getToken} before each request — the
 * implementation decides whether to return a cached token or obtain a new one.
 */
export interface TokenProvider {
    getToken(): Promise<string>;
}
