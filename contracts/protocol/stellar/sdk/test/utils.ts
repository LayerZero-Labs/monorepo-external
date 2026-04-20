import { keccak_256 } from '@noble/hashes/sha3';
import {
    Account,
    Address,
    authorizeEntry,
    BASE_FEE,
    Contract,
    contract,
    hash,
    Keypair,
    nativeToScVal,
    scValToNative,
    TransactionBuilder,
    xdr,
} from '@stellar/stellar-sdk';
import * as rpc from '@stellar/stellar-sdk/rpc';

import {
    DEFAULT_DEPLOYER,
    NATIVE_TOKEN_ADDRESS,
    NETWORK_PASSPHRASE,
    RPC_URL,
} from './suites/constants';

// ============================================================================
// Client Factory Helper
// ============================================================================

/**
 * Helper to create a Soroban contract client with DEFAULT_DEPLOYER as signer.
 * This is used to create clients for protocol contracts from their addresses.
 */
export function createClient<T>(
    ClientClass: new (options: {
        contractId: string;
        publicKey: string;
        signTransaction: (tx: string) => Promise<{ signedTxXdr: string; signerAddress: string }>;
        rpcUrl: string;
        networkPassphrase: string;
        allowHttp: boolean;
    }) => T,
    contractId: string,
): T {
    return new ClientClass({
        contractId,
        publicKey: DEFAULT_DEPLOYER.publicKey(),
        signTransaction: async (tx: string) => {
            const transaction = TransactionBuilder.fromXDR(tx, NETWORK_PASSPHRASE);
            transaction.sign(DEFAULT_DEPLOYER);
            return {
                signedTxXdr: transaction.toXDR(),
                signerAddress: DEFAULT_DEPLOYER.publicKey(),
            };
        },
        rpcUrl: RPC_URL,
        networkPassphrase: NETWORK_PASSPHRASE,
        allowHttp: true,
    });
}

// ============================================================================
// Token Balance Helpers
// ============================================================================

/**
 * Helper to get token balance for an address using SAC (Stellar Asset Contract).
 * Works for any token including native XLM.
 *
 * @param tokenAddress - The SAC contract address (defaults to native XLM)
 * @param accountAddress - The account to check balance for
 */
export async function getTokenBalance(
    accountAddress: string,
    tokenAddress: string = NATIVE_TOKEN_ADDRESS,
): Promise<bigint> {
    const server = new rpc.Server(RPC_URL, { allowHttp: true });
    const tokenContract = new Contract(tokenAddress);

    // Build the balance call
    const balanceOp = tokenContract.call(
        'balance',
        nativeToScVal(Address.fromString(accountAddress), { type: 'address' }),
    );

    const account = await server.getAccount(DEFAULT_DEPLOYER.publicKey());
    const tx = new TransactionBuilder(account, {
        fee: BASE_FEE,
        networkPassphrase: NETWORK_PASSPHRASE,
    })
        .addOperation(balanceOp)
        .setTimeout(30)
        .build();

    const simulated = await server.simulateTransaction(tx);
    if (rpc.Api.isSimulationError(simulated)) {
        throw new Error(`Balance query failed: ${JSON.stringify(simulated)}`);
    }

    // Extract result from simulation
    const result = (simulated as rpc.Api.SimulateTransactionSuccessResponse).result;
    if (result?.retval) {
        return scValToNative(result.retval) as bigint;
    }
    return 0n;
}

/**
 * Helper to get native token (XLM) balance for an address.
 * Convenience wrapper around getTokenBalance.
 */
export async function getNativeBalance(accountAddress: string): Promise<bigint> {
    return getTokenBalance(accountAddress, NATIVE_TOKEN_ADDRESS);
}

/**
 * Helper to check if an account is authorized on a SAC (Stellar Asset Contract).
 * Calls the SAC's `authorized()` method directly.
 *
 * @param accountAddress - The account to check authorization for
 * @param tokenAddress - The SAC contract address
 */
