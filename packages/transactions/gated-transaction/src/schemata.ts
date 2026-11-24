import z from 'zod';

import type {
    NormalizedHexString,
    transactionSchema as _transactionSchema,
    TransactionWithResult,
} from '@layerzerolabs/common-chain-model';
import {
    buildTransactionWithResultSchema,
    type Transaction,
    type TransactionWithResultFor,
    transactionWithResultSchema as _transactionWithResultSchema,
} from '@layerzerolabs/common-chain-model';
import type {
    DeepFunctionPointers,
    DeeplyResolvedDeepFunctionPointers,
    FunctionPointer,
} from '@layerzerolabs/function-pointer';
import type {
    BrandedError,
    BuildTuple,
    DecimalString,
    IsAny,
    Or,
} from '@layerzerolabs/typescript-utils';
import type { InferredArray } from '@layerzerolabs/zod-utils';
import { customSchema, functionSchema } from '@layerzerolabs/zod-utils';

import type { BuildDeps } from './gatedTx';

export type OnChainDataComparisonOperator<OnChainDataType> =
    Or<
        [OnChainDataType extends number | DecimalString ? true : false, IsAny<OnChainDataType>]
    > extends true
        ? '<' | '<=' | '=' | '!=' | '>' | '>='
        : OnChainDataType extends string | object | boolean
          ? '=' | '!='
          : BrandedError<'Unsupported comparison type'>;

export type OnChainDataComparison<OnChainDataType extends string | number | boolean | object> = {
    operator: OnChainDataComparisonOperator<OnChainDataType>;
    comparisonValue: OnChainDataType;
};

export type GatedTransactionCheck<
    CheckOutput extends Promise<any> = Promise<any>,
    _Dependencies extends GatedTransactionDependencies = GatedTransactionDependencies,
> = {
    functionPointer: FunctionPointer<
        (tx?: TransactionWithResult, deps?: BuildDeps<_Dependencies>) => CheckOutput
    >;
    expectedResult: OnChainDataComparison<Awaited<CheckOutput>>;
};

export type GatedTransactionPermission =
    | { type: 'equals'; address: NormalizedHexString }
    | {
          type: 'function';
          functionPointer: FunctionPointer<(caller: NormalizedHexString) => Promise<boolean>>;
      };

// Schema for gated transaction results
export const gatedTransactionResultSchema = <
    TxWithResultSchema extends typeof _transactionWithResultSchema,
    OnchainDataSchema extends z.ZodType,
>(
    txWithResultSchema: TxWithResultSchema,
    onchainDataSchema: OnchainDataSchema,
) =>
    // TODO: use this schema as source of truth for GatedTransactionResult type
    z.union([
        z.object({
            status: z.literal(GatedTransactionStatus.NO_OP),
        }),
        z.object({
            status: z.literal(GatedTransactionStatus.SUCCESS),
            submittedTransaction: txWithResultSchema,
        }),
        z.object({
            status: z.literal(GatedTransactionStatus.TRANSACTION_FAILED),
            transactionError: z.any().optional(),
        }),
        z.object({
            status: z.literal(GatedTransactionStatus.FINAL_CHECK_FAILED),
            submittedTransaction: txWithResultSchema,
            finalOnChainState: onchainDataSchema,
        }),
        z.object({
            status: z.literal(GatedTransactionStatus.DEPENDENCY_FAILED),
        }),
        z.object({
            status: z.literal(GatedTransactionStatus.DENIED),
        }),
        z.object({
            status: z.literal(GatedTransactionStatus.DEFERRED_SUCCESS),
        }),
    ]);

export type InferOnChainDataTypeFromCheck<Check> = Check extends (...args: any[]) => infer Ret
    ? Awaited<Ret>
    : unknown;
export type InferOnChainDataTypeFromGatedTransaction<GatedTx extends GatedTransaction> =
    InferOnChainDataTypeFromCheck<GatedTx['check']>;

export type GatedTransactionDependencies = GatedTransaction[];

export type GatedTransactionArtifacts = {
    // if the registry already has this artifact AND shortCircuit is true, will resolve with no-op
    [artifactType: string]: {
        // passed through to the registry
        [artifactId: string]: {
            shape: DeepFunctionPointers<
                (args: { gtx: SuccessfulGatedTransaction<any> }) => Promise<any>
            >;
            shortCircuit?: boolean;
        };
    };
};

