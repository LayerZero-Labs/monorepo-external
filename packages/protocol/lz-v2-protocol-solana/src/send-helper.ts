import type {
    AccountMeta,
    Commitment,
    MaybeRpcAccount,
    PublicKey,
    RpcInterface,
} from '@metaplex-foundation/umi';
import { createNoopSigner, defaultPublicKey, isSome } from '@metaplex-foundation/umi';
import { fromWeb3JsPublicKey } from '@metaplex-foundation/umi-web3js-adapters';
import * as web3 from '@solana/web3.js';
import invariant from 'tiny-invariant';

import { addressToBytes32 } from '@layerzerolabs/lz-v2-utilities';

import { EndpointProgram, SimpleMessageLibProgram, UlnProgram } from '.';
import { accounts as DvnAccounts, DVN } from './dvn';
import { DefaultMessageLib } from './endpoint';
import { accounts as ExecutorAccounts, Executor } from './executor';

/**
 * Interface representing keyed account information.
 */
interface KeyedAccountInfo {
    /**
     * The account ID.
     */
    accountId: PublicKey;
    accountInfo: MaybeRpcAccount;
}

/**
 * Enum representing quote or send actions.
 */
enum QuoteOrSend {
    /**
     * Quote action.
     */
    Quote,

    /**
     * Send action.
     */
    Send,
}

/**
 * Class representing a helper for sending transactions.
 */
export class SendHelper {
    private endpoint: EndpointProgram.Endpoint;
    private uln: UlnProgram.Uln;
    private simpleMsgLib: SimpleMessageLibProgram.SimpleMessageLib;
    private accounts = new Map<string, MaybeRpcAccount>();

    /**
     * Creates an instance of the SendHelper class.
     *
     * @param {PublicKey} [endpointProgram=EndpointProgram.PROGRAM_ID] - The endpoint program public key.
     * @param {PublicKey} [ulnProgram=UlnProgram.PROGRAM_ID] - The ULN program public key.
     * @param {PublicKey} [simpleMsgLibProgram=SimpleMessageLibProgram.PROGRAM_ID] - The simple message library program public key.
     */
    constructor(
        public readonly endpointProgram: PublicKey = EndpointProgram.ENDPOINT_PROGRAM_ID,
        public readonly ulnProgram: PublicKey = UlnProgram.ULN_PROGRAM_ID,
        public readonly simpleMsgLibProgram: PublicKey = SimpleMessageLibProgram.SIMPLE_MESSAGELIB_PROGRAM_ID,
    ) {
        this.endpoint = new EndpointProgram.Endpoint(endpointProgram);
        this.uln = new UlnProgram.Uln(ulnProgram);
        this.simpleMsgLib = new SimpleMessageLibProgram.SimpleMessageLib(simpleMsgLibProgram);
    }

    /**
     * Fetches multiple account information.
     *
     * @param {Connection} connection - The connection to the Solana cluster.
     * @param {PublicKey[]} keys - The public keys of the accounts.
     * @param {Commitment | GetAccountInfoConfig} [commitment] - The commitment level or account info configuration.
     * @returns {Promise<(AccountInfo<Buffer> | null)[]>} A promise that resolves to an array of account information.
     */
    private async getMultipleAccountsInfo(
        rpc: RpcInterface,
        keys: PublicKey[],
        commitment: Commitment = 'confirmed',
    ): Promise<MaybeRpcAccount[]> {
        // check if all accounts are already fetched
        const missingKeys = keys.filter((key) => !this.accounts.has(key));

        // fetch missing accounts
        if (missingKeys.length > 0) {
            const infos = await rpc.getAccounts(missingKeys, { commitment });
            infos.forEach((info, i) => {
                this.accounts.set(missingKeys[i], info);
            });
        }

        // return all accounts
        return keys.map((key) => this.accounts.get(key)!);
    }