export async function getTokenAuthorized(
    accountAddress: string,
    tokenAddress: string,
): Promise<boolean> {
    const server = new rpc.Server(RPC_URL, { allowHttp: true });
    const tokenContract = new Contract(tokenAddress);

    const authorizedOp = tokenContract.call(
        'authorized',
        nativeToScVal(Address.fromString(accountAddress), { type: 'address' }),
    );

    const account = await server.getAccount(DEFAULT_DEPLOYER.publicKey());
    const tx = new TransactionBuilder(account, {
        fee: BASE_FEE,
        networkPassphrase: NETWORK_PASSPHRASE,
    })
        .addOperation(authorizedOp)
        .setTimeout(30)
        .build();

    const simulated = await server.simulateTransaction(tx);
    if (rpc.Api.isSimulationError(simulated)) {
        throw new Error(`Authorized query failed: ${JSON.stringify(simulated)}`);
    }

    const result = (simulated as rpc.Api.SimulateTransactionSuccessResponse).result;
    if (result?.retval) {
        return scValToNative(result.retval) as boolean;
    }
    return false;
}

import { Secp256k1KeyPair } from './secp256k1';

// ============================================================================
// DVN Abstract Account Auth Signing
// ============================================================================

/**
 * Signs the DVN abstract account's auth entries.
 *
 * The DVN contract implements CustomAccountInterface with Signature = TransactionAuthData.
 * TransactionAuthData contains:
 * - vid: u32 - Verifier ID
 * - expiration: u64 - Ledger timestamp for when auth expires
 * - signatures: Vec<BytesN<65>> - Secp256k1 signatures from multisig signers
 * - sender: Sender - Either None or Admin(public_key, ed25519_signature)
 */
