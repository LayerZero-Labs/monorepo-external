/**
 * Mock fetch implementation that replays captured API interactions.
 *
 * Usage:
 *   import { createMockFetch, loadCapturedInteractions } from './mock-fetch';
 *
 *   const interactions = loadCapturedInteractions('internal');
 *   const mockFetch = createMockFetch(interactions);
 *
 *   const config = new Configuration({
 *     basePath: 'http://mock',
 *     fetchApi: mockFetch,
 *   });
 */

import * as fs from 'fs';
import * as path from 'path';

// ─────────────────────────────────────────────────────────────────────────────
// Types
// ─────────────────────────────────────────────────────────────────────────────

export interface CapturedInteraction {
    name: string;
    scenario?: string;
    timestamp: string;
    request: {
        method: string;
        url: string;
        path: string;
        headers: Record<string, string>;
        body: unknown;
    };
    response: {
        status: number;
        statusText: string;
        headers: Record<string, string>;
        body: unknown;
    };
}

export type InteractionMatcher = (
    request: { method: string; path: string; body: unknown },
    interaction: CapturedInteraction,
) => boolean;

// ─────────────────────────────────────────────────────────────────────────────
// Load Captured Interactions
// ─────────────────────────────────────────────────────────────────────────────

const CAPTURE_FILES = {
    internal: 'captured-internal-requests.json',
    external: 'captured-external-requests.json',
    unhappy: 'captured-unhappy-paths.json',
    disclosure: 'captured-disclosure.json',
};

export function loadCapturedInteractions(
    type: keyof typeof CAPTURE_FILES | 'all',
): CapturedInteraction[] {
    const mocksDir = path.dirname(new URL(import.meta.url).pathname);

    if (type === 'all') {
        const all: CapturedInteraction[] = [];
        for (const file of Object.values(CAPTURE_FILES)) {
            const filePath = path.join(mocksDir, file);
            if (fs.existsSync(filePath)) {
                const data = JSON.parse(fs.readFileSync(filePath, 'utf-8'));
                all.push(...data);
            }
        }
        return all;
    }

    const filePath = path.join(mocksDir, CAPTURE_FILES[type]);
    if (!fs.existsSync(filePath)) {
        throw new Error(`Captured interactions file not found: ${filePath}`);
    }
    return JSON.parse(fs.readFileSync(filePath, 'utf-8'));
}

// ─────────────────────────────────────────────────────────────────────────────
// Default Matcher
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Default matcher: matches by method and path.
 * For more specific matching, provide a custom matcher.
 */
export const defaultMatcher: InteractionMatcher = (request, interaction) => {
    return (
        request.method === interaction.request.method && request.path === interaction.request.path
    );
};

/**
 * Strict matcher: matches by method, path, and request body structure.
 */
export const strictMatcher: InteractionMatcher = (request, interaction) => {
    if (request.method !== interaction.request.method) return false;
    if (request.path !== interaction.request.path) return false;

    // For POST requests, compare body structure (ignoring dynamic values)
    if (request.method === 'POST' && request.body && interaction.request.body) {
        const reqKeys = Object.keys(request.body as object).sort();
        const intKeys = Object.keys(interaction.request.body as object).sort();
        if (JSON.stringify(reqKeys) !== JSON.stringify(intKeys)) return false;
    }

    return true;
};

// ─────────────────────────────────────────────────────────────────────────────
// Mock Fetch Factory
// ─────────────────────────────────────────────────────────────────────────────

export interface MockFetchOptions {
    /** Custom matcher function */
    matcher?: InteractionMatcher;
    /** If true, throw on unmatched requests instead of returning 404 */
    strict?: boolean;
    /** Called for each matched request */
    onMatch?: (interaction: CapturedInteraction) => void;
    /** Called for unmatched requests */
    onMiss?: (request: { method: string; path: string; body: unknown }) => void;
}

