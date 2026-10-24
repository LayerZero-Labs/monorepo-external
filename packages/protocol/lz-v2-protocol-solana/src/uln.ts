import type {
    AccountMeta,
    Cluster,
    ClusterFilter,
    Commitment,
    Option,
    Program,
    ProgramError,
    ProgramRepositoryInterface,
    PublicKey,
    RpcInterface,
    Signer,
    WrappedInstruction,
} from '@metaplex-foundation/umi';
import {
    createNoopSigner,
    createNullRpc,
    defaultPublicKey,
    isSome,
    publicKey,
} from '@metaplex-foundation/umi';
import { createDefaultProgramRepository } from '@metaplex-foundation/umi-program-repository';
import { fromWeb3JsPublicKey } from '@metaplex-foundation/umi-web3js-adapters';
import { TOKEN_PROGRAM_ID } from '@solana/spl-token';
import invariant from 'tiny-invariant';

import { hexToBytes } from '@layerzerolabs/common-encoding-utils';
import { PacketV1Codec } from '@layerzerolabs/protocol-codecs-v2';

import type { MessageLibInterface, SolanaPacketPath } from '.';
import { EndpointProgram, SetConfigType } from '.';
import { accounts as DvnAccounts, DVN } from './dvn';
import { ENDPOINT_PROGRAM_ID } from './endpoint';
import { accounts as ExecutorAccounts, Executor } from './executor';
import { ULN_PROGRAM_ID } from './generated/uln';
import * as accounts from './generated/uln/accounts';
import * as errors from './generated/uln/errors';
import * as events from './generated/uln/events';
import * as instructions from './generated/uln/instructions';
import * as types from './generated/uln/types';
import { EndpointPDA, EventPDA, UlnPDA } from './pda';

export { ULN_PROGRAM_ID } from './generated/uln';
export { accounts, errors, events, instructions, types };

/**
 * Interface representing the maximum message size.
 */
export interface MaxMessageSize {
    /**
     * The size of the message.
     */
    size: number;

    /**
     * The kind of the message size.
     */
    __kind: 'MaxMessageSize';
}

/**
 * Interface representing the outbound confirmations.
 */
export interface OutboundConfirmations {
    /**
     * The number of confirmations.
     */
    confirmations: number;

    /**
     * The kind of the outbound confirmations.
     */
    __kind: 'OutboundConfirmations';
}

/**
 * Interface representing the inbound confirmations.
 */
export interface InboundConfirmations {
    /**
     * The number of confirmations.
     */
    confirmations: number;

    /**
     * The kind of the inbound confirmations.
     */
    __kind: 'InboundConfirmations';
}

/**
 * Interface representing the oracles.
 */
export interface Oracles {
    /**
     * Indicates if custom oracles are used.
     */
    useCustomOracles: boolean;

    /**
     * The array of oracle public keys.
     */
    oracles: PublicKey[];

    /**
     * The kind of the oracles.
     */
    __kind: 'Oracles';
}

/**
 * Interface representing the optional oracles.
 */
export interface OptionalOracles {
    /**
     * Indicates if custom optional oracles are used.
     */
    useCustomOptionalOracles: boolean;

    /**
     * The array of optional oracle public keys.
     */
    optionalOracles: PublicKey[];

    /**
     * The threshold for the optional oracles.
     */
    threshold: number;

    /**
     * The kind of the optional oracles.
     */
    __kind: 'OptionalOracles';
}

/**
 * Class representing the ULN (Ultra Light Node).
 * @see {@link MessageLibInterface}
 */
export class Uln implements MessageLibInterface {
    public readonly pda: UlnPDA;
    public readonly programRepo: ProgramRepositoryInterface;
    public readonly eventAuthority: PublicKey;

    /**
     * Creates an instance of the Uln class.
     *
     * @param {PublicKey} programId - The program public key.
     */
    constructor(
        public programId: PublicKey = ULN_PROGRAM_ID,
        rpc?: RpcInterface,
    ) {
        this.pda = new UlnPDA(programId);
        if (rpc === undefined) {
            rpc = createNullRpc();
            rpc.getCluster = (): Cluster => 'custom';
        }
        this.programRepo = createDefaultProgramRepository({ rpc }, [
            {
                name: 'uln',
                publicKey: programId,
                getErrorFromCode(code: number, cause?: Error): ProgramError | null {
                    return errors.getUlnErrorFromCode(code, this, cause);
                },
                getErrorFromName(name: string, cause?: Error): ProgramError | null {
                    return errors.getUlnErrorFromName(name, this, cause);
                },
                isOnCluster(): boolean {
                    return true;
                },
            } satisfies Program,
        ]);

        this.eventAuthority = new EventPDA(programId).eventAuthority()[0];
    }

    getProgram(clusterFilter: ClusterFilter = 'custom'): Program {
        return this.programRepo.get('uln', clusterFilter);
    }

