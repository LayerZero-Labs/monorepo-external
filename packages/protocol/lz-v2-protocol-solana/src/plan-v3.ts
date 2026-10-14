import {
    type Commitment,
    generateSigner,
    type Instruction,
    type KeypairSigner,
    type PublicKey,
    type RpcInterface,
} from '@metaplex-foundation/umi';
import {
    publicKey as publicKeySerializer,
    type Serializer,
} from '@metaplex-foundation/umi/serializers';
import { toWeb3JsPublicKey } from '@metaplex-foundation/umi-web3js-adapters';
import { address, createSolanaRpc, getBase64EncodedWireTransaction } from '@solana/kit';
import { PublicKey as Web3PublicKey, SystemProgram } from '@solana/web3.js';

import { EDDSA, ExecutorPDA } from './pda';
import { compileTransactionV1, type TransactionV1Budgets } from './transaction-v1';
import type { AccountMetaRefV3 } from './types-v3';
import { instructionDiscriminator } from './utility';

/**
 * Borsh overheads of `LzReceiveTypesV3Result` / `LzComposeTypesV3Result`, for
 * {@link estimatePlanBytes}. An `AddressLocator::Address` meta is the largest at 34 bytes;
 * `Payer`/`Context` cost 2 and `Signer` 3, so this over-estimates rather than under-estimates.
 * Discovery itself never relies on an estimate: the planner reports the exact size.
 */
export const PLAN_BYTES = {
    /** `context_version: u8` plus the instruction vector's length prefix. */
    base: 5,
    /** Per instruction: enum tag plus its own account-vector length prefix. */
    perInstruction: 5,
    /** Per account meta, assuming a literal 32-byte address. */
    perAccount: 34,
    /** A `Standard` instruction additionally carries a program id and a data-length prefix. */
    perStandardInstruction: 36,
} as const;

/** Scratch sizes are rounded up to this, so a plan that drifts by a few bytes still fits. */
export const PLAN_BYTES_GRANULARITY = 512;

/**
 * First-attempt scratch size. A Transaction V1 holds at most 64 distinct addresses, so a plan in
 * which every meta names a distinct literal address fits here. Metas may repeat an address (up to
 * 255 per V1 instruction), so a larger plan is possible; the planner then reports its size and
 * {@link simulatePlanV3} re-simulates with a scratch that fits.
 */
export const DEFAULT_PLAN_SCRATCH_BYTES = 4_096;

/** Upper bound on the encoded plan for a given shape. See `PLAN_BYTES` for the terms. */
export function estimatePlanBytes(shape: {
    instructions: number;
    accounts: number;
    standardInstructions?: number;
    standardDataBytes?: number;
}): number {
    return (
        PLAN_BYTES.base +
        PLAN_BYTES.perInstruction * shape.instructions +
        PLAN_BYTES.perAccount * shape.accounts +
        PLAN_BYTES.perStandardInstruction * (shape.standardInstructions ?? 0) +
        (shape.standardDataBytes ?? 0)
    );
}

export function planScratchBytes(requiredBytes: number): number {
    return Math.ceil(requiredBytes / PLAN_BYTES_GRANULARITY) * PLAN_BYTES_GRANULARITY;
}

/** Only the simulation fields consumed by discovery; accepts Kit's lossless RPC response. */
export type PlannerSimulationResponse = {
    err: unknown | null;
    returnData?: { programId: string; data: readonly [string, 'base64'] } | null;
    accounts?:
        | readonly ({
              owner: string;
              executable: boolean;
              data: readonly [string, 'base64'];
          } | null)[]
        | null;
};

export interface PlanV3Options {
    /** Refuses to allocate or decode beyond this; in bytes. */
    maxPlanBytes?: number;
    /** Scratch size for the first simulation, before the planner reports what it needs. */
    initialPlanBytes?: number;
    maxAttempts?: number;
}

/**
 * Read RPC returnData, not a log line which may be truncated or come from an earlier CPI. The
 * runtime trims trailing zero bytes from recorded return data, so decode through `untrimmed`.
 */
