import { arrayify } from '@ethersproject/bytes';
import type {
    AccountMeta,
    Cluster,
    ClusterFilter,
    Commitment,
    Instruction,
    OptionOrNullable,
    Pda,
    Program,
    ProgramError,
    ProgramRepositoryInterface,
    PublicKey,
    RpcInterface,
    Signer,
    Some,
    WrappedInstruction,
} from '@metaplex-foundation/umi';
import {
    createNoopSigner,
    createNullRpc,
    isOption,
    isSome,
    publicKeyBytes,
    some,
} from '@metaplex-foundation/umi';
import type { Serializer } from '@metaplex-foundation/umi/serializers';
import { array, bool, bytes, publicKey, struct, u32 } from '@metaplex-foundation/umi/serializers';
import { createWeb3JsEddsa } from '@metaplex-foundation/umi-eddsa-web3js';
import { createDefaultProgramRepository } from '@metaplex-foundation/umi-program-repository';

import type {
    ExecuteTransactionInstructionDataArgs,
    InitOneSigInstructionDataArgs,
    OneSigState,
    OneSigTransactionArgs,
    SetConfigParamsArgs,
    VerifyMerkleRootParamsArgs,
} from './index';
import type { SolanaCallData } from './index';
import {
    closeMerkleRoot,
    executeTransaction,
    fetchOneSigState,
    getOnesigErrorFromCode,
    getOnesigErrorFromName,
    initOneSig,
    ONESIG_PROGRAM_ID,
    setConfig as setConfigInstruction,
    setConfigParams,
    verifyMerkleRoot as verifyMerkleRootInstruction,
} from './index';

export const EDDSA = createWeb3JsEddsa();

export class OneSigPDA {
    static readonly ONESIG_SEED = Buffer.from('OneSig', 'utf8');
    static readonly MERKLE_ROOT_SEED = Buffer.from('MerkleRoot', 'utf8');
    constructor(
        public readonly program: PublicKey = ONESIG_PROGRAM_ID,
        public readonly state: PublicKey,
    ) {}

    oneSigSigner(): Pda {
        return EDDSA.findPda(this.program, [OneSigPDA.ONESIG_SEED, publicKeyBytes(this.state)]);
    }

    merkleRootState(merkleRoot: Uint8Array): Pda {
        return EDDSA.findPda(this.program, [
            OneSigPDA.MERKLE_ROOT_SEED,
            publicKeyBytes(this.state),
            merkleRoot,
        ]);
    }
}

export class EventPDA {
    static EVENT_SEED = '__event_authority';

    constructor(public readonly program: PublicKey) {}

    eventAuthority(): Pda {
        return EDDSA.findPda(this.program, [Buffer.from(EventPDA.EVENT_SEED, 'utf8')]);
    }
}

export function getAccountMetaSerializer(): Serializer<AccountMeta, AccountMeta> {
    return struct<AccountMeta>(
        [
            ['pubkey', publicKey()],
            ['isSigner', bool()],
            ['isWritable', bool()],
        ],
        { description: 'AccountMeta' },
    ) as Serializer<AccountMeta, AccountMeta>;
}

export function getInstructionSerializer(): Serializer<Instruction, Instruction> {
    return struct<Instruction>(
        [
            ['programId', publicKey()],
            ['keys', array(getAccountMetaSerializer())],
            ['data', bytes({ size: u32() })],
        ],
        { description: 'Instruction' },
    ) as Serializer<Instruction, Instruction>;
}

export class OneSig {
    public readonly pda: OneSigPDA;
    public readonly eventPda: EventPDA;
    public readonly programRepo: ProgramRepositoryInterface;

    constructor(
        public programId: PublicKey = ONESIG_PROGRAM_ID,
        public state: Signer,
        rpc?: RpcInterface,
    ) {
        this.pda = new OneSigPDA(programId, state.publicKey);
        this.eventPda = new EventPDA(programId);
        if (rpc === undefined) {
            rpc = createNullRpc();
            rpc.getCluster = (): Cluster => 'custom';
        }
        this.programRepo = createDefaultProgramRepository({ rpc }, [
            {
                name: 'onesig',
                publicKey: programId,
                getErrorFromCode(code: number, cause?: Error): ProgramError | null {
                    return getOnesigErrorFromCode(code, this, cause);
                },
                getErrorFromName(name: string, cause?: Error): ProgramError | null {
                    return getOnesigErrorFromName(name, this, cause);
                },
                isOnCluster(): boolean {
                    return true;
                },
            } satisfies Program,
        ]);
    }

    getProgram(clusterFilter: ClusterFilter = 'custom'): Program {
        return this.programRepo.get('onesig', clusterFilter);
    }

    /**
     * Initialize OneSig multisig configuration
     */
    initialize(payer: Signer, params: InitOneSigInstructionDataArgs): WrappedInstruction {
        return initOneSig(
            {
                programs: this.programRepo,
                payer,
                eddsa: EDDSA,
            },
            {
                ...params,
                state: this.state,
                payer: payer,
                program: this.programId,
            },
        ).items[0];
    }