    initUln(
        payer: Signer,
        param: { admin: PublicKey; eid: number; endpointProgram?: PublicKey },
    ): WrappedInstruction {
        const { admin, eid, endpointProgram } = param;
        const [msgLib] = this.pda.messageLib();
        const [endpointAuth] = new EndpointPDA(
            endpointProgram ?? ENDPOINT_PROGRAM_ID,
        ).messageLibraryInfo(msgLib);
        return instructions.initUln(
            { programs: this.programRepo, payer },
            {
                payer,
                uln: this.pda.setting(),
                // param
                eid,
                admin,
                endpoint: endpointAuth,
                endpointProgram: endpointProgram ?? ENDPOINT_PROGRAM_ID,
            },
        ).items[0];
    }

    /**
     * Initializes or updates the default configuration.
     * before calling this function, you should call initUln to initialize the uln
     *
     * @param {Connection} connection - The connection to the Solana cluster.
     * @param {PublicKey} admin - The admin public key.
     * @param {number} eid - The endpoint ID.
     * @param {types.UlnConfig} sendUlnConfig - The send ULN configuration.
     * @param {types.UlnConfig} receiveUlnConfig - The receive ULN configuration.
     * @param {types.ExecutorConfig} executorConfig - The executor configuration.
     * @param {Commitment | GetAccountInfoConfig} [commitmentOrConfig] - The commitment level or account info configuration.
     * @returns {Promise<TransactionInstruction>} A promise that resolves to the transaction instruction.
     */
    async initOrUpdateDefaultConfig(
        rpc: RpcInterface,
        admin: Signer,
        param: {
            remote: number;
            sendUlnConfig: Option<types.UlnConfig>;
            receiveUlnConfig: Option<types.UlnConfig>;
            executorConfig: Option<types.ExecutorConfig>;
        },
    ): Promise<WrappedInstruction> {
        const { remote, sendUlnConfig, receiveUlnConfig, executorConfig } = param;
        const [setting] = this.pda.setting();
        const [sendConfig] = this.pda.defaultSendConfig(remote);
        const [receiveConfigPDA] = this.pda.defaultReceiveConfig(remote);
        const sendConfigExists = await rpc.accountExists(sendConfig, { commitment: 'confirmed' });
        if (sendConfigExists) {
            // update default config
            return instructions.setDefaultConfig(
                { programs: this.programRepo },
                {
                    admin,
                    uln: setting,
                    sendConfig: sendConfig,
                    receiveConfig: receiveConfigPDA,
                    eventAuthority: this.eventAuthority,
                    program: this.programId,
                    // param
                    eid: remote,
                    sendUlnConfig,
                    receiveUlnConfig,
                    executorConfig,
                },
            ).items[0];
        } else {
            invariant(isSome(sendUlnConfig), 'sendUlnConfig is required');
            invariant(isSome(receiveUlnConfig), 'receiveUlnConfig is required');
            invariant(isSome(executorConfig), 'executorConfig is required');

            // init default config
            return instructions.initDefaultConfig(
                { programs: this.programRepo },
                {
                    admin,
                    uln: setting,
                    sendConfig: sendConfig,
                    receiveConfig: receiveConfigPDA,
                    eventAuthority: this.eventAuthority,
                    program: this.programId,
                    // param
                    eid: remote,
                    sendUlnConfig: sendUlnConfig.value,
                    receiveUlnConfig: receiveUlnConfig.value,
                    executorConfig: executorConfig.value,
                },
            ).items[0];
        }
    }

    // msg_lib -> msg_lib_program ->
    /**
     * Sets the treasury.
     * before calling this function, you should call initUln to initialize the uln
     *
     * @param {PublicKey} admin - The admin public key.
     * @param {object} treasury - The treasury object.
     * @param {PublicKey} treasury.admin - The treasury admin public key.
     * @param {PublicKey} treasury.nativeReceiver - The native receiver public key.
     * @param {number} treasury.nativeFeeBps - The native fee basis points.
     * @param {object} treasury.lzToken - The LZ token object.
     * @param {PublicKey} treasury.lzToken.receiver - The LZ token receiver public key.
     * @param {number} treasury.lzToken.fee - The LZ token fee.
     * @returns {Promise<TransactionInstruction>} A promise that resolves to the transaction instruction.
     */
    setTreasury(
        admin: Signer,
        treasury: {
            admin: PublicKey;
            nativeReceiver: PublicKey;
            nativeFeeBps: number;
            lzToken: { receiver: PublicKey; fee: number } | null;
        } | null,
    ): WrappedInstruction {
        return instructions.setTreasury(
            { programs: this.programRepo },
            {
                signer: admin,
                uln: this.pda.setting(),
                eventAuthority: this.eventAuthority,
                program: this.programId,
                // param
                treasury,
            },
        ).items[0];
    }

    transferAdmin(admin: Signer, newAdmin: PublicKey): WrappedInstruction {
        return instructions.transferAdmin(
            { programs: this.programRepo },
            {
                admin,
                uln: this.pda.setting(),
                eventAuthority: this.eventAuthority,
                program: this.programId,
            },
            { admin: newAdmin },
        ).items[0];
    }

