import type { Abi, Hex } from 'viem';
import {
    AbiDecodingZeroDataError,
    BaseError,
    CallExecutionError,
    ContractFunctionExecutionError,
    ContractFunctionRevertedError,
    ContractFunctionZeroDataError,
    createPublicClient,
    custom,
    decodeFunctionResult,
    encodeErrorResult,
    erc20Abi,
    ExecutionRevertedError,
    HttpRequestError,
    RpcRequestError,
} from 'viem';
import { describe, expect, it } from 'vitest';

import { ChainName } from '@layerzerolabs/layerzero-definitions';

import { isRevertOrNoData, isRevertWithError } from './errors';

const endpointAbi: Abi = [
    {
        type: 'function',
        name: 'getReceiveLibrary',
        stateMutability: 'view',
        inputs: [
            { name: '_receiver', type: 'address' },
            { name: '_srcEid', type: 'uint32' },
        ],
        outputs: [
            { name: 'lib', type: 'address' },
            { name: 'isDefault', type: 'bool' },
        ],
    },
    {
        type: 'function',
        name: 'getSendLibrary',
        stateMutability: 'view',
        inputs: [
            { name: '_sender', type: 'address' },
            { name: '_dstEid', type: 'uint32' },
        ],
        outputs: [{ name: 'lib', type: 'address' }],
    },
];

const endpointAbiWithErrors: Abi = [
    ...endpointAbi,
    { type: 'error', name: 'LZ_DefaultReceiveLibUnavailable', inputs: [] },
    { type: 'error', name: 'LZ_DefaultSendLibUnavailable', inputs: [] },
];

const buildRevertedError = (params: { abi: Abi; functionName: string; data: Hex }) =>
    new ContractFunctionExecutionError(new ContractFunctionRevertedError(params), {
        abi: params.abi,
        functionName: params.functionName,
        args: [],
    });

const buildCallExecutionError = (details: string | undefined) =>
    new ContractFunctionExecutionError(
        new CallExecutionError(
            new BaseError('reverted', details === undefined ? {} : { details }),
            {},
        ),
        { abi: endpointAbi, functionName: 'getReceiveLibrary', args: [] },
    );

const buildTronCallError = (data: Hex | undefined) =>
    new ContractFunctionExecutionError(
        new CallExecutionError(
            new RpcRequestError({
                body: {},
                error: { code: -32000, message: 'REVERT opcode executed', data },
                url: 'https://api.trongrid.io/jsonrpc',
            }),
            {},
        ),
        { abi: endpointAbi, functionName: 'getReceiveLibrary', args: [] },
    );

const buildRootstockCallError = (data: Hex | undefined) =>
    new ContractFunctionExecutionError(
        new CallExecutionError(
            new RpcRequestError({
                body: {},
                error: { code: -32015, message: 'VM execution error.', data },
                url: 'https://public-node.rsk.co',
            }),
            {},
        ),
        { abi: endpointAbi, functionName: 'getReceiveLibrary', args: [] },
    );

const RECEIVE_LIB_UNAVAILABLE_SELECTOR: Hex = '0x78e84d06';
const SEND_LIB_UNAVAILABLE_SELECTOR: Hex = '0x6c1ccdb5';
const NIBIRU_RECEIVE_DETAILS = `execution reverted with undecodable reason (raw hex: ${RECEIVE_LIB_UNAVAILABLE_SELECTOR.slice(2)})`;
const NIBIRU_SEND_DETAILS = `execution reverted with undecodable reason (raw hex: ${SEND_LIB_UNAVAILABLE_SELECTOR.slice(2)})`;

