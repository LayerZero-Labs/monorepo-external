// google.rpc.Code values used by batch responses. Keep these dependency-free: importing
// @grpc/grpc-js here would pull Node's native transport into the browser entry point.
const GRPC_CODE_UNKNOWN = 2;
export const GRPC_CODE_NOT_FOUND = 5;

const GRPC_STATUS_NAMES: Readonly<Record<number, string>> = {
    0: 'OK',
    1: 'CANCELLED',
    [GRPC_CODE_UNKNOWN]: 'UNKNOWN',
    3: 'INVALID_ARGUMENT',
    4: 'DEADLINE_EXCEEDED',
    [GRPC_CODE_NOT_FOUND]: 'NOT_FOUND',
    6: 'ALREADY_EXISTS',
    7: 'PERMISSION_DENIED',
    8: 'RESOURCE_EXHAUSTED',
    9: 'FAILED_PRECONDITION',
    10: 'ABORTED',
    11: 'OUT_OF_RANGE',
    12: 'UNIMPLEMENTED',
    13: 'INTERNAL',
    14: 'UNAVAILABLE',
    15: 'DATA_LOSS',
    16: 'UNAUTHENTICATED',
};

export const grpcStatusName = (code: number | undefined): string =>
    GRPC_STATUS_NAMES[code ?? GRPC_CODE_UNKNOWN] ?? 'UNKNOWN';
