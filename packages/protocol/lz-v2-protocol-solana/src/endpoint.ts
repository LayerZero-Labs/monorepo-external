import type {
    AccountMeta,
    Cluster,
    ClusterFilter,
    Commitment,
    Program,
    ProgramError,
    ProgramRepositoryInterface,
    PublicKey,
    RpcInterface,
    Signer,
    TransactionBuilder,
    WrappedInstruction,
} from '@metaplex-foundation/umi';
import {
    createNoopSigner,
    createNullRpc,
    defaultPublicKey,
    isSome,
    publicKey,
    some,
} from '@metaplex-foundation/umi';
import { createDefaultProgramRepository } from '@metaplex-foundation/umi-program-repository';
import { toWeb3JsPublicKey } from '@metaplex-foundation/umi-web3js-adapters';
import { keccak_256 } from '@noble/hashes/sha3';
import { TransactionInstruction } from '@solana/web3.js';
import invariant from 'tiny-invariant';

import { hexToBytes } from '@layerzerolabs/common-encoding-utils';
import type { PacketV1Codec } from '@layerzerolabs/protocol-codecs-v2';
import { addressToBytes32 } from '@layerzerolabs/protocol-codecs-v2';

import type { MessageLibInterface, SetConfigType, SolanaPacketPath } from '.';
import {
    BlockedMessageLibProgram,
    SimpleMessageLibProgram,
    simulateWeb3JsTransaction,
    UlnProgram,
} from '.';
import { ENDPOINT_PROGRAM_ID } from './generated/endpoint';
import * as accounts from './generated/endpoint/accounts';
import * as errors from './generated/endpoint/errors';
import * as events from './generated/endpoint/events';
import * as instructions from './generated/endpoint/instructions';
import * as types from './generated/endpoint/types';
import type { Version } from './generated/simple_messagelib';
import { SIMPLE_MESSAGELIB_PROGRAM_ID } from './generated/simple_messagelib';
import { EndpointPDA, EventPDA, MessageLibPDA } from './pda';

export { accounts, errors, events, instructions, types };
export { ENDPOINT_PROGRAM_ID } from './generated/endpoint';

// https://github.com/coral-xyz/anchor/blob/c7ccbb8f620aed3ffecf8ab2f9c9007946f0f5cc/lang/src/event.rs#L2
export const EventEmitDiscriminator = 'e445a52e51cb9a1d'; // Sha256(anchor:event)[..8] then evert

export const DefaultMessageLib = defaultPublicKey(); // [0u8; 32]

/**
 * Class representing an Endpoint.
 */
export class Endpoint {
    public readonly pda: EndpointPDA;
    public readonly eventAuthority: PublicKey;
    public readonly programRepo: ProgramRepositoryInterface;

    constructor(
        public programId: PublicKey = ENDPOINT_PROGRAM_ID,
        rpc?: RpcInterface,
    ) {
        this.pda = new EndpointPDA(programId);
        if (rpc === undefined) {
            rpc = createNullRpc();
            rpc.getCluster = (): Cluster => 'custom';
        }
        this.programRepo = createDefaultProgramRepository({ rpc: rpc }, [
            {
                name: 'endpoint',
                publicKey: programId,
                getErrorFromCode(code: number, cause?: Error): ProgramError | null {
                    return errors.getEndpointErrorFromCode(code, this, cause);
                },
                getErrorFromName(name: string, cause?: Error): ProgramError | null {
                    return errors.getEndpointErrorFromName(name, this, cause);
                },
                isOnCluster(): boolean {
                    return true;
                },
            } satisfies Program,
        ]);
        this.eventAuthority = new EventPDA(programId).eventAuthority()[0];
    }

    getProgram(clusterFilter: ClusterFilter = 'custom'): Program {
        return this.programRepo.get('endpoint', clusterFilter);
    }

    /**
     * Initializes the endpoint settings, including eid and admin, and registers the blocked message library.
     *
     * @param {number} endpointId - The endpoint ID.
     * @param {PublicKey} payer - The payer public key.
     * @param {PublicKey} admin - The admin public key.
     * @returns {TransactionInstruction} The transaction instruction.
     */
    initEndpoint(payer: Signer, params: { eid: number; admin: PublicKey }): WrappedInstruction {
        const txBuilder = instructions.initEndpoint(
            {
                programs: this.programRepo,
                payer,
            },
            {
                payer,
                endpoint: this.pda.setting(),
                eid: params.eid,
                admin: params.admin,
            },
        );
        return txBuilder.items[0];
    }

    /**
     * Registers a library.
     * call this function after endpoint initialized. Only admin can call this function.
     *
     * @param {PublicKey} admin - The admin public key.
     * @param {PublicKey} messageLibProgram - The message library program public key.
     * @param {types.MessageLibType} [libType=types.MessageLibType.SendAndReceive] - The library type.
     * @returns {TransactionInstruction} The transaction instruction.
     */
    registerLibrary(
        admin: Signer,
        params: { messageLibProgram: PublicKey; libType?: types.MessageLibType },
    ): WrappedInstruction {
        const [msgLib] = new MessageLibPDA(params.messageLibProgram).messageLib();
        return instructions.registerLibrary(
            {
                programs: this.programRepo,
            },
            {
                admin,
                endpoint: this.pda.setting(),
                messageLibInfo: this.pda.messageLibraryInfo(msgLib),
                eventAuthority: this.eventAuthority,
                program: this.programId,
                libProgram: params.messageLibProgram,
                libType: params.libType ?? types.MessageLibType.SendAndReceive,
            },
        ).items[0];
    }

    /**
     * Sets the default send library for a given remote endpoint.
     * This function configures the default message library for sending messages to a specified remote endpoint.
     * It requires administrative privileges to execute.
     *
     * @param {RpcInterface} rpc - The connection to the Solana cluster.
     * @param {Signer} admin - The admin public key.
     * @param {PublicKey} messageLibProgram - The message library program public key.
     * @param {number} dstEid - The destination endpoint ID.
     * @param {Commitment | GetAccountInfoConfig} [commitmentOrConfig] - The commitment level or account info configuration.
     * @returns {Promise<TransactionInstruction | null>} A promise that resolves to the transaction instruction or null if not needed.
     * This method initializes or updates the default send library configuration for a specified remote endpoint.
     * If the configuration does not exist, it initializes it. Otherwise, it updates the existing configuration.
     */
    async setDefaultSendLibrary(
        rpc: RpcInterface,
        admin: Signer,
        params: { messageLibProgram: PublicKey; remote: number },
    ): Promise<WrappedInstruction> {
        const [msgLib] = new MessageLibPDA(params.messageLibProgram).messageLib();
        const [defaultSendLibConfig] = this.pda.defaultSendLibraryConfig(params.remote);
        const [setting] = this.pda.setting();
        const [msgLibInfo] = this.pda.messageLibraryInfo(msgLib);

        const defaultSendLibConfigInfo = await rpc.getAccount(defaultSendLibConfig, {
            commitment: 'confirmed',
        });
        let txBuilder: TransactionBuilder;
        if (!defaultSendLibConfigInfo.exists) {
            txBuilder = instructions.initDefaultSendLibrary(
                { programs: this.programRepo },
                {
                    admin,
                    endpoint: setting,
                    defaultSendLibraryConfig: defaultSendLibConfig,
                    messageLibInfo: msgLibInfo,
                    program: this.programId,
                    eventAuthority: this.eventAuthority,
                    // params
                    eid: params.remote,
                    newLib: msgLib,
                },
            );
        } else {
            // need to check if the new lib is the same as the current one
            // if (defaultSendLibConfigInfo.messageLib === msgLib) {
            //     return null
            // }
            txBuilder = instructions.setDefaultSendLibrary(
                {
                    programs: this.programRepo,
                },
                {
                    admin,
                    endpoint: setting,
                    defaultSendLibraryConfig: defaultSendLibConfig,
                    messageLibInfo: msgLibInfo,
                    program: this.programId,
                    eventAuthority: this.eventAuthority,
                    // params
                    eid: params.remote,
                    newLib: msgLib,
                },
            );
        }
        return txBuilder.items[0];
    }

