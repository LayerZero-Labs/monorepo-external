import type {
    AccountMeta,
    AddressLookupTableInput,
    Cluster,
    ClusterFilter,
    Commitment,
    Instruction,
    Program,
    ProgramError,
    ProgramRepositoryInterface,
    PublicKey,
    RpcInterface,
    Signer,
    WrappedInstruction,
} from '@metaplex-foundation/umi';
import { createNullRpc, defaultPublicKey } from '@metaplex-foundation/umi';
import { createDefaultProgramRepository } from '@metaplex-foundation/umi-program-repository';

import type { Packet } from '@layerzerolabs/protocol-codecs-v2';

import type { ComposeSentEvent } from './generated/endpoint/events';
import * as accounts from './generated/executor/accounts';
import * as errors from './generated/executor/errors';
import * as events from './generated/executor/events';
import type {
    NativeDropInstructionDataArgs,
    QuoteExecutorInstructionArgs,
} from './generated/executor/instructions';
import * as instructions from './generated/executor/instructions';
import { EXECUTOR_PROGRAM_ID } from './generated/executor/programs';
import * as types from './generated/executor/types';
import { EventPDA, ExecutorPDA, MessageLibPDA, PriceFeedPDA } from './pda';
import { lzCompose, lzReceive } from './receive';

export { EXECUTOR_PROGRAM_ID } from './generated/executor/programs';
export { accounts, errors, events, instructions, types };

export class Executor {
    public readonly pda: ExecutorPDA;
    public readonly programRepo: ProgramRepositoryInterface;
    public readonly eventAuthority: PublicKey;

    constructor(
        public programId: PublicKey = EXECUTOR_PROGRAM_ID,
        rpc?: RpcInterface,
    ) {
        this.pda = new ExecutorPDA(this.programId);
        if (rpc === undefined) {
            rpc = createNullRpc();
            rpc.getCluster = (): Cluster => 'custom';
        }
        this.programRepo = createDefaultProgramRepository({ rpc }, [
            {
                name: 'executor',
                publicKey: programId,
                getErrorFromCode(code: number, cause?: Error): ProgramError | null {
                    return errors.getExecutorErrorFromCode(code, this, cause);
                },
                getErrorFromName(name: string, cause?: Error): ProgramError | null {
                    return errors.getExecutorErrorFromName(name, this, cause);
                },
                isOnCluster(): boolean {
                    return true;
                },
            } satisfies Program,
        ]);

        this.eventAuthority = new EventPDA(programId).eventAuthority()[0];
    }

    getProgram(clusterFilter: ClusterFilter = 'custom'): Program {
        return this.programRepo.get('executor', clusterFilter);
    }

    // owner methods
    initExecutor(
        payer: Signer,
        param: instructions.InitExecutorInstructionDataArgs,
    ): WrappedInstruction {
        return instructions.initExecutor(
            { programs: this.programRepo, payer },
            {
                payer,
                config: this.pda.config(),
                ...param,
            },
        ).items[0];
    }

    setOwner(owner: Signer, newOwner: PublicKey): WrappedInstruction {
        return instructions.ownerSetConfig(
            { programs: this.programRepo },
            {
                owner,
                config: this.pda.config(),
                params: {
                    fields: [newOwner],
                    __kind: 'Owner',
                },
            },
        ).items[0];
    }

    setAdmins(owner: Signer, admins: PublicKey[]): WrappedInstruction {
        return instructions.ownerSetConfig(
            { programs: this.programRepo },
            {
                owner,
                config: this.pda.config(),
                params: {
                    fields: [admins],
                    __kind: 'Admins',
                },
            },
        ).items[0];
    }

    setAllowList(owner: Signer, allowlist: PublicKey[]): WrappedInstruction {
        return instructions.ownerSetConfig(
            { programs: this.programRepo },
            {
                owner,
                config: this.pda.config(),
                params: {
                    fields: [allowlist],
                    __kind: 'Allowlist',
                },
            },
        ).items[0];
    }

    setDenyList(owner: Signer, denylist: PublicKey[]): WrappedInstruction {
        return instructions.ownerSetConfig(
            { programs: this.programRepo },
            {
                owner,
                config: this.pda.config(),
                params: {
                    fields: [denylist],
                    __kind: 'Denylist',
                },
            },
        ).items[0];
    }