    async getQuoteAccounts(
        rpc: RpcInterface,
        params: {
            payer: PublicKey | web3.PublicKey;
            sender: PublicKey | web3.PublicKey;
            dstEid: number;
            receiver: string | Uint8Array;
        },
        commitment: Commitment = 'confirmed',
    ): Promise<AccountMeta[]> {
        const { payer: _payer, sender: _sender, dstEid, receiver } = params;
        const payer = _payer instanceof web3.PublicKey ? fromWeb3JsPublicKey(_payer) : _payer;
        const sender = _sender instanceof web3.PublicKey ? fromWeb3JsPublicKey(_sender) : _sender;

        const [sendLibConfig] = this.endpoint.pda.sendLibraryConfig(sender, dstEid);
        const [defaultSendLibConfig] = this.endpoint.pda.defaultSendLibraryConfig(dstEid);
        const [simpleMsgLib] = this.simpleMsgLib.pda.messageLib();
        const [uln] = this.uln.pda.messageLib();
        const [ulnDefaultSendConfig] = this.uln.pda.defaultSendConfig(dstEid);
        const [ulnSendConfig] = this.uln.pda.sendConfig(dstEid, sender);
        const [
            sendLibConfigBuf,
            defaultSendLibConfigBuf,
            _simpleMsgLibBuf,
            ulnBuf,
            ulnDefaultSendConfigBuf,
            ulnSendConfigBuf,
        ] = await this.getMultipleAccountsInfo(
            rpc,
            [
                sendLibConfig,
                defaultSendLibConfig,
                simpleMsgLib,
                uln,
                ulnDefaultSendConfig,
                ulnSendConfig,
            ],
            commitment,
        );
        invariant(
            defaultSendLibConfigBuf.exists && sendLibConfigBuf.exists,
            'endpoint send library not initialized',
        );
        const sendLibConfigInfo =
            EndpointProgram.accounts.deserializeSendLibraryConfig(sendLibConfigBuf);
        const defaultSendLibConfigInfo =
            EndpointProgram.accounts.deserializeSendLibraryConfig(defaultSendLibConfigBuf);
        const msgLib =
            sendLibConfigInfo.messageLib.toString() === DefaultMessageLib.toString()
                ? defaultSendLibConfigInfo.messageLib
                : sendLibConfigInfo.messageLib;

        let msgLibProgram = this.ulnProgram;
        if (msgLib === this.simpleMsgLib.pda.messageLib()[0]) {
            msgLibProgram = this.simpleMsgLibProgram;
            return this.getEndpointAccounts(
                msgLibProgram,
                msgLib,
                sender,
                dstEid,
                receiver,
                QuoteOrSend.Quote,
            ).concat(this.getSimpleMsgLibAccounts(payer, QuoteOrSend.Quote));
        }
        if (msgLib !== this.uln.pda.messageLib()[0]) {
            throw new Error('Invalid message library');
        }

        return this.getEndpointAccounts(
            msgLibProgram,
            msgLib,
            sender,
            dstEid,
            receiver,
            QuoteOrSend.Quote,
        ).concat(
            await this.getUlnAccounts(
                rpc,
                payer,
                {
                    accountId: uln,
                    accountInfo: ulnBuf,
                },
                {
                    accountId: ulnDefaultSendConfig,
                    accountInfo: ulnDefaultSendConfigBuf,
                },
                {
                    accountId: ulnSendConfig,
                    accountInfo: ulnSendConfigBuf,
                },
                QuoteOrSend.Quote,
                commitment,
            ),
        );
    }