function returnBytes(response: PlannerSimulationResponse, program: PublicKey): Buffer {
    if (response.err !== null)
        throw new Error(
            `Planner simulation failed: ${JSON.stringify(response.err, (_, value) => (typeof value === 'bigint' ? value.toString() : value))}`,
        );
    const value = response.returnData;
    if (!value || value.programId !== program || value.data[1] !== 'base64') {
        throw new Error('Missing or foreign planner return data');
    }
    return Buffer.from(value.data[0], 'base64');
}

/** Solana caps return data at 1024 bytes, so a bootstrap names at most this many inputs. */
const MAX_BOOTSTRAP_ACCOUNTS = Math.floor((1024 - 5) / 32);

/** `data` with its trimmed trailing zero bytes restored to `width`; longer data is malformed. */
function untrimmed(data: Buffer, width: number): Buffer {
    if (data.length > width) throw new Error('Unexpected planner return data length');
    return Buffer.concat([data, Buffer.alloc(width - data.length)]);
}

/**
 * Decode only post-state from the same successful simulation, never bank data.
 *
 * The planner reports the plan's byte length whether or not it fit, so a `requiredBytes` larger
 * than the scratch account means nothing was written and the caller must re-simulate bigger.
 * The account is the caller's own size, so the plan is the prefix, not the whole buffer.
 */
export function decodePlanOutput<T>(
    response: PlannerSimulationResponse,
    program: PublicKey,
    serializer: Serializer<T, T>,
    maxPlanBytes = 65_536,
): { plan: T } | { requiredBytes: number; availableBytes: number } {
    const result = untrimmed(returnBytes(response, program), 4);
    const requiredBytes = result.readUInt32LE(0);
    if (requiredBytes === 0 || requiredBytes > maxPlanBytes)
        throw new Error('Plan exceeds configured size budget');
    if (!response.accounts || response.accounts.length !== 1)
        throw new Error('Missing simulation accounts');
    const account = response.accounts[0];
    if (!account || account.executable || account.data[1] !== 'base64')
        throw new Error('Invalid planner output');
    if (account.owner !== program) throw new Error('Foreign planner output');
    const buffer = Buffer.from(account.data[0], 'base64');
    if (requiredBytes > buffer.length) return { requiredBytes, availableBytes: buffer.length };
    const data = buffer.subarray(0, requiredBytes);
    const [plan, consumed] = serializer.deserialize(data);
    if (consumed !== data.length || !Buffer.from(serializer.serialize(plan)).equals(data)) {
        throw new Error('Invalid planner output encoding');
    }
    return { plan };
}

/** Planner simulations run at the runtime's ceilings; they are never submitted. */
const SIMULATION_BUDGETS: TransactionV1Budgets = {
    computeUnitLimit: 1_400_000,
    loadedAccountsDataSizeLimit: 64 * 1024 * 1024,
    heapSize: 256 * 1024,
};

async function simulate(
    rpc: ReturnType<typeof createSolanaRpc>,
    payer: PublicKey,
    instructions: Instruction[],
    commitment: Commitment,
    output?: PublicKey,
) {
    const { value: lifetime } = await rpc.getLatestBlockhash({ commitment }).send();
    const transaction = compileTransactionV1(payer, instructions, lifetime, SIMULATION_BUDGETS);
    const result = await rpc
        .simulateTransaction(getBase64EncodedWireTransaction(transaction), {
            encoding: 'base64',
            sigVerify: false,
            replaceRecentBlockhash: true,
            commitment,
            ...(output
                ? { accounts: { encoding: 'base64' as const, addresses: [address(output)] } }
                : {}),
        })
        .send();
    return result.value;
}

/**
 * A top-level `create_account` for the planner's scratch, already owned by the planner program.
 *
 * Top-level, not a CPI, so `MAX_PERMITTED_DATA_INCREASE` never bounds `space`. The key is
 * throwaway and the transaction is only ever simulated, so no signature is produced for it.
 */
