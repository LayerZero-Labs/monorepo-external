/**
 * Shared OneSig execution helpers.
 *
 * These build and submit a Soroban transaction that invokes the OneSig contract
 * as a custom account: they attach the `TransactionAuthData` (merkle root, proof,
 * threshold signatures, sender) as the contract's auth-entry signature and send it.
 *
 * Two entry points:
 * - `signAndSendOnesigTx` — the low-level path. Caller supplies the already-built
 *   merkle package (root/proof/signatures) plus the matching assembled transaction.
 *   This mirrors the real off-chain workflow: calls are known up front, the leaf is
 *   built and signed off-chain, then executed with the proof.
 * - `executeOnesigTx` — a test convenience that simulates the assembled transaction,
 *   reverse-engineers the leaf `Call` from the resulting auth entry, builds the merkle
 *   package for it, then delegates to `signAndSendOnesigTx`.
 */
import { Address, contract, hash, Keypair, xdr } from '@stellar/stellar-sdk';
import { Wallet } from 'ethers';

import { signSignerExecutionAuthorization } from '@layerzerolabs/onesig-core';

import { Client, StellarCall } from '../src/index';
import { buildSingleTxMerkleData, IntegrationTestContext, OneSigMerkleData, RPC_URL } from './utils';

export type ClientWithSpec = Client & { spec: contract.Spec };

/**
 * Build an AssembledTransaction directly from a {@link StellarCall} — no typed client
 * binding required. This mirrors the production off-chain path: the very same
 * StellarCall that produced the signed leaf is replayed as the on-chain invocation,
 * so the tx's auth-entry root invocation matches the leaf by construction.
 */
export function buildCallTransaction(
    context: IntegrationTestContext,
    stellarCall: StellarCall,
): Promise<contract.AssembledTransaction<unknown>> {
    return contract.AssembledTransaction.build<unknown>({
        method: stellarCall.functionName,
        args: stellarCall.args,
        contractId: stellarCall.contractAddress,
        networkPassphrase: context.networkPassphrase,
        rpcUrl: RPC_URL,
        allowHttp: true,
        publicKey: context.deployerKeypair.publicKey(),
        ...contract.basicNodeSigner(context.deployerKeypair, context.networkPassphrase),
        parseResultXdr: () => undefined,
    });
}

const transactionAuthTypeCache = new WeakMap<contract.Spec, xdr.ScSpecTypeDef>();

export function getTransactionAuthType(spec: contract.Spec): xdr.ScSpecTypeDef {
    const cached = transactionAuthTypeCache.get(spec);
    if (cached) {
        return cached;
    }

    for (const entry of spec.entries) {
        if (entry.switch().value === xdr.ScSpecEntryKind.scSpecEntryUdtStructV0().value) {
            const udt = entry.udtStructV0();
            if (udt.name().toString() === 'TransactionAuthData') {
                const type = xdr.ScSpecTypeDef.scSpecTypeUdt(
                    new xdr.ScSpecTypeUdt({ name: udt.name() }),
                );
                transactionAuthTypeCache.set(spec, type);
                return type;
            }
        }
    }

    throw new Error('TransactionAuthData type not found in contract spec');
}

export function buildAuthorizationPreimage(
    addressCred: xdr.SorobanAddressCredentials,
    rootInvocation: xdr.SorobanAuthorizedInvocation,
    validUntilLedgerSeq: number,
    networkPassphrase: string,
): xdr.HashIdPreimage {
    const networkId = hash(Buffer.from(networkPassphrase));
    return xdr.HashIdPreimage.envelopeTypeSorobanAuthorization(
        new xdr.HashIdPreimageSorobanAuthorization({
            networkId,
            nonce: addressCred.nonce(),
            signatureExpirationLedger: validUntilLedgerSeq,
            invocation: rootInvocation,
        }),
    );
}

export function hashAuthorizationPreimage(preimage: xdr.HashIdPreimage): Buffer {
    return hash(preimage.toXDR());
}

export type MerklePackage = {
    merkleData: OneSigMerkleData;
    proof: Buffer[];
};

export type MerkleOverride = {
    merkleData?: Partial<OneSigMerkleData>;
    proof?: Buffer[];
};

export type TransactionAuthOptions = {
    senderType?: 'executor' | 'permissionless' | 'signer';
    signerWallet?: Wallet;
    /**
     * For `senderType: 'signer'` — the ed25519 keypair acting as `delegate` in
     * the signer-as-executor spec. Defaults to the context's deployer keypair,
     * which is the Stellar account actually submitting the transaction.
     */
    delegateKeypair?: Keypair;
    /**
     * Override the proof `expiry` (seconds since epoch) the signer signs over.
     * Defaults to `now + 600s`. Use to exercise expired-proof rejection.
     */
    expiryOverride?: bigint;
};