export async function signDvnAuthEntries<T>(
    dvnAddress: string,
    vid: number,
    adminKeypair: Keypair,
    multisigSigners: Secp256k1KeyPair[],
    assembledTx: contract.AssembledTransaction<T>,
    networkPassphrase: string,
): Promise<void> {
    const dvnAddr = Address.fromString(dvnAddress);

    console.log('\n🔄 Simulating DVN transaction to get the auth entries');
    await assembledTx.simulate();

    // Print debug info
    let remaining = assembledTx.needsNonInvokerSigningBy({ includeAlreadySigned: false });
    console.log('\n📋 Addresses needing to sign:', remaining);

    const networkId = hash(Buffer.from(networkPassphrase));

    // Custom authorizer for DVN abstract account
    const customAuthorizeEntry = async (
        entry: xdr.SorobanAuthorizationEntry,
        _signer: Keypair | ((preimage: xdr.HashIdPreimage) => Promise<unknown>),
        validUntilLedgerSeq: number,
        _passphrase?: string,
    ): Promise<xdr.SorobanAuthorizationEntry> => {
        const credentials = entry.credentials();
        if (credentials.switch() !== xdr.SorobanCredentialsType.sorobanCredentialsAddress()) {
            throw new Error('Expected address credentials');
        }

        const addressCred = credentials.address();
        const credentialAddress = Address.fromScAddress(addressCred.address());
        const rootInvocation = entry.rootInvocation();

        if (credentialAddress.toString() !== dvnAddr.toString()) {
            throw new Error('Credential address mismatch');
        }

        // Log the DVN's auth entry tree
        console.log('\n🌳 DVN Auth Entry Tree:');
        logInvocationTree(rootInvocation, 0);

        // 1. Compute the signature_payload (soroban authorization hash)
        const preimage = xdr.HashIdPreimage.envelopeTypeSorobanAuthorization(
            new xdr.HashIdPreimageSorobanAuthorization({
                networkId,
                nonce: addressCred.nonce(),
                signatureExpirationLedger: validUntilLedgerSeq,
                invocation: rootInvocation,
            }),
        );
        const signaturePayload = hash(preimage.toXDR());
        console.log(
            '\n📝 Signature payload (soroban auth hash):',
            signaturePayload.toString('hex'),
        );

        // 2. Sign the signature_payload with admin's Ed25519 key
        const adminSignature = adminKeypair.sign(signaturePayload);
        console.log(
            '✍️ Admin Ed25519 signature created:',
            adminSignature.toString('hex').slice(0, 32) + '...',
        );

        // 3. Extract calls from the auth entry and compute the multisig hash
        // The expiration is the ledger timestamp when the auth expires
        // We use validUntilLedgerSeq * 5 as a rough approximation (5 seconds per ledger)
        const expiration = BigInt(validUntilLedgerSeq) * 5n + BigInt(Math.floor(Date.now() / 1000));
        const rootCall = getRootCall(rootInvocation);
        const isSelfCall = rootCall.to === dvnAddr.toString();
        const calls = isSelfCall ? [rootCall] : collectCallsFromInvocation(rootInvocation);
        const callsXdr = serializeCallsToXdr(calls);
        const callHash = computeCallHash(vid, expiration, callsXdr);
        console.log('📝 Call hash for multisig:', Buffer.from(callHash).toString('hex'));

        // 4. Sign the call hash with multisig signers
        const signatures: Buffer[] = [];
        for (const signer of multisigSigners) {
            const sig = await signer.sign(callHash);
            signatures.push(sig);
            console.log('✍️ Multisig signature created:', sig.toString('hex').slice(0, 32) + '...');
        }

        // 5. Sort signatures by recovered signer address (ascending)
        // This is required by the DVN contract's verify_signatures function
        const signaturesWithAddresses = await Promise.all(
            signatures.map(async (sig, i) => ({
                sig,
                address: multisigSigners[i].ethAddress,
            })),
        );
        signaturesWithAddresses.sort((a, b) => a.address.compare(b.address));
        const sortedSignatures = signaturesWithAddresses.map((s) => s.sig);

        // 6. Build TransactionAuthData as ScVal
        // struct TransactionAuthData { vid: u32, expiration: u64, signatures: Vec<BytesN<65>>, sender: Sender }
        // enum Sender { None, Admin(BytesN<32>, BytesN<64>) }
        const transactionAuthDataScVal = xdr.ScVal.scvMap([
            new xdr.ScMapEntry({
                key: xdr.ScVal.scvSymbol('expiration'),
                val: xdr.ScVal.scvU64(new xdr.Uint64(expiration)),
            }),
            new xdr.ScMapEntry({
                key: xdr.ScVal.scvSymbol('sender'),
                // Sender::Admin(public_key, signature)
                val: xdr.ScVal.scvVec([
                    xdr.ScVal.scvSymbol('Admin'),
                    xdr.ScVal.scvBytes(adminKeypair.rawPublicKey()),
                    xdr.ScVal.scvBytes(adminSignature),
                ]),
            }),
            new xdr.ScMapEntry({
                key: xdr.ScVal.scvSymbol('signatures'),
                val: xdr.ScVal.scvVec(sortedSignatures.map((sig) => xdr.ScVal.scvBytes(sig))),
            }),
            new xdr.ScMapEntry({
                key: xdr.ScVal.scvSymbol('vid'),
                val: xdr.ScVal.scvU32(vid),
            }),
        ]);

        // Return DVN's auth entry with TransactionAuthData
        const newCred = new xdr.SorobanAddressCredentials({
            address: addressCred.address(),
            nonce: addressCred.nonce(),
            signatureExpirationLedger: validUntilLedgerSeq,
            signature: transactionAuthDataScVal,
        });

        return new xdr.SorobanAuthorizationEntry({
            credentials: xdr.SorobanCredentials.sorobanCredentialsAddress(newCred),
            rootInvocation,
        });
    };

    // Check if the DVN needs to sign
    if (remaining.includes(dvnAddr.toString())) {
        await assembledTx.signAuthEntries({
            address: dvnAddr.toString(),
            authorizeEntry: customAuthorizeEntry,
        });

        console.log('\n🔄 DVN auth signed');

        remaining = assembledTx.needsNonInvokerSigningBy({
            includeAlreadySigned: false,
        });
        console.log('📋 Remaining signers after DVN:', remaining);
    }

    // Final re-simulation
    console.log('\n🔄 Final re-simulation with DVN auth entries signed');
    await assembledTx.simulate();
    console.log('✅ Final simulation complete');
}

/**
 * Represents a contract call for multisig authorization.
 */
interface Call {
    to: string; // Contract address
    func: string; // Function name
    args: xdr.ScVal[]; // Function arguments
}

/**
 * Extracts only the root call from an invocation (no recursion into sub-invocations).
 */