async function createScratch(
    rpc: ReturnType<typeof createSolanaRpc>,
    payer: PublicKey,
    scratch: PublicKey,
    program: PublicKey,
    space: number,
): Promise<Instruction> {
    const lamports = await rpc.getMinimumBalanceForRentExemption(BigInt(space)).send();
    const instruction = SystemProgram.createAccount({
        fromPubkey: toWeb3JsPublicKey(payer),
        newAccountPubkey: toWeb3JsPublicKey(scratch),
        lamports: Number(lamports),
        space,
        programId: toWeb3JsPublicKey(program),
    });
    return {
        programId: instruction.programId.toBase58() as PublicKey,
        keys: instruction.keys.map(({ pubkey, isSigner, isWritable }) => ({
            pubkey: pubkey.toBase58() as PublicKey,
            isSigner,
            isWritable,
        })),
        data: instruction.data,
    };
}

/**
 * Discovery step 1: simulate `lz_{kind}_types_info` and return the planner's inputs (the accounts
 * after its payer and scratch). Only a version-3 answer is accepted; there is no fallback.
 */
export async function getPlannerAccounts(
    rpc: RpcInterface,
    payer: PublicKey,
    receiver: PublicKey,
    program: PublicKey,
    kind: 'receive' | 'compose',
    params: Uint8Array,
    commitment: Commitment,
): Promise<{ accounts: PublicKey[] }> {
    const lookup = Web3PublicKey.findProgramAddressSync(
        [
            Buffer.from(kind === 'receive' ? 'LzReceiveTypes' : 'LzComposeTypes'),
            toWeb3JsPublicKey(receiver).toBuffer(),
        ],
        toWeb3JsPublicKey(program),
    )[0];
    const result = await simulate(
        createSolanaRpc(rpc.getEndpoint()),
        payer,
        [
            {
                programId: program,
                keys: [
                    { pubkey: receiver, isSigner: false, isWritable: false },
                    { pubkey: lookup.toBase58() as PublicKey, isSigner: false, isWritable: false },
                ],
                data: Buffer.concat([instructionDiscriminator(`lz_${kind}_types_info`), params]),
            },
        ],
        commitment,
    );
    // [version: u8][count: u32 LE][count pubkeys]; the runtime may trim into any of these.
    const returned = returnBytes(result, program);
    const header = untrimmed(returned.subarray(0, 5), 5);
    const count = header.readUInt32LE(1);
    // Check the count before padding to it: the header is the planner's claim, not a size bound.
    const length = 5 + count * 32;
    if (header[0] !== 3 || count > MAX_BOOTSTRAP_ACCOUNTS || returned.length > length) {
        throw new Error('Expected V3 planner bootstrap');
    }
    const data = untrimmed(returned, length);
    const accounts: PublicKey[] = [];
    for (let offset = 5; offset < data.length; offset += 32) {
        accounts.push(publicKeySerializer().deserialize(data, offset)[0]);
    }
    return { accounts };
}

/**
 * Discovery step 2: simulate a top-level `create_account` of a throwaway, caller-signed scratch
 * plus `lz_{kind}_types_v3`, and decode the plan from the scratch's post-simulation data. When the
 * plan did not fit, re-simulate with the size the planner reported. Nothing is submitted.
 */