export type ExecuteCallOptions = TransactionAuthOptions & {
    signerCount?: number;
    executorKeypair?: Keypair;
    nonce?: bigint;
    customMerkleData?: MerklePackage;
    merkleDataOverride?: (
        data: MerklePackage,
    ) => MerkleOverride | void | Promise<MerkleOverride | void>;
    skipResimulate?: boolean;
};

export type SenderConfig = TransactionAuthOptions & {
    executorKeypair?: Keypair;
};

/**
 * Extracts the root-level contract call from a simulation auth entry, mapping it
 * back to a {@link StellarCall} (the leaf the OneSig contract will authorize).
 */
export function authEntryToRootCall(entry: xdr.SorobanAuthorizationEntry): StellarCall {
    const fn = entry.rootInvocation().function();
    if (
        fn.switch() !==
        xdr.SorobanAuthorizedFunctionType.sorobanAuthorizedFunctionTypeContractFn()
    ) {
        throw new Error('Root invocation is not a contract function');
    }
    const contractFn = fn.contractFn();
    return {
        contractAddress: Address.fromScAddress(contractFn.contractAddress()).toString(),
        functionName: contractFn.functionName().toString(),
        args: contractFn.args(),
    };
}

/**
 * Build the `sender` field of `TransactionAuthData` for the requested sender type.
 * The contract only verifies the sender when `executor_required` is true.
 */
async function buildSender(
    senderType: 'executor' | 'permissionless' | 'signer',
    senderConfig: SenderConfig,
    context: IntegrationTestContext,
    packageData: MerklePackage,
    payloadHash: Buffer,
) {
    switch (senderType) {
        case 'executor': {
            const keypair = senderConfig.executorKeypair;
            if (!keypair) {
                throw new Error('executorKeypair is required when senderType is executor');
            }
            return {
                tag: 'Executor' as const,
                values: [
                    Buffer.from(keypair.rawPublicKey()),
                    keypair.sign(Buffer.from(payloadHash)),
                ],
            };
        }
        case 'signer': {
            const signerWallet = senderConfig.signerWallet;
            if (!signerWallet) {
                throw new Error('signerWallet is required when senderType is set to signer');
            }
            // `delegate` is the ed25519 account actually submitting this Stellar
            // transaction. Defaults to the deployer keypair, which signs the outer
            // Stellar envelope in these tests.
            const delegateKeypair = senderConfig.delegateKeypair ?? context.deployerKeypair;
            const delegate = Buffer.from(delegateKeypair.rawPublicKey());
            const delegateProof = delegateKeypair.sign(Buffer.from(payloadHash));
            const expiry =
                senderConfig.expiryOverride ?? BigInt(Math.floor(Date.now() / 1000) + 600);
            const signature = (
                await signSignerExecutionAuthorization(signerWallet, {
                    leafHash: packageData.merkleData.leafHash,
                    merkleRoot: packageData.merkleData.merkleRoot,
                    delegate,
                    expiry,
                })
            ).get();
            return {
                tag: 'Signer' as const,
                values: [
                    {
                        signature,
                        expiry,
                        delegate,
                        delegate_proof: delegateProof,
                    },
                ],
            };
        }
        case 'permissionless':
            return { tag: 'Permissionless' as const, values: [] };
        default:
            throw new Error(`Unsupported sender type: ${senderType satisfies never}`);
    }
}

/**
 * Attaches the merkle package as the OneSig contract's account-abstraction signature
 * and submits the transaction. The assembled transaction must already invoke the call
 * covered by `packageData` (same leaf), otherwise the on-chain proof check will reject it.
 */
