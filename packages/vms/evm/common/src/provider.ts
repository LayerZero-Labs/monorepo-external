import axios from 'axios';
import type { PublicClient } from 'viem';
import { type AbiEvent, createPublicClient, http, type Log, parseEventLogs } from 'viem';

import { numberToHex } from '@layerzerolabs/common-encoding-utils';
import type { HexString } from '@layerzerolabs/typescript-utils';

import type { EnhancedLog, QueryFilter } from './events';
import { matchQueryFilter } from './events';

export type IViemClientWrapper = { viem: PublicClient };
export type EvmProvider = IViemClientWrapper & {
    batchQueryFilter: (
        filters: QueryFilter[],
        fromBlock: number,
        toBlock: number,
    ) => Promise<{ events: EnhancedLog[]; blockNumber: number }>;
};

interface JsonRpcResponse<T = unknown> {
    jsonrpc: '2.0';
    id: number;
    result?: T;
    error?: {
        code: number;
        message: string;
    };
}

interface JsonRpcRequest {
    jsonrpc: '2.0';
    id: number;
    method: string;
    params: unknown;
}

interface JsonRpcLog {
    address: HexString;
    topics: HexString[];
    data: HexString;
    blockNumber: string;
    transactionHash: HexString;
    transactionIndex: string;
    blockHash: HexString;
    logIndex: string;
    removed?: boolean;
}

class EvmProviderHelper {
    private nextId: number;
    private eventSignatureCache: Map<string, string>;

    /** The RPC this helper talks to, and the headers sent with each request (e.g. API-key auth). */
    constructor(private readonly endpoint: { uri: string; headers?: Record<string, string> }) {
        this.nextId = 1;
        this.eventSignatureCache = new Map<string, string>();
    }

    convertJsonRpcLogToLog = (jsonLog: JsonRpcLog): Log => {
        return {
            address: jsonLog.address,
            topics: jsonLog.topics as [HexString, ...HexString[]],
            data: jsonLog.data,
            blockNumber: BigInt(jsonLog.blockNumber),
            transactionHash: jsonLog.transactionHash,
            transactionIndex: Number(jsonLog.transactionIndex),
            blockHash: jsonLog.blockHash,
            logIndex: Number(jsonLog.logIndex),
            removed: jsonLog.removed ?? false,
        };
    };

    createEventSignatureCache = (filters: QueryFilter[]): Map<string, string> => {
        for (const filter of filters) {
            if (!this.eventSignatureCache.has(filter.abiEvent.name)) {
                const signature = `${filter.abiEvent.name}(${filter.abiEvent.inputs
                    .map((input: AbiEvent['inputs'][0]) => input.type)
                    .join(',')})`;
                this.eventSignatureCache.set(filter.abiEvent.name, signature);
            }
        }

        return this.eventSignatureCache;
    };

    createLogFilterBatchRequests = (
        filters: QueryFilter[],
        fromBlock: number,
        toBlock: number,
    ): JsonRpcRequest[] => {
        const requests: JsonRpcRequest[] = [
            {
                method: 'eth_blockNumber',
                params: [],
                id: this.nextId++,
                jsonrpc: '2.0',
            },
            {
                method: 'eth_getLogs',
                id: this.nextId++,
                jsonrpc: '2.0',
                params: [
                    {
                        address: [
                            ...filters.reduce(
                                (uniqueAddresses: Set<string>, { viemFilter: { address } }) => {
                                    if (!address) {
                                        throw new Error(
                                            '[ERROR] - [EVM - ProviderAdapterImpl][createLogFilterBatchRequests] - Address is undefined',
                                        );
                                    }
                                    if (Array.isArray(address)) {
                                        address.forEach((addr) => uniqueAddresses.add(addr));
                                    } else {
                                        uniqueAddresses.add(address);
                                    }
                                    return uniqueAddresses;
                                },
                                new Set<string>(),
                            ),
                        ],
                        fromBlock: numberToHex(fromBlock),
                        toBlock: numberToHex(toBlock),
                        topics: [filters.map(({ viemFilter: { topics } }) => topics![0])],
                    },
                ],
            },
        ];

        return requests;
    };

    makeBatchRequest = async (requests: JsonRpcRequest[]): Promise<JsonRpcResponse[]> => {
        const { uri, headers } = this.endpoint;
        let results: JsonRpcResponse[];

        try {
            // The batch body is JSON: the forced Content-Type wins over a configured one in any case.
            const configured = Object.fromEntries(
                Object.entries(headers ?? {}).filter(
                    ([name]) => name.toLowerCase() !== 'content-type',
                ),
            );
            const response = await axios.post(uri, requests, {
                headers: { ...configured, 'Content-Type': 'application/json' },
                timeout: 30000,
            });

            results = response.data;
        } catch (error) {
            if (axios.isAxiosError(error)) {
                throw new Error(`RPC request failed: ${error.message}`);
            }
            throw error;
        }

        if (!Array.isArray(results)) {
            throw new Error('Invalid JSON-RPC response format: expected array');
        }

        for (const result of results) {
            if ('error' in result && result.error) {
                const rawErr = result.error;
                throw new Error(
                    rawErr.message ||
                        rawErr.code?.toString() ||
                        `Unparsable error response: ${JSON.stringify(rawErr)}`,
                );
            }
        }

        const isOrdered = requests.every((req, i) => req.id === results[i]?.id);

        if (!isOrdered) {
            return requests.map((request) => {
                const found = results.find((r) => r.id === request.id);
                if (!found) {
                    throw new Error(
                        `Could not find result for request: ${JSON.stringify(request)}`,
                    );
                }
                return found;
            });
        }

        return results;
    };

