import type { bcs as iotaBcs, BcsType as IotaBcsType } from '@iota/iota-sdk/bcs';
import type {
    DevInspectResults as IotaDevInspectResults,
    IotaExecutionResult,
    IotaObjectData,
    IotaObjectResponse,
    IotaTransactionBlockResponse,
    LatestIotaSystemStateSummary,
    PaginatedObjectsResponse as IotaPaginatedObjectsResponse,
    PaginatedTransactionResponse as IotaPaginatedTransactionResponse,
    QueryTransactionBlocksParams as IotaQueryTransactionBlocksParams,
} from '@iota/iota-sdk/client';
import type { bcs as suiBcs, BcsType as SuiBcsType } from '@mysten/sui/bcs';
import type {
    Checkpoint,
    DevInspectResults as SuiDevInspectResults,
    GetAllCoinsParams,
    GetObjectParams,
    GetOwnedObjectsParams,
    GetTransactionBlockParams,
    PaginatedCoins,
    PaginatedObjectsResponse as SuiPaginatedObjectsResponse,
    PaginatedTransactionResponse as SuiPaginatedTransactionResponse,
    QueryTransactionBlocksParams as SuiQueryTransactionBlocksParams,
    SuiExecutionResult,
    SuiObjectData,
    SuiObjectResponse,
    SuiSystemStateSummary,
    SuiTransactionBlockResponse,
} from '@mysten/sui/client';

export type SuiMoveBcsType<T, U> = SuiBcsType<T, U> | IotaBcsType<T, U>;

export type SuiTypes =
    | typeof suiBcs.U256
    | typeof suiBcs.U64
    | typeof suiBcs.U32
    | typeof suiBcs.U16
    | typeof suiBcs.U8
    | typeof suiBcs.bool
    | typeof suiBcs.Address
    | typeof suiBcs.vector
    | SuiBcsType<
          string[],
          Iterable<string | Uint8Array> & {
              length: number;
          }
      >;

export type IotaTypes =
    | typeof iotaBcs.U256
    | typeof iotaBcs.U64
    | typeof iotaBcs.U32
    | typeof iotaBcs.U16
    | typeof iotaBcs.U8
    | typeof iotaBcs.bool
    | typeof iotaBcs.Address
    | typeof iotaBcs.vector
    | IotaBcsType<
          string[],
          Iterable<string | Uint8Array> & {
              length: number;
          }
      >;

export type SuiMoveTypes = SuiTypes | IotaTypes;

export interface SuiMoveBcs {
    u256: typeof suiBcs.U256 | typeof iotaBcs.U256;
    u128: typeof suiBcs.U128 | typeof iotaBcs.U128;
    u64: typeof suiBcs.U64 | typeof iotaBcs.U64;
    u32: typeof suiBcs.U32 | typeof iotaBcs.U32;
    u16: typeof suiBcs.U16 | typeof iotaBcs.U16;
    u8: typeof suiBcs.U8 | typeof iotaBcs.U8;
    bool: typeof suiBcs.bool | typeof iotaBcs.bool;
    address: typeof suiBcs.Address | typeof iotaBcs.Address;
    vectorAddress: SuiMoveBcsType<
        string[],
        Iterable<string | Uint8Array> & {
            length: number;
        }
    >;

    toAddress(bytes: Uint8Array): string;
    toU64(bytes: Uint8Array): string;
    toU16(bytes: Uint8Array): number;
    toU8(bytes: Uint8Array): number;
    toU8Vector(bytes: Uint8Array): number[];
    toBool(bytes: Uint8Array): boolean;
    toStruct<T>(bytes: Uint8Array, structName: string, fields: Record<string, SuiMoveTypes>): T;
}

export interface SuiMoveEventCursor {
    txDigest: string;
    eventSeq: string;
}

export interface SuiMoveEvent {
    type: string;
    data: unknown;
    txHash: string;
    blockSequenceNumber?: number;
    blockDigest?: string;
}

// Generic Move event shape, deliberately duplicated in each Move cluster's common package
// (common-aptosmove and common-suimove) rather than shared, so neither cluster carries a
// cross-cluster dependency for this ~4-line type. Kept as a generic `MoveEvent` (not
// cluster-prefixed) because the normalized shape is identical across Move VMs.
export interface MoveEvent {
    type: string;
    data: unknown;
    txHash: string;
    blockHeight: number;
}

export interface SuiMoveCoinBalance {
    coinType: string;
    totalBalance: string;
}

export interface SuiMoveViewResult {
    value: Uint8Array;
    type: string;
}

export type SuiMoveCheckpoint = Checkpoint;

export type SuiMoveGetTransactionBlockParams = GetTransactionBlockParams;

export type SuiMoveTransactionBlockResponse =
    | SuiTransactionBlockResponse
    | IotaTransactionBlockResponse;

export type SuiMoveGetAllCoinsParams = GetAllCoinsParams;

export type SuiMoveGetAllCoinsResponse = PaginatedCoins;

export type SuiMoveGetObjectParams = GetObjectParams;

export type SuiMoveObjectResponse = SuiObjectResponse | IotaObjectResponse;

export type SuiMoveGetOwnedObjectsParams = GetOwnedObjectsParams;

export type SuiMoveGetOwnedObjectsResponse =
    | SuiPaginatedObjectsResponse
    | IotaPaginatedObjectsResponse;

export type SuiMoveDevInspectResult = SuiDevInspectResults | IotaDevInspectResults;

export type SuiMoveExecutionResult = SuiExecutionResult | IotaExecutionResult;

export type SuiMoveObjectData = SuiObjectData | IotaObjectData;

export type SuiMoveSystemStateSummary = SuiSystemStateSummary | LatestIotaSystemStateSummary;

export type SuiMoveQueryTransactionBlocksParams =
    | SuiQueryTransactionBlocksParams
    | IotaQueryTransactionBlocksParams;

export type SuiMovePaginatedTransactionResponse =
    | SuiPaginatedTransactionResponse
    | IotaPaginatedTransactionResponse;