describe('isRevertWithError', () => {
    it.each([
        {
            functionName: 'getReceiveLibrary',
            data: RECEIVE_LIB_UNAVAILABLE_SELECTOR,
            signature: 'LZ_DefaultReceiveLibUnavailable()',
        },
        {
            functionName: 'getSendLibrary',
            data: SEND_LIB_UNAVAILABLE_SELECTOR,
            signature: 'LZ_DefaultSendLibUnavailable()',
        },
    ])(
        'matches via raw selector when ABI omits the error: $signature',
        ({ functionName, data, signature }) => {
            const err = buildRevertedError({ abi: endpointAbi, functionName, data });
            expect(isRevertWithError(err, ChainName.ETHEREUM, signature)).toBe(true);
        },
    );

    it('matches via decoded errorName when ABI declares the error', () => {
        const err = buildRevertedError({
            abi: endpointAbiWithErrors,
            functionName: 'getReceiveLibrary',
            data: RECEIVE_LIB_UNAVAILABLE_SELECTOR,
        });
        expect(err.cause).toBeInstanceOf(ContractFunctionRevertedError);
        if (err.cause instanceof ContractFunctionRevertedError) {
            expect(err.cause.data?.errorName).toBe('LZ_DefaultReceiveLibUnavailable');
        }
        expect(
            isRevertWithError(err, ChainName.ETHEREUM, 'LZ_DefaultReceiveLibUnavailable()'),
        ).toBe(true);
    });

    it('returns false for a revert with a different selector', () => {
        const err = buildRevertedError({
            abi: endpointAbi,
            functionName: 'getReceiveLibrary',
            data: '0xdeadbeef',
        });
        expect(
            isRevertWithError(err, ChainName.ETHEREUM, 'LZ_DefaultReceiveLibUnavailable()'),
        ).toBe(false);
    });

    it('returns false when the cause is ContractFunctionZeroDataError', () => {
        const zero = new ContractFunctionZeroDataError({ functionName: 'getReceiveLibrary' });
        const err = new ContractFunctionExecutionError(zero, {
            abi: endpointAbi,
            functionName: 'getReceiveLibrary',
            args: [],
        });
        expect(
            isRevertWithError(err, ChainName.ETHEREUM, 'LZ_DefaultReceiveLibUnavailable()'),
        ).toBe(false);
    });

    it('returns false for inputs that are not a ContractFunctionExecutionError', () => {
        expect(
            isRevertWithError(
                new Error('boom'),
                ChainName.ETHEREUM,
                'LZ_DefaultReceiveLibUnavailable()',
            ),
        ).toBe(false);
        expect(
            isRevertWithError(undefined, ChainName.ETHEREUM, 'LZ_DefaultReceiveLibUnavailable()'),
        ).toBe(false);
    });

    describe('Nibiru', () => {
        it.each([
            { details: NIBIRU_RECEIVE_DETAILS, signature: 'LZ_DefaultReceiveLibUnavailable()' },
            { details: NIBIRU_SEND_DETAILS, signature: 'LZ_DefaultSendLibUnavailable()' },
        ])(
            'matches via `(raw hex: ...)` suffix on Nibiru: $signature',
            ({ details, signature }) => {
                expect(
                    isRevertWithError(
                        buildCallExecutionError(details),
                        ChainName.NIBIRU,
                        signature,
                    ),
                ).toBe(true);
            },
        );
    });

    describe('Harmony', () => {
        it('matches a ContractFunctionRevertedError without revert data on Harmony', () => {
            const err = new ContractFunctionExecutionError(
                new ContractFunctionRevertedError({
                    abi: endpointAbi,
                    functionName: 'getReceiveLibrary',
                }),
                { abi: endpointAbi, functionName: 'getReceiveLibrary', args: [] },
            );
            expect(
                isRevertWithError(err, ChainName.HARMONY, 'LZ_DefaultReceiveLibUnavailable()'),
            ).toBe(true);
        });

        it('falls through to errorName matching when revert data is decoded on Harmony', () => {
            const err = buildRevertedError({
                abi: endpointAbiWithErrors,
                functionName: 'getReceiveLibrary',
                data: RECEIVE_LIB_UNAVAILABLE_SELECTOR,
            });
            expect(
                isRevertWithError(err, ChainName.HARMONY, 'LZ_DefaultReceiveLibUnavailable()'),
            ).toBe(true);
        });

        it('returns false when decoded revert data names a different error on Harmony', () => {
            const err = buildRevertedError({
                abi: endpointAbiWithErrors,
                functionName: 'getReceiveLibrary',
                data: SEND_LIB_UNAVAILABLE_SELECTOR,
            });
            expect(
                isRevertWithError(err, ChainName.HARMONY, 'LZ_DefaultReceiveLibUnavailable()'),
            ).toBe(false);
        });
    });

    describe('Tron', () => {
        it('matches via `RpcRequestError.data` selector on Tron', () => {
            expect(
                isRevertWithError(
                    buildTronCallError(RECEIVE_LIB_UNAVAILABLE_SELECTOR),
                    ChainName.TRON,
                    'LZ_DefaultReceiveLibUnavailable()',
                ),
            ).toBe(true);
        });

        it('returns false when the `RpcRequestError.data` selector mismatches on Tron', () => {
            expect(
                isRevertWithError(
                    buildTronCallError('0xdeadbeef'),
                    ChainName.TRON,
                    'LZ_DefaultReceiveLibUnavailable()',
                ),
            ).toBe(false);
        });

        it('terminates without matching when the cause chain is circular on Tron', () => {
            const call = new CallExecutionError(new BaseError('reverted'), {});
            const ring = new BaseError('a');
            const other = new BaseError('b');
            (ring as unknown as { cause: unknown }).cause = other;
            (other as unknown as { cause: unknown }).cause = ring;
            (call as unknown as { cause: unknown }).cause = ring;
            const err = new ContractFunctionExecutionError(call, {
                abi: endpointAbi,
                functionName: 'getReceiveLibrary',
                args: [],
            });
            expect(
                isRevertWithError(err, ChainName.TRON, 'LZ_DefaultReceiveLibUnavailable()'),
            ).toBe(false);
        });
    });

    describe('Rootstock', () => {
        it('matches via `RpcRequestError.data` selector on Rootstock', () => {
            expect(
                isRevertWithError(
                    buildRootstockCallError(RECEIVE_LIB_UNAVAILABLE_SELECTOR),
                    ChainName.ROOTSTOCK,
                    'LZ_DefaultReceiveLibUnavailable()',
                ),
            ).toBe(true);
        });

        it('returns false when the `RpcRequestError.data` selector mismatches on Rootstock', () => {
            expect(
                isRevertWithError(
                    buildRootstockCallError('0xdeadbeef'),
                    ChainName.ROOTSTOCK,
                    'LZ_DefaultReceiveLibUnavailable()',
                ),
            ).toBe(false);
        });
    });
});