export async function simulatePlanV3<T>(
    rpc: RpcInterface,
    payer: PublicKey,
    program: PublicKey,
    kind: 'receive' | 'compose',
    params: Uint8Array,
    accounts: PublicKey[],
    serializer: Serializer<T, T>,
    commitment: Commitment,
    options: PlanV3Options = {},
): Promise<T> {
    const {
        maxPlanBytes = 65_536,
        initialPlanBytes = DEFAULT_PLAN_SCRATCH_BYTES,
        maxAttempts = 3,
    } = options;
    if (
        !Number.isInteger(maxPlanBytes) ||
        maxPlanBytes < 1 ||
        maxPlanBytes > 10 * 1024 * 1024 ||
        !Number.isInteger(initialPlanBytes) ||
        initialPlanBytes < 1 ||
        !Number.isInteger(maxAttempts) ||
        maxAttempts < 1 ||
        maxAttempts > 10
    ) {
        throw new Error('Invalid planner bounds');
    }
    const connection = createSolanaRpc(rpc.getEndpoint());
    const scratch = generateSigner({ eddsa: EDDSA });
    const planner: Instruction = {
        programId: program,
        keys: [
            { pubkey: payer, isSigner: true, isWritable: true },
            { pubkey: scratch.publicKey, isSigner: true, isWritable: true },
            ...accounts.map((key) => ({
                pubkey: key,
                isSigner: false,
                isWritable: false,
            })),
        ],
        data: Buffer.concat([instructionDiscriminator(`lz_${kind}_types_v3`), params]),
    };
    // Rounding up to the scratch granularity must not allocate past the limit.
    const scratchBytes = (bytes: number) => Math.min(planScratchBytes(bytes), maxPlanBytes);
    let space = scratchBytes(Math.min(initialPlanBytes, maxPlanBytes));
    for (let attempt = 0; attempt < maxAttempts; attempt++) {
        const create = await createScratch(connection, payer, scratch.publicKey, program, space);
        const result = decodePlanOutput(
            await simulate(connection, payer, [create, planner], commitment, scratch.publicKey),
            program,
            serializer,
            maxPlanBytes,
        );
        if ('plan' in result) return result.plan;
        space = scratchBytes(result.requiredBytes);
    }
    throw new Error('Planner capacity changed too often; retry planning against fresh state');
}

type PlannedInstruction =
    | { __kind: 'LzReceive' | 'LzCompose'; accounts: AccountMetaRefV3[] }
    | { __kind: 'Standard'; programId: PublicKey; accounts: AccountMetaRefV3[]; data: Uint8Array };

/** Pure resolution. Repeated Standard instructions are valid; duplicate delivery is not. */
export function resolvePlanV3(
    plan: { contextVersion: number; instructions: PlannedInstruction[] },
    kind: 'receive' | 'compose',
    program: PublicKey,
    executor: PublicKey,
    payer: PublicKey,
    params: Uint8Array,
): { contextVersion: number; signers: KeypairSigner[]; instructions: Instruction[] } {
    if (plan.contextVersion !== 1) throw new Error('Unsupported execution context version');
    const primary = kind === 'receive' ? 'LzReceive' : 'LzCompose';
    const discriminator = instructionDiscriminator(`lz_${kind}`);
    if (plan.instructions.filter((ix) => ix.__kind === primary).length !== 1) {
        throw new Error('Plan must contain exactly one delivery instruction');
    }
    const signers = new Map<number, KeypairSigner>();
    const instructions = plan.instructions.map((ix): Instruction => {
        if (ix.__kind !== 'Standard' && ix.__kind !== primary)
            throw new Error('Wrong delivery instruction kind');
        if (
            ix.__kind === 'Standard' &&
            ix.programId === program &&
            Buffer.from(ix.data.slice(0, 8)).equals(discriminator)
        ) {
            throw new Error('Standard instruction cannot disguise duplicate delivery');
        }
        return {
            programId: ix.__kind === 'Standard' ? ix.programId : program,
            data: ix.__kind === 'Standard' ? ix.data : Buffer.concat([discriminator, params]),
            keys: ix.accounts.map(({ pubkey: locator, isWritable }) => {
                let pubkey: PublicKey;
                switch (locator.__kind) {
                    case 'Address':
                        pubkey = locator.fields[0];
                        break;
                    case 'Payer':
                        pubkey = payer;
                        break;
                    case 'Context':
                        pubkey = new ExecutorPDA(executor).context(payer, plan.contextVersion)[0];
                        break;
                    case 'Signer': {
                        const index = locator.fields[0];
                        if (!signers.has(index))
                            signers.set(index, generateSigner({ eddsa: EDDSA }));
                        pubkey = signers.get(index)!.publicKey;
                        break;
                    }
                }
                return {
                    pubkey,
                    isWritable,
                    isSigner: locator.__kind === 'Payer' || locator.__kind === 'Signer',
                };
            }),
        };
    });
    return { contextVersion: plan.contextVersion, signers: [...signers.values()], instructions };
}
