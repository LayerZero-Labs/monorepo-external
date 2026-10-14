import { describe, expect, it } from 'vitest';

import {
    ActivityNotAvailableError,
    AssertionError,
    NonRetryableError,
    NotFoundError,
    SerializableError,
} from './../src/';

describe('SerializableError', () => {
    it('should check if error is in stack', () => {
        const err = new NotFoundError('User');
        expect(err.name).toBe('NotFoundError');
        expect(err.message).toBe('Not found: User');
        expect(err.cause).toBeUndefined();
        expect(err.details).toEqual(['NotFoundError', 'SerializableError']);
        expect(NotFoundError.inStackOf(err)).toBe(err);
    });

    it('does not treat string details as a serializable error marker', () => {
        const err = Object.assign(new Error('RPC failed'), {
            details: 'SerializableError: upstream request failed',
        });

        expect(SerializableError.inStackOf(err)).toBeUndefined();
    });

    it('should wrap an error', () => {
        const originalError = new Error('No rows returned');
        const wrappedError = NotFoundError.wrap(originalError, 'User');

        expect(wrappedError.name).toBe('NotFoundError');
        expect(wrappedError.message).toBe('Not found: User > No rows returned');
        expect(wrappedError.cause).toBe(originalError);
        expect(wrappedError.details).toEqual(['NotFoundError', 'SerializableError', 'Error']);
    });

    it('does not spread string details when wrapping an error', () => {
        const originalError = Object.assign(new Error('RPC failed'), {
            details: 'upstream request failed',
        });
        const wrappedError = NotFoundError.wrap(originalError, 'User');

        expect(wrappedError.details).toEqual(['NotFoundError', 'SerializableError', 'Error']);
    });

    it('wraps simple error', () => {
        class SomeError extends SerializableError {
            constructor(opts: ErrorOptions) {
                console.log('SomeError constructor called', opts);
                super('Some error', opts);
            }
        }

        const err = new Error('Some error 2');
        const wrapped = SomeError.wrap(err);
        expect(wrapped.name).toBe('SomeError');
        expect(wrapped.message).toBe('Some error > Some error 2');
        expect(wrapped.cause).toBe(err);
        expect(wrapped.details).toEqual(['SomeError', 'SerializableError', 'Error']);
    });

    it('does not make plain construction non-retryable', () => {
        const activityErr = new ActivityNotAvailableError('getPeers');
        const assertionErr = new AssertionError('Invalid role setup');

        expect(NonRetryableError.inStackOf(activityErr)).toBeUndefined();
        expect(NonRetryableError.inStackOf(assertionErr)).toBeUndefined();
    });

    it('marks a subclass non-retryable without losing its class chain', () => {
        const err = AssertionError.nonRetryable('Expected role names to be unique');

        expect(err.name).toBe('NonRetryableError');
        expect(err.message).toBe('Expected role names to be unique');
        expect(err.details).toEqual(['NonRetryableError', 'SerializableError', 'AssertionError']);
        expect(AssertionError.inStackOf(err)).toBe(err);
        expect(NonRetryableError.inStackOf(err)).toBe(err);
    });

    it('forwards constructor arguments and error options', () => {
        const originalError = new Error('No rows returned');
        const err = NotFoundError.nonRetryable('User', { cause: originalError });

        expect(err.message).toBe('Not found: User');
        expect((err.cause as SerializableError).name).toBe('NotFoundError');
        expect((err.cause as SerializableError).cause).toBe(originalError);
    });

    it('does not wrap a NonRetryableError twice', () => {
        const err = NonRetryableError.nonRetryable('boom');

        expect(err.name).toBe('NonRetryableError');
        expect(err.cause).toBeUndefined();
        expect(err.details).toEqual(['NonRetryableError', 'SerializableError']);
    });

    it('preserves the prototype chain when wrapping', () => {
        const original = new Error('boom');
        const wrapped = ActivityNotAvailableError.wrap(original, 'getPeers');
        expect(wrapped.name).toBe('ActivityNotAvailableError');
        expect(wrapped.details).toEqual([
            'ActivityNotAvailableError',
            'SerializableError',
            'Error',
        ]);
        expect(ActivityNotAvailableError.inStackOf(wrapped)).toBe(wrapped);
    });
});