    /**
     * Gets the account metadata for the CPI (Cross-Program Invocation) of the quote instruction.
     *
     * @param {RpcInterface} rpc - The connection to the Solana cluster.
     * @param {PublicKey} _payer - The payer public key.
     * @param {SolanaPacketPath} path - The packet path.
     * @param {Commitment} [commitment] - The commitment level.
     * @returns {Promise<AccountMeta[]>} A promise that resolves to an array of account metadata.
     */
    async getQuoteIXAccountMetaForCPI(
        rpc: RpcInterface,
        _payer: PublicKey,
        path: SolanaPacketPath,
        commitment: Commitment = 'confirmed',
    ): Promise<AccountMeta[]> {
        const { sender, dstEid } = path;
        // const sender = publicKey(arrayify(sender_))
        const txBuilder = instructions.quote(
            { programs: this.programRepo },
            {
                endpoint: createNoopSigner(defaultPublicKey()),
                uln: this.pda.setting(),
                sendConfig: this.pda.sendConfig(dstEid, sender),
                defaultSendConfig: this.pda.defaultSendConfig(dstEid),

                packet: {
                    nonce: 0,
                    srcEid: 0,
                    sender: defaultPublicKey(),
                    dstEid: 0,
                    receiver: new Uint8Array(32),
                    guid: new Uint8Array(32),
                    message: new Uint8Array(4),
                },
                options: new Uint8Array(4),
                payInLzToken: false,
            },
        );
        return txBuilder
            .addRemainingAccounts(
                await this.getSendIxRemainingAccounts(rpc, sender, dstEid, false, commitment),
            )
            .getInstructions()[0]
            .keys.slice(1);
    }

    /**
     * Gets the account metadata for the CPI (Cross-Program Invocation) of the send instruction.
     *
     * @param {Connection} connection - The connection to the Solana cluster.
     * @param {PublicKey} payer - The payer public key.
     * @param {PacketPath} path - The packet path.
     * @param {Commitment} [commitment='confirmed'] - The commitment level.
     * @returns {Promise<AccountMeta[]>} A promise that resolves to an array of account metadata.
     */
    async getSendIXAccountMetaForCPI(
        rpc: RpcInterface,
        payer: PublicKey,
        path: SolanaPacketPath,
        commitment: Commitment = 'confirmed',
    ): Promise<AccountMeta[]> {
        const { sender, dstEid } = path;

        const ulnState = await this.getSetting(rpc, commitment);
        let treasury: PublicKey | undefined;
        if (ulnState !== null && isSome(ulnState.treasury)) {
            treasury = ulnState.treasury.value.nativeReceiver;
        }

        let txBuilder = instructions.send(
            { payer: createNoopSigner(payer), programs: this.programRepo },
            {
                endpoint: createNoopSigner(defaultPublicKey()),
                payer: createNoopSigner(payer),
                uln: this.pda.setting(),
                sendConfig: this.pda.sendConfig(dstEid, sender),
                defaultSendConfig: this.pda.defaultSendConfig(dstEid),
                treasury,
                eventAuthority: this.eventAuthority,
                program: this.programId,

                // param
                packet: {
                    nonce: 0,
                    srcEid: 0,
                    sender: defaultPublicKey(),
                    dstEid: 0,
                    receiver: new Uint8Array(32),
                    guid: new Uint8Array(32),
                    message: new Uint8Array(4),
                },
                options: new Uint8Array(4),
                nativeFee: 0,
            },
        );
        txBuilder = txBuilder.addRemainingAccounts(
            await this.getSendIxRemainingAccounts(rpc, sender, dstEid, true, commitment),
        );
        const accounts = txBuilder.getInstructions()[0].keys.map((key) => {
            if (payer !== key.pubkey) {
                key.isSigner = false;
            }
            if (treasury !== undefined && key.pubkey === treasury) {
                key.isWritable = true;
            }
            return key;
        });
        return accounts.slice(1);
    }

    /***
     * Get the account meta of the send instruction for CPI(Cross-Program Invocation ) with lzToken
     */
    async getSendWithLzTokenIXAccountMetaForCPI(
        rpc: RpcInterface,
        accounts: {
            payer: PublicKey;
            tokenMint: PublicKey;
            tokenSource: PublicKey;
        },
        path: SolanaPacketPath,
        programs: {
            tokenProgram?: PublicKey;
            associatedTokenProgram?: PublicKey;
        },
        commitment: Commitment = 'confirmed',
    ): Promise<AccountMeta[]> {
        const { payer, tokenMint, tokenSource } = accounts;
        const { sender, dstEid } = path;

        const ulnState = await this.getSetting(rpc, commitment);
        invariant(ulnState !== null, 'ULN not initialized');
        invariant(isSome(ulnState.treasury), 'treasury not set');
        invariant(isSome(ulnState.treasury.value.lzToken), 'lzToken treasury not set');
        const lzTokenTreasury = ulnState.treasury.value.lzToken.value.receiver;

        let txBuilder = instructions.sendWithLzToken(
            { payer: createNoopSigner(payer), programs: this.programRepo },
            {
                endpoint: createNoopSigner(defaultPublicKey()),
                payer: createNoopSigner(payer),
                uln: this.pda.setting(),
                sendConfig: this.pda.sendConfig(dstEid, sender),
                defaultSendConfig: this.pda.defaultSendConfig(dstEid),
                lzTokenTreasury,
                eventAuthority: this.eventAuthority,
                program: this.programId,
                lzTokenSource: tokenSource,
                lzTokenMint: tokenMint,
                tokenProgram: programs.tokenProgram ?? fromWeb3JsPublicKey(TOKEN_PROGRAM_ID),
            },
            {
                packet: {
                    nonce: 0,
                    srcEid: 0,
                    sender: defaultPublicKey(),
                    dstEid: 0,
                    receiver: new Uint8Array(32),
                    guid: new Uint8Array(32),
                    message: new Uint8Array(4),
                },
                options: new Uint8Array(4),
                nativeFee: 0,
                lzTokenFee: 0,
                lzTokenMint: tokenMint,
            },
        );
        txBuilder = txBuilder.addRemainingAccounts(
            await this.getSendIxRemainingAccounts(rpc, sender, dstEid, true, commitment),
        );
        const keys = txBuilder.getInstructions()[0].keys.map((key) => {
            if (payer !== key.pubkey) {
                key.isSigner = false;
            }
            if (key.pubkey === lzTokenTreasury) {
                key.isWritable = true;
            }
            return key;
        });
        return keys.slice(1);
    }

