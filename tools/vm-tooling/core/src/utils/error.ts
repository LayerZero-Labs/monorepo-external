export const stringifyError = (error: unknown): string =>
    error instanceof Error ? error.message : String(error);
