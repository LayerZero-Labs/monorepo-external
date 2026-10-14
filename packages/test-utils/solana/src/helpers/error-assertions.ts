/**
 * Solana-specific error assertion helpers.
 *
 * Solana transaction errors nest the Anchor error code in different structures
 * depending on the SDK (UMI vs web3.js) and the execution path (simulation vs
 * confirmed send). These helpers normalize all formats before matching.
 *
 * Exported via the ./assertions subpath (not the main barrel) to avoid
 * pulling vitest into globalSetup context where it's not available.
 */

import type { Context, Pda, Program, ProgramError, Umi } from '@metaplex-foundation/umi';
import { expect } from 'vitest';

type ProgramErrorConstructor<T extends ProgramError> = new (program: Program, cause?: Error) => T;

// ── Error text extraction ────────────────────────────────────────────────────

/**
 * Extract all searchable text from a Solana error object.
 * Handles UMI errors (message + transactionError.logs) and web3.js errors
 * (message includes logs) and simulation errors (Simulate Fail: prefix).
 */
const getErrorText = (error: unknown): string => {
    if (typeof error !== 'object' || error === null) return String(error);

    const parts: string[] = [];

    if ('message' in error && typeof error.message === 'string') {
        parts.push(error.message);

        // UMI simulation format: error message after "Simulate Fail:" is JSON-encoded
        if (error.message.startsWith('Simulate Fail:')) {
            parts.push(JSON.stringify(error.message.split('Simulate Fail:')[1]));
        }
    }

    // UMI transaction error format: logs are in a nested object
    if (
        'transactionError' in error &&
        typeof error.transactionError === 'object' &&
        error.transactionError !== null &&
        'logs' in error.transactionError
    ) {
        parts.push(JSON.stringify(error.transactionError.logs));
    }

    // web3.js format: logs may be directly on the error
    if ('logs' in error && Array.isArray(error.logs)) {
        parts.push(JSON.stringify(error.logs));
    }

    return parts.join(' ');
};

/**
 * Format error details for assertion failure messages.
 */
const formatErrorInfo = (error: unknown): string => {
    const err = error as { message?: string; code?: string; name?: string; logs?: string[] };
    const parts = [];

    if (err.message) parts.push(`Message: "${err.message.slice(0, 200)}"`);
    if (err.code) parts.push(`Code: ${err.code}`);
    if (err.name) parts.push(`Name: ${err.name}`);

    if (err.logs) {
        const errorLogs = err.logs.filter(
            (log: string) => log.includes('Error Code:') || log.includes('Error Number:'),
        );
        if (errorLogs.length > 0) {
            parts.push(`Logs: [${errorLogs.slice(0, 2).join(', ')}]`);
        }
    }

    return parts.length > 0 ? parts.join(', ') : 'Unknown error format';
};

// ── Catch helper ─────────────────────────────────────────────────────────────

/** Run an async operation and return the caught error (or undefined if it succeeded). */
const catchError = async (operation: () => Promise<unknown>): Promise<unknown> => {
    try {
        await operation();
        return undefined;
    } catch (error) {
        return error;
    }
};

// ── Public assertions ────────────────────────────────────────────────────────

/** Expects that the given operation throws an error containing the specified message. */
export const expectErrorMessage = async (
    operation: () => Promise<unknown>,
    expectedMessage: string,
    failMessage?: string,
): Promise<void> => {
    const caught = await catchError(operation);

    expect(
        caught,
        failMessage ||
            `Expected error containing "${expectedMessage}" to be thrown, but operation succeeded`,
    ).toBeDefined();
    expect(getErrorText(caught)).toContain(expectedMessage);
};

/** Expects that the given operation throws a specific Anchor program error. */
export const expectProgramError = async <T extends ProgramError>(
    operation: () => Promise<unknown>,
    expectedErrorClass: ProgramErrorConstructor<T>,
    program: Program,
    customMessage?: string,
): Promise<void> => {
    const caught = await catchError(operation);

    expect(
        caught,
        customMessage ||
            `Expected ${expectedErrorClass.name} to be thrown, but operation succeeded`,
    ).toBeDefined();

    const instance = new expectedErrorClass(program);
    const expectedPattern = `Error Code: ${instance.name}. Error Number: ${(instance as unknown as { code: number }).code}`;

    expect(
        getErrorText(caught).includes(expectedPattern),
        `Expected ${expectedErrorClass.name}, got: ${formatErrorInfo(caught)}`,
    ).toBe(true);
};

/** Asserts that an already-caught error matches the expected Anchor program error class. */
export const assertProgramError = <T extends ProgramError>(
    error: unknown,
    expectedErrorClass: ProgramErrorConstructor<T>,
    program: Program,
    message: string,
): void => {
    const instance = new expectedErrorClass(program);
    const expectedPattern = `Error Code: ${instance.name}. Error Number: ${(instance as unknown as { code: number }).code}`;

    expect(
        getErrorText(error).includes(expectedPattern),
        `${message}, got: ${formatErrorInfo(error)}\nExpected: ${expectedErrorClass.name}`,
    ).toBe(true);
};

const ACCOUNT_NOT_INITIALIZED_PATTERNS = ['AccountNotInitialized', 'Error Number: 3012', '0xbc4'];

/**
 * Expects that the given operation fails because the caller lacks the required RBAC role.
 * Verifies the RoleMember PDA doesn't exist, then checks for AccountNotInitialized error.
 */
export const expectUnauthorizedError = async (
    operation: () => Promise<unknown>,
    umi: Umi | Context,
    roleMemberPda: Pda,
    customMessage?: string,
): Promise<void> => {
    const account = await umi.rpc.getAccount(roleMemberPda[0]);
    expect(account.exists, 'RoleMember PDA should not exist for unauthorized user').toBe(false);

    const caught = await catchError(operation);

    expect(
        caught,
        customMessage || 'Expected unauthorized error to be thrown, but operation succeeded',
    ).toBeDefined();

    const errorText = getErrorText(caught);
    expect(
        ACCOUNT_NOT_INITIALIZED_PATTERNS.some((pattern) => errorText.includes(pattern)),
        `Expected Anchor AccountNotInitialized error (unauthorized role), got: ${errorText.slice(0, 300)}`,
    ).toBe(true);
};

// Aliases for OFT test suites (same functions, OFT-flavored names)
export const expectOftError = expectProgramError;
export const assertOftError = assertProgramError;