    // 3 RPC requests
    /**
     * Gets the remaining accounts for the send instruction.
     *
     * @param {Connection} connection - The connection to the Solana cluster.
     * @param {PublicKey} sender - The sender public key.
     * @param {number} dstEid - The destination endpoint ID.
     * @param {boolean} payment - Indicates if payment is required.
     * @param {Commitment | GetAccountInfoConfig} [commitment='confirmed'] - The commitment level or account info configuration.
     * @returns {Promise<AccountMeta[]>} A promise that resolves to an array of account metadata.
     */
    async getSendIxRemainingAccounts(
        rpc: RpcInterface,
        sender: PublicKey,
        dstEid: number,
        payment: boolean,
        commitment: Commitment = 'confirmed',
    ): Promise<AccountMeta[]> {
        const { executor, dvns } = await this.getWorkers(rpc, sender, dstEid);

        const priceFeeds = new Array<PublicKey>();
        [executor.config, ...dvns.map((dvn) => dvn.config)].forEach((config) => {
            if (!priceFeeds.find((p) => p === config.priceFeed)) {
                priceFeeds.push(config.priceFeed);
            }
        });
        const priceFeedInfos = await rpc.getAccounts(priceFeeds, { commitment });
        const priceFeedDict = priceFeedInfos.reduce((acc, info, i) => {
            invariant(info.exists, `priceFeed:${priceFeeds[i]} not initialized`);
            acc.set(priceFeeds[i], info.owner);
            return acc;
        }, new Map<PublicKey, PublicKey>());
        const executorAccounts = new Executor(executor.owner).getQuoteIXAccountMetaForCPI(
            executor.config.priceFeed,
            priceFeedDict.get(executor.config.priceFeed)!,
            payment,
        );
        const dvnAccounts = dvns.map((p) => {
            return new DVN(p.owner).getQuoteIXAccountMetaForCPI(
                p.config.priceFeed,
                priceFeedDict.get(p.config.priceFeed)!,
                payment,
            );
        });
        return executorAccounts.concat(dvnAccounts.flat());
    }

    /**
     * Gets all workers (executor and DVN).
     * 2 RPC requests
     *
     * @param {Connection} connection - The connection to the Solana cluster.
     * @param {PublicKey} sender - The sender public key.
     * @param {number} eid - The endpoint ID.
     * @param {Commitment | GetAccountInfoConfig} [commitment='confirmed'] - The commitment level or account info configuration.
     * @returns {Promise<{ executor: { config: ExecutorAccounts.ExecutorConfig; owner: PublicKey }; dvns: { config: DvnAccounts.DvnConfig; owner: PublicKey }[] }>} A promise that resolves to an object containing the executor and DVN configurations.
     */
    async getWorkers(
        rpc: RpcInterface,
        sender: PublicKey,
        eid: number,
        commitment: Commitment = 'confirmed',
    ): Promise<{
        executor: { config: ExecutorAccounts.ExecutorConfig; owner: PublicKey };
        dvns: { config: DvnAccounts.DvnConfig; owner: PublicKey }[];
    }> {
        const [defaultSendConfig] = this.pda.defaultSendConfig(eid);
        const [sendConfig] = this.pda.sendConfig(eid, sender);
        const [defaultSendConfigBuf, sendConfigBuf] = await rpc.getAccounts(
            [defaultSendConfig, sendConfig],
            {
                commitment,
            },
        );
        invariant(defaultSendConfigBuf.exists, 'defaultSendConfig not initialized');

        const defaultSendConfigState = accounts.deserializeSendConfig(defaultSendConfigBuf);
        const sendConfigState = sendConfigBuf.exists
            ? accounts.deserializeSendConfig(sendConfigBuf)
            : null;

        const finalConfigState = this.getUlnConfigState(defaultSendConfigState, sendConfigState);
        const finalExecutorConfigState = this.getExecutorConfigState(
            defaultSendConfigState,
            sendConfigState,
        );

        const { requiredDvns, optionalDvns } = finalConfigState;
        const { executor } = finalExecutorConfigState;
        const dvns = requiredDvns.concat(optionalDvns);
        const [executorBuf, ...dvnBuf] = await rpc.getAccounts([executor, ...dvns], {
            commitment,
        });
        invariant(executorBuf.exists, `executor:${executor} not initialized`);

        return {
            executor: {
                config: ExecutorAccounts.deserializeExecutorConfig(executorBuf),
                owner: executorBuf.owner,
            },
            dvns: dvnBuf.map((dvn, i) => {
                invariant(dvn.exists, `dvn:${dvns[i]} not initialized`);
                return {
                    config: DvnAccounts.deserializeDvnConfig(dvn),
                    owner: dvn.owner,
                };
            }),
        };
    }