function getRootCall(invocation: xdr.SorobanAuthorizedInvocation): Call {
    const fn = invocation.function();
    if (
        fn.switch() !== xdr.SorobanAuthorizedFunctionType.sorobanAuthorizedFunctionTypeContractFn()
    ) {
        throw new Error('Root invocation is not a contract function');
    }
    const contractFn = fn.contractFn();
    return {
        to: Address.fromScAddress(contractFn.contractAddress()).toString(),
        func: contractFn.functionName().toString(),
        args: contractFn.args(),
    };
}

/**
 * Collects all contract calls from an invocation tree.
 */
function collectCallsFromInvocation(invocation: xdr.SorobanAuthorizedInvocation): Call[] {
    const calls: Call[] = [];
    collectCallsRecursive(invocation, calls);
    return calls;
}

function collectCallsRecursive(invocation: xdr.SorobanAuthorizedInvocation, calls: Call[]): void {
    const fn = invocation.function();

    if (
        fn.switch() === xdr.SorobanAuthorizedFunctionType.sorobanAuthorizedFunctionTypeContractFn()
    ) {
        const contractFn = fn.contractFn();
        const contractAddr = Address.fromScAddress(contractFn.contractAddress());

        calls.push({
            to: contractAddr.toString(),
            func: contractFn.functionName().toString(),
            args: contractFn.args(),
        });
    }

    // Process sub-invocations
    for (const sub of invocation.subInvocations()) {
        collectCallsRecursive(sub, calls);
    }
}

/**
 * Serializes calls to XDR format matching Soroban's Vec<Call> serialization.
 *
 * Call struct: { args: Vec<Val>, func: Symbol, to: Address }
 * Serialized as ScMap with keys in alphabetical order.
 */
function serializeCallsToXdr(calls: Call[]): Buffer {
    const callScVals = calls.map((call) =>
        xdr.ScVal.scvMap([
            new xdr.ScMapEntry({
                key: xdr.ScVal.scvSymbol('args'),
                val: xdr.ScVal.scvVec(call.args),
            }),
            new xdr.ScMapEntry({
                key: xdr.ScVal.scvSymbol('func'),
                val: xdr.ScVal.scvSymbol(call.func),
            }),
            new xdr.ScMapEntry({
                key: xdr.ScVal.scvSymbol('to'),
                val: Address.fromString(call.to).toScVal(),
            }),
        ]),
    );

    const vecScVal = xdr.ScVal.scvVec(callScVals);
    return Buffer.from(vecScVal.toXDR());
}

/**
 * Computes the call hash for multisig signing.
 * hash = keccak256(vid.to_be_bytes(4) || expiration.to_be_bytes(8) || calls_xdr)
 */
function computeCallHash(vid: number, expiration: bigint, callsXdr: Buffer): Uint8Array {
    // vid as 4-byte big-endian
    const vidBytes = Buffer.alloc(4);
    vidBytes.writeUInt32BE(vid, 0);

    // expiration as 8-byte big-endian
    const expirationBytes = Buffer.alloc(8);
    expirationBytes.writeBigUInt64BE(expiration, 0);

    // Concatenate and hash
    const data = Buffer.concat([vidBytes, expirationBytes, callsXdr]);
    return keccak_256(data);
}

// ============================================================================
// Executor Abstract Account Auth Signing (with Non-Root Auth Support)
// ============================================================================

/**
 * Signs and sends a transaction with Executor abstract account auth entries.
 *
 * The Executor contract implements CustomAccountInterface with Signature = ExecutorSignature.
 * ExecutorSignature contains:
 * - public_key: BytesN<32> - Admin's Ed25519 public key
 * - signature: BytesN<64> - Ed25519 signature over the signature_payload
 *
 * This function uses `record_allow_nonroot` simulation mode to capture non-root auth entries,
 * which is required because the executor authorizes `lz_receive`/`lz_compose` calls that are
 * invoked by the ExecutorHelper contract (not the root invoker).
 *
 * @returns The transaction result after sending
 */
