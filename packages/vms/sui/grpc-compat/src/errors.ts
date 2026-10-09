import { JsonRpcError } from '@mysten/sui/client';
import { RpcError } from '@protobuf-ts/runtime-rpc';

export { JsonRpcError };

/**
 * Codes that `JsonRpcError` already classifies in `@mysten/sui/jsonRpc/errors`.
 */
export const JSON_RPC = {
    MethodNotFound: -32601,
    InvalidParams: -32602,
    InternalError: -32603,
    ServerBusy: -32604,
    CallExecutionFailed: -32000,
    TransientError: -32050,
} as const;

export class SuiCompatNotImplementedError extends JsonRpcError {
    public constructor(methodName: string) {
        super(
            `Sui gRPC compatibility method is not implemented: ${methodName}`,
            JSON_RPC.MethodNotFound,
        );
        this.name = 'SuiCompatNotImplementedError';
    }
}

/**
 * Marks an error as being about this specific provider's current state — missing data it hasn't
 * indexed yet, or its own health (down, overloaded, erroring) — rather than the request itself.
 * A different provider may still answer correctly, unlike every other error `toJsonRpcError`
 * produces. See `isSuiCompatProviderSpecificError`.
 */
export class SuiCompatProviderSpecificError extends JsonRpcError {
    public constructor(message: string, code: number) {
        super(message, code);
        this.name = 'SuiCompatProviderSpecificError';
    }
}

// Not `instanceof`: a duplicated copy of this package breaks class identity across the
// transport/multiprovider boundary.
export const isSuiCompatProviderSpecificError = (error: unknown): boolean =>
    error instanceof Error && error.name === 'SuiCompatProviderSpecificError';

/**
 * Mysten v2 gRPC throws `RpcError` whose `code` is a gRPC status name
 * (`UNAVAILABLE`). 1.45 callers classify on `JsonRpcError.code`.
 */
const GRPC_STATUS_TO_JSON_RPC: Readonly<Record<string, number>> = {
    INVALID_ARGUMENT: JSON_RPC.InvalidParams,
    RESOURCE_EXHAUSTED: JSON_RPC.ServerBusy,
    UNIMPLEMENTED: JSON_RPC.MethodNotFound,
    DEADLINE_EXCEEDED: JSON_RPC.TransientError,
    UNAVAILABLE: JSON_RPC.TransientError,
    INTERNAL: JSON_RPC.InternalError,
    UNKNOWN: JSON_RPC.InternalError,
};

/**
 * gRPC statuses that describe this provider's own state right now rather than the request —
 * `NOT_FOUND` included, since a provider that simply hasn't indexed a transaction yet isn't
 * saying anything about whether the transaction exists. `UNAUTHENTICATED` and
 * `PERMISSION_DENIED` are about this gateway's credentials, and `ABORTED` is a submission Sui
 * marks retriable. Any status not listed here is treated as definitive and ends the provider race.
 */
const GRPC_STATUS_PROVIDER_SPECIFIC: ReadonlySet<string> = new Set([
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
]);

/**
 * `JsonRpcError`'s constructor doesn't take a `cause`, so it's attached after
 * construction. protobuf-ts rewraps network failures (e.g. a `fetch` `TypeError`)
 * into a bare `RpcError(INTERNAL)` without forwarding the original cause; setting
 * it here at least preserves whatever protobuf-ts still gives us instead of
 * dropping it a second time.
 */
const withCause = (jsonRpcError: JsonRpcError, cause: unknown): JsonRpcError => {
    if (cause instanceof Error) {
        jsonRpcError.cause = cause;
    }
    return jsonRpcError;
};

export const toJsonRpcError = (error: unknown): JsonRpcError => {
    // Already a deliberately constructed JsonRpcError — e.g. `SuiCompatProviderSpecificError`
    // thrown by a method handler — so its class/name must survive unwrapped rather than being
    // collapsed into a generic one below.
    if (error instanceof JsonRpcError) {
        return error;
    }

    if (error instanceof TypeError) {
        return withCause(new JsonRpcError(error.message, JSON_RPC.InternalError), error);
    }

    if (error instanceof RpcError) {
        const code = GRPC_STATUS_TO_JSON_RPC[error.code] ?? JSON_RPC.CallExecutionFailed;
        const mapped = GRPC_STATUS_PROVIDER_SPECIFIC.has(error.code)
            ? new SuiCompatProviderSpecificError(error.message, code)
            : new JsonRpcError(error.message, code);
        return withCause(mapped, error);
    }

    const message = error instanceof Error ? error.message : String(error);
    return withCause(new JsonRpcError(message, JSON_RPC.CallExecutionFailed), error);
};

/**
 * A failed connection to a host with several addresses (IPv4 + IPv6) surfaces as an
 * `AggregateError` whose own `.message` is empty, so it's expanded into its inner errors;
 * undici keeps its most specific identifier on `.code` (e.g. `UND_ERR_SOCKET`), not `.message`.
 * A null-prototype cause or a throwing `toString`/`message` getter makes this throw — the caller
 * is expected to fall back to the original, unmodified error when that happens.
 */
const describeCause = (cause: unknown): string => {
    if (cause instanceof AggregateError && cause.errors.length > 0) {
        return cause.errors.map(describeCause).join('; ');
    }
    if (!(cause instanceof Error)) {
        return String(cause);
    }
    const code = 'code' in cause && typeof cause.code === 'string' ? ` [${cause.code}]` : '';
    return `${cause.name}${code}: ${cause.message}`;
};

/**
 * Node's `fetch` wraps every network-level failure (DNS, connection reset, TLS, socket timeout)
 * in a generic `TypeError: fetch failed` and puts the real reason on `.cause` — but
 * `@protobuf-ts/grpcweb-transport` re-wraps any fetch rejection into a fresh `RpcError` built
 * only from `.message` (its `unary`/`serverStreaming` `.catch`), and `toJsonRpcError` above
 * re-wraps again the same way, so `.cause` is dropped twice before a caller ever sees it. Folding
 * it into the message here, before either re-wrap runs, is the one place it still survives both.
 */
export const fetchWithCauseInMessage: typeof fetch = async (...args) => {
    try {
        return await fetch(...args);
    } catch (error) {
        if (!(error instanceof Error) || error.cause === undefined) {
            throw error;
        }

        let causeDetail: string;
        try {
            causeDetail = describeCause(error.cause);
        } catch {
            throw error;
        }

        throw new Error(`${error.message}: ${causeDetail}`, { cause: error.cause });
    }
};
