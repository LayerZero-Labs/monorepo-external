import type {
    SuiTransport,
    SuiTransportRequestOptions,
    SuiTransportSubscribeOptions,
} from '@mysten/sui/client';
import { SuiGraphQLClient } from '@mysten/sui-v2/graphql';
import { GrpcWebFetchTransport, SuiGrpcClient } from '@mysten/sui-v2/grpc';
import type { RpcTransport } from '@protobuf-ts/runtime-rpc';

import { fetchWithCauseInMessage, SuiCompatNotImplementedError, toJsonRpcError } from './errors';
import { devInspectTransactionBlock } from './methods/devInspectTransactionBlock';
import { dryRunTransactionBlock } from './methods/dryRunTransactionBlock';
import { executeTransactionBlock } from './methods/executeTransactionBlock';
import { getAllBalances } from './methods/getAllBalances';
import { getAllCoins } from './methods/getAllCoins';
import { getBalance } from './methods/getBalance';
import { getCheckpoint } from './methods/getCheckpoint';
import { getCoins } from './methods/getCoins';
import { getLatestCheckpointSequenceNumber } from './methods/getLatestCheckpointSequenceNumber';
import { getLatestSuiSystemState } from './methods/getLatestSuiSystemState';
import { getNormalizedMoveFunction } from './methods/getNormalizedMoveFunction';
import { getObject } from './methods/getObject';
import { getOwnedObjects } from './methods/getOwnedObjects';
import { getReferenceGasPrice } from './methods/getReferenceGasPrice';
import { getTransactionBlock } from './methods/getTransactionBlock';
import { multiGetObjects } from './methods/multiGetObjects';
import { queryEvents } from './methods/queryEvents';
import { queryTransactionBlocks } from './methods/queryTransactionBlocks';
import type { SuiCompatClientOptions } from './types';

type SuiCompatMethodHandler = (
    clients: SuiCompatClients,
    params: unknown[],
    signal?: AbortSignal,
) => Promise<unknown>;

export interface SuiCompatClients {
    readonly grpc: SuiGrpcClient;
    readonly graphql?: SuiGraphQLClient;
}

/**
 * JSON-RPC methods this transport implements. Keys are the names Mysten 1.45
 * `SuiClient` sends (`sui_*` / `suix_*`). Anything else throws
 * `SuiCompatNotImplementedError`.
 */
const METHOD_HANDLERS: Readonly<Record<string, SuiCompatMethodHandler>> = {
    // Mysten 1.45 calls `suix_getReferenceGasPrice` (extended JSON-RPC).
    // v2 gRPC returns a decimal string; the handler parses it to the v1 bigint.
    suix_getReferenceGasPrice: ({ grpc }, params, signal) =>
        getReferenceGasPrice(grpc, params, signal),
    sui_getLatestCheckpointSequenceNumber: ({ grpc }, params, signal) =>
        getLatestCheckpointSequenceNumber(grpc, params, signal),
    sui_getCheckpoint: ({ grpc }, params, signal) => getCheckpoint(grpc, params, signal),
    suix_getBalance: ({ grpc }, params, signal) => getBalance(grpc, params, signal),
    suix_getAllBalances: ({ grpc }, params, signal) => getAllBalances(grpc, params, signal),
    suix_getCoins: ({ grpc }, params, signal) => getCoins(grpc, params, signal),
    suix_getAllCoins: ({ grpc }, params, signal) => getAllCoins(grpc, params, signal),
    sui_getTransactionBlock: ({ grpc }, params, signal) =>
        getTransactionBlock(grpc, params, signal),
    sui_getObject: ({ grpc }, params, signal) => getObject(grpc, params, signal),
    sui_multiGetObjects: ({ grpc }, params, signal) => multiGetObjects(grpc, params, signal),
    suix_getOwnedObjects: ({ grpc }, params, signal) => getOwnedObjects(grpc, params, signal),
    suix_queryEvents: ({ grpc }, params, signal) => queryEvents(grpc, params, signal),
    suix_getLatestSuiSystemState: ({ grpc }, params, signal) =>
        getLatestSuiSystemState(grpc, params, signal),
    sui_getNormalizedMoveFunction: ({ grpc }, params, signal) =>
        getNormalizedMoveFunction(grpc, params, signal),
    sui_devInspectTransactionBlock: ({ grpc }, params, signal) =>
        devInspectTransactionBlock(grpc, params, signal),
    sui_dryRunTransactionBlock: ({ grpc }, params, signal) =>
        dryRunTransactionBlock(grpc, params, signal),
    sui_executeTransactionBlock: ({ grpc }, params, signal) =>
        executeTransactionBlock(grpc, params, signal),
    suix_queryTransactionBlocks: ({ grpc }, params, signal) =>
        queryTransactionBlocks(grpc, params, signal),
};

const createSuiGrpcTransport = (options: SuiCompatClientOptions): RpcTransport =>
    options.grpcTransport ??
    new GrpcWebFetchTransport({
        baseUrl: options.grpcUrl,
        meta: options.headers,
        // protobuf-ts defaults to base64 `grpc-web-text`, a workaround for browsers
        // reading streamed responses over XHR; binary is the native gRPC-web framing.
        format: 'binary',
        fetch: fetchWithCauseInMessage,
    });

/**
 * Builds the Mysten v2 clients used behind the v1 transport contract.
 */
export const createSuiCompatClients = (options: SuiCompatClientOptions): SuiCompatClients => ({
    grpc: new SuiGrpcClient({
        network: options.network,
        transport: createSuiGrpcTransport(options),
    }),
    graphql: options.graphqlUrl
        ? new SuiGraphQLClient({
              network: options.network,
              url: options.graphqlUrl,
          })
        : undefined,
});

/**
 * Presents the Mysten 1.45 JSON-RPC transport contract while executing supported methods
 * through the v2 clients internally.
 */
const mergeAbortSignals = (
    signal: AbortSignal | undefined,
    timeoutMs: number | undefined,
): AbortSignal | undefined => {
    if (timeoutMs === undefined) {
        return signal;
    }
    const timeoutSignal = AbortSignal.timeout(timeoutMs);
    return signal ? AbortSignal.any([signal, timeoutSignal]) : timeoutSignal;
};

export class SuiCompatTransport implements SuiTransport {
    private readonly clients: SuiCompatClients;

    public constructor(
        public readonly options: SuiCompatClientOptions,
        clients: SuiCompatClients = createSuiCompatClients(options),
    ) {
        this.clients = clients;
    }

    public async request<Result = unknown>(input: SuiTransportRequestOptions): Promise<Result> {
        const handler = METHOD_HANDLERS[input.method];

        if (!handler) {
            throw new SuiCompatNotImplementedError(input.method);
        }

        const signal = mergeAbortSignals(input.signal, this.options.timeout);
        let result: unknown;

        try {
            result = await handler(this.clients, input.params, signal);
        } catch (error: unknown) {
            signal?.throwIfAborted();
            throw toJsonRpcError(error);
        }

        // JsonRpcTransport owns the generic result boundary; the method dispatcher guarantees
        // the concrete v1 shape associated with each JSON-RPC method name.
        return result as Result;
    }

    // Websocket subscriptions (`sui_subscribeEvent`, etc.). Unused: we only
    // implement one-shot `request` calls, but `SuiTransport` requires this method.
    public async subscribe<Result = unknown>(
        _input: SuiTransportSubscribeOptions<Result>,
    ): Promise<() => Promise<boolean>> {
        throw new SuiCompatNotImplementedError('subscribe');
    }
}
