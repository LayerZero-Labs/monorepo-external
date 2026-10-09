import { ChannelCredentials } from '@grpc/grpc-js';
import { GrpcTransport } from '@protobuf-ts/grpc-transport';
import type { RpcTransport } from '@protobuf-ts/runtime-rpc';

import type { SuiCompatClientOptions } from './types';

/** `URL#host` drops the port when it matches the scheme's default (e.g. https:443). */
const DEFAULT_PORT_BY_PROTOCOL: Readonly<Record<string, string>> = {
    'https:': '443',
    'http:': '80',
};

/**
 * Resolves a `GrpcTransport` target from an HTTPS grpc-web-shaped URL: bare
 * `host:port` (no scheme — `GrpcTransport` rejects one) plus matching channel
 * credentials.
 */
export const resolveNativeGrpcTarget = (
    grpcUrl: string,
): { readonly host: string; readonly channelCredentials: ChannelCredentials } => {
    const { protocol, hostname, port } = new URL(grpcUrl);
    return {
        host: `${hostname}:${port || DEFAULT_PORT_BY_PROTOCOL[protocol] || '443'}`,
        channelCredentials:
            protocol === 'https:'
                ? ChannelCredentials.createSsl()
                : ChannelCredentials.createInsecure(),
    };
};

/**
 * Builds a native gRPC transport (HTTP/2 via `@grpc/grpc-js`) for gateways that
 * reject grpc-web entirely. Pass it as `SuiCompatClientOptions.grpcTransport`.
 */
export const createNativeGrpcTransport = ({
    grpcUrl,
    headers,
}: Pick<SuiCompatClientOptions, 'grpcUrl' | 'headers'>): RpcTransport =>
    new GrpcTransport({
        ...resolveNativeGrpcTarget(grpcUrl),
        meta: headers,
    });
