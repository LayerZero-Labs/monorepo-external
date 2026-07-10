import { z } from 'zod';

import { ObjectDefinition } from '@layerzerolabs/base-definitions';
import type { Identity } from '@layerzerolabs/typescript-utils';

export enum LogLevel {
    'TRACE',
    'DEBUG',
    'INFO',
    'WARN',
    'ERROR',
}

export type LogMetadata = Record<string | symbol, any>;

export interface Logger {
    log(level: LogLevel, message: string, ...optionalParams: any[]): any;
    trace(message: string, ...optionalParams: any[]): any;
    debug(message: string, ...optionalParams: any[]): any;
    info(message: string, ...optionalParams: any[]): any;
    warn(message: string, ...optionalParams: any[]): any;
    error(message: string, ...optionalParams: any[]): any;
    // extending basic logger properties with chainName
    chainName?: string;
}

/**
 * <!-- anchor:LoggerDefinition -->
 */
export const LoggerDefinition = class extends ObjectDefinition<'Logger', z.ZodSchema<Logger>, {}> {
    constructor() {
        super({ name: 'Logger', schema: z.custom<Logger>(), dependencies: {} });
    }
};

const _loggerDefinition = new LoggerDefinition();

export interface LoggerDefinition extends Identity<typeof _loggerDefinition> {}

export const loggerDefinition = _loggerDefinition as LoggerDefinition;
