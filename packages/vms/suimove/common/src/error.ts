export class SuiMoveAbortError extends Error {
    readonly abortCode: number;
    constructor(abortCode: number, rawMsg: string) {
        super(`Move abort with code: ${abortCode}. Raw error message: ${rawMsg}`);
        this.abortCode = abortCode;
    }
}

export class SuiMoveUnclassifiedError extends Error {}