    /**
     * Sets the default receive library for a given endpoint.
     * This function configures the default message library for receiving messages at a specified endpoint.
     * It requires administrative privileges to execute.
     *
     * @param {Connection} connection - The connection to the Solana cluster.
     * @param {PublicKey} admin - The admin public key.
     * @param {PublicKey} messageLibProgram - The message library program public key.
     * @param {number} srcEid - The source endpoint ID.
     * @param {Commitment | GetAccountInfoConfig} [commitmentOrConfig] - The commitment level or account info configuration.
     * @returns {Promise<TransactionInstruction | null>} A promise that resolves to the transaction instruction or null if not needed.
     * This method initializes or updates the default receive library configuration for a specified remote endpoint.
     * If the configuration does not exist, it initializes it. Otherwise, it updates the existing configuration.
     */
    async setDefaultReceiveLibrary(
        rpc: RpcInterface,
        admin: Signer,
        params: { messageLibProgram: PublicKey; remote: number; gracePeriod?: bigint | number },
    ): Promise<WrappedInstruction> {
        const [msgLib] = new MessageLibPDA(params.messageLibProgram).messageLib();
        const [defaultReceiveLibConfig] = this.pda.defaultReceiveLibraryConfig(params.remote);
        const [setting] = this.pda.setting();
        const [defaultMsgLibInfo] = this.pda.messageLibraryInfo(msgLib);
        const defaultReceiveLibConfigInfo = await rpc.getAccount(defaultReceiveLibConfig, {
            commitment: 'confirmed',
        });
        let txBuilder: TransactionBuilder;
        if (!defaultReceiveLibConfigInfo.exists) {
            txBuilder = instructions.initDefaultReceiveLibrary(
                { programs: this.programRepo },
                {
                    admin,
                    endpoint: setting,
                    defaultReceiveLibraryConfig: defaultReceiveLibConfig,
                    messageLibInfo: defaultMsgLibInfo,
                    program: this.programId,
                    eventAuthority: this.eventAuthority,
                    // param
                    eid: params.remote,
                    newLib: msgLib,
                },
            );
        } else {
            // need to check if the new lib is the same as the current one
            // if (defaultReceiveLibConfigInfo.messageLib === msgLib) {
            //     return null
            // }
            txBuilder = instructions.setDefaultReceiveLibrary(
                { programs: this.programRepo },
                {
                    admin,
                    endpoint: setting,
                    defaultReceiveLibraryConfig: defaultReceiveLibConfig,
                    messageLibInfo: defaultMsgLibInfo,
                    program: this.programId,
                    eventAuthority: this.eventAuthority,

                    // param
                    eid: params.remote,
                    newLib: msgLib,
                    gracePeriod: params.gracePeriod ?? 0,
                },
            );
        }
        return txBuilder.items[0];
    }

    /**
     * Sets the default receive library timeout for a given message library program and remote endpoint.
     *
     * @param admin - The signer who has administrative privileges to set the timeout.
     * @param param - An object containing the following properties:
     *   @param param.msgLibProgram - The public key of the message library program.
     *   @param param.remote - The remote endpoint identifier.
     *   @param param.expiry - The expiry time for the timeout, can be a bigint or number.
     * @returns A WrappedInstruction object representing the instruction to set the default receive library timeout.
     */
    setDefaultReceiveLibraryTimeout(
        admin: Signer,
        params: { msgLibProgram: PublicKey; remote: number; expiry: bigint | number },
    ): WrappedInstruction {
        const [msgLib] = new MessageLibPDA(params.msgLibProgram).messageLib();
        return instructions.setDefaultReceiveLibraryTimeout(
            { programs: this.programRepo },
            {
                admin,
                endpoint: this.pda.setting(),
                program: this.programId,
                eventAuthority: this.eventAuthority,
                defaultReceiveLibraryConfig: this.pda.defaultReceiveLibraryConfig(params.remote),
                messageLibInfo: this.pda.messageLibraryInfo(msgLib),
                // param
                eid: params.remote,
                lib: msgLib,
                expiry: params.expiry,
            },
        ).items[0];
    }

    setLzToken(admin: Signer, lzToken: PublicKey | null): WrappedInstruction {
        return instructions.setLzToken(
            { programs: this.programRepo },
            {
                admin: admin,
                endpoint: this.pda.setting(),
                eventAuthority: this.eventAuthority,
                program: this.programId,
                lzToken: lzToken == null ? null : some(lzToken),
            },
        ).items[0];
    }

    withdrawRent(
        admin: Signer,
        params: { amount: bigint; receiver: PublicKey },
    ): WrappedInstruction {
        const { amount, receiver } = params;
        return instructions.withdrawRent(
            { programs: this.programRepo },
            {
                admin: admin,
                endpoint: this.pda.setting(),
                eventAuthority: this.eventAuthority,
                program: this.programId,
                // param
                amount,
                receiver,
            },
        ).items[0];
    }

    /**
     * Initializes the OApp configuration.
     *
     * @param accounts - The accounts object.
     * @param accounts.delegate - The delegate public key.
     * @param accounts.payer - The payer public key.
     * @param params - The parameters object.
     *  @param params.msgLibSDK - The message library SDK.
     *  @param params.oapp - The OApp ID public key.
     *  @param params.remote - The endpoint ID.
     * @returns A WrappedInstruction object representing the instruction to initialize the OApp configuration.
     */
    initOAppConfig(
        accounts: { delegate: Signer; payer: PublicKey },
        params: {
            msgLibSDK: MessageLibInterface;
            oapp: PublicKey; // this is the PDA of the oapp
            remote: number;
        },
    ): WrappedInstruction {
        const [msgLib] = new MessageLibPDA(params.msgLibSDK.programId).messageLib();
        // if (!(await uln.getOappConfig(connection, oappID, eid, commitmentOrConfig))) {
        // init oapp config
        const txBuilder = instructions.initConfig(
            { programs: this.programRepo },
            {
                delegate: accounts.delegate,
                oappRegistry: this.pda.oappRegistry(params.oapp),
                messageLib: msgLib,
                messageLibInfo: this.pda.messageLibraryInfo(msgLib),
                messageLibProgram: params.msgLibSDK.programId,
                // param
                eid: params.remote,
                oapp: params.oapp,
            },
        );
        return txBuilder.addRemainingAccounts(
            params.msgLibSDK.getInitConfigIXAccountMetaForCPI(
                accounts.payer,
                params.oapp,
                params.remote,
            ),
        ).items[0];
    }