export function createMockFetch(
    interactions: CapturedInteraction[],
    options: MockFetchOptions = {},
): typeof fetch {
    const { matcher = defaultMatcher, strict = false, onMatch, onMiss } = options;

    // Track which interactions have been used (for sequential matching)
    const usedIndices = new Set<number>();

    return async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
        const url = typeof input === 'string' ? input : input.toString();
        const method = init?.method ?? 'GET';
        const urlPath = new URL(url, 'http://mock').pathname;

        // Parse request body
        let requestBody: unknown = null;
        if (init?.body) {
            try {
                requestBody = JSON.parse(init.body as string);
            } catch {
                requestBody = init.body;
            }
        }

        const request = { method, path: urlPath, body: requestBody };

        // Find matching interaction (prefer unused ones for sequential flows)
        let matchIndex = -1;
        for (let i = 0; i < interactions.length; i++) {
            const interaction = interactions[i];
            if (interaction && !usedIndices.has(i) && matcher(request, interaction)) {
                matchIndex = i;
                break;
            }
        }

        // If no unused match, try any match (for repeated requests)
        if (matchIndex === -1) {
            matchIndex = interactions.findIndex((int) => matcher(request, int));
        }

        if (matchIndex === -1) {
            onMiss?.(request);

            if (strict) {
                throw new Error(
                    `MockFetch: No matching interaction for ${method} ${urlPath}\n` +
                        `Body: ${JSON.stringify(requestBody, null, 2)}`,
                );
            }

            // Return 404 for unmatched requests
            return new Response(JSON.stringify({ error: 'Not found in mock data' }), {
                status: 404,
                statusText: 'Not Found',
                headers: { 'content-type': 'application/json' },
            });
        }

        const interaction = interactions[matchIndex]!;
        usedIndices.add(matchIndex);
        onMatch?.(interaction);

        // Build response
        const responseHeaders = new Headers();
        for (const [key, value] of Object.entries(interaction.response.headers)) {
            responseHeaders.set(key, value);
        }

        const responseBody =
            typeof interaction.response.body === 'string'
                ? interaction.response.body
                : JSON.stringify(interaction.response.body);

        return new Response(responseBody, {
            status: interaction.response.status,
            statusText: interaction.response.statusText,
            headers: responseHeaders,
        });
    };
}

// ─────────────────────────────────────────────────────────────────────────────
// Sequence-Based Mock (for testing specific flows)
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Creates a mock that returns interactions in sequence, ignoring request matching.
 * Useful for testing a specific flow where you know the exact order of requests.
 */
export function createSequentialMock(interactions: CapturedInteraction[]): typeof fetch {
    let index = 0;

    return async (_input: RequestInfo | URL, _init?: RequestInit): Promise<Response> => {
        if (index >= interactions.length) {
            throw new Error(`MockFetch: Ran out of captured interactions at index ${index}`);
        }

        const interaction = interactions[index++]!;

        const responseHeaders = new Headers();
        for (const [key, value] of Object.entries(interaction.response.headers)) {
            responseHeaders.set(key, value);
        }

        const responseBody =
            typeof interaction.response.body === 'string'
                ? interaction.response.body
                : JSON.stringify(interaction.response.body);

        return new Response(responseBody, {
            status: interaction.response.status,
            statusText: interaction.response.statusText,
            headers: responseHeaders,
        });
    };
}

// ─────────────────────────────────────────────────────────────────────────────
// Filter Helpers
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Filter interactions by operation name prefix.
 */
export function filterByOperation(
    interactions: CapturedInteraction[],
    prefix: string,
): CapturedInteraction[] {
    return interactions.filter((i) => i.name.startsWith(prefix));
}

/**
 * Filter interactions by scenario name.
 */
export function filterByScenario(
    interactions: CapturedInteraction[],
    scenario: string,
): CapturedInteraction[] {
    return interactions.filter((i) => i.scenario === scenario);
}

/**
 * Filter only successful responses (2xx status).
 */
export function filterSuccessful(interactions: CapturedInteraction[]): CapturedInteraction[] {
    return interactions.filter((i) => i.response.status >= 200 && i.response.status < 300);
}

/**
 * Filter only error responses (4xx, 5xx status).
 */
export function filterErrors(interactions: CapturedInteraction[]): CapturedInteraction[] {
    return interactions.filter((i) => i.response.status >= 400);
}