export async function signAndSendOnesigTx<T>(
    context: IntegrationTestContext,
    packageData: MerklePackage,
    assembledTx: contract.AssembledTransaction<T>,
    senderConfig: SenderConfig,
    skipResimulate = false,
): Promise<contract.SentTransaction<T>> {
    if (!assembledTx.built) {
        await assembledTx.simulate();
    }

    const oneSigAddress = Address.fromString(context.oneSigContractId);
    const oneSigAddressStr = oneSigAddress.toString();
    const remaining = assembledTx.needsNonInvokerSigningBy({ includeAlreadySigned: false });
    if (remaining.length !== 1 || remaining[0] !== oneSigAddressStr) {
        throw new Error('Invalid signer for transaction');
    }

    const senderType =
        senderConfig.senderType ??
        (senderConfig.executorKeypair ? ('executor' as const) : ('permissionless' as const));

    const oneSigSpec = (context.oneSigClient as ClientWithSpec).spec;
    const transactionAuthType = getTransactionAuthType(oneSigSpec);

    const customAuthorizeEntry = async (
        entry: xdr.SorobanAuthorizationEntry,
        _signer: Keypair | ((preimage: xdr.HashIdPreimage) => Promise<unknown>),
        validUntilLedgerSeq: number,
        networkPassphrase?: string,
    ) => {
        const credentials = entry.credentials();
        if (credentials.switch() !== xdr.SorobanCredentialsType.sorobanCredentialsAddress()) {
            throw new Error('Expected address credentials for Account Abstraction');
        }

        const addressCred = credentials.address();
        const credentialAddress = Address.fromScAddress(addressCred.address());
        if (credentialAddress.toString() !== oneSigAddressStr) {
            throw new Error('Credential address does not match oneSig address');
        }

        const payloadHash = hashAuthorizationPreimage(
            buildAuthorizationPreimage(
                addressCred,
                entry.rootInvocation(),
                validUntilLedgerSeq,
                networkPassphrase || context.networkPassphrase,
            ),
        );

        const sender = await buildSender(
            senderType,
            senderConfig,
            context,
            packageData,
            payloadHash,
        );

        const transactionAuthData = {
            merkle_root: packageData.merkleData.merkleRoot,
            expiry: packageData.merkleData.expiry,
            proof: packageData.proof,
            signatures: packageData.merkleData.signatures,
            sender,
        };

        const authDataScVal = oneSigSpec.nativeToScVal(transactionAuthData, transactionAuthType);

        const newAddressCred = new xdr.SorobanAddressCredentials({
            address: addressCred.address(),
            nonce: addressCred.nonce(),
            signatureExpirationLedger: validUntilLedgerSeq,
            signature: authDataScVal,
        });

        return new xdr.SorobanAuthorizationEntry({
            credentials: xdr.SorobanCredentials.sorobanCredentialsAddress(newAddressCred),
            rootInvocation: entry.rootInvocation(),
        });
    };

    await assembledTx.signAuthEntries({
        address: oneSigAddressStr,
        authorizeEntry: customAuthorizeEntry,
    });

    try {
        await assembledTx.simulate({ restore: true });
    } catch (e) {
        // negative-path tests pass skipResimulate to tolerate simulation errors
        if (!skipResimulate) throw e;
    }

    return assembledTx.signAndSend({ force: true });
}

/**
 * Test convenience: simulate the assembled transaction, derive the leaf `Call` from
 * the resulting OneSig auth entry, build the merkle package, then sign and send.
 *
 * Prefer `signAndSendOnesigTx` directly when you already know the calls up front and
 * want to mirror the production off-chain workflow.
 */
export async function executeOnesigTx<T>(
    context: IntegrationTestContext,
    assembledTx: contract.AssembledTransaction<T>,
    options: ExecuteCallOptions = {},
): Promise<contract.SentTransaction<T>> {
    if (!assembledTx.simulation) {
        await assembledTx.simulate();
    }

    const simulation = assembledTx.simulation;
    const simulationResult =
        (simulation as { result?: { auth?: xdr.SorobanAuthorizationEntry[] } } | undefined)
            ?.result ?? assembledTx.simulationData?.result;
    if (!simulationResult) {
        throw new Error('Simulation failed');
    }

    const authEntries = simulationResult.auth ?? [];
    // The OneSig contract is the sole authorizer: it invokes every external call
    // directly and pre-authorizes nested calls as itself. So exactly one auth entry
    // should be addressed to the OneSig contract — mirroring the on-chain invariant
    // `auth_contexts.len() == 1` in extract_single_self_call. Select by credential
    // address rather than position, since the simulator can surface entries for other
    // addresses too (see simulateSubInvocations).
    const oneSigEntries = authEntries.filter((entry) => {
        const credentials = entry.credentials();
        return (
            credentials.switch() === xdr.SorobanCredentialsType.sorobanCredentialsAddress() &&
            Address.fromScAddress(credentials.address().address()).toString() ===
                context.oneSigContractId
        );
    });
    if (oneSigEntries.length !== 1) {
        throw new Error(
            `Expected exactly one OneSig auth entry, got ${oneSigEntries.length} ` +
                `(of ${authEntries.length} total auth entries)`,
        );
    }

    const rootCall = authEntryToRootCall(oneSigEntries[0]);
    const signerCount = options.signerCount ?? context.threshold;

    const defaultPackage =
        options.customMerkleData ??
        (await buildSingleTxMerkleData(context, signerCount, rootCall, options.nonce));

    let mergedPackage: MerklePackage = {
        merkleData: { ...defaultPackage.merkleData },
        proof: [...defaultPackage.proof],
    };

    if (options.merkleDataOverride) {
        const override = await options.merkleDataOverride(mergedPackage);
        if (override) {
            mergedPackage = {
                merkleData: {
                    ...mergedPackage.merkleData,
                    ...(override.merkleData ?? {}),
                },
                proof: override.proof ?? mergedPackage.proof,
            };
        }
    }

    const senderConfig: SenderConfig = {
        senderType: options.senderType,
        signerWallet: options.signerWallet,
        executorKeypair: options.executorKeypair,
        delegateKeypair: options.delegateKeypair,
        expiryOverride: options.expiryOverride,
    };

    return signAndSendOnesigTx(
        context,
        mergedPackage,
        assembledTx,
        senderConfig,
        options.skipResimulate ?? false,
    );
}