    /**
     * Initializes the verification process.
     *
     */
    initVerify(
        payer: Signer,
        param: { dvn: PublicKey; packetBytes: Uint8Array },
    ): WrappedInstruction {
        const { dvn, packetBytes } = param;
        const packet = PacketV1Codec.fromBytes(packetBytes);
        const headerHash = packet.headerHash();
        const headerHashBytes = hexToBytes(headerHash);
        const payloadHash = packet.payloadHash();
        const payloadHashBytes = hexToBytes(payloadHash);
        // const confirmationsInfo = await rpc.getAccount(confirmationsPDA, { commitment })
        // if (confirmationsInfo.exists) {
        //     // throw new Error('init verify already executed')
        //     return null
        // }
        return instructions.initVerify(
            { programs: this.programRepo, payer },
            {
                payer,
                confirmations: this.pda.confirmations(headerHashBytes, payloadHashBytes, dvn),
                // param
                packetHeader: hexToBytes(packet.header()),
                payloadHash: payloadHashBytes,
                dvn,
            },
        ).items[0];
    }

    verify(
        dvn: Signer,
        param: { packetBytes: Uint8Array; confirmations: number | bigint },
    ): WrappedInstruction {
        const { packetBytes, confirmations } = param;
        const packet = PacketV1Codec.fromBytes(packetBytes);
        const headerHash = packet.headerHash();
        const headerHashBytes = hexToBytes(headerHash);
        const payloadHash = packet.payloadHash();
        const payloadHashBytes = hexToBytes(payloadHash);
        return instructions.verify(
            { programs: this.programRepo },
            {
                dvn,
                confirmations: this.pda.confirmations(
                    headerHashBytes,
                    payloadHashBytes,
                    dvn.publicKey,
                ),
                eventAuthority: this.eventAuthority,
                program: this.programId,
            },
            {
                packetHeader: hexToBytes(packet.header()),
                payloadHash: payloadHashBytes,
                confirmations: confirmations,
            },
        ).items[0];
    }

    closeVerify(
        dvn: Signer,
        param: { receiver: PublicKey; packetBytes: Uint8Array },
    ): WrappedInstruction {
        const { receiver, packetBytes } = param;
        const packet = PacketV1Codec.fromBytes(packetBytes);
        const headerHash = packet.headerHash();
        const headerHashBytes = hexToBytes(headerHash);
        const payloadHash = packet.payloadHash();
        const payloadHashBytes = hexToBytes(payloadHash);
        return instructions.closeVerify(
            { programs: this.programRepo },
            {
                dvn,
                receiver,
                confirmations: this.pda.confirmations(
                    headerHashBytes,
                    payloadHashBytes,
                    dvn.publicKey,
                ),

                // param
                packetHeaderHash: headerHashBytes,
                payloadHash: payloadHashBytes,
            },
        ).items[0];
    }

    /**
     * Checks if the DVN is verified.
     *
     * @param {Connection} connection - The connection to the Solana cluster.
     * @param {PublicKey} endpointProgram - The endpoint program public key.
     * @param {PublicKey} dvn - The DVN public key.
     * @param {Uint8Array} packetBytes - The packet bytes.
     * @param {Commitment | GetAccountInfoConfig} [commitmentOrConfig='confirmed'] - The commitment level or account info configuration.
     * @returns {Promise<boolean>} A promise that resolves to true if the DVN is verified, false otherwise.
     */
    async isDvnVerified(
        rpc: RpcInterface,
        endpointProgram: PublicKey,
        dvn: PublicKey,
        packetBytes: Uint8Array,
        commitment: Commitment = 'confirmed',
    ): Promise<boolean> {
        const packet = PacketV1Codec.fromBytes(packetBytes);
        const headerHash = packet.headerHash();
        const headerHashBytes = hexToBytes(headerHash);
        const payloadHash = packet.payloadHash();
        const payloadHashBytes = hexToBytes(payloadHash);
        const [confirmationsPDA] = this.pda.confirmations(headerHashBytes, payloadHashBytes, dvn);
        const endpoint = new EndpointProgram.Endpoint(endpointProgram);
        const receiver = publicKey(hexToBytes(packet.receiver()));
        const sender = hexToBytes(packet.sender());
        const nonce = await endpoint.getNonce(rpc, receiver, packet.srcEid(), sender, commitment);
        const pendingNonce = await endpoint.getPendingInboundNonce(
            rpc,
            receiver,
            packet.srcEid(),
            sender,
            commitment,
        );
        if (!nonce || !pendingNonce) {
            return false;
        }

        // after lzReceive, the inboundNonce is increased by 1
        if (parseInt(nonce.inboundNonce.toString()) >= parseInt(packet.nonce())) {
            return true;
        }
        // after commitVerification, the nonce is added to pendingNonce
        if (pendingNonce.nonces.find((n) => n.toString() === packet.nonce()) !== undefined) {
            return true;
        }

        // before commitVerification, should call initVerify and verify
        const confirmation = await accounts.safeFetchConfirmations({ rpc }, confirmationsPDA, {
            commitment,
        });
        if (confirmation?.value == null) {
            // initial value is null not verified
            return false;
        } else {
            // TODO check confirmation value
            return true;
        }
    }