    /**
     * Initializes the OApp nonce.
     *
     * @param {PublicKey} delegate - The delegate public key.
     * @param {number} dstEid - The destination endpoint ID.
     * @param {PublicKey} oappIDPDA - The OApp ID PDA.
     * @param {Uint8Array} remoteOappAddr - The remote OApp address.
     * @returns {TransactionInstruction} The transaction instruction.
     */
    initOAppNonce(
        delegate: Signer, // the delegate of the oapp
        params: {
            localOApp: PublicKey;
            remote: number;
            remoteOApp: Uint8Array;
        },
    ): WrappedInstruction {
        const txBuilder = instructions.initNonce(
            { programs: this.programRepo },
            {
                nonce: this.pda.nonce(params.localOApp, params.remote, params.remoteOApp),
                pendingInboundNonce: this.pda.pendingNonce(
                    params.localOApp,
                    params.remote,
                    params.remoteOApp,
                ),
                oappRegistry: this.pda.oappRegistry(params.localOApp),
                delegate: delegate,
                // param
                localOapp: params.localOApp,
                remoteOapp: params.remoteOApp,
                remoteEid: params.remote,
            },
        );
        return txBuilder.items[0];
    }

    initOAppSendLibrary(
        delegate: Signer,
        params: { sender: PublicKey; remote: number },
    ): WrappedInstruction {
        return instructions.initSendLibrary(
            { programs: this.programRepo },
            {
                delegate: delegate,
                oappRegistry: this.pda.oappRegistry(params.sender),
                sendLibraryConfig: this.pda.sendLibraryConfig(params.sender, params.remote),
                // param
                sender: params.sender,
                eid: params.remote,
            },
        ).items[0];
    }

    setOAppSendLibrary(
        delegate: Signer,
        params: { sender: PublicKey; remote: number; msgLibProgram: PublicKey },
    ): WrappedInstruction {
        const { sender, remote, msgLibProgram } = params;
        const [newSendLib] = new MessageLibPDA(msgLibProgram).messageLib();
        return instructions.setSendLibrary(
            { programs: this.programRepo },
            {
                signer: delegate,
                sendLibraryConfig: this.pda.sendLibraryConfig(sender, remote),
                messageLibInfo:
                    msgLibProgram === DefaultMessageLib
                        ? undefined
                        : this.pda.messageLibraryInfo(newSendLib),
                oappRegistry: this.pda.oappRegistry(sender),
                program: this.programId,
                eventAuthority: this.eventAuthority,
                //param
                sender: sender,
                eid: remote,
                newLib: msgLibProgram === DefaultMessageLib ? DefaultMessageLib : newSendLib,
            },
        ).items[0];
    }

    initOAppReceiveLibrary(
        delegate: Signer,
        params: { receiver: PublicKey; remote: number },
    ): WrappedInstruction {
        const { receiver, remote } = params;
        return instructions.initReceiveLibrary(
            { programs: this.programRepo },
            {
                delegate: delegate,
                oappRegistry: this.pda.oappRegistry(receiver),
                receiveLibraryConfig: this.pda.receiveLibraryConfig(receiver, remote),
                // param
                receiver: receiver,
                eid: remote,
            },
        ).items[0];
    }

    setOAppReceiveLibrary(
        delegate: Signer,
        params: {
            receiver: PublicKey;
            remote: number;
            msgLibProgram: PublicKey;
            gracePeriod?: bigint | number;
        },
    ): WrappedInstruction {
        const { receiver, remote, msgLibProgram, gracePeriod } = params;
        const [newReceiveLib] = new MessageLibPDA(msgLibProgram).messageLib();
        return instructions.setReceiveLibrary(
            { programs: this.programRepo },
            {
                signer: delegate,
                receiveLibraryConfig: this.pda.receiveLibraryConfig(receiver, remote),
                messageLibInfo:
                    msgLibProgram === DefaultMessageLib
                        ? undefined
                        : this.pda.messageLibraryInfo(newReceiveLib),
                oappRegistry: this.pda.oappRegistry(receiver),
                program: this.programId,
                eventAuthority: this.eventAuthority,
                // param
                receiver: receiver,
                eid: remote,
                newLib: msgLibProgram === DefaultMessageLib ? DefaultMessageLib : newReceiveLib,
                gracePeriod: gracePeriod ?? 0,
            },
        ).items[0];
    }

    setOAppReceiveLibraryTimeout(
        delegate: Signer,
        params: {
            receiver: PublicKey;
            msgLibProgram: PublicKey;
            remote: number;
            expiry: bigint | number;
        },
    ): WrappedInstruction {
        const { receiver, remote, msgLibProgram, expiry } = params;
        const [receiveLib] = new MessageLibPDA(msgLibProgram).messageLib();
        return instructions.setReceiveLibraryTimeout(
            { programs: this.programRepo },
            {
                signer: delegate,
                oappRegistry: this.pda.oappRegistry(receiver),
                receiveLibraryConfig: this.pda.receiveLibraryConfig(receiver, remote),
                messageLibInfo: this.pda.messageLibraryInfo(receiveLib),
                eventAuthority: this.eventAuthority,
                program: this.programId,
                // param
                receiver: receiver,
                eid: remote,
                lib: receiveLib,
                expiry,
            },
        ).items[0];
    }