export type BaseGatedTransaction<
    Name extends string = string,
    CheckOutput extends Promise<any> = Promise<any>,
    _Dependencies extends GatedTransactionDependencies = GatedTransactionDependencies,
    Artifacts extends GatedTransactionArtifacts = GatedTransactionArtifacts,
> = {
    name: Name;
    description?: string;
    bundleName?: string;
    artifacts?: Artifacts;
    chainName: string;
    check: GatedTransactionCheck<CheckOutput, _Dependencies>;
    hasPermission?: GatedTransactionPermission;
    dependencies: _Dependencies;
    /**
     * Ordering-only dependencies: this transaction must be executed after these transactions,
     * but does not require their resolved output. If a transaction appears in both
     * `dependencies` and `orderingDependencies`, the regular dependency semantics take precedence.
     */
    orderingDependencies?: GatedTransactionDependencies;
    /**
     * Completion-only dependencies: this transaction cannot be processed until these transactions
     * reach a terminal state. Their success or failure does not affect this transaction.
     */
    completionDependencies?: GatedTransactionDependencies;
    cacheable?: boolean;
    uniqueIdKeys?: Record<string, string | number | boolean>;
};

export type LiteralGatedTransaction<
    Name extends string = string,
    TxType extends Transaction = Transaction,
    CheckOutput extends Promise<any> = Promise<any>,
    _Dependencies extends GatedTransactionDependencies = GatedTransactionDependencies,
    Artifacts extends GatedTransactionArtifacts = GatedTransactionArtifacts,
> = BaseGatedTransaction<Name, CheckOutput, _Dependencies, Artifacts> & {
    transactionType: 'literal';
    transaction: TxType;
};

export type FunctionalGatedTransaction<
    Name extends string = string,
    TxType extends Transaction = Transaction,
    CheckOutput extends Promise<any> = Promise<any>,
    DepInput extends [...args: any[], txs: any] = [txs: any],
    _Dependencies extends GatedTransactionDependencies = GatedTransactionDependencies,
    Artifacts extends GatedTransactionArtifacts = GatedTransactionArtifacts,
> = BaseGatedTransaction<Name, CheckOutput, _Dependencies, Artifacts> & {
    transactionType: 'functional';
    getTransaction: {
        functionPointer: FunctionPointer<(...deps: DepInput) => Promise<TxType>>;
    };
};

export type GatedTransaction<
    Name extends string = string,
    TxType extends Transaction = Transaction,
    CheckOutput extends Promise<any> = Promise<any>,
    DepInput extends [...args: any[], txs: any] = [txs: any],
    _Dependencies extends GatedTransactionDependencies = GatedTransactionDependencies,
    Artifacts extends GatedTransactionArtifacts = GatedTransactionArtifacts,
> =
    | LiteralGatedTransaction<Name, TxType, CheckOutput, _Dependencies, Artifacts>
    | FunctionalGatedTransaction<Name, TxType, CheckOutput, DepInput, _Dependencies, Artifacts>;

export type BaseGatedTransactionFor<GatedTx extends GatedTransaction> =
    GatedTx extends GatedTransaction<
        infer Name,
        any,
        infer CheckOutput,
        any,
        infer _Dependencies,
        infer Artifacts
    >
        ? BaseGatedTransaction<Name, CheckOutput, _Dependencies, Artifacts>
        : never;

export enum GatedTransactionStatus {
    // precheck passed, no need to send the tx
    NO_OP = 'no_op',
    // precheck failed, tx was sent, postcheck passed
    SUCCESS = 'success',
    // precheck failed, tx was sent but sender returned an error
    TRANSACTION_FAILED = 'transaction_failed',
    // precheck failed, tx was sent, postcheck failed
    FINAL_CHECK_FAILED = 'final_check_failed',
    // the tx couldn't be resolved because one of its dependencies resolved to a failed state
    DEPENDENCY_FAILED = 'dependency_failed',
    // approval to send the tx was explicitly denied
    DENIED = 'denied',
    // precheck failed, tx was sent but indeterminate, deferred execution passed on a recheck
    DEFERRED_SUCCESS = 'deferred_success',
}

