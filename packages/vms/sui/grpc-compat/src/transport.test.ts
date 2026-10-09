import { JsonRpcError, SuiClient } from '@mysten/sui/client';
import { SuiGraphQLClient } from '@mysten/sui-v2/graphql';
import { SuiGrpcClient } from '@mysten/sui-v2/grpc';
import { RpcError } from '@protobuf-ts/runtime-rpc';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { SuiCompatNotImplementedError } from './errors';
import { createNativeGrpcTransport, resolveNativeGrpcTarget } from './nativeGrpcTransport';
import { createSuiCompatClients, SuiCompatTransport } from './transport';

const TEST_OPTIONS = {
    network: 'testnet',
    grpcUrl: 'https://grpc.example',
    graphqlUrl: 'https://graphql.example',
} as const;

type ReferenceGasPriceGrpcClient = Pick<SuiGrpcClient, 'getReferenceGasPrice'>;

const createMockGrpcClient = (methods: Partial<ReferenceGasPriceGrpcClient>): SuiGrpcClient =>
    Object.assign(
        new SuiGrpcClient({
            network: TEST_OPTIONS.network,
            baseUrl: TEST_OPTIONS.grpcUrl,
        }),
        methods,
    );

const createMockClients = (grpc: SuiGrpcClient) => ({
    grpc,
    graphql: new SuiGraphQLClient({
        network: TEST_OPTIONS.network,
        url: TEST_OPTIONS.graphqlUrl,
    }),
});

describe('SuiCompatTransport', () => {
    it('returns the v1 reference gas price through a real SuiClient', async () => {
        const grpcClient = createMockGrpcClient({
            getReferenceGasPrice: vi.fn().mockResolvedValue({ referenceGasPrice: '750' }),
        });
        const client = new SuiClient({
            network: 'testnet',
            transport: new SuiCompatTransport(TEST_OPTIONS, createMockClients(grpcClient)),
        });

        await expect(client.getReferenceGasPrice()).resolves.toBe(750n);
        expect(grpcClient.getReferenceGasPrice).toHaveBeenCalledWith({ signal: undefined });
    });

    it('rejects methods that have not been implemented', async () => {
        const grpcClient = createMockGrpcClient({});
        const client = new SuiClient({
            network: 'testnet',
            transport: new SuiCompatTransport(TEST_OPTIONS, createMockClients(grpcClient)),
        });

        await expect(
            client.resolveNameServiceAddress({ name: 'example.sui' }),
        ).rejects.toBeInstanceOf(SuiCompatNotImplementedError);
        await expect(client.getProtocolConfig()).rejects.toBeInstanceOf(
            SuiCompatNotImplementedError,
        );
    });

    it('rejects an empty reference gas price instead of treating it as 0n', async () => {
        const grpcClient = createMockGrpcClient({
            getReferenceGasPrice: vi.fn().mockResolvedValue({ referenceGasPrice: '' }),
        });
        const client = new SuiClient({
            network: 'testnet',
            transport: new SuiCompatTransport(TEST_OPTIONS, createMockClients(grpcClient)),
        });

        await expect(client.getReferenceGasPrice()).rejects.toMatchObject({
            code: -32000,
        });
    });

    it('maps SDK TypeError bugs to InternalError instead of InvalidParams', async () => {
        const grpcClient = createMockGrpcClient({
            getReferenceGasPrice: vi.fn().mockResolvedValue(undefined),
        });
        const client = new SuiClient({
            network: 'testnet',
            transport: new SuiCompatTransport(TEST_OPTIONS, createMockClients(grpcClient)),
        });

        await expect(client.getReferenceGasPrice()).rejects.toMatchObject({
            constructor: JsonRpcError,
            code: -32603,
        });
    });

    it('applies a client timeout AbortSignal when options.timeout is set', async () => {
        const grpcClient = createMockGrpcClient({
            getReferenceGasPrice: vi.fn().mockResolvedValue({ referenceGasPrice: '750' }),
        });
        const transport = new SuiCompatTransport(
            { ...TEST_OPTIONS, timeout: 5_000 },
            createMockClients(grpcClient),
        );

        await transport.request({ method: 'suix_getReferenceGasPrice', params: [] });

        expect(grpcClient.getReferenceGasPrice).toHaveBeenCalledWith({
            signal: expect.any(AbortSignal),
        });
    });

    it('rethrows a local abort instead of wrapping it as CallExecutionFailed', async () => {
        const controller = new AbortController();
        controller.abort();
        const grpcClient = createMockGrpcClient({
            getReferenceGasPrice: vi.fn().mockRejectedValue(new RpcError('aborted', 'CANCELLED')),
        });
        const transport = new SuiCompatTransport(TEST_OPTIONS, createMockClients(grpcClient));

        await expect(
            transport.request({
                method: 'suix_getReferenceGasPrice',
                params: [],
                signal: controller.signal,
            }),
        ).rejects.toMatchObject({ name: 'AbortError' });
    });
});

describe('createSuiCompatClients', () => {
    afterEach(() => {
        vi.restoreAllMocks();
    });

    it('sends binary-framed grpc-web content-type on the wire', async () => {
        const fetchSpy = vi
            .spyOn(globalThis, 'fetch')
            .mockRejectedValue(new Error('network unreachable in test'));

        const { grpc } = createSuiCompatClients(TEST_OPTIONS);

        await expect(grpc.getReferenceGasPrice()).rejects.toThrow();

        expect(fetchSpy).toHaveBeenCalledTimes(1);
        const [, init] = fetchSpy.mock.calls[0] as Parameters<typeof fetch>;
        expect((init?.headers as Headers).get('content-type')).toBe('application/grpc-web+proto');
    });

    it('uses a caller-supplied grpcTransport instead of grpc-web', () => {
        const fetchSpy = vi.spyOn(globalThis, 'fetch');

        const { grpc } = createSuiCompatClients({
            ...TEST_OPTIONS,
            grpcTransport: createNativeGrpcTransport(TEST_OPTIONS),
        });

        expect(grpc).toBeInstanceOf(SuiGrpcClient);
        expect(fetchSpy).not.toHaveBeenCalled();
    });

    it('skips the GraphQL client when graphqlUrl is omitted or empty', () => {
        const { graphqlUrl: _graphqlUrl, ...grpcOnlyOptions } = TEST_OPTIONS;

        expect(createSuiCompatClients(grpcOnlyOptions).graphql).toBeUndefined();
        expect(
            createSuiCompatClients({ ...grpcOnlyOptions, graphqlUrl: '' }).graphql,
        ).toBeUndefined();
        expect(createSuiCompatClients(TEST_OPTIONS).graphql).toBeInstanceOf(SuiGraphQLClient);
    });
});

describe('resolveNativeGrpcTarget', () => {
    it('parses an https grpc-web URL into host:port with SSL credentials', () => {
        const target = resolveNativeGrpcTarget('https://sui-mainnet.g.alchemy.com:443');

        expect(target.host).toBe('sui-mainnet.g.alchemy.com:443');
        expect(target.channelCredentials._isSecure()).toBe(true);
    });

    it('falls back to insecure channel credentials for a plain http target', () => {
        const target = resolveNativeGrpcTarget('http://localhost:9000');

        expect(target.host).toBe('localhost:9000');
        expect(target.channelCredentials._isSecure()).toBe(false);
    });
});
