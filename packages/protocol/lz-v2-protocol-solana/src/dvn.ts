import type {
    AccountMeta,
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
import { createNullRpc, defaultPublicKey, publicKey } from '@metaplex-foundation/umi';
import { createDefaultProgramRepository } from '@metaplex-foundation/umi-program-repository';
import { keccak_256 } from '@noble/hashes/sha3';

import { hexToBytes } from '@layerzerolabs/common-encoding-utils';
import { addressToBytes32, PacketV1Codec } from '@layerzerolabs/protocol-codecs-v2';

import { EndpointProgram, UlnProgram } from '.';
import * as accounts from './generated/dvn/accounts';
import * as errors from './generated/dvn/errors';
import * as events from './generated/dvn/events';
import type { QuoteDvnInstructionArgs } from './generated/dvn/instructions';
import * as instructions from './generated/dvn/instructions';
import * as types from './generated/dvn/types';
import { DvnPDA, EndpointPDA, EventPDA, PriceFeedPDA } from './pda';

export { accounts, errors, events, instructions, types };
export { DVN_PROGRAM_ID } from './generated/dvn';

export interface SignFunc {
    sign(message: Buffer): Promise<
        {
            signature: Uint8Array;
            recoveryId: number;
        }[]
    >;
}

export type HashSigner = {
    signHash(hash: Uint8Array): Promise<Uint8Array>;
};

export class SolanaSignerExt implements SignFunc {
    private readonly signers: HashSigner[];

    private constructor(signers: HashSigner[]) {
        this.signers = signers;
    }

    static from(signers: HashSigner[]): SolanaSignerExt {
        return new SolanaSignerExt(signers);
    }

    async sign(message: Buffer): Promise<{ signature: Uint8Array; recoveryId: number }[]> {
        return Promise.all(
            this.signers.map(async (s) => {
                const rv = await s.signHash(message);
                return { signature: rv.slice(0, 64), recoveryId: rv[64] };
            }),
        );
    }
}

export class DVN {
    public readonly pda: DvnPDA;
    public readonly eventAuthority: PublicKey;
    public readonly programRepo: ProgramRepositoryInterface;

    constructor(
        readonly programId: PublicKey,
        rpc?: RpcInterface,
    ) {
        this.pda = new DvnPDA(programId);
        // this.vid = endpointId % 30000
        this.eventAuthority = new EventPDA(programId).eventAuthority()[0];
        if (rpc === undefined) {
            rpc = createNullRpc();
            rpc.getCluster = (): Cluster => 'custom';
        }
        this.programRepo = createDefaultProgramRepository({ rpc }, [
            {
                name: 'dvn',
                publicKey: programId,
                getErrorFromCode(code: number, cause?: Error): ProgramError | null {
                    return errors.getDvnErrorFromCode(code, this, cause);
                },
                getErrorFromName(name: string, cause?: Error): ProgramError | null {
                    return errors.getDvnErrorFromName(name, this, cause);
                },
                isOnCluster(): boolean {
                    return true;
                },
            } satisfies Program,
        ]);
    }

    getProgram(clusterFilter: ClusterFilter = 'custom'): Program {
        return this.programRepo.get('dvn', clusterFilter);
    }

    async initDVN(
        rpc: RpcInterface,
        payer: Signer,
        params: instructions.InitDvnInstructionArgs,
    ): Promise<WrappedInstruction> {
        const [config] = this.pda.config();
        const info = await rpc.getAccount(config);
        if (info.exists) {
            throw new Error('DVN already initialized');
        }
        return instructions.initDvn(
            { programs: this.programRepo, payer: payer },
            {
                payer,
                config,
                //
                ...params,
            },
        ).items[0];
    }

    getDigest(
        vid: number,
        instruction: Instruction,
        expiration: bigint,
    ): types.ExecuteTransactionDigest {
        return {
            vid,
            programId: instruction.programId,
            accounts: instruction.keys.map((key) => {
                return {
                    pubkey: key.pubkey,
                    isSigner: key.isSigner,
                    isWritable: key.isWritable,
                };
            }),
            data: instruction.data,
            expiration,
        };
    }

    getExecuteHash(hashBytes: Buffer): PublicKey {
        return this.pda.executeHash(hashBytes)[0];
    }

    getHashBytes(digest: types.ExecuteTransactionDigest): Buffer {
        const digestBytes = types.getExecuteTransactionDigestSerializer().serialize(digest);
        const hash = keccak_256(digestBytes);
        return Buffer.from(hash);
    }

    async invoke(
        rpc: RpcInterface,
        payer: Signer,
        params: {
            vid: number;
            instruction: Instruction;
            expiration: bigint;
        },
        sign: SignFunc,
    ): Promise<WrappedInstruction> {
        const configState = await this.getConfigState(rpc, 'confirmed');
        if (!configState) {
            throw new Error('DVN not initialized');
        }

        const { vid, instruction, expiration } = params;
        const digest: types.ExecuteTransactionDigest = this.getDigest(vid, instruction, expiration);
        const hashBytes = this.getHashBytes(digest);
        const executeHash = this.getExecuteHash(hashBytes);
        const signResult = await sign.sign(hashBytes);
        const signatures: Array<Uint8Array> = signResult.map(
            (s) => new Uint8Array([...s.signature, s.recoveryId]), // TODO: verify signature construction
        );

        const txBuilder = instructions.invoke(
            { programs: this.programRepo },
            {
                signer: payer,
                config: this.pda.config(),
                executeHash,
                program: this.programId,
                eventAuthority: this.eventAuthority,

                digest: digest,
                signatures: signatures,
            },
        );
        return txBuilder.addRemainingAccounts([
            {
                pubkey: instruction.programId,
                isSigner: false,
                isWritable: false,
            },
            ...instruction.keys.map((key) => {
                key.isSigner = false;
                return key;
            }),
        ]).items[0];
    }

    async setMultisigConfig(
        rpc: RpcInterface,
        payer: Signer,
        params: {
            vid: number;
            config: types.MultisigConfig;
            expiration: bigint;
        },
        sign: SignFunc,
    ): Promise<[WrappedInstruction, Buffer]> {
        const { vid, expiration } = params;
        const innerInstruction: Instruction = {
            programId: this.programId,
            keys: [],
            data: Buffer.from(types.getMultisigConfigSerializer().serialize(params.config)),
        };
        const digest: types.ExecuteTransactionDigest = this.getDigest(
            vid,
            innerInstruction,
            expiration,
        );
        return [
            await this.invoke(
                rpc,
                payer,
                {
                    vid: vid,
                    instruction: innerInstruction,
                    expiration,
                },
                sign,
            ),
            this.getHashBytes(digest),
        ];
    }

    // set admin config, can call by one of the admins
    setConfig(admin: Signer, adminConfig: types.AdminConfigArgs): WrappedInstruction {
        return instructions.setConfig(
            { programs: this.programRepo },
            {
                admin,
                config: this.pda.config(),
                program: this.programId,
                eventAuthority: this.eventAuthority,
            },
            {
                config: adminConfig,
            },
        ).items[0];
    }

    setDstConfig(admin: Signer, dstConfigs: types.DstConfig[]): WrappedInstruction {
        return this.setConfig(admin, {
            __kind: 'DstConfigs',
            fields: [dstConfigs],
        });
    }

    setAdmins(admin: Signer, admins: PublicKey[]): WrappedInstruction {
        return this.setConfig(admin, {
            __kind: 'Admins',
            fields: [admins],
        });
    }

    setDefaultMultiplierBps(admin: Signer, defaultMultiplierBps: number): WrappedInstruction {
        return this.setConfig(admin, {
            __kind: 'DefaultMultiplierBps',
            fields: [defaultMultiplierBps],
        });
    }

    setPriceFeed(admin: Signer, priceFeedProgram: PublicKey): WrappedInstruction {
        const [priceFeedPda] = new PriceFeedPDA(priceFeedProgram).priceFeed();
        return this.setConfig(admin, {
            fields: [priceFeedPda],
            __kind: 'PriceFeed',
        });
    }

    _getExpiration(): bigint {
        return BigInt(new Date().getTime() / 1000 + 120);
    }

    withdrawFee(
        admin: Signer,
        param: { receiver: PublicKey; amount: number | bigint },
    ): WrappedInstruction {
        return instructions.withdrawFee(
            { programs: this.programRepo },
            {
                admin,
                config: this.pda.config(),
                receiver: param.receiver,
                program: this.programId,
                eventAuthority: this.eventAuthority,
                amount: param.amount,
            },
        ).items[0];
    }

    closeExecute(admin: Signer, digestHash: Buffer): WrappedInstruction {
        return instructions.closeExecute(
            { programs: this.programRepo },
            {
                admin,
                config: this.pda.config(),
                executeHash: this.pda.executeHash(digestHash),
                digestHash,
            },
        ).items[0];
    }

    quoteDvn(param: { priceFeedProgram: PublicKey } & QuoteDvnInstructionArgs): WrappedInstruction {
        const [priceFeed] = new PriceFeedPDA(param.priceFeedProgram).priceFeed();
        return instructions.quoteDvn(
            { programs: this.programRepo },
            {
                dvnConfig: this.pda.config(),
                priceFeedConfig: priceFeed,
                ...param,
            },
        ).items[0];
    }

    async verifiable(
        rpc: RpcInterface,
        params: {
            packetBytes: Uint8Array;
            endpointProgram?: PublicKey;
            msgLibProgram?: PublicKey;
        },
    ): Promise<WrappedInstruction> {
        const { packetBytes } = params;
        const packet = PacketV1Codec.fromBytes(packetBytes);
        const receiver = publicKey(hexToBytes(packet.receiver()));
        const srcEid = packet.srcEid();
        const sender = addressToBytes32(packet.sender());
        const packetNonce = parseInt(packet.nonce());
        const headerHashBytes = hexToBytes(packet.headerHash());
        const payloadHashBytes = hexToBytes(packet.payloadHash());

        const endpointPDA = new EndpointPDA(
            params.endpointProgram ?? EndpointProgram.ENDPOINT_PROGRAM_ID,
        );
        const ulnSDK = new UlnProgram.Uln(params.msgLibProgram ?? UlnProgram.ULN_PROGRAM_ID);

        const finalReceiveConfig = await ulnSDK.getFinalReceiveConfigState(
            rpc,
            receiver,
            srcEid,
            'confirmed',
        );
        const confirmations: AccountMeta[] = [
            ...finalReceiveConfig.requiredDvns,
            ...finalReceiveConfig.optionalDvns,
        ].map((dvn) => {
            return {
                pubkey: ulnSDK.pda.confirmations(headerHashBytes, payloadHashBytes, dvn)[0],
                isSigner: false,
                isWritable: false,
            };
        });
        return instructions
            .verifiable(
                { programs: this.programRepo },
                {
                    nonce: endpointPDA.nonce(receiver, srcEid, sender),
                    payloadHash: endpointPDA.payloadHash(receiver, srcEid, sender, packetNonce),
                    receiveConfig: ulnSDK.pda.receiveConfig(srcEid, receiver),
                    defaultReceiveConfig: ulnSDK.pda.defaultReceiveConfig(srcEid),
                },
                {
                    packetHeader: hexToBytes(packet.header()),
                    payloadHash: payloadHashBytes,
                },
            )
            .addRemainingAccounts(confirmations).items[0];
    }

    getQuoteIXAccountMetaForCPI(
        priceFeedConfig: PublicKey,
        priceFeedProgram: PublicKey,
        payment: boolean,
    ): AccountMeta[] {
        const txBuilder = instructions.quoteDvn(
            { programs: this.programRepo },
            {
                dvnConfig: this.pda.config(),
                priceFeedConfig,
                priceFeedProgram: priceFeedProgram,

                // param
                msglib: defaultPublicKey(),
                dstEid: 0,
                sender: defaultPublicKey(),
                packetHeader: new Uint8Array(4),
                payloadHash: new Uint8Array(32),
                confirmations: 0,
                options: [],
            },
        );
        const { keys } = txBuilder.getInstructions()[0];
        if (payment) {
            // if payment is required, the first account is required to be writable to receive the payment
            keys[0].isWritable = true;
        }
        return [
            {
                pubkey: this.programId,
                isWritable: false,
                isSigner: false,
            },
        ].concat(keys);
    }

    async getConfigState(
        rpc: RpcInterface,
        commitment: Commitment = 'confirmed',
    ): Promise<accounts.DvnConfig | null> {
        const [config] = this.pda.config();
        return accounts.safeFetchDvnConfig({ rpc }, config, { commitment });
    }
}