    /**
     * Commits the verification process.
     *
     * @param {Connection} connection - The connection to the Solana cluster.
     * @param {PublicKey} endpointProgram - The endpoint program public key.
     * @param {Uint8Array} packetBytes - The packet bytes.
     * @returns {Promise<TransactionInstruction>} A promise that resolves to the transaction instruction.
     */
    async commitVerification(
        rpc: RpcInterface,
        packetBytes: Uint8Array,
        endpointProgram: PublicKey = ENDPOINT_PROGRAM_ID,
    ): Promise<WrappedInstruction> {
        const packet = PacketV1Codec.fromBytes(packetBytes);
        const payloadHash = packet.payloadHash();
        const srcEid = packet.srcEid();
        const receiver = publicKey(hexToBytes(packet.receiver()));
        const payloadHashBytes = hexToBytes(payloadHash);

        const [msgLib] = this.pda.messageLib();
        const receiveConfigState = await this.getFinalReceiveConfigState(rpc, receiver, srcEid);

        const headerHash = packet.headerHash();
        const headerHashBytes = hexToBytes(headerHash);

        const confirmations: AccountMeta[] = receiveConfigState.requiredDvns
            .concat(receiveConfigState.optionalDvns)
            .map((p) => {
                const [confirmationsPDA] = this.pda.confirmations(
                    headerHashBytes,
                    payloadHashBytes,
                    p,
                );
                return {
                    pubkey: confirmationsPDA,
                    isSigner: false,
                    isWritable: true,
                };
            });
        const endpoint = new EndpointProgram.Endpoint(endpointProgram);
        const verifyAccounts = endpoint.getVerifyIXAccountMetaForCPI(packet, msgLib);

        const txBuilder = instructions.commitVerification(
            { programs: this.programRepo },
            {
                uln: this.pda.setting(),
                defaultReceiveConfig: this.pda.defaultReceiveConfig(srcEid),
                receiveConfig: this.pda.receiveConfig(srcEid, receiver),

                // param
                packetHeader: hexToBytes(packet.header()),
                payloadHash: payloadHashBytes,
            },
        );
        return txBuilder.addRemainingAccounts(confirmations.concat(verifyAccounts)).items[0];
    }

    /**
     * Gets the account metadata for the CPI (Cross-Program Invocation) of the init config instruction.
     *
     * @param {PublicKey} payer - The payer public key.
     * @param {PublicKey} oappID - The OApp ID public key.
     * @param {number} eid - The endpoint ID.
     * @returns {AccountMeta[]} An array of account metadata.
     */
    getInitConfigIXAccountMetaForCPI(
        payer: PublicKey,
        oappID: PublicKey,
        eid: number,
    ): AccountMeta[] {
        const txBuilder = instructions.initConfig(
            { payer: createNoopSigner(payer), programs: this.programRepo },
            {
                endpoint: createNoopSigner(defaultPublicKey()),
                payer: createNoopSigner(payer),
                uln: this.pda.setting(),
                sendConfig: this.pda.sendConfig(eid, oappID),
                receiveConfig: this.pda.receiveConfig(eid, oappID),

                // params
                oapp: defaultPublicKey(),
                eid: 0,
            },
        );
        const accounts = txBuilder.getInstructions()[0].keys.map((key) => {
            if (payer !== key.pubkey) {
                key.isSigner = false;
            }
            return key;
        });
        return accounts.slice(1);
    }

    /**
     * Constructs the set config data.
     *
     * @param {SetConfigType} configType - The configuration type.
     * @param {types.ExecutorConfig | types.UlnConfig} configData - The configuration data.
     * @returns {Uint8Array} The constructed set config data.
     * @throws {Error} If the configuration type is invalid.
     */
    static constructSetConfigData(
        configType: SetConfigType,
        configData: types.ExecutorConfig | types.UlnConfig,
    ): Uint8Array {
        switch (configType) {
            case SetConfigType.EXECUTOR: {
                return types
                    .getExecutorConfigSerializer()
                    .serialize(configData as types.ExecutorConfig);
            }
            case SetConfigType.SEND_ULN:
            case SetConfigType.RECEIVE_ULN: {
                return types.getUlnConfigSerializer().serialize(configData as types.UlnConfig);
            }
            default:
                throw new Error(`invalid config type: ${configType as number}`);
        }
    }

