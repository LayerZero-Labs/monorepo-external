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
    WrappedInstruction,
} from '@metaplex-foundation/umi';
import { createNoopSigner, createNullRpc, defaultPublicKey } from '@metaplex-foundation/umi';
import { createDefaultProgramRepository } from '@metaplex-foundation/umi-program-repository';
import { fromWeb3JsPublicKey, toWeb3JsPublicKey } from '@metaplex-foundation/umi-web3js-adapters';
import {
    ASSOCIATED_TOKEN_PROGRAM_ID,
    getAssociatedTokenAddress,
    TOKEN_PROGRAM_ID,
} from '@solana/spl-token';

import { PacketV1Codec } from '@layerzerolabs/lz-v2-utilities';

import type { MessageLibInterface, SolanaPacketPath } from '.';
import { EndpointProgram } from '.';
import { ENDPOINT_PROGRAM_ID } from './endpoint';
import { SIMPLE_MESSAGELIB_PROGRAM_ID } from './generated/simple_messagelib';
import * as accounts from './generated/simple_messagelib/accounts';
import * as errors from './generated/simple_messagelib/errors';
import * as instructions from './generated/simple_messagelib/instructions';
import * as types from './generated/simple_messagelib/types';
import { EndpointPDA, MessageLibPDA } from './pda';

export { SIMPLE_MESSAGELIB_PROGRAM_ID } from './generated/simple_messagelib';
export { accounts, errors, instructions, types };

/**
 * Class representing the SimpleMessageLib.
 * @see {@link MessageLibInterface}
 */
export class SimpleMessageLib implements MessageLibInterface {
    public readonly pda: MessageLibPDA;
    public readonly programRepo: ProgramRepositoryInterface;

    constructor(
        public programId: PublicKey = SIMPLE_MESSAGELIB_PROGRAM_ID,
        rpc?: RpcInterface,
    ) {
        this.pda = new MessageLibPDA(programId);
        if (rpc === undefined) {
            rpc = createNullRpc();
            rpc.getCluster = (): Cluster => 'custom';
        }
        this.programRepo = createDefaultProgramRepository({ rpc }, [
            {
                name: 'simpleMessagelib',
                publicKey: programId,
                getErrorFromCode(code: number, cause?: Error): ProgramError | null {
                    return errors.getSimpleMessagelibErrorFromCode(code, this, cause);
                },
                getErrorFromName(name: string, cause?: Error): ProgramError | null {
                    return errors.getSimpleMessagelibErrorFromName(name, this, cause);
                },
                isOnCluster(): boolean {
                    return true;
                },
            } satisfies Program,
        ]);
    }

    getProgram(clusterFilter: ClusterFilter = 'custom'): Program {
        return this.programRepo.get('simpleMessagelib', clusterFilter);
    }

    /**
     * Initializes the SimpleMessageLib.
     *
     * @param {PublicKey} endpointProgram - The endpoint program public key.
     * @param {PublicKey} payer - The payer public key.
     * @param {PublicKey} admin - The admin public key.
     * @param {number} eid - The endpoint ID.
     * @param {number} nativeFee - The native fee.
     * @param {number} [lzTokenFee=0] - The LayerZero token fee.
     *
     * @returns {TransactionInstruction} The transaction instruction.
     */
    initSimpleMessageLib(
        payer: Signer,
        param: {
            endpointProgram?: PublicKey;
            admin: PublicKey;
            eid: number;
            nativeFee: number;
            lzTokenFee: number;
        },
    ): WrappedInstruction {
        const [messageLib] = this.pda.messageLib();
        const { endpointProgram, admin, eid, nativeFee, lzTokenFee } = param;
        const [endpointAuth] = new EndpointPDA(
            endpointProgram ?? ENDPOINT_PROGRAM_ID,
        ).messageLibraryInfo(messageLib);
        return instructions.initMessageLib(
            { payer, programs: this.programRepo },
            {
                payer,
                messageLib: messageLib,

                // param
                endpointProgram: endpointProgram ?? ENDPOINT_PROGRAM_ID,
                endpoint: endpointAuth,
                eid,
                admin,
                fee: nativeFee,
                lzTokenFee,
            },
        ).items[0];
    }

    /**
     * Sets the whitelist caller.
     *
     * @param {Signer} admin - The admin public key.
     * @param {PublicKey} newCaller - The new caller public key.
     *
     * @returns {TransactionInstruction} The transaction instruction.
     */
    setWhitelistCaller(admin: Signer, newCaller: PublicKey): WrappedInstruction {
        const [messageLibPDA] = this.pda.messageLib();
        return instructions.setWlCaller(
            { programs: this.programRepo },
            {
                admin,
                messageLib: messageLibPDA,
                newCaller,
            },
        ).items[0];
    }