export async function signAndSendWithExecutorAuth<T>(
    executorAddress: string,
    adminKeypair: Keypair,
    assembledTx: contract.AssembledTransaction<T>,
    networkPassphrase: string,
): Promise<rpc.Api.GetSuccessfulTransactionResponse> {
    const executorAddr = Address.fromString(executorAddress);
    const server = new rpc.Server(RPC_URL, { allowHttp: true });

    console.log('\n🔄 Building transaction for non-root auth...');

    // 1. Build the raw transaction (don't simulate yet)
    const rawTx = assembledTx.raw!.build();

    // 2. Simulate with record_allow_nonroot to capture non-root auth entries
    // This is required because the executor's auth is not the root invocation
    console.log('🔄 Simulating with record_allow_nonroot...');
    const sim = await server.simulateTransaction(
        rawTx,
        undefined, // addlResources
        'record_allow_nonroot', // ← This enables non-root auth recording!
    );

    if (rpc.Api.isSimulationError(sim)) {
        throw new Error(`Simulation failed: ${JSON.stringify(sim)}`);
    }

    console.log('✅ Simulation complete');
    console.log('   Auth entries returned:', sim.result?.auth?.length ?? 0);

    // 3. Sign auth entries
    const latestLedger = sim.latestLedger;
    const validUntilLedger = latestLedger + 100;
    const networkId = hash(Buffer.from(networkPassphrase));

    if (sim.result && sim.result.auth) {
        sim.result.auth = await Promise.all(
            sim.result.auth.map(async (entry) => {
                const credentials = entry.credentials();

                // Source account credentials are already signed by tx envelope
                if (
                    credentials.switch() ===
                    xdr.SorobanCredentialsType.sorobanCredentialsSourceAccount()
                ) {
                    console.log('   Skipping source account auth entry');
                    return entry;
                }

                // Address credentials need explicit signature
                const addressCred = credentials.address();
                const addr = Address.fromScAddress(addressCred.address()).toString();
                const rootInvocation = entry.rootInvocation();

                console.log('   Processing auth entry for address:', addr);
                console.log('   Auth entry tree:');
                logInvocationTree(rootInvocation, 2);

                // Check if this is the executor's auth entry (Abstract Account)
                if (addr === executorAddr.toString()) {
                    console.log('   ✍️ Signing executor auth entry (Abstract Account)...');

                    // Compute the signature_payload hash
                    const preimage = xdr.HashIdPreimage.envelopeTypeSorobanAuthorization(
                        new xdr.HashIdPreimageSorobanAuthorization({
                            networkId,
                            nonce: addressCred.nonce(),
                            signatureExpirationLedger: validUntilLedger,
                            invocation: rootInvocation,
                        }),
                    );
                    const signaturePayload = hash(preimage.toXDR());

                    // Sign the signature_payload with admin's Ed25519 key
                    const adminSignature = adminKeypair.sign(signaturePayload);

                    // Build ExecutorSignature struct as ScVal
                    // struct ExecutorSignature { public_key: BytesN<32>, signature: BytesN<64> }
                    const executorSignatureScVal = xdr.ScVal.scvMap([
                        new xdr.ScMapEntry({
                            key: xdr.ScVal.scvSymbol('public_key'),
                            val: xdr.ScVal.scvBytes(adminKeypair.rawPublicKey()),
                        }),
                        new xdr.ScMapEntry({
                            key: xdr.ScVal.scvSymbol('signature'),
                            val: xdr.ScVal.scvBytes(adminSignature),
                        }),
                    ]);

                    // Return executor's auth entry with ExecutorSignature
                    const newCred = new xdr.SorobanAddressCredentials({
                        address: addressCred.address(),
                        nonce: addressCred.nonce(),
                        signatureExpirationLedger: validUntilLedger,
                        signature: executorSignatureScVal,
                    });

                    return new xdr.SorobanAuthorizationEntry({
                        credentials: xdr.SorobanCredentials.sorobanCredentialsAddress(newCred),
                        rootInvocation,
                    });
                }

                // Check if this is the admin's auth entry (regular Stellar account)
                // This happens when admin needs to authorize token transfers (e.g., native_drop, value transfers)
                if (addr === adminKeypair.publicKey()) {
                    console.log('   ✍️ Signing admin auth entry (regular account)...');
                    return authorizeEntry(entry, adminKeypair, validUntilLedger, networkPassphrase);
                }

                throw new Error(`Unexpected auth signer needed: ${addr}`);
            }),
        );
        console.log('✅ Auth entries signed');
    }

    // 4. Assemble transaction with signed auth entries
    const txWithSignedAuth = rpc.assembleTransaction(rawTx, sim).build();

    console.log('✅ Transaction assembled with signed auth entries');

    // 5. Re-simulate to get correct footprint (includes __check_auth storage accesses)
    const finalSim = await server.simulateTransaction(txWithSignedAuth);
    if (rpc.Api.isSimulationError(finalSim)) {
        throw new Error(`Final simulation failed: ${JSON.stringify(finalSim)}`);
    }

    console.log('✅ Final simulation completed');

    // 6. Assemble final transaction with accurate footprint
    const assembledFinalTx = rpc.assembleTransaction(txWithSignedAuth, finalSim).build();

    // 7. Rebuild the transaction with adminKeypair as the source account
    // The original transaction was built with DEFAULT_DEPLOYER as source,
    // but we want EXECUTOR_ADMIN to be the source so they can sign the envelope
    // Fetch the current sequence number for the admin account from the network
    const adminAccountInfo = await server.getAccount(adminKeypair.publicKey());
    const adminAccount = new Account(adminKeypair.publicKey(), adminAccountInfo.sequenceNumber());
    const finalTxBuilder = new TransactionBuilder(adminAccount, {
        fee: assembledFinalTx.fee,
        networkPassphrase,
    });

    // Get the transaction XDR to extract the operation and soroban data
    const txXdr = assembledFinalTx.toEnvelope().v1().tx();

    // Copy the Soroban invoke operation (there's only one operation in Soroban transactions)
    const operationXdr = txXdr.operations()[0];
    finalTxBuilder.addOperation(xdr.Operation.fromXDR(operationXdr.toXDR()));

    // Copy the Soroban transaction data (footprint, resources, etc.)
    const extSwitch = txXdr.ext().switch();
    if (extSwitch === 1) {
        // Has SorobanTransactionData
        finalTxBuilder.setSorobanData(txXdr.ext().sorobanData());
    }

    // Set timeout to match original
    finalTxBuilder.setTimeout(30);

    const finalTx = finalTxBuilder.build();

    // 8. Sign the transaction envelope
    finalTx.sign(adminKeypair);

    console.log('✅ Transaction envelope signed');

    // 9. Send and poll
    const sentResult = await server.sendTransaction(finalTx);

    if (sentResult.status !== 'PENDING') {
        throw new Error(`Transaction failed to send: ${JSON.stringify(sentResult)}`);
    }

    console.log('✅ Transaction sent, hash:', sentResult.hash);

    const txResult = await server.pollTransaction(sentResult.hash);

    if (txResult.status !== 'SUCCESS') {
        throw new Error(`Transaction failed: ${JSON.stringify(txResult)}`);
    }

    console.log('✅ Transaction completed successfully');

    return txResult as rpc.Api.GetSuccessfulTransactionResponse;
}

/**
 * Logs the invocation tree for debugging auth entries.
 */
function logInvocationTree(invocation: xdr.SorobanAuthorizedInvocation, depth: number): void {
    const indent = '  '.repeat(depth);
    const fn = invocation.function();

    if (
        fn.switch() === xdr.SorobanAuthorizedFunctionType.sorobanAuthorizedFunctionTypeContractFn()
    ) {
        const contractFn = fn.contractFn();
        const contractAddr = Address.fromScAddress(contractFn.contractAddress());
        const fnName = contractFn.functionName().toString();

        console.log(`${indent}📞 ${contractAddr.toString()}...${fnName}()`);
    } else {
        console.log(`${indent}🔧 CreateContractHostFn`);
    }

    // Log sub-invocations
    const subInvocations = invocation.subInvocations();
    for (const sub of subInvocations) {
        logInvocationTree(sub, depth + 1);
    }
}

export function assertTransactionSucceeded(
    txResult: rpc.Api.GetTransactionResponse,
    contextLabel: string,
): void {
    if (txResult.status !== rpc.Api.GetTransactionStatus.SUCCESS) {
        throw new Error(
            `Transaction ${contextLabel} failed with status ${txResult.status}. Response: ${JSON.stringify(txResult)}`,
        );
    }
}