    /**
     * Gets the account metadata for the CPI (Cross-Program Invocation) of the set config instruction.
     *
     * @param {PublicKey} endpointProgram - The endpoint program public key.
     * @param {PublicKey} oappID - The OApp ID public key.
     * @param {number} eid - The endpoint ID.
     * @returns {Promise<AccountMeta[]>} A promise that resolves to an array of account metadata.
     */
    getSetConfigIXAccountMetaForCPI(
        oapp: PublicKey,
        eid: number,
        endpointProgram: PublicKey = ENDPOINT_PROGRAM_ID,
    ): AccountMeta[] {
        const [msgLib] = this.pda.messageLib();
        const [msgLibInfo] = new EndpointPDA(endpointProgram).messageLibraryInfo(msgLib);

        const txBuilder = instructions.setConfig(
            { programs: this.programRepo },
            {
                endpoint: createNoopSigner(msgLibInfo),
                uln: this.pda.setting(),
                sendConfig: this.pda.sendConfig(eid, oapp),
                defaultSendConfig: this.pda.defaultSendConfig(eid),
                defaultReceiveConfig: this.pda.defaultReceiveConfig(eid),
                receiveConfig: this.pda.receiveConfig(eid, oapp),
                eventAuthority: this.eventAuthority,
                program: this.programId,
                // param
                oapp: defaultPublicKey(),
                eid: 0,
                configType: 0,
                config: new Uint8Array(32),
            },
        );
        return txBuilder.getInstructions()[0].keys.slice(1);
    }

    /**
     * Gets the ULN settings.
     *
     * @param {RpcInterface} rpc - The connection to the Solana cluster.
     * @param {Commitment} [commitment] - The commitment level or account info configuration.
     * @returns {Promise<accounts.UlnSettings | null>} A promise that resolves to the ULN settings or null if not found.
     */
    async getSetting(
        rpc: RpcInterface,
        commitment: Commitment = 'confirmed',
    ): Promise<accounts.UlnSettings | null> {
        const [setting] = this.pda.setting();
        return accounts.safeFetchUlnSettings({ rpc }, setting, { commitment });
    }

    /**
     * Gets the default send configuration state.
     *
     * @param {Connection} connection - The connection to the Solana cluster.
     * @param {number} eid - The endpoint ID.
     * @param {Commitment | GetAccountInfoConfig} [commitmentOrConfig] - The commitment level or account info configuration.
     * @returns {Promise<accounts.SendConfig | null>} A promise that resolves to the default send configuration state or null if not found.
     */
    async getDefaultSendConfigState(
        rpc: RpcInterface,
        eid: number,
        commitment: Commitment = 'confirmed',
    ): Promise<accounts.SendConfig | null> {
        const [config] = this.pda.defaultSendConfig(eid);
        return accounts.safeFetchSendConfig({ rpc }, config, { commitment });
    }

    /**
     * Gets the send configuration state.
     *
     * @param {Connection} connection - The connection to the Solana cluster.
     * @param {PublicKey} sender - The sender public key.
     * @param {number} eid - The endpoint ID.
     * @param {Commitment | GetAccountInfoConfig} [commitmentOrConfig] - The commitment level or account info configuration.
     * @returns {Promise<accounts.SendConfig | null>} A promise that resolves to the send configuration state or null if not found.
     */
    async getSendConfigState(
        rpc: RpcInterface,
        sender: PublicKey,
        eid: number,
        commitment: Commitment = 'confirmed',
    ): Promise<accounts.SendConfig | null> {
        const [config] = this.pda.sendConfig(eid, sender);
        return accounts.safeFetchSendConfig({ rpc }, config, { commitment });
    }

    /**
     * Gets the default receive configuration state.
     *
     * @param {Connection} connection - The connection to the Solana cluster.
     * @param {number} eid - The endpoint ID.
     * @param {Commitment | GetAccountInfoConfig} [commitmentOrConfig] - The commitment level or account info configuration.
     * @returns {Promise<accounts.ReceiveConfig | null>} A promise that resolves to the default receive configuration state or null if not found.
     */
    async getDefaultReceiveConfigState(
        rpc: RpcInterface,
        eid: number,
        commitment: Commitment = 'confirmed',
    ): Promise<accounts.ReceiveConfig | null> {
        const [config] = this.pda.defaultReceiveConfig(eid);
        return accounts.safeFetchReceiveConfig({ rpc }, config, { commitment });
    }

    /**
     * Gets the receive configuration state.
     *
     * @param {Connection} connection - The connection to the Solana cluster.
     * @param {PublicKey} receiver - The receiver public key.
     * @param {number} eid - The endpoint ID.
     * @param {Commitment | GetAccountInfoConfig} [commitmentOrConfig] - The commitment level or account info configuration.
     * @returns {Promise<accounts.ReceiveConfig | null>} A promise that resolves to the receive configuration state or null if not found.
     */
    async getReceiveConfigState(
        rpc: RpcInterface,
        receiver: PublicKey,
        eid: number,
        commitment: Commitment = 'confirmed',
    ): Promise<accounts.ReceiveConfig | null> {
        const [config] = this.pda.receiveConfig(eid, receiver);
        return accounts.safeFetchReceiveConfig({ rpc }, config, { commitment });
    }

