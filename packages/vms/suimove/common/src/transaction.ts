import type {
    TransactionArgument as IotaTransactionArgument,
    TransactionResult as IotaTransactionResult,
} from '@iota/iota-sdk/transactions';
import type { Transaction as IotaTransaction } from '@iota/iota-sdk/transactions';
import type {
    TransactionArgument as SuiTransactionArgument,
    TransactionResult as SuiTransactionResult,
} from '@mysten/sui/transactions';
import type { Transaction as SuiTransaction } from '@mysten/sui/transactions';

import type { SuiMoveProvider } from './provider';

export type SuiMoveArgument = SuiTransactionArgument | IotaTransactionArgument;

export type SuiMoveTransactionResult = SuiTransactionResult | IotaTransactionResult;

export type SuiMoveClock = SuiTransaction['object']['clock'] | IotaTransaction['object']['clock'];

// Extract types from SuiTransaction.getData() return type
export type SuiMoveTransactionData =
    | ReturnType<SuiTransaction['getData']>
    | ReturnType<IotaTransaction['getData']>;
export type SuiMoveTransactionInput = SuiMoveTransactionData['inputs'][number];

// Extract command types - filter out the undefined case
export type SuiMoveCommand = SuiMoveTransactionData['commands'][number];
export type SuiMoveCall = Extract<SuiMoveCommand, { $kind: 'MoveCall' }>['MoveCall'];
export type SuiMoveCallArgument = SuiMoveCall['arguments'][number];

export type SuiMoveGas = SuiTransaction['gas'] | IotaTransaction['gas'];

export interface SuiMoveTransaction {
    gas: SuiMoveGas;

    getNew(): SuiMoveTransaction;

    from(tx: SuiMoveTransaction | string): SuiMoveTransaction;

    setSender(sender: string): void;

    suiMoveObjectRef(args: {
        objectId: string;
        digest: string;
        version: string | number;
    }): SuiMoveArgument;

    suiMoveSharedObjectRef(args: {
        objectId: string;
        initialSharedVersion: string | number;
        mutable: boolean;
    }): SuiMoveArgument;

    suiMoveReceivingRef(args: {
        objectId: string;
        digest: string;
        version: string | number;
    }): SuiMoveArgument;

    suiMoveCall(args: {
        target: string;
        arguments: SuiMoveArgument[];
        typeArguments: string[];
    }): SuiMoveTransactionResult;

    suiMovePublish(args: {
        modules: number[][] | string[];
        dependencies: string[];
    }): SuiMoveTransactionResult;

    suiMoveTransferObjects(
        objects: (SuiMoveArgument | string)[],
        target: string | SuiMoveArgument,
    ): SuiMoveTransactionResult;

    suiMakeMoveVec(args: {
        type: string | undefined;
        elements: SuiMoveArgument[];
    }): SuiMoveTransactionResult;

    toJSON(): Promise<string>;

    getData(): SuiMoveTransactionData;

    getDigest(args: { client: SuiMoveProvider }): Promise<string>;

    suiMoveSplitCoins(args: {
        coin?: SuiMoveArgument;
        amounts: SuiMoveArgument[];
    }): SuiMoveTransactionResult;

    upgrade(args: {
        modules: number[][] | string[];
        dependencies: string[];
        package: string;
        ticket: string | SuiMoveArgument;
    }): SuiMoveTransactionResult;

    mergeCoins(
        destination: string | SuiMoveArgument,
        sources: (string | SuiMoveArgument)[],
    ): SuiMoveTransactionResult;

    buildSuiMove(args: { client: SuiMoveProvider }): Promise<Uint8Array>;

    setExpiration(args: { Epoch: string }): void;

    asObject(args: { objectId: string | SuiMoveArgument }): SuiMoveArgument;

    asAddress(args: { address: string | SuiMoveArgument }): SuiMoveArgument;

    asAddressVector(args: { addresses: string[] | SuiMoveArgument }): SuiMoveArgument;

    asBytesVector(args: { bytes: Uint8Array[] | SuiMoveArgument }): SuiMoveArgument;

    asBytes(args: { bytes: Uint8Array | SuiMoveArgument }): SuiMoveArgument;

    asPure(args: { bytes: Uint8Array | SuiMoveArgument }): SuiMoveArgument;

    asU8(args: { value: number | SuiMoveArgument }): SuiMoveArgument;

    asU16(args: { value: number | SuiMoveArgument }): SuiMoveArgument;

    asU32(args: { value: number | SuiMoveArgument }): SuiMoveArgument;

    asU64(args: { value: bigint | number | string | SuiMoveArgument }): SuiMoveArgument;

    asU128(args: { value: bigint | number | string | SuiMoveArgument }): SuiMoveArgument;

    asU256(args: { value: bigint | number | string | SuiMoveArgument }): SuiMoveArgument;

    asString(args: { value: string | SuiMoveArgument }): SuiMoveArgument;

    asBool(args: { value: boolean | SuiMoveArgument }): SuiMoveArgument;

    getClock(): ReturnType<SuiMoveClock>;
}