    /**
     * Checks if a caller is whitelisted.
     *
     * @param {RpcInterface} rpc - The connection object.
     * @param {PublicKey} caller - The caller public key.
     *
     * @returns {Promise<boolean>} A promise that resolves to true if the caller is whitelisted, false otherwise.
     */
    async isWhiteListed(rpc: RpcInterface, caller: PublicKey): Promise<boolean> {
        try {
            const exceptedCaller = await this.getWhiteListCaller(rpc);
            return exceptedCaller === caller;
        } catch (_e) {
            return false;
        }
    }

    /**
     * Gets the whitelisted caller.
     *
     * @param {RpcInterface} rpc - The connection object.
     * @param {Commitment | GetAccountInfoConfig} [commitmentOrConfig] - The commitment or config.
     *
     * @returns {Promise<PublicKey>} A promise that resolves to the whitelisted caller public key.
     */
    async getWhiteListCaller(rpc: RpcInterface): Promise<PublicKey> {
        const [messageLib] = this.pda.messageLib();
        const messageLibInfo = await accounts.fetchMessageLib({ rpc }, messageLib, {});
        return messageLibInfo.wlCaller;
    }

    /**
     * Validates a packet.
     *
     * @param {Signer} payer - The payer public key.
     * @param {Uint8Array} encodedPacket - The encoded packet.
     * @param {PublicKey} endpointProgram - The endpoint program public key.
     *
     * @returns {TransactionInstruction} The transaction instruction.
     */
    validatePacket(
        payer: Signer,
        encodedPacket: Uint8Array,
        endpointProgram?: PublicKey,
    ): WrappedInstruction {
        const packet = PacketV1Codec.fromBytes(encodedPacket);
        const [receiveLibrary] = this.pda.messageLib();
        const endpoint = new EndpointProgram.Endpoint(endpointProgram ?? ENDPOINT_PROGRAM_ID);

        const txBuilder = instructions.validatePacket(
            { programs: this.programRepo, payer: payer },
            {
                receiveLibrary,
                packet: encodedPacket,
            },
        );
        return txBuilder.addRemainingAccounts(
            endpoint.getVerifyIXAccountMetaForCPI(packet, receiveLibrary),
        ).items[0];
    }

    /**
     * Gets the account meta of the send instruction for CPI (Cross-Program Invocation).
     *
     * @param {RpcInterface} _rpc - The connection object.
     * @param {PublicKey} payer - The payer public key.
     * @param {SolanaPacketPath} _path - The packet path.
     *
     * @returns {Promise<AccountMeta[]>} A promise that resolves to an array of account meta.
     */
    async getSendIXAccountMetaForCPI(
        _rpc: RpcInterface,
        payer: PublicKey,
        _path: SolanaPacketPath,
    ): Promise<AccountMeta[]> {
        const [msgLib] = this.pda.messageLib();
        const txBuilder = instructions.send(
            { payer: createNoopSigner(payer), programs: this.programRepo },
            {
                endpoint: createNoopSigner(defaultPublicKey()), // useless
                messageLib: msgLib,
                payer: createNoopSigner(payer),

                //param
                packet: {
                    nonce: 0,
                    srcEid: 0,
                    sender: defaultPublicKey(),
                    dstEid: 0,
                    receiver: new Uint8Array(32),
                    guid: new Uint8Array(32),
                    message: new Uint8Array(0),
                },
                options: new Uint8Array([0, 0, 0, 0]),
                nativeFee: 0,
            },
        );
        const cpiAccounts = txBuilder.getInstructions()[0].keys.map((key) => {
            if (payer !== key.pubkey) {
                key.isSigner = false;
            }
            return key;
        });
        return Promise.resolve(cpiAccounts.slice(1));
    }

    /***
     * Get the account meta of the send instruction for CPI(Cross-Program Invocation ) with lzToken
     */
    async getSendWithLzTokenIXAccountMetaForCPI(
        _rpc: RpcInterface,
        accounts: {
            payer: PublicKey;
            tokenMint: PublicKey;
            tokenSource: PublicKey;
        },
        _path: SolanaPacketPath,
        programs: {
            tokenProgram?: PublicKey;
            associatedTokenProgram?: PublicKey;
        } = {
            tokenProgram: fromWeb3JsPublicKey(TOKEN_PROGRAM_ID),
            associatedTokenProgram: fromWeb3JsPublicKey(ASSOCIATED_TOKEN_PROGRAM_ID),
        },
        _commitment: Commitment = 'confirmed',
    ): Promise<AccountMeta[]> {
        const { payer, tokenMint, tokenSource } = accounts;
        const [msgLib] = this.pda.messageLib();
        const {
            tokenProgram = fromWeb3JsPublicKey(TOKEN_PROGRAM_ID),
            associatedTokenProgram = fromWeb3JsPublicKey(ASSOCIATED_TOKEN_PROGRAM_ID),
        } = programs;
        const messageLibLzToken = await getAssociatedTokenAddress(
            toWeb3JsPublicKey(tokenMint),
            toWeb3JsPublicKey(msgLib),
            true,
            toWeb3JsPublicKey(tokenProgram),
            toWeb3JsPublicKey(associatedTokenProgram),
        );
        const txBuilder = instructions.sendWithLzToken(
            { payer: createNoopSigner(payer), programs: this.programRepo },
            {
                endpoint: createNoopSigner(defaultPublicKey()),
                messageLib: msgLib,
                payer: createNoopSigner(payer),
                messageLibLzToken: fromWeb3JsPublicKey(messageLibLzToken),
                lzTokenSource: tokenSource,
                lzTokenMint: tokenMint,
            },
            {
                //param
                packet: {
                    nonce: 0,
                    srcEid: 0,
                    sender: defaultPublicKey(),
                    dstEid: 0,
                    receiver: new Uint8Array(32),
                    guid: new Uint8Array(32),
                    message: new Uint8Array(0),
                },
                options: new Uint8Array([0, 0, 0, 0]),
                nativeFee: 0,
                lzTokenFee: 0,
                lzTokenMint: tokenMint,
            },
        );
        const cpiAccounts = txBuilder.getInstructions()[0].keys.map((key) => {
            if (payer !== key.pubkey) {
                key.isSigner = false;
            }
            return key;
        });
        return Promise.resolve(cpiAccounts.slice(1));
    }