    /**
     * Execute a multisig transaction with optional merkle root verification.
     *
     * Two execution modes:
     * 1. Single-step (merkleRootVerification provided): verifies signatures + executes in one tx.
     * 2. Two-step (merkleRootVerification null): uses a pre-verified MerkleRootState PDA.
     *
     * The two-step approach avoids Solana's 1232-byte transaction size limit when
     * signatures + merkle proofs + tx data would exceed it.
     */
    executeTransaction(
        signer: Signer,
        merkleRoot: Uint8Array,
        params: {
            call: SolanaCallData;
            proof: string[];
            merkleRootVerification: OptionOrNullable<
                Pick<VerifyMerkleRootParamsArgs, 'expiry' | 'signatures'>
            >;
        },
    ): WrappedInstruction {
        const hasMerkleRootVerification =
            isOption(params.merkleRootVerification) && isSome(params.merkleRootVerification);

        const oneSigTransactionArgs: OneSigTransactionArgs = {
            ixData: params.call.data,
            value: params.call.value,
            proof: params.proof.map((p) => [arrayify(p)]),
        };
        const args: ExecuteTransactionInstructionDataArgs = {
            transaction: oneSigTransactionArgs,
            merkleRootVerification: hasMerkleRootVerification
                ? some({
                      ...(params.merkleRootVerification as Some<VerifyMerkleRootParamsArgs>).value,
                      merkleRoot: [merkleRoot],
                  })
                : null,
        };

        const [oneSigSigner] = this.pda.oneSigSigner();
        const [ix] = executeTransaction(
            {
                programs: this.programRepo,
                eddsa: EDDSA,
            },
            {
                ...args,
                executor: signer,
                oneSigState: this.state.publicKey,
                program: this.programId,
                eventAuthority: this.eventPda.eventAuthority(),
                oneSigSigner: oneSigSigner,
                merkleRootState: hasMerkleRootVerification
                    ? undefined
                    : this.pda.merkleRootState(merkleRoot),
            },
        ).items;

        params.call.keys.forEach((key) => {
            key.isSigner = false;
            ix.instruction.keys.push(key);
        });
        return ix;
    }

    verifyMerkleRoot(payer: Signer, params: VerifyMerkleRootParamsArgs): WrappedInstruction {
        return verifyMerkleRootInstruction(
            {
                programs: this.programRepo,
                payer,
            },
            {
                oneSigState: this.state.publicKey,
                merkleRootState: this.pda.merkleRootState(params.merkleRoot[0]),
                params,
            },
        ).items[0];
    }

    closeMerkleRootState(recipient: Signer, merkleRoot: Uint8Array): WrappedInstruction {
        return closeMerkleRoot(
            {
                programs: this.programRepo,
            },
            {
                signer: recipient,
                merkleRootState: this.pda.merkleRootState(merkleRoot),
            },
        ).items[0];
    }

    setConfig(config: SetConfigParamsArgs): Instruction {
        const txBuilder = setConfigInstruction(
            {
                programs: this.programRepo,
                eddsa: EDDSA,
            },
            {
                state: this.state.publicKey,
                eventAuthority: this.eventPda.eventAuthority(),
                oneSigSigner: createNoopSigner(this.pda.oneSigSigner()[0]),
                program: this.programId,
                params: config,
            },
        );
        const instruction = txBuilder.getInstructions()[0];
        instruction.keys = [
            {
                pubkey: this.programId,
                isSigner: false,
                isWritable: false,
            },
            ...instruction.keys,
        ];
        return instruction;
    }

    addSigner(signer: Uint8Array): Instruction {
        return this.setConfig(setConfigParams('AddSigner', [[signer]]));
    }

    removeSigner(signer: Uint8Array): Instruction {
        return this.setConfig(setConfigParams('RemoveSigner', [[signer]]));
    }

    setThreshold(threshold: number): Instruction {
        return this.setConfig(setConfigParams('SetThreshold', [threshold]));
    }

    setSeed(seed: Uint8Array): Instruction {
        return this.setConfig(setConfigParams('SetSeed', [[seed]]));
    }

    addExecutor(executor: PublicKey): Instruction {
        return this.setConfig(setConfigParams('AddExecutor', [executor]));
    }

    removeExecutor(executor: PublicKey): Instruction {
        return this.setConfig(setConfigParams('RemoveExecutor', [executor]));
    }

    setExecutorRequired(required: boolean): Instruction {
        return this.setConfig(setConfigParams('SetExecutorRequired', [required]));
    }

    async getState(rpc: RpcInterface, commitment: Commitment = 'confirmed'): Promise<OneSigState> {
        return fetchOneSigState({ rpc }, this.state.publicKey, { commitment });
    }
}