    processBatchResponse = (results: JsonRpcResponse[]): [string, JsonRpcLog[]] => {
        const invalidResponse = results.find((res) => !('id' in res));
        if (invalidResponse) {
            throw new Error(`Malformed RPC response: ${JSON.stringify(invalidResponse)}`);
        }

        const [blockNumberResult, logsResult] = results;

        if (!blockNumberResult || !logsResult) {
            throw new Error(
                `Missing required results. Block number: ${!!blockNumberResult}, Logs: ${!!logsResult}`,
            );
        }

        const validateResponse = (response: JsonRpcResponse, name: string) => {
            if ('error' in response && response.error) {
                throw new Error(`RPC error for ${name}: ${JSON.stringify(response.error)}`);
            }
            if (!('result' in response) || !response.result) {
                throw new Error(`Missing ${name} result value`);
            }
        };

        validateResponse(blockNumberResult, 'block number');
        validateResponse(logsResult, 'logs');

        return [blockNumberResult.result as string, logsResult.result as JsonRpcLog[]];
    };

    createEnhancedLogs = (
        jsonLogs: JsonRpcLog[],
        filters: QueryFilter[],
        signatureCache: Map<string, string>,
    ): EnhancedLog[] => {
        const viemLogs = jsonLogs.map(this.convertJsonRpcLogToLog);
        const enhancedLogs: EnhancedLog[] = [];

        for (const log of viemLogs) {
            const matchingFilter = filters.find((filter) => matchQueryFilter(log, filter));

            if (!matchingFilter) {
                throw new Error(`Couldn't find processFilter for event "${JSON.stringify(log)}"`);
            }

            const parsedLogs = parseEventLogs({
                abi: [matchingFilter.abiEvent],
                logs: [log],
                strict: true,
            });

            if (parsedLogs.length === 0) {
                throw new Error(
                    `Failed to parse log for event "${matchingFilter.abiEvent.name}" with log: ${JSON.stringify(log)}`,
                );
            }

            const parsedLog = parsedLogs[0];
            const eventSignature = signatureCache.get(matchingFilter.abiEvent.name);

            if (!eventSignature) {
                throw new Error(`Missing event signature for ${matchingFilter.abiEvent.name}`);
            }

            enhancedLogs.push({
                ...log,
                event: matchingFilter.abiEvent.name,
                eventSignature,
                args: parsedLog.args || {},
            } as EnhancedLog);
        }

        return enhancedLogs;
    };

    batchQueryFilter = async ({
        filters,
        fromBlock,
        toBlock,
    }: {
        filters: QueryFilter[];
        fromBlock: number;
        toBlock: number;
    }): Promise<{ events: EnhancedLog[]; blockNumber: number }> => {
        const signatureCache = this.createEventSignatureCache(filters);

        const batchRequests = this.createLogFilterBatchRequests(filters, fromBlock, toBlock);

        const results = await this.makeBatchRequest(batchRequests);

        const [blockNumber, logs] = this.processBatchResponse(results);

        const enhancedLogs = this.createEnhancedLogs(logs, filters, signatureCache);

        return {
            events: enhancedLogs,
            blockNumber: Number(BigInt(blockNumber)),
        };
    };
}

export type CreateEvmProviderOptions = {
    /** Fail fast when the RPC reports another chain id. */
    expectedChainId?: number;
    /** Extra HTTP headers sent with every RPC request (e.g. API-key auth for keyed RPC providers). */
    headers?: Record<string, string>;
};

/**
 * `options` may also be the expected chain id alone, as callers passed it before the options
 * object existed (the package is published).
 */
export const createEvmProvider = (
    uri: string,
    options: CreateEvmProviderOptions | number = {},
): EvmProvider => {
    const { expectedChainId, headers } =
        typeof options === 'number' ? { expectedChainId: options, headers: undefined } : options;
    const baseClient = createPublicClient({
        transport: http(uri, headers ? { fetchOptions: { headers } } : undefined),
    });

    const helper = new EvmProviderHelper({ uri, headers });

    if (expectedChainId != null) {
        void baseClient
            .getChainId()
            .then((chainId) => {
                if (chainId !== expectedChainId) {
                    console.error(
                        `EVM provider expected chainId ${expectedChainId} but endpoint ${uri} returned ${chainId}`,
                    );
                }
            })
            .catch(() => {
                console.error(`Error fetching chainId from ${uri}`);
            });
    }

    const proxy = new Proxy(
        { viem: baseClient },
        {
            get: (target, prop) => {
                if (prop === 'batchQueryFilter') {
                    return async (
                        filters: QueryFilter[],
                        fromBlock: number,
                        toBlock: number,
                    ): Promise<{ events: EnhancedLog[]; blockNumber: number }> => {
                        return helper.batchQueryFilter({ filters, fromBlock, toBlock });
                    };
                }

                return Reflect.get(target, prop);
            },
        },
    );

    return proxy as EvmProvider;
};