    /**
     * Gets the account meta of the quote instruction for CPI (Cross-Program Invocation).
     *
     * @param {Connection} _connection - The connection object.
     * @param {PublicKey} _payer - The payer public key.
     * @param {PacketPath} _path - The packet path.
     * @param {Commitment} [commitment] - The commitment.
     *
     * @returns {Promise<AccountMeta[]>} A promise that resolves to an array of account meta.
     */
    async getQuoteIXAccountMetaForCPI(
        _rpc: RpcInterface,
        _payer: PublicKey,
        _path: SolanaPacketPath,
        _commitment: Commitment = 'confirmed',
    ): Promise<AccountMeta[]> {
        const [msgLib] = this.pda.messageLib();
        const txBuilder = instructions.quote(
            { programs: this.programRepo },
            {
                endpoint: createNoopSigner(defaultPublicKey()), // useless
                messageLib: msgLib,
                //param
                packet: {
                    nonce: 0,
                    srcEid: 0,
                    sender: defaultPublicKey(),
                    dstEid: 0,
                    receiver: new Uint8Array(32),
                    guid: new Uint8Array(32),
                    message: new Uint8Array(0),
                },
                options: new Uint8Array([0, 0, 0, 0]),
                payInLzToken: false,
            },
        );
        return Promise.resolve(txBuilder.getInstructions()[0].keys.slice(1));
    }

    /**
     * Gets the account meta of the init config instruction for CPI (Cross-Program Invocation).
     *
     * @param {PublicKey} payer - The payer public key.
     * @param {PublicKey} oapp - The oapp ID public key.
     * @param {number} eid - The endpoint ID.
     *
     * @returns {AccountMeta[]} An array of account meta.
     */
    getInitConfigIXAccountMetaForCPI(
        payer: PublicKey,
        oapp: PublicKey,
        eid: number,
    ): AccountMeta[] {
        const [sendConfig] = this.pda.sendConfig(eid, oapp);
        const [receiveConfig] = this.pda.receiveConfig(eid, oapp);
        const [messageLib] = this.pda.messageLib();
        const txBuilder = instructions.initConfig(
            { payer: createNoopSigner(payer), programs: this.programRepo },
            {
                endpoint: createNoopSigner(defaultPublicKey()),
                payer: createNoopSigner(payer),
                messageLib,
                sendConfig,
                receiveConfig,
                // param
                oapp,
                eid,
            },
        );
        const cpiAccounts = txBuilder.getInstructions()[0].keys.map((key) => {
            if (payer !== key.pubkey) {
                key.isSigner = false;
            }
            return key;
        });
        return cpiAccounts.slice(1);
    }

    /**
     * Gets the account meta of the set config instruction for CPI (Cross-Program Invocation).
     *
     * @param {PublicKey} oapp - The oapp ID public key.
     * @param {number} eid - The endpoint ID.
     * @param {PublicKey} _endpointProgram - The endpoint program public key.
     *
     * @returns {Promise<AccountMeta[]>} A promise that resolves to an array of account meta.
     */
    getSetConfigIXAccountMetaForCPI(
        oapp: PublicKey,
        eid: number,
        _endpointProgram: PublicKey = ENDPOINT_PROGRAM_ID,
    ): AccountMeta[] {
        const [sendConfig] = this.pda.sendConfig(eid, oapp);
        const [receiveConfig] = this.pda.receiveConfig(eid, oapp);
        const [msgLib] = this.pda.messageLib();
        const txBuilder = instructions.setConfig(
            { programs: this.programRepo },
            {
                endpoint: createNoopSigner(ENDPOINT_PROGRAM_ID), // useless
                sendConfig,
                receiveConfig,
                messageLib: msgLib,
                // param
                oapp: oapp,
                eid: 0,
                configType: 0,
                config: new Uint8Array(0),
            },
        );
        return txBuilder.getInstructions()[0].keys.slice(1);
    }
}