    async setOAppConfig(
        rpc: RpcInterface,
        delegate: Signer,
        params: {
            oapp: PublicKey; // this is the PDA of the oapp
            eid: number;
            config: {
                configType: SetConfigType;
                value: UlnProgram.types.ExecutorConfig | UlnProgram.types.UlnConfig;
            };
            msgLibProgram: PublicKey;
            msgLibVersion?: Version;
        },
        commitment: Commitment = 'confirmed',
    ): Promise<WrappedInstruction> {
        const { oapp, eid, config, msgLibProgram } = params;
        const [msgLib] = new MessageLibPDA(msgLibProgram).messageLib();

        const msgLibVersion =
            params.msgLibVersion ??
            (await this.getMessageLibVersion(rpc, delegate.publicKey, msgLibProgram, commitment));
        let msgLibClient: MessageLibInterface;
        if (
            msgLibVersion.major === 0n &&
            msgLibVersion.minor == 0 &&
            msgLibVersion.endpointVersion == 2
        ) {
            msgLibClient = new SimpleMessageLibProgram.SimpleMessageLib(msgLibProgram);
        } else if (
            msgLibVersion.major === 3n &&
            msgLibVersion.minor == 0 &&
            msgLibVersion.endpointVersion == 2
        ) {
            msgLibClient = new UlnProgram.Uln(msgLibProgram);
        } else {
            throw new Error(
                `unsupported message lib version ${msgLibVersion.major.toString()}.${msgLibVersion.minor.toString()}`,
            );
        }

        const txBuilder = instructions.setConfig(
            { programs: this.programRepo },
            {
                signer: delegate,
                messageLibInfo: this.pda.messageLibraryInfo(msgLib),
                messageLib: msgLib,
                messageLibProgram: msgLibProgram,
                oappRegistry: this.pda.oappRegistry(oapp),
                // param
                eid,
                configType: config.configType,
                config:
                    msgLibProgram === SIMPLE_MESSAGELIB_PROGRAM_ID
                        ? new Uint8Array(10).fill(0)
                        : UlnProgram.Uln.constructSetConfigData(config.configType, config.value),
                oapp: oapp,
            },
        );
        return txBuilder.addRemainingAccounts(
            msgLibClient.getSetConfigIXAccountMetaForCPI(oapp, eid),
        ).items[0];
    }

    oAppNilify(delegate: Signer, args: instructions.NilifyInstructionArgs): WrappedInstruction {
        const { receiver, srcEid, sender, nonce } = args;
        return instructions.nilify(
            { programs: this.programRepo },
            {
                signer: delegate,
                eventAuthority: this.eventAuthority,
                program: this.programId,
                oappRegistry: this.pda.oappRegistry(receiver),
                nonce: this.pda.nonce(receiver, srcEid, sender),
                pendingInboundNonce: this.pda.pendingNonce(receiver, srcEid, sender),
                payloadHash: this.pda.payloadHash(receiver, srcEid, sender, nonce),
            },
            args,
        ).items[0];
    }

    oAppBurnNonce(delegate: Signer, args: instructions.BurnInstructionArgs): WrappedInstruction {
        const { receiver, srcEid, sender, nonce } = args;
        return instructions.burn(
            { programs: this.programRepo },
            {
                signer: delegate,
                eventAuthority: this.eventAuthority,
                program: this.programId,
                oappRegistry: this.pda.oappRegistry(receiver),
                nonce: this.pda.nonce(receiver, srcEid, sender),
                payloadHash: this.pda.payloadHash(receiver, srcEid, sender, nonce),
                endpoint: this.pda.setting(),
            },
            args,
        ).items[0];
    }

    /// send a simulated transaction to the endpoint to get the fee for sending a message
    /**
     *
     * Gets the account metadata for the CPI (Cross-Program Invocation) of the quote instruction.
     *
     * caculate the fee for sending a message with ULN:
     *  1. executorFee: feeForGas + feeForOptionType
     *      * feeForGas: ((gas + gasForCalldata) * gasPriceInUnit * priceRatio / priceRatioDenominator) * multiplier_bps / 10000
     *      * feeForOptionType: nativeDrop/lzReceive/lzCompose
     *  2. oracleFee: feeForGas
     *      * feeForGas: same above
     *
     *  The priceRatioDenominator is 10^20
     *  totalFee = executorFee + oracleFee * numOracles(requiredOracles + optionalOracles)
     *
     * @param {Connection} connection - The connection to the Solana cluster.
     * @param {PublicKey} payer - The payer public key.
     * @param {PacketPath} path - The packet path.
     * @param {MessageLibInterface} msgLibProgram - The message library program.
     * @returns {Promise<AccountMeta[]>} A promise that resolves to an array of account metadata.
     * @throws {Error} If the default send library is not initialized or the message library is blocked.
     */
    async getQuoteIXAccountMetaForCPI(
        rpc: RpcInterface,
        payer: PublicKey,
        params: {
            path: SolanaPacketPath;
            msgLibProgram: MessageLibInterface;
        },
        commitment: Commitment = 'confirmed',
    ): Promise<AccountMeta[]> {
        const { path, msgLibProgram } = params;
        const { sender, dstEid, receiver } = path;
        const sendLibInfo = await this.getSendLibrary(rpc, sender, dstEid, commitment);
        const { msgLib, programId: owner } = sendLibInfo;
        const txBuilder = instructions.quote(
            { programs: this.programRepo },
            {
                sendLibraryConfig: this.pda.sendLibraryConfig(sender, dstEid),
                sendLibraryProgram: owner,
                defaultSendLibraryConfig: this.pda.defaultSendLibraryConfig(dstEid),
                endpoint: this.pda.setting(),
                nonce: this.pda.nonce(sender, dstEid, receiver),
                sendLibraryInfo: this.pda.messageLibraryInfo(msgLib),

                // param
                sender: defaultPublicKey(),
                dstEid: 0,
                receiver: new Uint8Array(32),
                message: new Uint8Array(32),
                options: new Uint8Array(32),
                payInLzToken: false,
            },
        );
        const remainingAccounts = await msgLibProgram.getQuoteIXAccountMetaForCPI(rpc, payer, path);
        return [
            { pubkey: this.programId, isSigner: false, isWritable: false },
            ...txBuilder.addRemainingAccounts(remainingAccounts).getInstructions()[0].keys,
        ];
    }

    /**
     * Gets the account metadata for the CPI (Cross-Program Invocation) of the send instruction.
     *
     * @param {Connection} connection - The connection to the Solana cluster.
     * @param {PublicKey} payer - The payer public key.
     * @param {PacketPath} path - The packet path.
     * @param {MessageLibInterface} msgLibProgram - The message library program.
     * @param {Commitment | GetAccountInfoConfig} [commitmentOrConfig] - The commitment level or account info configuration.
     * @returns {Promise<AccountMeta[]>} A promise that resolves to an array of account metadata.
     * @throws {Error} If the default send library is not initialized or the message library is blocked.
     */
    async getSendIXAccountMetaForCPI(
        rpc: RpcInterface,
        payerOrAccounts:
            | PublicKey
            | { payer: PublicKey; tokenMint: PublicKey; tokenSource: PublicKey },
        params: {
            path: SolanaPacketPath;
            msgLibProgram: MessageLibInterface;
            tokenProgram?: PublicKey;
            associatedTokenProgram?: PublicKey;
        },
        commitment: Commitment = 'confirmed',
    ): Promise<AccountMeta[]> {
        const { path, msgLibProgram } = params;
        const { sender, dstEid, receiver } = path;
        const info = await this.getSendLibrary(rpc, sender, dstEid, commitment);
        const sendLibrary = info.msgLib;
        const txBuilder = instructions.send(
            { programs: this.programRepo },
            {
                sender: createNoopSigner(sender),
                /// this account should be derived from message lib
                sendLibraryProgram: info.programId,
                sendLibraryConfig: this.pda.sendLibraryConfig(sender, dstEid),
                defaultSendLibraryConfig: this.pda.defaultSendLibraryConfig(dstEid),
                sendLibraryInfo: this.pda.messageLibraryInfo(sendLibrary),
                endpoint: this.pda.setting(),
                program: this.programId,
                nonce: this.pda.nonce(sender, dstEid, receiver),
                eventAuthority: this.eventAuthority,

                // param
                dstEid: 0,
                receiver: new Uint8Array(32),
                message: new Uint8Array(32),
                options: new Uint8Array(32),
                nativeFee: 0,
                lzTokenFee: 0,
            },
        );
        let remainingAccounts;
        if (typeof payerOrAccounts === 'object') {
            remainingAccounts = await msgLibProgram.getSendWithLzTokenIXAccountMetaForCPI(
                rpc,
                payerOrAccounts,
                path,
                {
                    tokenProgram: params.tokenProgram,
                    associatedTokenProgram: params.associatedTokenProgram,
                },
                commitment,
            );
        } else {
            remainingAccounts = await msgLibProgram.getSendIXAccountMetaForCPI(
                rpc,
                payerOrAccounts,
                path,
            );
        }

        return [
            { pubkey: this.programId, isSigner: false, isWritable: false },
            ...txBuilder
                .addRemainingAccounts(remainingAccounts)
                .getInstructions()[0]
                .keys.map((key) => {
                    key.isSigner = false;
                    return key;
                }),
        ];
    }

