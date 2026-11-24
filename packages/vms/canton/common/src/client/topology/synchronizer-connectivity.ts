// `@protobuf-ts/runtime` and `@protobuf-ts/runtime-rpc` are already in the tree as
// transitive deps of `@canton-network/core-ledger-proto` (and `@protobuf-ts/grpc-transport`),
// so declaring them here adds no new dependency — pnpm's isolation just requires this
// package to list them before it can import them directly.
import { MessageType, RepeatType, ScalarType } from '@protobuf-ts/runtime';
import {
    type MethodInfo,
    type RpcOptions,
    type RpcTransport,
    ServiceType,
    stackIntercept,
    type UnaryCall,
} from '@protobuf-ts/runtime-rpc';

/**
 * Minimal hand-written client for the Canton participant admin
 * `SynchronizerConnectivityService.ListConnectedSynchronizers` RPC.
 *
 * The published `@canton-network/core-ledger-proto` package does not ship the
 * `com.digitalasset.canton.admin.participant.v30` namespace, so the message and
 * service descriptors required for synchronizer discovery are declared here
 * against the same `@protobuf-ts` runtime the generated topology clients use.
 *
 * Field numbers mirror the `SynchronizerConnectivityService` definition in the
 * Canton `com.digitalasset.canton.admin.participant.v30` proto package; they track
 * the Canton version rather than any published package, so re-verify them when
 * upgrading Canton.
 *
 * TODO: the synchronizer id is also resolvable via the JSON Ledger API
 * (`/v2/state/connected-synchronizers`), in which case this hand-written gRPC
 * client can be removed — but consumers would then need to pass a JSON API URL too.
 */

const SERVICE_NAME =
    'com.digitalasset.canton.admin.participant.v30.SynchronizerConnectivityService';

/** Empty request for `ListConnectedSynchronizers`. */
export type ListConnectedSynchronizersRequest = Record<string, never>;

/** A single connected-synchronizer entry. */
export type ConnectedSynchronizer = {
    /** Human-readable synchronizer alias (e.g. `global`). */
    synchronizerAlias: string;
    /** Logical synchronizer id — the value accepted by topology `BaseQuery.store`. */
    synchronizerId: string;
    /** Physical synchronizer id (logical id plus a `::<protocol>-<serial>` suffix). */
    physicalSynchronizerId: string;
    /** Whether the participant's connection to the synchronizer is healthy. */
    healthy: boolean;
};

/** Response for `ListConnectedSynchronizers`. */
export type ListConnectedSynchronizersResponse = {
    connectedSynchronizers: ConnectedSynchronizer[];
};

const connectedSynchronizerMessage = new MessageType<ConnectedSynchronizer>(
    `${SERVICE_NAME}.ListConnectedSynchronizersResponse.Result`,
    [
        { no: 1, name: 'synchronizer_alias', kind: 'scalar', T: ScalarType.STRING },
        { no: 2, name: 'synchronizer_id', kind: 'scalar', T: ScalarType.STRING },
        { no: 3, name: 'physical_synchronizer_id', kind: 'scalar', T: ScalarType.STRING },
        { no: 4, name: 'healthy', kind: 'scalar', T: ScalarType.BOOL },
    ],
);

const requestMessage = new MessageType<ListConnectedSynchronizersRequest>(
    `${SERVICE_NAME}.ListConnectedSynchronizersRequest`,
    [],
);

const responseMessage = new MessageType<ListConnectedSynchronizersResponse>(
    `${SERVICE_NAME}.ListConnectedSynchronizersResponse`,
    [
        {
            no: 1,
            name: 'connected_synchronizers',
            kind: 'message',
            repeat: RepeatType.UNPACKED,
            T: () => connectedSynchronizerMessage,
        },
    ],
);

const service = new ServiceType(SERVICE_NAME, [
    { name: 'ListConnectedSynchronizers', options: {}, I: requestMessage, O: responseMessage },
]);

/** Client for the participant admin `SynchronizerConnectivityService`. */
export class SynchronizerConnectivityServiceClient {
    readonly #transport: RpcTransport;

    constructor(transport: RpcTransport) {
        this.#transport = transport;
    }

    /** Lists synchronizers the participant is currently connected to. */
    listConnectedSynchronizers(
        input: ListConnectedSynchronizersRequest,
        options?: RpcOptions,
    ): UnaryCall<ListConnectedSynchronizersRequest, ListConnectedSynchronizersResponse> {
        const method = service.methods[0] as MethodInfo<
            ListConnectedSynchronizersRequest,
            ListConnectedSynchronizersResponse
        >;
        return stackIntercept<
            ListConnectedSynchronizersRequest,
            ListConnectedSynchronizersResponse
        >('unary', this.#transport, method, this.#transport.mergeOptions(options), input);
    }
}
