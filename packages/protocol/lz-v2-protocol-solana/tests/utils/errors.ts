import { SendTransactionError } from '@solana/web3.js';

import { expect } from './util';

export const ConstraintHasOne = {
    code: 0x7d1,
    name: 'ConstraintHasOne',
};

export const ConstraintSeeds = {
    code: 0x7d6,
    name: 'ConstraintSeeds',
};

export const ConstraintRaw = {
    code: 0x7d3,
    name: 'ConstraintRaw',
};

export async function shouldBeRejected(
    fn: Promise<any>,
    error: { code: number; name: string } | string,
    printLogs = false,
): Promise<void> {
    try {
        await fn;
    } catch (e) {
        const errorMsgMatch =
            typeof error === 'string'
                ? error
                : `Error Code: ${error.name}. Error Number: ${error.code.toString(10)}`;

        if (e instanceof SendTransactionError) {
            if (printLogs) {
                console.error(e.transactionError);
            }
            expect(JSON.stringify(e.transactionError.logs)).to.contain(errorMsgMatch);
        } else if (e instanceof Error) {
            if (printLogs) {
                console.error(e.message);
            }
            expect(e.message).to.contain(errorMsgMatch);
        } else {
            const err = e ?? 'No error message';
            if (printLogs) {
                console.error(err);
            }
            expect(JSON.stringify(err)).to.contain(errorMsgMatch);
        }
        return;
    }
    throw new Error('Should never reach here');
}

/**
 * print error message and error stack, used to debug the negative test cases.
 * @param errorPrefix
 * @param promises
 */
export async function printErr(errorPrefix?: string, ...promises: Promise<any>[]): Promise<void> {
    try {
        await Promise.all(promises);
    } catch (e) {
        if (errorPrefix !== undefined) {
            console.error(errorPrefix + ': ' + String(e));
        } else {
            console.error(e);
        }
    }
}

/**
 * print the objects to json string with specified name.
 * @param objs
 */
export function printToJson(...objs: { name: string; obj: unknown }[]): void {
    try {
        objs.forEach(({ name, obj }) => {
            console.log(name + ': ', JSON.stringify(obj));
        });
    } catch (e) {
        console.error(e);
    }
}
