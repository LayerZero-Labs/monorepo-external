import { z } from 'zod';

export class OneSigError extends Error {
    code: number;
}

export class InvalidOneSigInputError extends OneSigError {
    constructor(message: string, code: number = 400) {
        super(message);
        this.name = 'InvalidOneSigInputError';
        this.code = code;
    }
}

export class OneSigServiceError extends OneSigError {
    constructor(message: string, code: number = 503) {
        super(message);
        this.name = 'OneSigServiceError';
        this.code = code;
    }
}

export class OneSigInvalidProposerSignatureError extends OneSigError {
    code: number;

    constructor(message: string, code: number = 401) {
        super(message);
        this.name = 'OneSigInvalidProposerSignatureError';
        this.code = code;
    }
}

export class OneSigInvalidRequestSignatureError extends OneSigError {
    code: number;

    constructor(message: string, code: number = 401) {
        super(message);
        this.name = 'OneSigInvalidRequestSignatureError';
        this.code = code;
    }
}

export class OneSigInvalidSignerSignatureError extends OneSigError {
    code: number;

    constructor(message: string, code: number = 401) {
        super(message);
        this.name = 'OneSigInvalidSignerSignatureError';
        this.code = code;
    }
}

export class OneSigEntityTooLargeError extends OneSigError {
    code: number;

    constructor(message: string, code: number = 401) {
        super(message);
        this.name = 'OneSigEntityTooLargeError';
        this.code = code;
    }
}

export class OneSigNotFoundError extends OneSigError {
    code: number;

    constructor(message: string, code: number = 404) {
        super(message);
        this.name = 'OneSigNotFoundError';
        this.code = code;
    }
}

export class OneSigBatchNotFoundError extends OneSigError {
    code: number;

    constructor(message: string, code: number = 404) {
        super(message);
        this.name = 'OneSigBatchNotFoundError';
        this.code = code;
    }
}

export class OneSigSessionExpiredError extends OneSigError {
    code: number;

    constructor(message: string, code: number = 401) {
        super(message);
        this.name = 'OneSigSessionExpiredError';
        this.code = code;
    }
}

export const oneSigServiceErrorSchema = z.object({
    name: z.string(),
    message: z.string(),
    code: z.number(),
});
