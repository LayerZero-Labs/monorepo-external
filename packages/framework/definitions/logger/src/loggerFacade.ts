import type { Logger, LogLevel } from './model';

export const createLoggerFacade = (loggers: Logger[]): Logger => {
    let currentChainName: string | undefined = undefined;

    const forEachLogger = (fn: (logger: Logger, index: number) => void) => {
        for (let i = 0; i < loggers.length; i++) {
            const logger = loggers[i];
            try {
                fn(logger, i);
            } catch (error) {
                // Ensure one logger failure doesn't block others
                console.error(`[LoggerFacade] logger[${i}] call failed`, error);
            }
        }
    };

    return {
        get chainName() {
            return currentChainName;
        },
        set chainName(value: string | undefined) {
            currentChainName = value;
            forEachLogger((l) => {
                l.chainName = value;
            });
        },
        log(level: LogLevel, message: string, ...optionalParams: any[]) {
            forEachLogger((l) => l.log(level, message, ...optionalParams));
        },
        trace(message: string, ...optionalParams: any[]) {
            forEachLogger((l) => l.trace(message, ...optionalParams));
        },
        debug(message: string, ...optionalParams: any[]) {
            forEachLogger((l) => l.debug(message, ...optionalParams));
        },
        info(message: string, ...optionalParams: any[]) {
            forEachLogger((l) => l.info(message, ...optionalParams));
        },
        warn(message: string, ...optionalParams: any[]) {
            forEachLogger((l) => l.warn(message, ...optionalParams));
        },
        error(message: string, ...optionalParams: any[]) {
            forEachLogger((l) => l.error(message, ...optionalParams));
        },
    };
};
