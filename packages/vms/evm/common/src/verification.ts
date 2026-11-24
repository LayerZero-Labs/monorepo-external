import type { Abi } from 'viem';

import {
    buildTransactionWithResultSchema,
    type TransactionWithResult,
} from '@layerzerolabs/common-chain-model';
import type { ChainName } from '@layerzerolabs/layerzero-definitions';
import { ChainType } from '@layerzerolabs/layerzero-definitions';
import { isZkChain } from '@layerzerolabs/static-chain-info';

import type { EvmArtifact } from './artifact';
import { deriveEvmConstructorArgs, deriveZkSyncConstructorArgs } from './encoding';
import { evmTransactionSchema } from './transaction';

// TODO: Make buildInfo and sourceName required on EvmArtifact (they are always present for compiled-in-repo contracts).

const parseEvmTransaction = (submittedTransaction: TransactionWithResult) =>
    buildTransactionWithResultSchema(evmTransactionSchema).parse(submittedTransaction);

/**
 * Derives a complete EVM verification artifact from a submitted transaction and a contract artifact.
 * If the artifact includes flattenedSol (Tron), it is included in the result.
 */
export const deriveEvmVerificationArtifact = (
    submittedTransaction: TransactionWithResult,
    artifact: EvmArtifact<Abi>,
) => {
    const evmTransaction = parseEvmTransaction(submittedTransaction);

    // TODO: flattenedSol will be present on all artifacts (EVM and Tron) once the generator
    // is updated — then this conditional can become a direct field access.
    const flattenedSolSourceBase64 = artifact.flattenedSol?.flattenedSolSourceBase64;

    return {
        kind: ChainType.EVM as const,
        buildInfo: artifact.buildInfo,
        creationBytecode: artifact.bytecode,
        deployedBytecode: artifact.deployedBytecode,
        fullyQualifiedContractName: `${artifact.sourceName}:${artifact.contractName}`,
        flattenedSolSourceBase64,
        abi: artifact.abi,
        constructorArgs: deriveEvmConstructorArgs({
            txData: evmTransaction.populatedTransaction.data,
            creationBytecode: artifact.bytecode,
            abi: artifact.abi,
        }),
    };
};

/**
 * Derives a complete zkSync verification artifact from a submitted transaction and a contract artifact.
 * Uses zkSync-specific constructor arg derivation (decodes from ContractDeployer.create call).
 */
export const deriveZkSyncVerificationArtifact = (
    submittedTransaction: TransactionWithResult,
    artifact: EvmArtifact<Abi>,
) => {
    const evmTransaction = parseEvmTransaction(submittedTransaction);
    const flattenedSolSourceBase64 = artifact.flattenedSol?.flattenedSolSourceBase64;

    return {
        kind: ChainType.EVM as const,
        buildInfo: artifact.buildInfo,
        creationBytecode: artifact.bytecode,
        deployedBytecode: artifact.deployedBytecode,
        fullyQualifiedContractName: `${artifact.sourceName}:${artifact.contractName}`,
        flattenedSolSourceBase64,
        abi: artifact.abi,
        constructorArgs: deriveZkSyncConstructorArgs({
            txData: evmTransaction.populatedTransaction.data,
            abi: artifact.abi,
        }),
    };
};

/**
 * Unified verification artifact derivation that selects the correct constructor-arg decoding
 * strategy (standard EVM vs zkSync `ContractDeployer.create`) based on `chainName`.
 *
 * TODO: this shouldn't be part of `common-evm` package since it leaks LZ-specific `ChainName`
 * to non-LZ-specific consumers.
 */
export const deriveVerificationArtifact = (
    chainName: ChainName,
    submittedTransaction: TransactionWithResult,
    artifact: EvmArtifact<Abi>,
) =>
    isZkChain(chainName)
        ? deriveZkSyncVerificationArtifact(submittedTransaction, artifact)
        : deriveEvmVerificationArtifact(submittedTransaction, artifact);
