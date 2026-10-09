import type {
    OwnedObjectRef,
    SuiEvent,
    SuiObjectChange,
    SuiTransactionBlockResponse,
    SuiTransactionBlockResponseOptions,
} from '@mysten/sui/client';
import { GrpcTypes } from '@mysten/sui-v2/grpc';

import { assertDefined, mapGrpcOwner, timestampToMs, toShortStructTag } from '../../utils';
import { buildSuiEventFields } from './eventConversion';

type V1TransactionBlockData = NonNullable<SuiTransactionBlockResponse['transaction']>['data'];

/**
 * Deliberately drops `gasData` and the full PTB `transaction` (kind/inputs) — no real caller
 * reads anything from this field besides `sender`. If a future caller needs one, add it here and
 * to `buildReadMask`.
 */
export type PartialTransactionBlockData = Pick<V1TransactionBlockData, 'messageVersion' | 'sender'>;

/**
 * Shared by `getTransactionBlock` and `executeTransactionBlock` — both the ledger-read and the
 * execute gRPC responses carry the same `ExecutedTransaction` shape, and both map to v1's
 * `SuiTransactionBlockResponse`, with `transaction` narrowed to what this module builds.
 */
export type GrpcCompatTransactionBlock = Omit<SuiTransactionBlockResponse, 'transaction'> & {
    transaction?: { data: PartialTransactionBlockData; txSignatures: string[] };
};

export const assertSupportedOptions = (
    options: SuiTransactionBlockResponseOptions | undefined,
    method: string,
): void => {
    if (options?.showRawInput || options?.showRawEffects || options?.showBalanceChanges) {
        throw new Error(
            `Sui gRPC compat ${method}: showRawInput, showRawEffects and showBalanceChanges are not yet supported — no production caller requests them`,
        );
    }
};

export const buildReadMask = (
    options: SuiTransactionBlockResponseOptions | undefined,
): string[] => {
    const paths = ['digest', 'checkpoint', 'timestamp', 'effects.status'];

    if (options?.showInput || options?.showObjectChanges) paths.push('transaction.sender');
    if (options?.showEffects) paths.push('effects');
    if (options?.showEvents) paths.push('events');
    if (options?.showObjectChanges) paths.push('effects.changed_objects');

    return paths;
};

// v1's placeholder for a gas object reference that doesn't exist — used below for transactions
// that pay gas from the sender's address balance rather than a gas coin (confirmed against
// mainnet transactions: gRPC's effects carry no gas_object at all for those).
const ZERO_ADDRESS = `0x${'0'.repeat(64)}`;
const ZERO_DIGEST = '1'.repeat(32);

// The old (v1) API's `effects` object has many more fields (created/mutated/deleted object
// lists, etc). We checked every real caller of this method and none of them read anything
// besides `status` (did the tx succeed) and `gasUsed`, so that's all we build here.
const buildEffects = (
    effects: GrpcTypes.TransactionEffects | undefined,
    method: string,
): NonNullable<SuiTransactionBlockResponse['effects']> => {
    // `effects.status` is always requested (see `buildReadMask`), so it should always be
    // present. If it's ever missing, that means something is wrong with the response, not that
    // the transaction failed — reporting it as a failure here would be misleading and could
    // trigger callers (e.g. executor/transaction-sdk) to unnecessarily retry a real success.
    if (effects?.status === undefined) {
        throw new Error(
            `Sui gRPC compat ${method}: response carried no effects.status — cannot tell whether the transaction succeeded`,
        );
    }

    return {
        messageVersion: 'v1',
        status: effects.status.success
            ? { status: 'success' }
            : {
                  status: 'failure',
                  error: effects.status.error?.description ?? 'Transaction failed',
              },
        executedEpoch: assertDefined(effects.epoch, method, 'effects.epoch').toString(),
        gasUsed: {
            computationCost: assertDefined(
                effects.gasUsed?.computationCost,
                method,
                'effects.gasUsed.computationCost',
            ).toString(),
            storageCost: assertDefined(
                effects.gasUsed?.storageCost,
                method,
                'effects.gasUsed.storageCost',
            ).toString(),
            storageRebate: assertDefined(
                effects.gasUsed?.storageRebate,
                method,
                'effects.gasUsed.storageRebate',
            ).toString(),
            nonRefundableStorageFee: assertDefined(
                effects.gasUsed?.nonRefundableStorageFee,
                method,
                'effects.gasUsed.nonRefundableStorageFee',
            ).toString(),
        },
        transactionDigest: assertDefined(
            effects.transactionDigest,
            method,
            'effects.transactionDigest',
        ),
        gasObject: effects.gasObject
            ? ({
                  owner: mapGrpcOwner(effects.gasObject.outputOwner),
                  reference: {
                      objectId: assertDefined(
                          effects.gasObject.objectId,
                          method,
                          'effects.gasObject.objectId',
                      ),
                      version: assertDefined(
                          effects.gasObject.outputVersion,
                          method,
                          'effects.gasObject.outputVersion',
                      ).toString(),
                      digest: assertDefined(
                          effects.gasObject.outputDigest,
                          method,
                          'effects.gasObject.outputDigest',
                      ),
                  },
              } satisfies OwnedObjectRef)
            : ({
                  owner: { AddressOwner: ZERO_ADDRESS },
                  reference: { objectId: ZERO_ADDRESS, version: '0', digest: ZERO_DIGEST },
              } satisfies OwnedObjectRef),
    };
};