const readDecimals = async (
    response: { result: Hex } | { error: { code: number; message: string; data?: unknown } },
) => {
    const client = createPublicClient({
        transport: custom(
            {
                request: async () => {
                    if ('result' in response) {
                        return response.result;
                    }
                    throw Object.assign(new Error(response.error.message), response.error);
                },
            },
            { retryCount: 0 },
        ),
    });
    return client
        .readContract({
            address: '0x70c0000000000000000000000000000000000002',
            abi: erc20Abi,
            functionName: 'decimals',
        })
        .then(
            () => {
                throw new Error('Expected the decimals() read to fail');
            },
            (error: unknown) => error,
        );
};

const thrownBy = (run: () => unknown) => {
    try {
        run();
    } catch (error) {
        return error;
    }
    throw new Error('Expected the call to throw');
};

describe('isRevertOrNoData', () => {
    it('returns true for a JSON-RPC -32000 execution reverted with no data, which viem maps to ExecutionRevertedError', async () => {
        const error = await readDecimals({
            error: { code: -32000, message: 'execution reverted' },
        });

        expect(error).toBeInstanceOf(BaseError);
        expect(
            error instanceof BaseError && error.walk((e) => e instanceof ExecutionRevertedError),
        ).toBeInstanceOf(ExecutionRevertedError);
        expect(isRevertOrNoData(error)).toBe(true);
    });

    it('returns true for a JSON-RPC -32000 gas required exceeds allowance, which viem maps to ExecutionRevertedError', async () => {
        expect(
            isRevertOrNoData(
                await readDecimals({
                    error: { code: -32000, message: 'gas required exceeds allowance' },
                }),
            ),
        ).toBe(true);
    });

    it.each(['request timed out', 'internal error', 'header not found'])(
        'returns false for a JSON-RPC -32603 %s with no revert data, which viem reports as a revert',
        async (message) => {
            const error = await readDecimals({ error: { code: -32603, message } });

            expect(error instanceof ContractFunctionExecutionError && error.cause).toBeInstanceOf(
                ContractFunctionRevertedError,
            );
            expect(isRevertOrNoData(error)).toBe(false);
        },
    );

    it('returns true for a JSON-RPC -32603 execution reverted with revert data', async () => {
        const error = await readDecimals({
            error: {
                code: -32603,
                message: 'execution reverted',
                data: encodeErrorResult({
                    abi: [
                        {
                            type: 'error',
                            name: 'Error',
                            inputs: [{ name: 'message', type: 'string' }],
                        },
                    ],
                    errorName: 'Error',
                    args: ['no decimals'],
                }),
            },
        });

        expect(error instanceof ContractFunctionExecutionError && error.cause).toBeInstanceOf(
            ContractFunctionRevertedError,
        );
        expect(isRevertOrNoData(error)).toBe(true);
    });

    it('returns true for a JSON-RPC -32603 with revert data whose message does not mention a revert', async () => {
        const error = await readDecimals({
            error: { code: -32603, message: 'internal error', data: '0x12345678' },
        });

        expect(isRevertOrNoData(error)).toBe(true);
    });

    it('returns true for a JSON-RPC -32603 execution reverted with no revert data', async () => {
        expect(
            isRevertOrNoData(
                await readDecimals({ error: { code: -32603, message: 'execution reverted' } }),
            ),
        ).toBe(true);
    });

    it.each([
        ['a message string', 'request timed out'],
        ['an object without revert data', { reason: 'upstream reset' }],
    ])(
        'returns false for a JSON-RPC -32603 internal error whose data is %s',
        async (_case, data) => {
            const error = await readDecimals({
                error: { code: -32603, message: 'internal error', data },
            });

            expect(error instanceof ContractFunctionExecutionError && error.cause).toBeInstanceOf(
                ContractFunctionRevertedError,
            );
            expect(isRevertOrNoData(error)).toBe(false);
        },
    );

    it.each([
        ['code 3 with hex shorter than a 4-byte selector', 3, 'execution reverted', '0x1234'],
        ['code 3 with non-hex data that says it reverted', 3, 'execution reverted', 'Reverted'],
        [
            '-32603 with non-hex data that says it reverted',
            -32603,
            'VM Exception while processing transaction: reverted',
            'Reverted',
        ],
        [
            '-32603 internal error with hex shorter than a 4-byte selector',
            -32603,
            'internal error',
            '0x1234',
        ],
    ])('returns true for a JSON-RPC %s', async (_case, code, message, data) => {
        const error = await readDecimals({ error: { code, message, data } });

        expect(error instanceof ContractFunctionExecutionError && error.cause).toBeInstanceOf(
            ContractFunctionRevertedError,
        );
        expect(isRevertOrNoData(error)).toBe(true);
    });

    it('returns false for a JSON-RPC -32603 whose non-hex data does not say it reverted, even when the message does, because viem drops the message', async () => {
        const error = await readDecimals({
            error: { code: -32603, message: 'execution reverted: not an OFT', data: 'not an OFT' },
        });

        expect(isRevertOrNoData(error)).toBe(false);
    });

    it('returns true for a JSON-RPC -32603 whose data is an object holding revert data', async () => {
        expect(
            isRevertOrNoData(
                await readDecimals({
                    error: {
                        code: -32603,
                        message: 'internal error',
                        data: { data: '0x12345678' },
                    },
                }),
            ),
        ).toBe(true);
    });

    it('returns true for a JSON-RPC code 3 execution reverted with empty revert data', async () => {
        expect(
            isRevertOrNoData(
                await readDecimals({
                    error: { code: 3, message: 'execution reverted', data: '0x' },
                }),
            ),
        ).toBe(true);
    });

    it('returns true for a ContractFunctionRevertedError with neither revert data nor a reason', () => {
        expect(
            isRevertOrNoData(
                new ContractFunctionExecutionError(
                    new ContractFunctionRevertedError({ abi: erc20Abi, functionName: 'decimals' }),
                    { abi: erc20Abi, functionName: 'decimals', args: [] },
                ),
            ),
        ).toBe(true);
    });

    it('returns true for a revert with revert data, which viem maps to ContractFunctionRevertedError', async () => {
        const error = await readDecimals({
            error: {
                code: 3,
                message: 'execution reverted: no decimals',
                data: encodeErrorResult({
                    abi: [
                        {
                            type: 'error',
                            name: 'Error',
                            inputs: [{ name: 'message', type: 'string' }],
                        },
                    ],
                    errorName: 'Error',
                    args: ['no decimals'],
                }),
            },
        });

        expect(error).toBeInstanceOf(ContractFunctionExecutionError);
        expect(error instanceof ContractFunctionExecutionError && error.cause).toBeInstanceOf(
            ContractFunctionRevertedError,
        );
        expect(isRevertOrNoData(error)).toBe(true);
    });

    it('returns true for a call that returns no data, which viem maps to ContractFunctionZeroDataError', async () => {
        const error = await readDecimals({ result: '0x' });

        expect(error instanceof ContractFunctionExecutionError && error.cause).toBeInstanceOf(
            ContractFunctionZeroDataError,
        );
        expect(isRevertOrNoData(error)).toBe(true);
    });

    it('returns true for an AbiDecodingZeroDataError from decoding empty return data', () => {
        const error = thrownBy(() =>
            decodeFunctionResult({ abi: erc20Abi, functionName: 'decimals', data: '0x' }),
        );

        expect(error).toBeInstanceOf(AbiDecodingZeroDataError);
        expect(isRevertOrNoData(error)).toBe(true);
    });

    it('returns true when the revert is deeper in the cause chain of an error that is not a viem error', async () => {
        const revert = await readDecimals({
            error: { code: -32000, message: 'execution reverted' },
        });

        expect(isRevertOrNoData(new Error('wrapped', { cause: revert }))).toBe(true);
    });

    it('returns false for a JSON-RPC -32000 error other than execution reverted, such as header not found', async () => {
        const error = await readDecimals({ error: { code: -32000, message: 'header not found' } });

        expect(error).toBeInstanceOf(ContractFunctionExecutionError);
        expect(isRevertOrNoData(error)).toBe(false);
    });

    it('returns false for an HTTP transport error', () => {
        const error = new ContractFunctionExecutionError(
            new HttpRequestError({ url: 'https://rpc.invalid', status: 503 }),
            { abi: erc20Abi, functionName: 'decimals', args: [] },
        );

        expect(isRevertOrNoData(error)).toBe(false);
    });

    it('returns false for a value that is not an error and for a circular cause chain without a revert', () => {
        const ring = new Error('a');
        ring.cause = new Error('b', { cause: ring });

        expect([undefined, 'execution reverted', ring].map(isRevertOrNoData)).toEqual([
            false,
            false,
            false,
        ]);
    });
});