    /**
     * Skips a message.
     *
     * @param {PublicKey} payer - The payer public key.
     * @param {PublicKey} sender - The sender public key.
     * @param {PublicKey} receiver - The receiver public key.
     * @param {number} srcEid - The source endpoint ID.
     * @param {string} nonce - The nonce.
     * @returns {Promise<TransactionInstruction | null>} A promise that resolves to the transaction instruction or null if not needed.
     */
    skip(payer: Signer, params: instructions.SkipInstructionDataArgs): WrappedInstruction {
        const { sender, receiver, srcEid, nonce } = params;
        // get the delegate from endpoint
        return instructions.skip(
            { programs: this.programRepo },
            {
                signer: payer,
                oappRegistry: this.pda.oappRegistry(receiver),
                nonce: this.pda.nonce(receiver, srcEid, sender),
                pendingInboundNonce: this.pda.pendingNonce(receiver, srcEid, sender),
                payloadHash: this.pda.payloadHash(receiver, srcEid, sender, nonce),
                endpoint: this.pda.setting()[0],
                eventAuthority: this.eventAuthority,
                program: this.programId,
            },
            params,
        ).items[0];
    }

    /**
     * Initializes the verification process.
     *
     * @param {Connection} connection - The connection to the Solana cluster.
     * @param {PublicKey} payer - The payer public key.
     * @param {PublicKey} sender - The sender public key.
     * @param {PublicKey} receiver - The receiver public key.
     * @param {number} srcEid - The source endpoint ID.
     * @param {string} nonce - The nonce.
     * @param {Commitment | GetAccountInfoConfig} [commitmentOrConfig] - The commitment level or account info configuration.
     * @returns {Promise<TransactionInstruction | null>} A promise that resolves to the transaction instruction or null if not needed.
     */
    initVerify(payer: Signer, params: instructions.InitVerifyInstructionArgs): WrappedInstruction {
        const { sender, receiver, srcEid, nonce } = params;

        return instructions.initVerify(
            { programs: this.programRepo, payer },
            {
                payer,
                nonce: this.pda.nonce(receiver, srcEid, sender),
                payloadHash: this.pda.payloadHash(
                    receiver,
                    srcEid,
                    sender,
                    parseInt(nonce.toString()),
                ),
            },
            params,
        ).items[0];
    }

    /**
     * Gets the account metadata for the CPI (Cross-Program Invocation) of the verify instruction.
     *
     * @param {PacketV1Codec} packet - The packet.
     * @param {PublicKey} receiveLibrary - The receive library public key.
     * @returns {AccountMeta[]} An array of account metadata.
     */
    getVerifyIXAccountMetaForCPI(packet: PacketV1Codec, receiveLibrary: PublicKey): AccountMeta[] {
        const receiver = publicKey(hexToBytes(packet.receiver()));
        const srcEid = packet.srcEid();
        const sender = addressToBytes32(packet.sender());

        const txBuilder = instructions.verify(
            { programs: this.programRepo },
            {
                receiveLibrary: createNoopSigner(receiveLibrary),
                receiveLibraryConfig: this.pda.receiveLibraryConfig(receiver, srcEid),
                defaultReceiveLibraryConfig: this.pda.defaultReceiveLibraryConfig(srcEid),
                nonce: this.pda.nonce(receiver, srcEid, sender),
                pendingInboundNonce: this.pda.pendingNonce(receiver, srcEid, sender),
                payloadHash: this.pda.payloadHash(
                    receiver,
                    srcEid,
                    sender,
                    parseInt(packet.nonce()),
                ),
                program: this.programId,
                eventAuthority: this.eventAuthority,
            },
            {
                srcEid: 0,
                sender: new Uint8Array(32),
                receiver: defaultPublicKey(),
                nonce: 0,
                payloadHash: new Uint8Array(32),
            },
        );
        const program: AccountMeta = {
            pubkey: this.programId,
            isSigner: false,
            isWritable: false,
        };
        return [
            program,
            ...txBuilder.getInstructions()[0].keys.map((key) => ({ ...key, isSigner: false })),
        ];
    }

    /**
     * Gets the account metadata for the CPI (Cross-Program Invocation) of the register OApp instruction.
     *
     * @param {PublicKey} payer - The payer public key.
     * @param {PublicKey} oapp - The OApp public key.
     * @returns {AccountMeta[]} An array of account metadata.
     */
    getRegisterOappIxAccountMetaForCPI(payer: PublicKey, oapp: PublicKey): AccountMeta[] {
        const txBuilder = instructions.registerOapp(
            { programs: this.programRepo, payer: createNoopSigner(payer) },
            {
                payer: createNoopSigner(payer),
                oapp: createNoopSigner(oapp),
                oappRegistry: this.pda.oappRegistry(oapp),
                eventAuthority: this.eventAuthority,
                program: this.programId,
                // param
                delegate: payer,
            },
        );
        return [
            {
                pubkey: this.programId,
                isSigner: false,
                isWritable: false,
            },
            ...txBuilder.getInstructions()[0].keys.map((key) => ({ ...key, isSigner: false })),
        ];
    }

    getSetDelegateIxAccountMetaForCPI(oapp: PublicKey): AccountMeta[] {
        const txBuilder = instructions.setDelegate(
            { programs: this.programRepo },
            {
                oapp: createNoopSigner(oapp),
                oappRegistry: this.pda.oappRegistry(oapp),
                eventAuthority: this.eventAuthority,
                program: this.programId,
                // param
                delegate: defaultPublicKey(),
            },
        );
        return [
            {
                pubkey: this.programId,
                isSigner: false,
                isWritable: false,
            },
            ...txBuilder.getInstructions()[0].keys.map((key) => ({ ...key, isSigner: false })),
        ];
    }