const buildEvents = (events: GrpcTypes.Event[], txDigest: string, method: string): SuiEvent[] =>
    events.map(
        (event, index) =>
            ({
                id: { txDigest, eventSeq: (event.eventIndex ?? index).toString() },
                ...buildSuiEventFields(event, method),
            }) satisfies SuiEvent,
    );

const buildObjectChanges = (
    changedObjects: GrpcTypes.ChangedObject[],
    sender: string,
    method: string,
): SuiObjectChange[] =>
    changedObjects.flatMap((change): SuiObjectChange[] => {
        const objectId = assertDefined(change.objectId, method, 'changed_objects[].objectId');
        // Unlike `objectId` (every changed object has one), whether `outputVersion`/`outputDigest`/
        // `objectType` are set depends on which branch below actually applies (e.g. a deleted
        // object genuinely has no output version) — confirmed against real transactions. Kept as
        // `??` fallbacks rather than `assertDefined` since asserting here would throw on those
        // legitimately-absent cases.
        const version = change.outputVersion?.toString() ?? '0';
        const digest = change.outputDigest ?? '';
        const objectType = toShortStructTag(change.objectType ?? '');

        if (change.outputState === GrpcTypes.ChangedObject_OutputObjectState.PACKAGE_WRITE) {
            return [
                {
                    type: 'published',
                    packageId: objectId,
                    version,
                    digest,
                    modules: [],
                },
            ];
        }

        // gRPC reports a deleted or wrapped object like any other changed object; the old v1 API
        // leaves every one of them out of `objectChanges` entirely, not just the dynamic-field and
        // gas-smashing cases we special-cased before (confirmed against real mainnet
        // transactions, including plain `Coin<T>` deletions unrelated to either special case).
        if (
            change.outputState === GrpcTypes.ChangedObject_OutputObjectState.DOES_NOT_EXIST &&
            change.inputState === GrpcTypes.ChangedObject_InputObjectState.EXISTS
        ) {
            return [];
        }

        if (
            change.idOperation === GrpcTypes.ChangedObject_IdOperation.CREATED &&
            change.outputState === GrpcTypes.ChangedObject_OutputObjectState.OBJECT_WRITE
        ) {
            return [
                {
                    type: 'created',
                    objectId,
                    objectType,
                    version,
                    digest,
                    sender,
                    owner: mapGrpcOwner(change.outputOwner),
                },
            ];
        }

        if (
            change.idOperation === GrpcTypes.ChangedObject_IdOperation.NONE &&
            change.outputState === GrpcTypes.ChangedObject_OutputObjectState.OBJECT_WRITE
        ) {
            return [
                {
                    type: 'mutated',
                    objectId,
                    objectType,
                    version,
                    digest,
                    sender,
                    owner: mapGrpcOwner(change.outputOwner),
                    previousVersion: change.inputVersion?.toString() ?? '0',
                },
            ];
        }

        return [];
    });

/**
 * Assembles the shared subset of `SuiTransactionBlockResponse` that `getTransactionBlock` (a
 * ledger read), `executeTransactionBlock` (a broadcast), and `queryTransactionBlocks` (a
 * checkpoint-range scan) all build from the same `ExecutedTransaction` shape, honoring the same
 * `options` flags.
 */
export const buildTransactionBlockResult = (
    tx: GrpcTypes.ExecutedTransaction,
    digest: string,
    options: SuiTransactionBlockResponseOptions | undefined,
    method: string,
): GrpcCompatTransactionBlock => {
    const result: GrpcCompatTransactionBlock = {
        digest,
        checkpoint: tx.checkpoint !== undefined ? tx.checkpoint.toString() : null,
        timestampMs: tx.timestamp ? timestampToMs(tx.timestamp) : null,
    };

    // Requested by either `showInput` (as `transaction.data.sender`) or `showObjectChanges` (as
    // each change's `sender`) — asserted once and reused so it's never asserted twice.
    const sender =
        options?.showInput || options?.showObjectChanges
            ? assertDefined(tx.transaction?.sender, method, 'transaction.sender')
            : undefined;

    if (options?.showInput) {
        // The v1 `transaction` field normally also includes `gasData` and the full list of
        // operations the transaction runs (a "programmable transaction block", or PTB) — we
        // don't fetch or build either of those. We checked and the only thing any real caller
        // reads from this field is `sender`, so that's all we fill in. (`transaction.data` beyond
        // `sender` is also hashed for quorum by `suiTransactionBlockQuorumFn` in multiprovider.
        // Since we leave it empty, that quorum compares digest, sender, checkpoint and status
        // across providers, but not the transaction payload.)
        result.transaction = {
            data: { messageVersion: 'v1', sender: sender as string },
            txSignatures: [],
        };
    }

    if (options?.showEffects) {
        result.effects = buildEffects(tx.effects, method);
    }

    if (options?.showEvents) {
        result.events = buildEvents(tx.events?.events ?? [], digest, method);
    }

    if (options?.showObjectChanges) {
        result.objectChanges = buildObjectChanges(
            tx.effects?.changedObjects ?? [],
            sender as string,
            method,
        );
    }

    return result;
};
