const extractMessageFromJsonRpcError = (err: any): string => {
    try {
        if (typeof err.body === 'object' && err.body.message) {
            return err.body.message;
        }
        const parsedBody = JSON.parse(err.body);
        return parsedBody?.error?.message;
    } catch {
        return 'unknown';
    }
};

export function convertErrorToObject(err: any): any {
    return JSON.parse(JSON.stringify(err, Object.getOwnPropertyNames(err)));
}

export function normalizeError(err: any) {
    const error = convertErrorToObject(err);
    return {
        // Normal Error properties
        ...(error.name ? { name: error.name } : {}),
        ...(error.message ? { message: error.message } : {}),
        ...(error.stack ? { stack: error.stack } : {}),
        // Rpc properties
        ...(error.reason ? { reason: error.reason } : {}),
        ...(error.code ? { code: error.code } : {}),
        ...(error.event ? { event: error.event } : {}),
        ...(error.body ? { body: extractMessageFromJsonRpcError(error) } : {}),
    };
}

// Removes the last argument if it is an ErrorOptions
type RemoveErrorOptions<T extends any[]> = T extends [...infer U, ErrorOptions?] ? U : never;

/**
 * Base class for all serializable errors.
 * This class is designed to be extended by other error classes.
 * It provides a way to wrap errors and a way to check if an error is in the stack of a specific error class.
 * All errors that extend this class *must* have error options as the last argument in their constructor.
 */
export abstract class SerializableError extends Error {
    details: string[];
    /*
     * The instance of the error that was wrapped, if any.
     * Creates a linked list of error objects.
     * Only exists if the error hasn't been serialized and deserialized.
     */
    cause: unknown;
    constructor(message: string, options?: ErrorOptions) {
        super(message, options);
        // for some reason, we need to set the cause directly on the instance, even after calling super
        this.cause = options?.cause;
        this.name = this.constructor.name;
        this.details = SerializableError.computeClassChain(this);
    }

    private static computeClassChain(instance: SerializableError): string[] {
        const chain: string[] = [];
        let proto: object | null = Object.getPrototypeOf(instance);
        while (proto && proto !== Error.prototype && proto !== Object.prototype) {
            const name = proto.constructor?.name;
            if (name) {
                chain.push(name);
            }
            if (name === SerializableError.name) {
                break;
            }
            proto = Object.getPrototypeOf(proto);
        }
        return chain;
    }

    /*
     * Checks if the error is an instance of the current class or a subclass. Returns the error if it is.
     * We can't type the error as more than SerializableError because it could have been serialized and deserialized,
     * which could make it lose extra fields.
     */
    static inStackOf<T extends abstract new (...args: any) => any>(
        this: T,
        error: any,
    ): SerializableError | undefined {
        if (Array.isArray(error?.details) && error.details.includes(this.name)) {
            return error as SerializableError;
        } else if (
            Array.isArray(error?.cause?.details) &&
            error.cause.details.includes(this.name)
        ) {
            return error.cause as SerializableError;
        }
        return undefined;
    }

    /*
     * Constructs this error and marks it non-retryable, e.g. AssertionError.nonRetryable('...').
     * Being non-retryable is a modifier rather than a kind of error, so prefer this over extending
     * NonRetryableError. Retry policies match on the exact class name and not the prototype chain,
     * so a subclass is silently retried unless its own name is registered in every policy.
     * The result keeps this error's class chain in details, so inStackOf still narrows to it.
     */
    static nonRetryable<T extends new (...args: any) => SerializableError>(
        this: T,
        ...args: ConstructorParameters<T>
    ): NonRetryableError {
        const error = new this(...args);
        // exact match only, since a subclass of NonRetryableError still reports its own name
        if (error.constructor === NonRetryableError) {
            return error as NonRetryableError;
        }

        return NonRetryableError.wrap(error, '');
    }

    // We could limit this to only wrap serializable errors, but that could limit the flexibility of the error system.
    static wrap<T extends new (...args: any) => SerializableError>(
        this: T,
        error: any,
        // Remove the optional error arguments
        ...args: RemoveErrorOptions<ConstructorParameters<T>>
    ): InstanceType<T> {
        const wrappedError = new this(...args, { cause: error });

        const combinedDetails = Array.isArray(error?.details)
            ? [...wrappedError.details, ...error.details]
            : [...wrappedError.details, error?.name ?? 'UnknownError'];
        wrappedError.details = [...new Set(combinedDetails)];

        const originalMessage = error?.message ?? String(error);
        wrappedError.message = wrappedError.message
            ? `${wrappedError.message} > ${originalMessage}`
            : originalMessage;

        return wrappedError as InstanceType<T>;
    }
}

export class NonRetryableError extends SerializableError {
    constructor(message: string, options?: ErrorOptions) {
        super(message, options);
    }
}

/**
 * Thrown when an internal invariant is violated.
 * Throw it via AssertionError.nonRetryable(...); plain construction is retryable.
 */
export class AssertionError extends SerializableError {
    constructor(message: string, options?: ErrorOptions) {
        super(message, options);
    }
}

/**
 * Thrown when an activity method or chain capability is not available.
 * Prefer this over plain Error for unimplemented stubs and missing chain implementations.
 * Throw it via ActivityNotAvailableError.nonRetryable(...); plain construction is retryable.
 */
export class ActivityNotAvailableError extends SerializableError {
    constructor(message: string, options?: ErrorOptions) {
        super(message, options);
    }
}

export class NotFoundError extends SerializableError {
    constructor(message?: string, options?: ErrorOptions) {
        super(message ? `Not found: ${message}` : 'Not found', options);
    }
}

// TODO: extend this for chain specific providers
export class ProviderError extends SerializableError {
    constructor(providerUri: string, options?: ErrorOptions) {
        super(`Provider error at host '${ProviderError.parseHost(providerUri)}'`, options);
    }

    private static parseHost(providerUri: string): string {
        try {
            const url = new URL(providerUri);
            return url.host;
        } catch {
            return 'UNKNOWN_HOST';
        }
    }
}

export class NonEmittableError extends SerializableError {
    constructor(message: string, options?: ErrorOptions) {
        super(message, options);
        this.name = 'NonEmittableError';
    }
}

export class QuorumNotAchievedYet extends SerializableError {
    constructor(options?: ErrorOptions) {
        super('The quorum was not achieved yet', options);
    }
}

export class MultiError extends Error {
    constructor(public readonly errs: any[]) {
        super(errs.map((err) => err.message).join(', '));
    }
}

/**
 * Throw from an expression position (`??`, `||`, ternaries, `return`, etc.).
 *
 * Prefer a normal `throw new Error(...)` / `throw new SomeError(...)` in statement
 * position.
 *
 * @example
 * const value = maybe ?? throwError('missing value');
 * const value = maybe ?? throwError('missing value', (msg) => new NonRetryableError(msg));
 */
export const throwError = <Err extends Error>(
    message: string,
    error?: (message: string) => Err,
): never => {
    throw error?.(message) ?? new Error(message);
};

/**
 * Assert that a value is never.
 * Most useful for enforcing exhaustive switch statements.
 */
export const assertUnreachable = (value: never): never => {
    throw new NonRetryableError(`Unreachable value: ${value}`);
};