export type NoOpGatedTransaction = {
    status: GatedTransactionStatus.NO_OP;
};

export type SuccessfulGatedTransaction<TxType extends Transaction = Transaction> = {
    status: GatedTransactionStatus.SUCCESS;
    submittedTransaction: TransactionWithResultFor<TxType>;
};

export type TxFailedGatedTransaction = {
    status: GatedTransactionStatus.TRANSACTION_FAILED;
    transactionError: any;
};

export type CheckFailedGatedTransaction<
    GatedTx extends GatedTransaction,
    TxType extends Transaction,
> = {
    status: GatedTransactionStatus.FINAL_CHECK_FAILED;
    submittedTransaction: TransactionWithResultFor<TxType>;
    finalOnChainState: InferOnChainDataTypeFromGatedTransaction<GatedTx>;
};

export type DependencyFailedGatedTransaction = {
    status: GatedTransactionStatus.DEPENDENCY_FAILED;
};

export type DeniedGatedTransaction = {
    status: GatedTransactionStatus.DENIED;
};

export type DeferredSuccessfulGatedTransaction = {
    status: GatedTransactionStatus.DEFERRED_SUCCESS;
};

export type GatedTransactionResult<
    GatedTx extends GatedTransaction = GatedTransaction,
    TxType extends Transaction = Transaction,
> =
    | NoOpGatedTransaction
    | SuccessfulGatedTransaction<TxType>
    | TxFailedGatedTransaction
    | CheckFailedGatedTransaction<GatedTx, TxType>
    | DependencyFailedGatedTransaction
    | DeniedGatedTransaction
    | DeferredSuccessfulGatedTransaction;

export type ResolvedGatedTransaction<
    GatedTx extends GatedTransaction = GatedTransaction,
    TxType extends Transaction = Transaction,
> = BaseGatedTransactionFor<GatedTx> & {
    result: GatedTransactionResult<GatedTx, TxType>;
};

export type ResolvedGatedTransactionWithArtifacts<
    GatedTx extends GatedTransaction = GatedTransaction,
    TxType extends Transaction = Transaction,
> = ResolvedGatedTransaction<GatedTx, TxType> & {
    resolvedArtifacts: {
        [ArtifactType in keyof NonNullable<GatedTx['artifacts']>]: {
            [ArtifactId in keyof NonNullable<GatedTx['artifacts']>[ArtifactType]]: Awaited<
                NonNullable<GatedTx['artifacts']>[ArtifactType][ArtifactId] extends {
                    shape: infer Shape extends DeepFunctionPointers;
                }
                    ? DeeplyResolvedDeepFunctionPointers<Shape>
                    : never
            >;
        };
    };
};

export const isResolvedGtx = (
    gtx: GatedTransaction | ResolvedGatedTransaction,
): gtx is ResolvedGatedTransaction => !!(gtx as ResolvedGatedTransaction).result;

export const gatedTransactionSchema = <
    Name extends z.ZodString | z.ZodLiteral<string> = z.ZodString,
    TransactionSchema extends typeof _transactionSchema = typeof _transactionSchema,
>(_?: {
    name?: Name;
    transactionSchema?: TransactionSchema;
}) =>
    customSchema<GatedTransaction<z.infer<Name>, z.infer<TransactionSchema>>>().meta({
        title: 'Gated Transaction',
        description: 'A schema for a gated transaction',
    });

export const resolvedGatedTransactionSchema = <
    Name extends z.ZodString | z.ZodLiteral<string> = z.ZodString,
    TransactionSchema extends typeof _transactionSchema = typeof _transactionSchema,
>(_?: {
    name?: Name;
    transactionSchema?: TransactionSchema;
}) =>
    customSchema<
        ResolvedGatedTransaction<
            GatedTransaction<z.infer<Name>, z.infer<TransactionSchema>>,
            z.infer<TransactionSchema>
        >
    >().meta({
        title: 'Resolved Gated Transaction',
        description: 'A schema for a resolved gated transaction',
    });

export const resolvedGatedTransactionWithArtifactsSchema = <
    Name extends z.ZodString | z.ZodLiteral<string> = z.ZodString,
    TransactionSchema extends typeof _transactionSchema = typeof _transactionSchema,