    setPaused(owner: Signer, paused: boolean): WrappedInstruction {
        return instructions.ownerSetConfig(
            { programs: this.programRepo },
            {
                owner,
                config: this.pda.config(),
                params: {
                    fields: [paused],
                    __kind: 'Paused',
                },
            },
        ).items[0];
    }

    setExecutors(owner: Signer, executors: PublicKey[]): WrappedInstruction {
        return instructions.ownerSetConfig(
            { programs: this.programRepo },
            {
                owner: owner,
                config: this.pda.config(),
                params: {
                    fields: [executors],
                    __kind: 'Executors',
                },
            },
        ).items[0];
    }

    setMsglibByPrograms(owner: Signer, msglibPrograms: PublicKey[]): WrappedInstruction {
        const msglibPdas = msglibPrograms.map((program) => {
            return new MessageLibPDA(program).messageLib()[0];
        });
        return this.setMsglibByPDAs(owner, msglibPdas);
    }

    setMsglibByPDAs(owner: Signer, msglibPDAs: PublicKey[]): WrappedInstruction {
        return instructions.ownerSetConfig(
            { programs: this.programRepo },
            {
                owner,
                config: this.pda.config(),
                params: {
                    fields: [msglibPDAs],
                    __kind: 'Msglibs',
                },
            },
        ).items[0];
    }

    // admin methods
    setDefaultMultiplierBps(admin: Signer, defaultMultiplierBps: number): WrappedInstruction {
        return instructions.adminSetConfig(
            { programs: this.programRepo },
            {
                admin,
                config: this.pda.config(),
                params: {
                    fields: [defaultMultiplierBps],
                    __kind: 'DefaultMultiplierBps',
                } satisfies types.AdminSetConfigParams,
            },
        ).items[0];
    }

    setDstConfig(admin: Signer, dstConfigs: types.DstConfig[]): WrappedInstruction {
        return instructions.adminSetConfig(
            { programs: this.programRepo },
            {
                admin,
                config: this.pda.config(),
                params: {
                    fields: [dstConfigs],
                    __kind: 'DstConfigs',
                } satisfies types.AdminSetConfigParams,
            },
        ).items[0];
    }

    setPriceFeed(admin: Signer, priceFeedProgram: PublicKey): WrappedInstruction {
        const [priceFeed] = new PriceFeedPDA(priceFeedProgram).priceFeed();
        return instructions.adminSetConfig(
            { programs: this.programRepo },
            {
                admin,
                config: this.pda.config(),
                params: {
                    fields: [priceFeed],
                    __kind: 'PriceFeed',
                } satisfies types.AdminSetConfigParams,
            },
        ).items[0];
    }

    nativeDrop(executor: Signer, param: NativeDropInstructionDataArgs): WrappedInstruction {
        const receivers: AccountMeta[] = param.nativeDropRequests.map((request) => {
            return {
                pubkey: request.receiver,
                isSigner: false,
                isWritable: true,
            } satisfies AccountMeta;
        });
        return instructions
            .nativeDrop(
                { programs: this.programRepo },
                {
                    executor: executor,
                    config: this.pda.config(),
                    eventAuthority: new EventPDA(this.programId).eventAuthority()[0],
                    program: this.programId,
                    ...param,
                },
            )
            .addRemainingAccounts(receivers).items[0];
    }

    quoteExecutor(
        param: { priceFeedProgram: PublicKey } & QuoteExecutorInstructionArgs,
    ): WrappedInstruction {
        const [priceFeed] = new PriceFeedPDA(param.priceFeedProgram).priceFeed();
        return instructions.quoteExecutor(
            { programs: this.programRepo },
            {
                executorConfig: this.pda.config(),
                priceFeedConfig: priceFeed,
                ...param,
            },
        ).items[0];
    }

    async getExecutorConfig(
        rpc: RpcInterface,
        commitment: Commitment = 'confirmed',
    ): Promise<accounts.ExecutorConfig | null> {
        const [configAccount] = this.pda.config();
        const config = await accounts.safeFetchExecutorConfig({ rpc }, configAccount, {
            commitment,
        });
        return config;
    }

