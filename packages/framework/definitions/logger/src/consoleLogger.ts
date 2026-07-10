import type { Logger } from './model';
import { LogLevel } from './model';

const RESET = '\x1b[0m';
const RED = '\x1b[31m';
const YELLOW = '\x1b[33m';

export const createConsoleLogger = (logLevel: LogLevel): Logger => ({
    log(level, message, ...optionalParams) {
        switch (level) {
            case LogLevel.TRACE:
                this.trace(message, ...optionalParams);
                break;
            case LogLevel.DEBUG:
                this.debug(message, ...optionalParams);
                break;
            case LogLevel.INFO:
                this.info(message, ...optionalParams);
                break;
            case LogLevel.WARN:
                this.warn(message, ...optionalParams);
                break;
            case LogLevel.ERROR:
                this.error(message, ...optionalParams);
                break;
            default:
                console.log(`[INVALID LOG LEVEL ${level}] ${message}`, ...optionalParams);
        }
    },
    trace(message, ...optionalParams) {
        if (logLevel > LogLevel.TRACE) {
            return;
        }
        console.debug(`[TRACE] ${message}`, ...optionalParams);
    },
    debug(message, ...optionalParams) {
        if (logLevel > LogLevel.DEBUG) {
            return;
        }
        console.debug(`[DEBUG] ${message}`, ...optionalParams);
    },
    info(message, ...optionalParams) {
        if (logLevel > LogLevel.INFO) {
            return;
        }
        console.info(`[INFO] ${message}`, ...optionalParams);
    },
    warn(message, ...optionalParams) {
        if (logLevel > LogLevel.WARN) {
            return;
        }
        console.warn(`${YELLOW}[WARN] ${message}${RESET}`, ...optionalParams);
    },
    error(message, ...optionalParams) {
        if (logLevel > LogLevel.ERROR) {
            return;
        }
        console.error(`${RED}[ERROR] ${message}${RESET}`, ...optionalParams);
    },
});