>(_?: {
    name?: Name;
    transactionSchema?: TransactionSchema;
}) =>
    customSchema<
        ResolvedGatedTransactionWithArtifacts<
            GatedTransaction<z.infer<Name>, z.infer<TransactionSchema>>,
            z.infer<TransactionSchema>
        >
    >().meta({
        title: 'Resolved Gated Transaction',
        description: 'A schema for a resolved gated transaction',
    });

/**
 * Builds a schema for an activity that builds a transaction based on the results of other transactions
 * @param transactionSchema The schema for the transaction to be built
 * @param txNumber The number of transactions you're building off of
 * @param extraArgs Additional arguments that must be passed to the function after the txs
 * @returns A schema for the activity that builds the transaction
 */
export const createTxArrayDependentActivitySchema = <
    TransactionSchema extends typeof _transactionSchema = typeof _transactionSchema,
    ExtraArgs extends z.ZodTuple = z.ZodTuple<[]>,
>(
    transactionSchema: TransactionSchema,
    extraArgs?: ExtraArgs,
) => {
    return functionSchema({
        input: z.tuple([
            ...(extraArgs?.def?.items ?? []),
            z.array(
                resolvedGatedTransactionWithArtifactsSchema({
                    transactionSchema,
                }),
            ),
        ] as any),
        output: z.promise(transactionSchema),
    }) as z.ZodType<
        [] extends z.infer<ExtraArgs>
            ? (
                  txs: ResolvedGatedTransactionWithArtifacts<
                      GatedTransaction<string, z.infer<TransactionSchema>>
                  >[],
              ) => Promise<z.infer<TransactionSchema>>
            : (
                  ...args: [
                      ...extraArgs: z.infer<ExtraArgs>,
                      txs: ResolvedGatedTransactionWithArtifacts<
                          GatedTransaction<string, z.infer<TransactionSchema>>
                      >[],
                  ]
              ) => Promise<z.infer<TransactionSchema>>
    >;
};
/**
 * Builds a schema for an activity that builds a transaction based on the results of other transactions
 * @param transactionSchema The schema for the transaction to be built
 * @param txNumber The number of transactions you're building off of
 * @param extraArgs Additional arguments that must be passed to the function after the txs
 * @returns A schema for the activity that builds the transaction
 */
export const createTxTupleDependentActivitySchema = <
    TransactionSchema extends typeof _transactionSchema = typeof _transactionSchema,
    const TxNumber extends number = 1,
    ExtraArgs extends z.ZodTuple = z.ZodTuple<[]>,
>(
    transactionSchema: TransactionSchema,
    txNumber: TxNumber,
    extraArgs?: ExtraArgs,
) => {
    const txs = Array.from({ length: txNumber }, () =>
        resolvedGatedTransactionWithArtifactsSchema({
            transactionSchema: transactionSchema,
        }),
    );

    return functionSchema({
        input: z.tuple([...(extraArgs?.def?.items ?? []), z.tuple(txs as any)] as any),
        output: z.promise(transactionSchema),
    }) as z.ZodType<
        [] extends z.infer<ExtraArgs>
            ? (
                  txs: BuildTuple<
                      ResolvedGatedTransactionWithArtifacts<
                          GatedTransaction<string, z.infer<TransactionSchema>>
                      >,
                      TxNumber
                  >,
              ) => Promise<z.infer<TransactionSchema>>
            : (
                  ...args: [
                      ...extraArgs: z.infer<ExtraArgs>,
                      txs: BuildTuple<
                          ResolvedGatedTransactionWithArtifacts<
                              GatedTransaction<string, z.infer<TransactionSchema>>
                          >,
                          TxNumber
                      >,
                  ]
              ) => Promise<z.infer<TransactionSchema>>
    >;
};

export const createGatedTxCheckActivitySchema = <
    Output extends z.ZodType,
    const Input extends z.ZodType[] = [],
    TransactionWithResultSchema extends
        typeof _transactionWithResultSchema = typeof _transactionWithResultSchema,