    getQuoteIXAccountMetaForCPI(
        priceFeedConfig: PublicKey,
        priceFeedProgram: PublicKey,
        payment: boolean,
    ): AccountMeta[] {
        const txBuilder = instructions.quoteExecutor(
            { programs: this.programRepo },
            {
                executorConfig: this.pda.config(),
                priceFeedConfig,
                priceFeedProgram: priceFeedProgram,
                // param
                msglib: defaultPublicKey(),
                dstEid: 0,
                sender: defaultPublicKey(),
                calldataSize: 0,
                options: [],
            },
        );
        const ixAccounts = txBuilder.getInstructions()[0].keys;
        if (payment) {
            // if payment is required, the first account is required to be writable to receive the payment
            ixAccounts[0].isWritable = true;
        }
        return [
            {
                pubkey: this.programId,
                isWritable: false,
                isSigner: false,
            },
        ].concat(ixAccounts);
    }

    async execute(
        rpc: RpcInterface,
        executor: Signer,
        param: {
            packet: Packet;
            extraData: Uint8Array;
            value?: bigint;
            computeUnits?: number;
            endpointProgram?: PublicKey;
        },
        commitment: Commitment = 'confirmed',
    ): Promise<{
        signers: Signer[];
        instructions: Instruction[];
        addressLookupTables: AddressLookupTableInput[];
    }> {
        const { packet, extraData, value = 0n } = param;
        const payer = executor.publicKey;
        const lzReceiveResult = await lzReceive(
            rpc,
            payer,
            packet,
            extraData,
            this.programId,
            commitment,
        );
        const { contextVersion } = lzReceiveResult;
        const instructions: Instruction[] = [
            this.preExecute(executor, contextVersion, value).instruction,
        ];
        const signers: Signer[] = [];
        const addressLookupTables: AddressLookupTableInput[] = [];
        // Handle both V1 (Instruction) and V2 ({signers, instructions})
        if ('instruction' in lzReceiveResult) {
            // V1: single instruction
            instructions.push(lzReceiveResult.instruction);
        } else {
            // V2: multi-instruction
            instructions.push(...lzReceiveResult.instructions);
            signers.push(...lzReceiveResult.signers);
            addressLookupTables.push(...lzReceiveResult.addressLookupTables);
        }
        instructions.push(this.postExecute(executor, contextVersion).instruction);
        return { signers, instructions, addressLookupTables };
    }

    async compose(
        rpc: RpcInterface,
        executor: Signer,
        param: {
            event: ComposeSentEvent;
            extraData: Uint8Array;
            value?: bigint;
            endpointProgram?: PublicKey;
        },
        commitment: Commitment = 'confirmed',
    ): Promise<{
        signers: Signer[];
        instructions: Instruction[];
        addressLookupTables: AddressLookupTableInput[];
    }> {
        const { event, extraData, value = 0n } = param;
        const payer = executor.publicKey;
        const lzComposeResult = await lzCompose(
            rpc,
            payer,
            event,
            extraData,
            this.programId,
            commitment,
        );
        const { contextVersion } = lzComposeResult;
        const instructions: Instruction[] = [
            this.preExecute(executor, contextVersion, value).instruction,
        ];
        const signers: Signer[] = [];
        const addressLookupTables: AddressLookupTableInput[] = [];
        // Handle both V1 (Instruction) and V2 ({signers, instructions})
        if ('instruction' in lzComposeResult) {
            // V1: single instruction
            instructions.push(lzComposeResult.instruction);
        } else {
            // V2: multi-instruction
            instructions.push(...lzComposeResult.instructions);
            signers.push(...lzComposeResult.signers);
            addressLookupTables.push(...lzComposeResult.addressLookupTables);
        }
        instructions.push(this.postExecute(executor, contextVersion).instruction);
        return { signers, instructions, addressLookupTables };
    }

    preExecute(executor: Signer, version: number, feeLimit: bigint): WrappedInstruction {
        const context = this.pda.context(executor.publicKey, version);
        return instructions.preExecute(
            { programs: this.programRepo },
            { executor, context, feeLimit, contextVersion: version },
        ).items[0];
    }

    postExecute(executor: Signer, version: number): WrappedInstruction {
        const context = this.pda.context(executor.publicKey, version);
        return instructions.postExecute(
            { programs: this.programRepo },
            { context, executor, contextVersion: version },
        ).items[0];
    }
}