    /**
     * Gets the account metadata for the CPI (Cross-Program Invocation) of the skip instruction.
     *
     * @param {PublicKey} receiver - The receiver public key.
     * @param {Uint8Array} sender - The sender address.
     * @param {number} srcEid - The source endpoint ID.
     * @param {number} nonce - The nonce.
     * @returns {AccountMeta[]} An array of account metadata.
     */
    getSkipIxAccountMetaForCPI(
        receiver: PublicKey,
        sender: Uint8Array,
        srcEid: number,
        nonce: number | bigint,
    ): AccountMeta[] {
        const txBuilder = instructions.skip(
            { programs: this.programRepo },
            {
                signer: createNoopSigner(receiver),
                oappRegistry: this.pda.oappRegistry(receiver),
                nonce: this.pda.nonce(receiver, srcEid, sender),
                pendingInboundNonce: this.pda.pendingNonce(receiver, srcEid, sender),
                payloadHash: this.pda.payloadHash(receiver, srcEid, sender, nonce),
                endpoint: this.pda.setting(),
                program: this.programId,
                eventAuthority: this.eventAuthority,
            },
            {
                receiver: defaultPublicKey(),
                srcEid: 0,
                sender: new Uint8Array(32),
                nonce: 0,
            },
        );
        return [
            {
                pubkey: this.programId,
                isSigner: false,
                isWritable: false,
            },
            ...txBuilder.getInstructions()[0].keys.map((key) => ({ ...key, isSigner: false })),
        ];
    }

    /**
     * Checks if the given message library program is the default send library.
     *
     * @param {Connection} connection - The connection to the Solana cluster.
     * @param {PublicKey} messageLibProgram - The message library program public key.
     * @param {number} dstEid - The destination endpoint ID.
     * @param {Commitment | GetAccountInfoConfig} [commitmentOrConfig] - The commitment level or account info configuration.
     * @returns {Promise<boolean>} A promise that resolves to true if the message library program is the default send library, false otherwise.
     */
    async isDefaultSendLibrary(
        rpc: RpcInterface,
        messageLibProgram: PublicKey,
        dstEid: number,
        commitment: Commitment = 'confirmed',
    ): Promise<boolean> {
        const [msgLib] = new MessageLibPDA(messageLibProgram).messageLib();
        const info = await this.getDefaultSendLibrary(rpc, dstEid, commitment);
        if (info) {
            return info.msgLib === msgLib;
        }
        return false;
    }

    /**
     * Checks if the given message library program is the default receive library.
     *
     * @param {Connection} connection - The connection to the Solana cluster.
     * @param {PublicKey} messageLibProgram - The message library program public key.
     * @param {number} srcEid - The source endpoint ID.
     * @param {Commitment | GetAccountInfoConfig} [commitmentOrConfig] - The commitment level or account info configuration.
     * @returns {Promise<boolean>} A promise that resolves to true if the message library program is the default receive library, false otherwise.
     */
    async isDefaultReceiveLibrary(
        rpc: RpcInterface,
        messageLibProgram: PublicKey,
        srcEid: number,
        commitment: Commitment = 'confirmed',
    ): Promise<boolean> {
        const [msgLib] = new MessageLibPDA(messageLibProgram).messageLib();
        const info = await this.getDefaultReceiveLibrary(rpc, srcEid, commitment);
        if (info) {
            return info.msgLib === msgLib;
        }
        return false;
    }

    // all of below functions are retrieving accounts state
    /**
     * Gets the endpoint settings.
     *
     * @param {Connection} connection - The connection to the Solana cluster.
     * @param {Commitment | GetAccountInfoConfig} [commitmentOrConfig] - The commitment level or account info configuration.
     * @returns {Promise<EndpointSettings | null>} A promise that resolves to the endpoint settings or null if not found.
     */
    async getSetting(
        rpc: RpcInterface,
        commitment: Commitment = 'confirmed',
    ): Promise<accounts.EndpointSettings | null> {
        const [setting] = this.pda.setting();
        return accounts.safeFetchEndpointSettings({ rpc }, setting, { commitment });
    }

    /**
     * Gets the message library information.
     *
     * @param {Connection} connection - The connection to the Solana cluster.
     * @param {PublicKey} messageLibProgram - The message library program public key, It is a PDA of the message library program
     * @param {Commitment | GetAccountInfoConfig} [commitmentOrConfig] - The commitment level or account info configuration.
     * @returns {Promise<MessageLibInfo | null>} A promise that resolves to the message library information or null if not found.
     */
    async getMessageLibInfo(
        rpc: RpcInterface,
        messageLibProgram: PublicKey,
        commitment: Commitment = 'confirmed',
    ): Promise<accounts.MessageLibInfo | null> {
        const [msgLib] = new MessageLibPDA(messageLibProgram).messageLib();
        const [messageLibInfo] = this.pda.messageLibraryInfo(msgLib);
        return accounts.safeFetchMessageLibInfo({ rpc }, messageLibInfo, { commitment });
    }

    /**
     * Gets the default receive library.
     *
     * @param {Connection} connection - The connection to the Solana cluster.
     * @param {number} srcEid - The source endpoint ID.
     * @param {Commitment | GetAccountInfoConfig} [commitmentOrConfig] - The commitment level or account info configuration.
     * @returns {Promise<{ msgLib: PublicKey; owner: PublicKey } | null>} A promise that resolves to the default receive library or null if not found.
     */
    async getDefaultReceiveLibrary(
        rpc: RpcInterface,
        srcEid: number,
        commitment: Commitment = 'confirmed',
    ): Promise<{ msgLib: PublicKey; owner: PublicKey } | null> {
        const [defaultReceiveLibConfig] = this.pda.defaultReceiveLibraryConfig(srcEid);

        const defaultInfo = await accounts.safeFetchReceiveLibraryConfig(
            { rpc },
            defaultReceiveLibConfig,
            {
                commitment,
            },
        );
        if (defaultInfo == null) {
            return null;
        }

        let msgLibProgram: PublicKey | undefined;

        if (Endpoint.checkIfBlockedMessageLib(defaultInfo.messageLib)) {
            msgLibProgram = BlockedMessageLibProgram.BLOCKED_MESSAGELIB_PROGRAM_ID;
        } else {
            const messageLibInfo = await rpc.getAccount(defaultInfo.messageLib, { commitment });
            invariant(messageLibInfo.exists, 'messageLibInfo should not be null');
            msgLibProgram = messageLibInfo.owner;
        }
        return {
            owner: msgLibProgram,
            msgLib: defaultInfo.messageLib,
        };
    }