>({
    input,
    output,
    transactionWithResultSchema,
}: {
    input?: Input;
    transactionWithResultSchema?: TransactionWithResultSchema;
    output: Output;
}) => {
    const txWithResultSchema = (
        transactionWithResultSchema ?? _transactionWithResultSchema
    ).optional();

    return functionSchema({
        input: z.tuple([
            ...(input ?? []),
            txWithResultSchema,
            z.array(resolvedGatedTransactionSchema()).optional(),
        ] as any),
        output: z.promise(output),
    }) as z.ZodType<
        (
            ...args: [
                ...args: InferredArray<Input>,
                tx?: z.infer<TransactionWithResultSchema>,
                dependencies?: unknown[],
            ]
        ) => Promise<z.infer<Output>>
    >;
};

export const createGatedTupleDependentTxCheckActivitySchema = <
    Output extends z.ZodType,
    const Input extends z.ZodType[] = [],
    TransactionSchema extends typeof _transactionSchema = typeof _transactionSchema,
    const TxNumber extends number = 1,
>({
    input,
    output,
    transactionSchema,
    txNumber,
}: {
    input?: Input;
    output: Output;
    transactionSchema: TransactionSchema;
    txNumber: TxNumber;
}) => {
    return functionSchema({
        input: z.tuple([
            ...(input ?? []),
            buildTransactionWithResultSchema(transactionSchema),
            z
                .array(resolvedGatedTransactionSchema({ transactionSchema }))
                .length(txNumber)
                .optional(),
        ] as any),
        output: z.promise(output),
    }) as z.ZodType<
        (
            ...args: [
                ...args: InferredArray<Input>,
                tx?: z.infer<TransactionWithResultFor<z.infer<TransactionSchema>>>,
                dependencies?: BuildTuple<ResolvedGatedTransaction, TxNumber>,
            ]
        ) => Promise<z.infer<Output>>
    >;
};

export type ResolvedGatedTransactionDependencies<GatedTx extends GatedTransaction> =
    GatedTx extends GatedTransaction<any, any, any, any, infer _Dependencies>
        ? {
              [K in keyof _Dependencies]?: ResolvedGatedTransaction<_Dependencies[K]>;
          }
        : never;

export interface GatedTxCheckResult {
    expectationMet: boolean;
    data?: unknown;
}

export const gatedTxCheckResultSchema = z.object({
    expectationMet: z.boolean(),
    data: z.any().optional(),
});

export const isAnySuccessTypeGatedTransaction = <
    GatedTx extends GatedTransaction,
    TxType extends Transaction,
>(
    gtx: ResolvedGatedTransaction<GatedTx, TxType>,
): gtx is BaseGatedTransactionFor<GatedTx> & {
    result: Extract<
        GatedTransactionResult<GatedTx, TxType>,
        {
            status:
                | GatedTransactionStatus.SUCCESS
                | GatedTransactionStatus.NO_OP
                | GatedTransactionStatus.DEFERRED_SUCCESS;
        }
    >;
} => {
    return [
        GatedTransactionStatus.SUCCESS,
        GatedTransactionStatus.NO_OP,
        GatedTransactionStatus.DEFERRED_SUCCESS,
    ].includes(gtx.result.status);
};

export const gatedTransactionCacheSchema = z.object({
    getCachedTxCheckData: functionSchema({
        input: z.tuple([z.any()]),
        output: z.promise(z.any()),
    }) as z.ZodType<
        <GatedTx extends GatedTransaction>(
            gtx: GatedTx,
        ) => Promise<InferOnChainDataTypeFromGatedTransaction<GatedTx> | undefined>
    >,
    cacheSuccessfulTxCheckData: functionSchema({
        input: z.tuple([z.any(), z.any()]),
        output: z.promise(z.any()),
    }) as z.ZodType<
        <GatedTx extends GatedTransaction>(
            gtx: GatedTx,
            data: InferOnChainDataTypeFromGatedTransaction<GatedTx>,
        ) => Promise<void>
    >,
});

export type IGatedTransactionCache = z.infer<typeof gatedTransactionCacheSchema>;

/**
 * name-chain-uniqueIdKeys
 *
 * E.g., setDelegate-ethereum-oAppAddress:0xMY_OAPP
 */
export type GatedTransactionId = `${string}-${string}-${string}`;

/**
 * bundleName-chain-uniqueIdKeys
 *
 * E.g., SetPeer-ton-oAppAddress:0xMY_OAPP
 */
export type GatedTransactionBundleId = `${string}-${string}-${string}`;
