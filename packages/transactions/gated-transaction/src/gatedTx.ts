import type { Transaction } from '@layerzerolabs/common-chain-model';
import type { FunctionPointer } from '@layerzerolabs/function-pointer';

import type {
    BaseGatedTransaction,
    FunctionalGatedTransaction,
    GatedTransaction,
    GatedTransactionArtifacts,
    GatedTransactionBundleId,
    GatedTransactionCheck,
    GatedTransactionDependencies,
    GatedTransactionId,
    GatedTransactionPermission,
    LiteralGatedTransaction,
    ResolvedGatedTransaction,
} from './schemata';

/**
 * Builds a {@link GatedTransaction}
 */
export const constructGatedTransaction = <
    const Name extends string,
    TxType extends Transaction,
    CheckOutput extends Promise<any>,
    const _Dependencies extends GatedTransactionDependencies,
    Artifacts extends GatedTransactionArtifacts = GatedTransactionArtifacts,
>(gtx: {
    name: Name;
    description?: string;
    chainName: string;
    bundleName?: string;
    artifacts?: Artifacts;
    check: GatedTransactionCheck<CheckOutput, _Dependencies>;
    hasPermission?: GatedTransactionPermission;
    uniqueIdKeys?: Record<string, string | number | boolean>;
    cacheable?: boolean;
    dependencies?: _Dependencies;
    orderingDependencies?: GatedTransactionDependencies;
    completionDependencies?: GatedTransactionDependencies;
    transaction: TxType;
}): LiteralGatedTransaction<Name, TxType, CheckOutput, _Dependencies, Artifacts> => {
    const dependencies = gtx.dependencies ?? ([] as any);
    return { ...gtx, transactionType: 'literal', dependencies };
};

export type BuildDeps<Params extends GatedTransaction[]> = Params extends []
    ? []
    : Params extends readonly [
            infer Gtx extends GatedTransaction,
            ...infer Rest extends GatedTransaction[],
        ]
      ? [ResolvedGatedTransaction<Gtx>, ...BuildDeps<[...Rest]>]
      : Params extends Array<GatedTransaction>
        ? unknown[]
        : never;

/**
 * Builds a {@link GatedTransaction} from a pointer
 */
export const constructGatedTransactionFromPointer = <
    const Name extends string,
    TxType extends Transaction,
    CheckOutput extends Promise<any>,
    DepInput extends [...args: any[], txs: any],
    const _Dependencies extends GatedTransactionDependencies,
    Artifacts extends GatedTransactionArtifacts = GatedTransactionArtifacts,
>(gtx: {
    name: Name;
    description?: string;
    chainName: string;
    bundleName?: string;
    artifacts?: Artifacts;
    check: GatedTransactionCheck<CheckOutput, _Dependencies>;
    hasPermission?: GatedTransactionPermission;
    uniqueIdKeys?: Record<string, string | number | boolean>;
    cacheable?: boolean;
    dependencies: _Dependencies;
    orderingDependencies?: GatedTransactionDependencies;
    completionDependencies?: GatedTransactionDependencies;
    getTransaction: {
        functionPointer: FunctionPointer<(...deps: DepInput) => Promise<TxType>>;
    };
}): FunctionalGatedTransaction<Name, TxType, CheckOutput, DepInput, _Dependencies, Artifacts> => {
    return {
        ...gtx,
        transactionType: 'functional',
    };
};

export const getIdForGatedTransaction = (gtx: BaseGatedTransaction): GatedTransactionId => {
    const serializedUniqueIdKeys = gtx.uniqueIdKeys
        ? Object.entries(gtx.uniqueIdKeys)
              .map(([k, v]) => `${k}:${v}`)
              .join('-')
        : '';

    return `${gtx.name}-${gtx.chainName}-${serializedUniqueIdKeys}`;
};

export const getBundleIdForGatedTransaction = (
    gtx: BaseGatedTransaction,
): GatedTransactionBundleId => {
    const serializedUniqueIdKeys = gtx.uniqueIdKeys
        ? Object.entries(gtx.uniqueIdKeys)
              .map(([k, v]) => `${k}:${v}`)
              .join('-')
        : '';

    return `${gtx.bundleName}-${gtx.chainName}-${serializedUniqueIdKeys}`;
};
