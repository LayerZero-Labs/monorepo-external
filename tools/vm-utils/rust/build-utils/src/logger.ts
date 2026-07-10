import { createConsoleLogger, LogLevel } from '@layerzerolabs/logger-node';

export type { Logger } from '@layerzerolabs/logger-node';
export { LogLevel } from '@layerzerolabs/logger-node';

export let logger = createConsoleLogger(LogLevel.INFO);

export const setLogLevel = (level: LogLevel): void => {
    logger = createConsoleLogger(level);
};

/** Parse a log-level string (CLI flag). Unknown values fall back to INFO. */
export const parseLogLevel = (value?: string): LogLevel => {
    switch (value?.toLowerCase()) {
        case 'trace':
            return LogLevel.TRACE;
        case 'debug':
            return LogLevel.DEBUG;
        case 'warn':
            return LogLevel.WARN;
        case 'error':
            return LogLevel.ERROR;
        default:
            return LogLevel.INFO;
    }
};