    /**
     * @param connection
     * @param payer
     * @param sender the PDA of the oApp
     * @param dstEid the destination endpoint id
     * @param receiver the remote peer's address
     * @param commitmentOrConfig
     * 1 or 3(1+2) RPC calls
     * */
    async getSendAccounts(
        rpc: RpcInterface,
        params: {
            payer: PublicKey | web3.PublicKey;
            sender: PublicKey | web3.PublicKey;
            dstEid: number;
            receiver: string | Uint8Array;
        },
        commitment: Commitment = 'confirmed',
    ): Promise<AccountMeta[]> {
        const { payer: _payer, sender: _sender, dstEid, receiver } = params;
        const payer = _payer instanceof web3.PublicKey ? fromWeb3JsPublicKey(_payer) : _payer;
        const sender = _sender instanceof web3.PublicKey ? fromWeb3JsPublicKey(_sender) : _sender;

        const [sendLibConfig] = this.endpoint.pda.sendLibraryConfig(sender, dstEid);
        const [defaultSendLibConfig] = this.endpoint.pda.defaultSendLibraryConfig(dstEid);
        const [simpleMsgLib] = this.simpleMsgLib.pda.messageLib();
        const [uln] = this.uln.pda.messageLib();
        const [ulnDefaultSendConfig] = this.uln.pda.defaultSendConfig(dstEid);
        const [ulnSendConfig] = this.uln.pda.sendConfig(dstEid, sender);
        const [
            sendLibConfigBuf,
            defaultSendLibConfigBuf,
            _simpleMsgLibBuf,
            ulnBuf,
            ulnDefaultSendConfigBuf,
            ulnSendConfigBuf,
        ] = await this.getMultipleAccountsInfo(
            rpc,
            [
                sendLibConfig,
                defaultSendLibConfig,
                simpleMsgLib,
                uln,
                ulnDefaultSendConfig,
                ulnSendConfig,
            ],
            commitment,
        );
        invariant(
            defaultSendLibConfigBuf.exists && sendLibConfigBuf.exists,
            'endpoint send library not initialized',
        );
        const sendLibConfigInfo =
            EndpointProgram.accounts.deserializeSendLibraryConfig(sendLibConfigBuf);
        const defaultSendLibConfigInfo =
            EndpointProgram.accounts.deserializeSendLibraryConfig(defaultSendLibConfigBuf);
        const msgLib =
            sendLibConfigInfo.messageLib.toString() === DefaultMessageLib.toString()
                ? defaultSendLibConfigInfo.messageLib
                : sendLibConfigInfo.messageLib;

        let msgLibProgram = this.ulnProgram;
        if (msgLib === this.simpleMsgLib.pda.messageLib()[0]) {
            msgLibProgram = this.simpleMsgLibProgram;
            return this.getEndpointAccounts(
                msgLibProgram,
                msgLib,
                sender,
                dstEid,
                receiver,
                QuoteOrSend.Send,
            ).concat(this.getSimpleMsgLibAccounts(payer, QuoteOrSend.Send));
        }
        if (msgLib !== this.uln.pda.messageLib()[0]) {
            throw new Error('Invalid message library');
        }
        return this.getEndpointAccounts(
            msgLibProgram,
            msgLib,
            sender,
            dstEid,
            receiver,
            QuoteOrSend.Send,
        ).concat(
            await this.getUlnAccounts(
                rpc,
                payer,
                {
                    accountId: uln,
                    accountInfo: ulnBuf,
                },
                {
                    accountId: ulnDefaultSendConfig,
                    accountInfo: ulnDefaultSendConfigBuf,
                },
                {
                    accountId: ulnSendConfig,
                    accountInfo: ulnSendConfigBuf,
                },
                QuoteOrSend.Send,
                commitment,
            ),
        );
    }

    /**
     * Gets the account metadata for the endpoint.
     *
     * @param {PublicKey} msgLibProgram - The message library program public key.
     * @param {PublicKey} msgLib - The message library public key.
     * @param {PublicKey} sender - The sender public key.
     * @param {number} dstEid - The destination endpoint ID.
     * @param {string} receiver - The receiver address.
     * @param {QuoteOrSend} quoteOrSend - The quote or send action.
     * @returns {AccountMeta[]} An array of account metadata.
     */
    private getEndpointAccounts(
        msgLibProgram: PublicKey,
        msgLib: PublicKey,
        sender: PublicKey,
        dstEid: number,
        _receiver: string | Uint8Array,
        quoteOrSend: QuoteOrSend,
    ): AccountMeta[] {
        const receiver = typeof _receiver === 'string' ? addressToBytes32(_receiver) : _receiver;
        const [sendLibraryConfig] = this.endpoint.pda.sendLibraryConfig(sender, dstEid);
        const [defaultSendLibraryConfig] = this.endpoint.pda.defaultSendLibraryConfig(dstEid);
        const [sendLibraryInfo] = this.endpoint.pda.messageLibraryInfo(msgLib);
        const [nonce] = this.endpoint.pda.nonce(sender, dstEid, receiver);
        let accounts: AccountMeta[];
        const endpoint = new EndpointProgram.Endpoint(this.endpointProgram);
        if (quoteOrSend === QuoteOrSend.Quote) {
            accounts = EndpointProgram.instructions
                .quote(
                    { programs: endpoint.programRepo },
                    {
                        sendLibraryProgram: msgLibProgram,
                        sendLibraryConfig,
                        defaultSendLibraryConfig,
                        sendLibraryInfo,
                        endpoint: this.endpoint.pda.setting()[0],
                        nonce,

                        // param
                        sender: defaultPublicKey(),
                        dstEid: 0,
                        receiver: new Uint8Array(32),
                        message: new Uint8Array(32),
                        options: new Uint8Array(32),
                        payInLzToken: false,
                    },
                )
                .getInstructions()[0].keys;
        } else {
            accounts = EndpointProgram.instructions
                .send(
                    { programs: endpoint.programRepo },
                    {
                        sender: createNoopSigner(sender), //signer
                        sendLibraryProgram: msgLibProgram,
                        sendLibraryConfig,
                        defaultSendLibraryConfig,
                        sendLibraryInfo,
                        endpoint: this.endpoint.pda.setting()[0],
                        nonce,
                        program: this.endpointProgram,
                        eventAuthority: this.endpoint.eventAuthority,

                        // param
                        dstEid: 0,
                        receiver: new Uint8Array(32),
                        message: new Uint8Array(32),
                        options: new Uint8Array(32),
                        nativeFee: 0,
                        lzTokenFee: 0,
                    },
                )
                .getInstructions()[0].keys;
        }

        accounts.forEach((item: AccountMeta) => {
            item.isSigner = false;
        });
        return [
            {
                pubkey: this.endpoint.programId,
                isSigner: false,
                isWritable: false,
            },
            ...accounts,
        ];
    }

