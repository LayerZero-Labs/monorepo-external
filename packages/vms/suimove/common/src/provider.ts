import type { SuiMoveTransaction } from './transaction';
import type {
    SuiMoveCheckpoint,
    SuiMoveCoinBalance,
    SuiMoveDevInspectResult,
    SuiMoveEvent,
    SuiMoveEventCursor,
    SuiMoveGetAllCoinsParams,
    SuiMoveGetAllCoinsResponse,
    SuiMoveGetObjectParams,
    SuiMoveGetOwnedObjectsParams,
    SuiMoveGetOwnedObjectsResponse,
    SuiMoveGetTransactionBlockParams,
    SuiMoveObjectResponse,
    SuiMovePaginatedTransactionResponse,
    SuiMoveQueryTransactionBlocksParams,
    SuiMoveSystemStateSummary,
    SuiMoveTransactionBlockResponse,
} from './types';

export interface SuiMoveProvider {
    queryEventsByType(args: {
        type: string;
        limit?: number;
        order?: 'ascending' | 'descending';
        cursor?: SuiMoveEventCursor;
    }): Promise<SuiMoveEvent[]>;

    queryEventByTxHash(args: {
        txHash: string;
        limit?: number;
        order?: 'ascending' | 'descending';
        cursor?: SuiMoveEventCursor;
    }): Promise<SuiMoveEvent[]>;

    queryTransactionBlocks(
        args: SuiMoveQueryTransactionBlocksParams,
    ): Promise<SuiMovePaginatedTransactionResponse>;

    getChainIdentifier(): Promise<string>;

    getCheckpoint(args: { id: string }): Promise<SuiMoveCheckpoint>;

    getSuiMoveTransactionBlock(
        args: SuiMoveGetTransactionBlockParams,
    ): Promise<SuiMoveTransactionBlockResponse>;

    getLatestCheckpointSequenceNumber(): Promise<string>;

    getReferenceGasPrice(): Promise<bigint>;

    executeSuiMoveTransactionBlock(args: {
        transactionBlock: string | Uint8Array;
        signature: string | string[];
    }): Promise<SuiMoveTransactionBlockResponse>;

    getCoinBalance(args: { address: string }): Promise<SuiMoveCoinBalance>;

    devInspectSuiMoveTransactionBlock(args: {
        transactionBlock: SuiMoveTransaction;
        sender: string;
    }): Promise<SuiMoveDevInspectResult>;

    getSuiMoveObject(args: SuiMoveGetObjectParams): Promise<SuiMoveObjectResponse>;

    getAllSuiMoveCoins(args: SuiMoveGetAllCoinsParams): Promise<SuiMoveGetAllCoinsResponse>;

    getSuiMoveOwnedObject(
        args: SuiMoveGetOwnedObjectsParams,
    ): Promise<SuiMoveGetOwnedObjectsResponse>;

    getSuiMoveSystemStateSummary(): Promise<SuiMoveSystemStateSummary>;
}
