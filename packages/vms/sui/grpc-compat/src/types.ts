import type { SuiClientTypes } from '@mysten/sui-v2/client';
import type { RpcTransport } from '@protobuf-ts/runtime-rpc';

/**
 * Network accepted by the Mysten 2.26 gRPC client, re-exported so callers configure
 * this package without importing `@mysten/sui-v2` themselves.
 */
export type SuiCompatNetwork = SuiClientTypes.Network;

/**
 * Configures the upstream used by one compatibility client.
 */
export interface SuiCompatClientOptions {
    readonly network: SuiCompatNetwork;
    readonly grpcUrl: string;
    readonly graphqlUrl?: string;
    readonly headers?: Readonly<Record<string, string>>;
    readonly timeout?: number;
    /**
     * Replaces the default grpc-web-over-`fetch` transport. Pass
     * `createNativeGrpcTransport` from `@layerzerolabs/sui-grpc-compat/node` for gateways
     * that only speak native gRPC and reject every grpc-web content-type framing; it's a
     * separate entry point so browser bundles never pull in `@grpc/grpc-js`.
     */
    readonly grpcTransport?: RpcTransport;
}