    /**
     * Gets the default send library.
     *
     * @param {Connection} connection - The connection to the Solana cluster.
     * @param {number} dstEid - The destination endpoint ID.
     * @param {Commitment | GetAccountInfoConfig} [commitmentOrConfig] - The commitment level or account info configuration.
     * @returns {Promise<{ msgLib: PublicKey; owner: PublicKey } | null>} A promise that resolves to the default send library or null if not found.
     */
    async getDefaultSendLibrary(
        rpc: RpcInterface,
        dstEid: number,
        commitment: Commitment = 'confirmed',
    ): Promise<{ msgLib: PublicKey; owner: PublicKey } | null> {
        const [defaultSendLibConfig] = this.pda.defaultSendLibraryConfig(dstEid);

        const defaultInfo = await accounts.safeFetchSendLibraryConfig(
            { rpc },
            defaultSendLibConfig,
            { commitment },
        );
        if (defaultInfo == null) {
            return null;
        }
        let msgLibProgram: PublicKey | undefined;
        if (Endpoint.checkIfBlockedMessageLib(defaultInfo.messageLib)) {
            msgLibProgram = BlockedMessageLibProgram.BLOCKED_MESSAGELIB_PROGRAM_ID;
        } else {
            const messageLibInfo = await rpc.getAccount(defaultInfo.messageLib, { commitment });
            invariant(messageLibInfo.exists, 'messageLibInfo should not be null');
            msgLibProgram = messageLibInfo.owner;
        }
        return {
            owner: msgLibProgram,
            msgLib: defaultInfo.messageLib,
        };
    }

    /**
     * Gets the configured send library for the app.
     *
     * @param {Connection} connection - The connection to the Solana cluster.
     * @param {PublicKey} oappPda - The OApp PDA.
     * @param {number} dstEid - The destination endpoint ID.
     * @param {Commitment | GetAccountInfoConfig} [commitmentOrConfig='confirmed'] - The commitment level or account info configuration.
     * @returns {Promise<{ msgLib: PublicKey; programId: PublicKey; isDefault: boolean } | null>} A promise that resolves to the configured send library or null if not found.
     */
    async getSendLibrary(
        rpc: RpcInterface,
        oappPda: PublicKey,
        dstEid: number,
        commitment: Commitment = 'confirmed',
    ): Promise<{ msgLib: PublicKey; programId: PublicKey; isDefault: boolean }> {
        const [sendLibConfig] = this.pda.sendLibraryConfig(oappPda, dstEid);
        const [defaultSendLibConfig] = this.pda.defaultSendLibraryConfig(dstEid);
        const [defaultSendLibConfigBuf, sendLibConfigBuf] = await rpc.getAccounts(
            [defaultSendLibConfig, sendLibConfig],
            { commitment },
        );
        if (!defaultSendLibConfigBuf.exists || !sendLibConfigBuf.exists) {
            throw new Error(
                `Unable to find defaultSendLibraryConfig/sendLibraryConfig account at ${defaultSendLibConfig}/${sendLibConfig}`,
            );
        }
        const sendLibConfigInfo = accounts.deserializeSendLibraryConfig(sendLibConfigBuf);
        const defaultSendLibConfigInfo =
            accounts.deserializeSendLibraryConfig(defaultSendLibConfigBuf);
        const msgLib =
            sendLibConfigInfo.messageLib.toString() === DefaultMessageLib.toString()
                ? defaultSendLibConfigInfo.messageLib
                : sendLibConfigInfo.messageLib;
        const isDefault = sendLibConfigInfo.messageLib.toString() === DefaultMessageLib.toString();
        let msgLibProgram: PublicKey | undefined;
        if (Endpoint.checkIfBlockedMessageLib(msgLib)) {
            msgLibProgram = BlockedMessageLibProgram.BLOCKED_MESSAGELIB_PROGRAM_ID;
        } else {
            const msgLibInfo = await rpc.getAccount(msgLib, { commitment });
            invariant(msgLibInfo.exists, 'msgLibInfo should not be null');
            msgLibProgram = msgLibInfo.owner;
        }
        return {
            programId: msgLibProgram,
            msgLib,
            isDefault,
        };
    }

    /**
     * Gets the configured receive library for the app.
     *
     * @param {Connection} connection - The connection to the Solana cluster.
     * @param {PublicKey} oappPda - The OApp PDA.
     * @param {number} srcEid - The source endpoint ID.
     * @param {Commitment | GetAccountInfoConfig} [commitmentOrConfig] - The commitment level or account info configuration.
     * @returns {Promise<{ msgLib: PublicKey; programId: PublicKey; isDefault: boolean; timeout: { msgLib: PublicKey; expiry: bigint } | null } | null>} A promise that resolves to the configured receive library or null if not found.
     */
    async getReceiveLibrary(
        rpc: RpcInterface,
        oappPda: PublicKey,
        srcEid: number,
        commitment: Commitment = 'confirmed',
    ): Promise<{
        msgLib: PublicKey;
        programId: PublicKey;
        isDefault: boolean;
        timeout?: { msgLib: PublicKey; expiry: bigint };
    }> {
        const [receiveLibConfig] = this.pda.receiveLibraryConfig(oappPda, srcEid);
        const [defaultReceiveLibConfig] = this.pda.defaultReceiveLibraryConfig(srcEid);
        const [defaultReceiveLibConfigBuf, receiveLibConfigBuf] = await rpc.getAccounts(
            [defaultReceiveLibConfig, receiveLibConfig],
            { commitment },
        );
        if (!defaultReceiveLibConfigBuf.exists || !receiveLibConfigBuf.exists) {
            throw new Error(
                `Unable to find defaultReceiveLibraryConfig/receiveLibraryConfig account at ${defaultReceiveLibConfig}/${receiveLibConfig}`,
            );
        }
        const receiveLibConfigInfo = accounts.deserializeReceiveLibraryConfig(receiveLibConfigBuf);
        const defaultReceiveLibConfigInfo = accounts.deserializeReceiveLibraryConfig(
            defaultReceiveLibConfigBuf,
        );
        const finalReceiveLibConfigInfo =
            receiveLibConfigInfo.messageLib.toString() === DefaultMessageLib.toString()
                ? defaultReceiveLibConfigInfo
                : receiveLibConfigInfo;
        const msgLib = finalReceiveLibConfigInfo.messageLib;
        const isDefault =
            receiveLibConfigInfo.messageLib.toString() === DefaultMessageLib.toString();
        let msgLibProgram: PublicKey | undefined;
        if (Endpoint.checkIfBlockedMessageLib(msgLib)) {
            msgLibProgram = BlockedMessageLibProgram.BLOCKED_MESSAGELIB_PROGRAM_ID;
        } else {
            const msgLibInfo = await rpc.getAccount(msgLib, { commitment });
            invariant(msgLibInfo.exists, 'msgLibInfo should not be null');
            msgLibProgram = msgLibInfo.owner;
        }
        const receiveTimeout = isSome(finalReceiveLibConfigInfo.timeout)
            ? {
                  msgLib: finalReceiveLibConfigInfo.timeout.value.messageLib,
                  expiry: finalReceiveLibConfigInfo.timeout.value.expiry,
              }
            : undefined;

        return {
            programId: msgLibProgram,
            msgLib,
            isDefault,
            timeout: receiveTimeout,
        };
    }

