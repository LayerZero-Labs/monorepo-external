import { JsonRpcError } from '@mysten/sui/client';
import { RpcError } from '@protobuf-ts/runtime-rpc';
import { afterEach, describe, expect, it, vi } from 'vitest';

import {
    fetchWithCauseInMessage,
    isSuiCompatProviderSpecificError,
    toJsonRpcError,
} from './errors';

describe('toJsonRpcError', () => {
    it('maps TypeError to InternalError', () => {
        const mapped = toJsonRpcError(new TypeError('Cannot destructure property'));

        expect(mapped).toBeInstanceOf(JsonRpcError);
        expect(mapped.code).toBe(-32603);
    });

    it('maps known gRPC statuses', () => {
        expect(toJsonRpcError(new RpcError('bad arg', 'INVALID_ARGUMENT')).code).toBe(-32602);
        expect(toJsonRpcError(new RpcError('busy', 'RESOURCE_EXHAUSTED')).code).toBe(-32604);
        expect(toJsonRpcError(new RpcError('missing', 'UNIMPLEMENTED')).code).toBe(-32601);
        expect(toJsonRpcError(new RpcError('timeout', 'DEADLINE_EXCEEDED')).code).toBe(-32050);
        expect(toJsonRpcError(new RpcError('down', 'UNAVAILABLE')).code).toBe(-32050);
        expect(toJsonRpcError(new RpcError('boom', 'INTERNAL')).code).toBe(-32603);
        expect(toJsonRpcError(new RpcError('???', 'UNKNOWN')).code).toBe(-32603);
    });

    it('maps unmapped gRPC statuses and unknown values to CallExecutionFailed', () => {
        expect(toJsonRpcError(new RpcError('cancelled', 'CANCELLED')).code).toBe(-32000);
        expect(toJsonRpcError(new Error('nope')).code).toBe(-32000);
        expect(toJsonRpcError('string error').code).toBe(-32000);
    });

    it('preserves an already-constructed JsonRpcError unwrapped, rather than collapsing it', () => {
        const original = new JsonRpcError('already classified', -32601);
        expect(toJsonRpcError(original)).toBe(original);
    });

    it('marks a provider-health, data-availability or credential gRPC status as provider-specific', () => {
        for (const code of [
            'NOT_FOUND',
            'UNAVAILABLE',
            'DEADLINE_EXCEEDED',
            'RESOURCE_EXHAUSTED',
            'INTERNAL',
            'UNKNOWN',
            'CANCELLED',
            'UNAUTHENTICATED',
            'PERMISSION_DENIED',
            'ABORTED',
        ]) {
            const mapped = toJsonRpcError(new RpcError('boom', code));
            expect(isSuiCompatProviderSpecificError(mapped)).toBe(true);
        }
    });

    it('does not mark a request-shape gRPC status as provider-specific', () => {
        for (const code of ['INVALID_ARGUMENT', 'UNIMPLEMENTED']) {
            const mapped = toJsonRpcError(new RpcError('boom', code));
            expect(isSuiCompatProviderSpecificError(mapped)).toBe(false);
        }
    });

    it('does not mark a bare thrown Error as provider-specific', () => {
        // e.g. an unsupported-option guard, a size limit, or a digest-mismatch guard — these
        // fail the same way on every provider, so they must keep short-circuiting the race.
        expect(isSuiCompatProviderSpecificError(toJsonRpcError(new Error('nope')))).toBe(false);
    });

    it('preserves the original error as cause instead of dropping it', () => {
        const original = new RpcError('fetch failed', 'INTERNAL');

        expect(toJsonRpcError(original).cause).toBe(original);
        expect(toJsonRpcError(new TypeError('fetch failed')).cause).toBeInstanceOf(TypeError);
    });

    it('does not set a cause for non-Error values', () => {
        expect(toJsonRpcError('string error').cause).toBeUndefined();
    });
});

describe('fetchWithCauseInMessage', () => {
    afterEach(() => vi.unstubAllGlobals());

    it('folds an Error cause into the thrown message', () => {
        const dnsFailure = new Error('getaddrinfo ENOTFOUND sui-mainnet.example');
        vi.stubGlobal(
            'fetch',
            vi.fn(async () => {
                throw new TypeError('fetch failed', { cause: dnsFailure });
            }),
        );

        return expect(fetchWithCauseInMessage('https://sui-mainnet.example')).rejects.toMatchObject(
            {
                message: 'fetch failed: Error: getaddrinfo ENOTFOUND sui-mainnet.example',
                cause: dnsFailure,
            },
        );
    });

    it('expands an AggregateError cause into its inner errors, keeping .code', () => {
        // Node's fetch failure when a host resolves to both an IPv6 and an IPv4 address that
        // both refuse the connection: the AggregateError's own .message is empty.
        const aggregate = new AggregateError(
            [
                new Error('connect ECONNREFUSED ::1:59999'),
                new Error('connect ECONNREFUSED 127.0.0.1:59999'),
            ],
            '',
        );
        Object.assign(aggregate, { code: 'ECONNREFUSED' });
        vi.stubGlobal(
            'fetch',
            vi.fn(async () => {
                throw new TypeError('fetch failed', { cause: aggregate });
            }),
        );

        return expect(fetchWithCauseInMessage('https://sui-mainnet.example')).rejects.toMatchObject(
            {
                message:
                    'fetch failed: Error: connect ECONNREFUSED ::1:59999; ' +
                    'Error: connect ECONNREFUSED 127.0.0.1:59999',
            },
        );
    });

    it('includes an undici-style .code that is not part of .message', () => {
        class SocketError extends Error {
            constructor(message: string) {
                super(message);
                this.name = 'SocketError';
            }
        }
        const socketError = new SocketError('other side closed');
        Object.assign(socketError, { code: 'UND_ERR_SOCKET' });
        vi.stubGlobal(
            'fetch',
            vi.fn(async () => {
                throw new TypeError('fetch failed', { cause: socketError });
            }),
        );

        return expect(fetchWithCauseInMessage('https://sui-mainnet.example')).rejects.toMatchObject(
            {
                message: 'fetch failed: SocketError [UND_ERR_SOCKET]: other side closed',
            },
        );
    });

    it('falls back to the original error when the cause cannot be stringified', () => {
        const original = new TypeError('fetch failed', { cause: Object.create(null) });
        vi.stubGlobal(
            'fetch',
            vi.fn(async () => {
                throw original;
            }),
        );

        return expect(fetchWithCauseInMessage('https://sui-mainnet.example')).rejects.toBe(
            original,
        );
    });

    it('passes through an error with no cause unchanged', () => {
        const plain = new Error('boom');
        vi.stubGlobal(
            'fetch',
            vi.fn(async () => {
                throw plain;
            }),
        );

        return expect(fetchWithCauseInMessage('https://sui-mainnet.example')).rejects.toBe(plain);
    });

    it('resolves normally on success', () => {
        const response = new Response('ok');
        vi.stubGlobal(
            'fetch',
            vi.fn(async () => response),
        );

        return expect(fetchWithCauseInMessage('https://sui-mainnet.example')).resolves.toBe(
            response,
        );
    });
});