    /**
     * Gets the account metadata for the simple message library.
     *
     * @param {PublicKey} payer - The payer public key.
     * @param {QuoteOrSend} quoteOrSend - The quote or send action.
     * @returns {AccountMeta[]} An array of account metadata.
     */
    private getSimpleMsgLibAccounts(payer: PublicKey, quoteOrSend: QuoteOrSend): AccountMeta[] {
        const [msgLib] = this.simpleMsgLib.pda.messageLib();
        let accounts: AccountMeta[];
        const simpleMsgLib = new SimpleMessageLibProgram.SimpleMessageLib(this.simpleMsgLibProgram);
        if (quoteOrSend === QuoteOrSend.Quote) {
            accounts = SimpleMessageLibProgram.instructions
                .quote(
                    { programs: simpleMsgLib.programRepo },
                    {
                        endpoint: createNoopSigner(defaultPublicKey()),
                        messageLib: msgLib,
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
                        payInLzToken: false,
                    },
                )
                .getInstructions()[0].keys;
        } else {
            accounts = SimpleMessageLibProgram.instructions
                .send(
                    { programs: simpleMsgLib.programRepo, payer: createNoopSigner(payer) },
                    {
                        endpoint: createNoopSigner(defaultPublicKey()), // useless
                        messageLib: msgLib,
                        payer: createNoopSigner(payer),
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
                )
                .getInstructions()[0].keys;
        }
        accounts.forEach((key) => {
            if (payer !== key.pubkey) {
                key.isSigner = false;
            }
        });
        return accounts.slice(1);
    }

    /**
     * Gets the account metadata for the ULN.
     *
     * @param {Connection} connection - The connection to the Solana cluster.
     * @param {PublicKey} payer - The payer public key.
     * @param {KeyedAccountInfo} ulnInfo - The ULN account information.
     * @param {KeyedAccountInfo} ulnDefaultSendConfigInfo - The ULN default send configuration account information.
     * @param {KeyedAccountInfo} ulnSendConfigInfo - The ULN send configuration account information.
     * @param {QuoteOrSend} quoteOrSend - The quote or send action.
     * @param {Commitment | GetAccountInfoConfig} [commitment] - The commitment level or account info configuration.
     * @returns {Promise<AccountMeta[]>} A promise that resolves to an array of account metadata.
     */
    private async getUlnAccounts(
        rpc: RpcInterface,
        payer: PublicKey,
        ulnInfo: KeyedAccountInfo,
        ulnDefaultSendConfigInfo: KeyedAccountInfo,
        ulnSendConfigInfo: KeyedAccountInfo,
        quoteOrSend: QuoteOrSend,
        commitment: Commitment = 'confirmed',
    ): Promise<AccountMeta[]> {
        invariant(
            ulnInfo.accountInfo.exists && ulnDefaultSendConfigInfo.accountInfo.exists,
            'uln send library not initialized',
        );
        const ulnState = UlnProgram.accounts.deserializeUlnSettings(ulnInfo.accountInfo);
        const defaultSendConfigState = UlnProgram.accounts.deserializeSendConfig(
            ulnDefaultSendConfigInfo.accountInfo,
        );
        const sendConfigState = ulnSendConfigInfo.accountInfo.exists
            ? UlnProgram.accounts.deserializeSendConfig(ulnSendConfigInfo.accountInfo)
            : null;

        let {
            executor,
            uln: { requiredDvns, optionalDvns },
        } = defaultSendConfigState;

        // if the executor is set in the send config, use it
        if (sendConfigState?.executor && sendConfigState.executor.executor !== defaultPublicKey()) {
            ({ executor } = sendConfigState);
        }

        // if the requiredDvns is set in the send config, use it
        if (sendConfigState && sendConfigState.uln.requiredDvns.length > 0) {
            requiredDvns = sendConfigState.uln.requiredDvns.filter((p) => {
                return p !== defaultPublicKey();
            });
        }

        // if the optionalDvns is set in the send config, use it
        if (sendConfigState && sendConfigState.uln.optionalDvns.length > 0) {
            optionalDvns = sendConfigState.uln.optionalDvns.filter((p) => {
                return p !== defaultPublicKey();
            });
        }

        const dvnsKey = requiredDvns.concat(optionalDvns);
        const [executorBuf, ...dvnBuf] = await this.getMultipleAccountsInfo(
            rpc,
            [executor.executor, ...dvnsKey],
            commitment,
        );
        invariant(executorBuf.exists, `executor:${executor.executor} not initialized`);

        let executorAccounts: AccountMeta[], dvnAccounts: AccountMeta[];
        {
            const executor = {
                config: ExecutorAccounts.deserializeExecutorConfig(executorBuf),
                owner: executorBuf.owner,
            };
            const dvns = dvnBuf.map((dvn, i) => {
                invariant(dvn.exists, `dvn:${dvnsKey[i]} not initialized`);
                return {
                    config: DvnAccounts.deserializeDvnConfig(dvn),
                    owner: dvn.owner,
                };
            });

            const priceFeeds = new Array<PublicKey>();
            [executor.config, ...dvns.map((dvn) => dvn.config)].forEach((config) => {
                priceFeeds.push(config.priceFeed);
            });
            const priceFeedInfos = await this.getMultipleAccountsInfo(rpc, priceFeeds, commitment);
            priceFeedInfos.forEach((info, i) => {
                invariant(info.exists, `priceFeed:${priceFeeds[i]} not initialized`);
            });
            const executorPriceFeed = await this.getMultipleAccountsInfo(
                rpc,
                [executor.config.priceFeed],
                commitment,
            );
            invariant(
                executorPriceFeed[0].exists,
                `executor priceFeed:${executor.config.priceFeed} not initialized`,
            );
            executorAccounts = new Executor(executor.owner).getQuoteIXAccountMetaForCPI(
                executor.config.priceFeed,
                executorPriceFeed[0].owner,
                quoteOrSend === QuoteOrSend.Send,
            );
            dvnAccounts = (
                await Promise.all(
                    dvns.map(async (p, i) => {
                        const dvnPriceFeed = await this.getMultipleAccountsInfo(
                            rpc,
                            [p.config.priceFeed],
                            commitment,
                        );
                        invariant(
                            dvnPriceFeed[0].exists,
                            `dvn priceFeed:${p.config.priceFeed} not initialized`,
                        );
                        return new DVN(p.owner).getQuoteIXAccountMetaForCPI(
                            p.config.priceFeed,
                            dvnPriceFeed[0].owner,
                            quoteOrSend === QuoteOrSend.Send,
                        );
                    }),
                )
            ).flat();
        }

        const treasury = isSome(ulnState.treasury)
            ? ulnState.treasury.value.nativeReceiver
            : undefined;
        let accounts: AccountMeta[];
        const uln = new UlnProgram.Uln(this.ulnProgram);
        if (quoteOrSend === QuoteOrSend.Quote) {
            const txBuilder = UlnProgram.instructions
                .quote(
                    { programs: uln.programRepo },
                    {
                        endpoint: createNoopSigner(defaultPublicKey()),
                        uln: this.uln.pda.setting()[0],
                        sendConfig: ulnSendConfigInfo.accountId,
                        defaultSendConfig: ulnDefaultSendConfigInfo.accountId,
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
                        payInLzToken: false,
                    },
                )
                .addRemainingAccounts(executorAccounts.concat(dvnAccounts));
            accounts = txBuilder.getInstructions()[0].keys;
        } else {
            const txBuilder = UlnProgram.instructions
                .send(
                    { programs: uln.programRepo, payer: createNoopSigner(payer) },
                    {
                        endpoint: createNoopSigner(defaultPublicKey()),
                        uln: this.uln.pda.setting()[0],
                        sendConfig: ulnSendConfigInfo.accountId,
                        defaultSendConfig: ulnDefaultSendConfigInfo.accountId,
                        payer: createNoopSigner(payer),
                        treasury,
                        eventAuthority: this.uln.eventAuthority,
                        program: this.uln.programId,

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
                )
                .addRemainingAccounts(executorAccounts.concat(dvnAccounts));
            accounts = txBuilder.getInstructions()[0].keys;
            if (treasury) {
                const treasuryIndex = accounts.findIndex((k) => k.pubkey == treasury);
                accounts[treasuryIndex].isWritable = true; // treasury account
            }
        }
        accounts.forEach((key) => {
            if (payer !== key.pubkey) {
                key.isSigner = false;
            }
        });
        return accounts.slice(1);
    }
}
