import { z } from 'zod';

import { SerializableError } from '@layerzerolabs/common-error-utils';

/**
 * Base error class for Canton SDK errors.
 */
export class CantonError extends Error {
    constructor(message: string) {
        super(message);
        this.name = this.constructor.name;
    }
}

/**
 * Network/transport layer errors (timeouts, 5xx, connection issues).
 */
export class CantonTransportError extends CantonError {
    constructor(
        message: string,
        public readonly status?: number,
    ) {
        super(message);
    }
}

/**
 * Protocol errors (unexpected response shapes, missing required fields).
 */
export class CantonProtocolError extends CantonError {
    constructor(
        message: string,
        public readonly details?: unknown,
    ) {
        super(message);
    }
}

/** A JSON Ledger API error, normalized from a non-2xx response's `JsCantonError` body. */
export class CantonApiError extends CantonError {
    constructor(
        message: string,
        /** Canton error category (1–14). See {@link isRetryableCantonError}. */
        public readonly errorCategory: number | undefined,
        /** Canton error code id, e.g. `CONTRACT_NOT_FOUND`. */
        public readonly code: string | undefined,
        public readonly status: number,
        public readonly body: unknown,
    ) {
        super(message);
    }
}

const cantonApiErrorBodySchema = z.object({
    errorCategory: z.number(),
    code: z.string(),
    cause: z.string(),
});

/** Build a {@link CantonApiError} from a non-2xx `Response`, reading a clone of the body. */
export async function cantonApiErrorFromResponse(response: Response): Promise<CantonApiError> {
    const body = await response.json().catch(() => undefined);
    const fields = cantonApiErrorBodySchema.safeParse(body).data;
    const message = `Canton API error ${response.status}${fields?.code ? ` [${fields.code}]` : ''}${
        fields?.cause ? `: ${fields.cause}` : ''
    }`;
    return new CantonApiError(message, fields?.errorCategory, fields?.code, response.status, body);
}

// Canton's `errorCategory` (1–14) is the retry signal, not the HTTP status.
// See https://docs.canton.network/appdev/reference/error-codes
const NON_RETRYABLE_CANTON_ERROR_CATEGORIES: ReadonlySet<number> = new Set([
    5, 9, 10, 11, 12, 13, 14,
]);

/**
 * Non-retryable Categories: 5, 9, 10, 11, 12, 13, 14.  Everything else is retryable.
 * Errors with no category (transport/connection failures) are treated as retryable.
 */
export function isRetryableCantonError(error: unknown): boolean {
    return (
        !(error instanceof CantonApiError) ||
        error.errorCategory === undefined ||
        !NON_RETRYABLE_CANTON_ERROR_CATEGORIES.has(error.errorCategory)
    );
}

/** Deterministic failure while resolving an OApp's active contract set. */
export class IOAppResolutionError extends SerializableError {
    constructor(message: string, options?: ErrorOptions) {
        super(message, options);
    }
}