    /**
     * Gets the final receive configuration state.
     *
     * @param {Connection} connection - The connection to the Solana cluster.
     * @param {PublicKey} receiver - The receiver public key.
     * @param {number} eid - The endpoint ID.
     * @param {Commitment | GetAccountInfoConfig} [commitmentOrConfig='confirmed'] - The commitment level or account info configuration.
     * @returns {Promise<accounts.ReceiveConfig>} A promise that resolves to the final receive configuration state.
     * @throws {Error} If no DVN is found.
     */
    async getFinalReceiveConfigState(
        rpc: RpcInterface,
        receiver: PublicKey,
        eid: number,
        commitment: Commitment = 'confirmed',
    ): Promise<types.UlnConfig> {
        const [defaultConfig] = this.pda.defaultReceiveConfig(eid);
        const [customConfig] = this.pda.receiveConfig(eid, receiver);

        const [defaultConfigInfo, customConfigInfo] = await rpc.getAccounts(
            [defaultConfig, customConfig],
            {
                commitment,
            },
        );
        if (!defaultConfigInfo.exists) {
            throw new Error(`please init default receive config first. ${defaultConfig}`);
        }
        const defaultConfigState = accounts.deserializeReceiveConfig(defaultConfigInfo);
        const customConfigState = customConfigInfo.exists
            ? accounts.deserializeReceiveConfig(customConfigInfo)
            : null;
        return this.getUlnConfigState(defaultConfigState, customConfigState);
    }

    async getFinalSendConfigState(
        rpc: RpcInterface,
        sender: PublicKey,
        eid: number,
        commitment: Commitment = 'confirmed',
    ): Promise<types.UlnConfig> {
        const [defaultConfig] = this.pda.defaultSendConfig(eid);
        const [customConfig] = this.pda.sendConfig(eid, sender);

        const [defaultConfigInfo, customConfigInfo] = await rpc.getAccounts(
            [defaultConfig, customConfig],
            {
                commitment,
            },
        );
        if (!defaultConfigInfo.exists) {
            throw new Error(`please init default send config first. ${defaultConfig}`);
        }
        const defaultConfigState = accounts.deserializeSendConfig(defaultConfigInfo);
        const customConfigState = customConfigInfo.exists
            ? accounts.deserializeSendConfig(customConfigInfo)
            : null;
        return this.getUlnConfigState(defaultConfigState, customConfigState);
    }

    private getUlnConfigState(
        defaultConfigState: accounts.ReceiveConfig | accounts.SendConfig,
        customConfigState: accounts.ReceiveConfig | accounts.SendConfig | null,
    ): types.UlnConfig {
        const NIL_CONFIRMATIONS = '18446744073709551615'; // max uint64
        const NIL_DVN_COUNT = '255';

        const rtn_config: types.UlnConfig = {
            confirmations: 0n,
            requiredDvnCount: 0,
            optionalDvnCount: 0,
            optionalDvnThreshold: 0,
            requiredDvns: [],
            optionalDvns: [],
        };

        if (customConfigState == null || customConfigState.uln.confirmations === 0n) {
            rtn_config.confirmations = defaultConfigState.uln.confirmations;
        } else if (customConfigState.uln.confirmations.toString() !== NIL_CONFIRMATIONS) {
            rtn_config.confirmations = customConfigState.uln.confirmations;
        }

        if (customConfigState == null || customConfigState.uln.requiredDvnCount == 0) {
            if (defaultConfigState.uln.requiredDvnCount > 0) {
                rtn_config.requiredDvns = defaultConfigState.uln.requiredDvns;
                rtn_config.requiredDvnCount = defaultConfigState.uln.requiredDvnCount;
            }
        } else if (customConfigState.uln.requiredDvnCount.toString() !== NIL_DVN_COUNT) {
            rtn_config.requiredDvns = customConfigState.uln.requiredDvns;
            rtn_config.requiredDvnCount = customConfigState.uln.requiredDvnCount;
        }

        if (customConfigState == null || customConfigState.uln.optionalDvnCount == 0) {
            if (defaultConfigState.uln.optionalDvnCount > 0) {
                rtn_config.optionalDvns = defaultConfigState.uln.optionalDvns;
                rtn_config.optionalDvnCount = defaultConfigState.uln.optionalDvnCount;
                rtn_config.optionalDvnThreshold = defaultConfigState.uln.optionalDvnThreshold;
            }
        } else if (customConfigState.uln.optionalDvnCount.toString() !== NIL_DVN_COUNT) {
            rtn_config.optionalDvns = customConfigState.uln.optionalDvns;
            rtn_config.optionalDvnCount = customConfigState.uln.optionalDvnCount;
            rtn_config.optionalDvnThreshold = customConfigState.uln.optionalDvnThreshold;
        }

        if (rtn_config.requiredDvnCount === 0 && rtn_config.optionalDvnCount === 0) {
            throw new Error('no dvn');
        }
        return rtn_config;
    }

    private getExecutorConfigState(
        defaultConfigState: accounts.SendConfig,
        customConfigState: accounts.SendConfig | null,
    ): types.ExecutorConfig {
        const rtn_config: types.ExecutorConfig = {
            maxMessageSize: 0,
            executor: defaultPublicKey(),
        };

        if (
            customConfigState == null ||
            customConfigState.executor.executor === defaultPublicKey()
        ) {
            rtn_config.executor = defaultConfigState.executor.executor;
        } else {
            rtn_config.executor = customConfigState.executor.executor;
        }

        if (customConfigState == null || customConfigState.executor.maxMessageSize === 0) {
            rtn_config.maxMessageSize = defaultConfigState.executor.maxMessageSize;
        } else {
            rtn_config.maxMessageSize = customConfigState.executor.maxMessageSize;
        }

        return rtn_config;
    }
}