    // rename to a more generic name
    /**
     * Gets the inbound payload hash.
     *
     * @param {Connection} connection - The connection to the Solana cluster.
     * @param {PublicKey} receiver - The receiver public key.
     * @param {number} srcEid - The source endpoint ID.
     * @param {Uint8Array} sender - The sender address.
     * @param {number} nonce - The nonce.
     * @param {Uint8Array} _payloadHash - The payload hash.
     * @param {Commitment | GetAccountInfoConfig} [commitmentOrConfig] - The commitment level or account info configuration.
     * @returns {Promise<PayloadHash | null>} A promise that resolves to the payload hash or null if not found.
     */
    async getInboundPayloadHash(
        rpc: RpcInterface,
        receiver: PublicKey,
        srcEid: number,
        sender: Uint8Array,
        nonce: number,
        _payloadHash: Uint8Array,
        commitment: Commitment = 'confirmed',
    ): Promise<accounts.PayloadHash | null> {
        const [payloadHashPDA] = this.pda.payloadHash(receiver, srcEid, sender, nonce);
        return accounts.safeFetchPayloadHash({ rpc }, payloadHashPDA, { commitment });
    }

    /**
     * Gets the composed message state.
     *
     * @param {Connection} connection - The connection to the Solana cluster.
     * @param {PublicKey} from - The sender public key.
     * @param {types.SendComposeParams} params - The send compose parameters.
     * @param {Commitment | GetAccountInfoConfig} [commitmentOrConfig] - The commitment level or account info configuration.
     * @returns {Promise<ComposeMessageState | null>} A promise that resolves to the composed message state or null if not found.
     */
    async getComposedMessageState(
        rpc: RpcInterface,
        from: PublicKey,
        params: instructions.SendComposeInstructionArgs,
        commitment: Commitment = 'confirmed',
    ): Promise<accounts.ComposeMessageState | null> {
        const message = keccak_256(params.message);
        const [composedMessagePDA] = this.pda.composedMessage(
            from,
            params.guid,
            params.index,
            params.to,
            message,
        );
        return accounts.safeFetchComposeMessageState({ rpc }, composedMessagePDA, { commitment });
    }

    /**
     * Gets the nonce.
     *
     * @param {Connection} connection - The connection to the Solana cluster.
     * @param {PublicKey} oappIDPDA - The OApp ID PDA.
     * @param {number} remoteEid - The remote endpoint ID.
     * @param {Uint8Array} remoteOappAddr - The remote OApp address.
     * @param {Commitment | GetAccountInfoConfig} [commitmentOrConfig] - The commitment level or account info configuration.
     * @returns {Promise<accounts.Nonce | null>} A promise that resolves to the nonce or null if not found.
     */
    async getNonce(
        rpc: RpcInterface,
        oappIDPDA: PublicKey,
        remoteEid: number,
        remoteOappAddr: Uint8Array,
        commitment: Commitment = 'confirmed',
    ): Promise<accounts.Nonce | null> {
        const [nonce] = this.pda.nonce(oappIDPDA, remoteEid, remoteOappAddr);
        return accounts.safeFetchNonce({ rpc }, nonce, { commitment });
    }

    /**
     * Gets the pending inbound nonce.
     *
     * @param {Connection} connection - The connection to the Solana cluster.
     * @param {PublicKey} oappIDPDA - The OApp ID PDA.
     * @param {number} remoteEid - The remote endpoint ID.
     * @param {Uint8Array} remoteOappAddr - The remote OApp address.
     * @param {Commitment | GetAccountInfoConfig} [commitmentOrConfig] - The commitment level or account info configuration.
     * @returns {Promise<accounts.PendingInboundNonce | null>} A promise that resolves to the pending inbound nonce or null if not found.
     */
    async getPendingInboundNonce(
        rpc: RpcInterface,
        oappIDPDA: PublicKey,
        remoteEid: number,
        remoteOappAddr: Uint8Array,
        commitment: Commitment = 'confirmed',
    ): Promise<accounts.PendingInboundNonce | null> {
        const [nonce] = this.pda.pendingNonce(oappIDPDA, remoteEid, remoteOappAddr);
        return accounts.safeFetchPendingInboundNonce({ rpc }, nonce, { commitment });
    }

    /**
     * Gets the message library version.
     *
     * @param {Connection} connection - The connection to the Solana cluster.
     * @param {PublicKey} payer - The payer public key.
     * @param {PublicKey} messageLibProgram - The message library program public key.
     * @param {Commitment} [commitment='confirmed'] - The commitment level.
     * @returns {Promise<Version | null>} A promise that resolves to the version or null if not found.
     */
    async getMessageLibVersion(
        rpc: RpcInterface,
        payer: PublicKey,
        messageLibProgram: PublicKey,
        commitment: Commitment = 'confirmed',
    ): Promise<Version> {
        const msgLibProgramInWeb3Js = toWeb3JsPublicKey(messageLibProgram);
        const version = await simulateWeb3JsTransaction(
            rpc.getEndpoint(),
            [
                new TransactionInstruction({
                    keys: [{ pubkey: msgLibProgramInWeb3Js, isSigner: false, isWritable: false }],
                    data: Buffer.from(
                        SimpleMessageLibProgram.instructions
                            .getVersionInstructionDataSerializer()
                            .serialize({}),
                    ),
                    programId: msgLibProgramInWeb3Js,
                }),
            ],
            msgLibProgramInWeb3Js,
            toWeb3JsPublicKey(payer),
            SimpleMessageLibProgram.types.getVersionSerializer(),
            commitment,
        );
        return version;
    }

    /**
     * Transfers the admin role to a new admin.
     *
     * @param {Connection} connection - The connection to the Solana cluster.
     * @param {PublicKey} admin - The current admin public key.
     * @param {PublicKey} newAdmin - The new admin public key.
     * @param {Commitment} [commitment='confirmed'] - The commitment level.
     * @returns {Promise<TransactionInstruction | null>} A promise that resolves to the transaction instruction or null if not needed.
     */
    transferAdmin(admin: Signer, newAdmin: PublicKey): WrappedInstruction {
        return instructions.transferAdmin(
            { programs: this.programRepo },
            {
                admin,
                endpoint: this.pda.setting(),
                eventAuthority: this.eventAuthority,
                program: this.programId,
            },
            {
                admin: newAdmin,
            },
        ).items[0];
    }

    static checkIfBlockedMessageLib(msgLib: PublicKey): boolean {
        const [blockedMessageLib] = new MessageLibPDA(
            BlockedMessageLibProgram.BLOCKED_MESSAGELIB_PROGRAM_ID,
        ).messageLib();
        return msgLib.toString() === blockedMessageLib.toString();
    }
}
