import {
    Cell,
    StateInit,
    beginCell,
    external,
    storeMessage,
    Contract,
    openContract,
    Address,
    ContractProvider,
    ContractState,
    toNano,
    comment,
    OpenedContract,
    Transaction,
    TupleItem,
    TupleReader,
    loadTransaction
} from '@ton/core'
import {z} from 'zod'

import {Maybe} from "../utils/maybe";

import {
    Account,
    AddressBook,
    BlockList,
    BlockTransactions,
    GetMethodRequest,
    GetMethodRequestStack,
    GetMethodResponse,
    GetMethodResponseStack,
    MasterchainInfo,
    MessageList,
    SendMessageResponse,
    TraceItem,
    TraceNode,
    Traces,
    TransactionTrace,
    WalletInfo,
} from './types3'

import {
    accountSchema,
    addressBookSchema,
    blockListSchema,
    blockTransactionsSchema,
    getMethodRequestSchema,
    getMethodResponseSchema,
    masterchainInfoSchema,
    messageListSchema,
    sendMessageResponseSchema,
    transactionTraceSchema,
    walletInfoSchema,
} from './types3'

interface HttpHeaders {
    [key: string]: string
}
const transformToTransactionTrace = (
    traceItem: TraceItem,
    node: TraceNode = traceItem.trace,
): TransactionTrace => {
    return {
        transaction: traceItem.transactions[node.tx_hash],
        children: node.children.map((child) =>
            transformToTransactionTrace(traceItem, child),
        ),
    }
}

export type TonClient3Parameters = {
    /**
     * API Endpoint
     */
    endpoint: string;

    /**
     * API Key
     */
    apiKey?: string;

    headers?: HttpHeaders
    params?: Record<string, string>
}

// TODO: gracefully handle validation error (code 422)
export class TonClient3 {
    protected endpoint: string
    protected headers: HttpHeaders
    protected params?: Record<string, string>

    constructor(args: TonClient3Parameters) {
        this.endpoint = args.endpoint
        this.headers = {
            'Accept': 'application/json',
            'Content-Type': 'application/json',
            ...args.headers
        }
        this.params = args.params
        if (args.apiKey !== undefined) {
            this.headers['X-API-Key'] = args.apiKey
        }
    }

    // Main method to make an http request to the API
    protected async fetch(method: string, subpath: string, queryParams: string[][] = [], data?: any): Promise<unknown> {
        // Initialize a new URL object with the base URL
        const url = new URL(this.endpoint + subpath)

        for (const [key, value] of [...queryParams, ...Object.entries(this.params ?? {})]) {
            // Make sure the value is not empty (definitely happens for nullable query parameters)
            if (value !== '') {
                url.searchParams.append(key, value)
            }
        }

        // Initialize the fetch options
        const fetchOptions: RequestInit = {
            method: method,
            headers: this.headers,
        }

        if (data !== undefined) {
            fetchOptions.body = JSON.stringify(data)
        }

        try {
            const response = await fetch(url, fetchOptions)
            if (!response.ok) {
                throw new Error(`HTTP error! status: ${response.status}`)
            }
            return await response.json()
        } catch (error) {
            if (error instanceof Error) {
                console.error('Error: ', error.message)
            } else {
                console.error('Unknown Error:', error)
            }
            throw error
        }
    }

    protected async get(subpath: string, queryParams: string[][] = []): Promise<unknown> {
        return this.fetch('GET', subpath, queryParams)
    }

    protected async post(subpath: string, data: any): Promise<unknown> {
        return this.fetch('POST', subpath, [], data)
    }

    // parses the response with the given schema and returns the data of the corresponding type if successful
    protected returnOrThrow<T, S extends z.ZodType<T>>(
        response: unknown,
        schema: S,
        name = 'response',
    ): any {
        const parsedResponse = schema.safeParse(response)
        if (parsedResponse.success) {
            return parsedResponse.data
        } else {
            const errorMessage = parsedResponse.error.issues
                .map((issue) => issue.message)
                .join(', ')
            throw new Error(`Error parsing ${name}: ${errorMessage}`)
        }
    }
    /**
     * Fetches the masterchain information.
     *
     * @returns {Promise<MasterchainInfo>} - The response containing the masterchain information.
     */
    public async getMasterchainInfo(): Promise<MasterchainInfo> {
        // Make a GET request to the /masterchainInfo endpoint
        const response = await this.get('/masterchainInfo')

        // Return the response or throw an error based on the masterchainInfoSchema
        return this.returnOrThrow(response, masterchainInfoSchema)
    }

    /**
     * Fetches a list of blocks from the blockchain based on various criteria.
     *
     * @param {number} workchain - The ID of the blockchain workchain. Required.
     * @param {string} [shard] - The specific shard ID of the block. Must be provided alongside workchain.
     * @param {number} [seqno] - The sequence number of the block. Must be provided with both workchain and shard.
     * This method constructs query parameters based on input, checks for the existence of required parameters,
     * and sends a GET request to the '/api/v3/blocks' endpoint. The response is then validated against the blockListSchema
     * and either returned or an error is thrown.
     */
    public async getBlocks(
        options: {
            workchain?: number
            shard?: number
            seqno?: number
        } = {},
    ): Promise<BlockList> {
        // Make a GET request to the /masterchainInfo endpoint
        const queryParams = [
            ...(options.workchain
                ? [['workchain', options.workchain.toString()]]
                : []),
            ...(options.shard ? [['shard', options.shard.toString()]] : []),
            ...(options.seqno ? [['seqno', options.seqno.toString()]] : []),
        ]
        const response = await this.get('/blocks', queryParams)

        return this.returnOrThrow(response, blockListSchema)
    }

    /**
     * Fetches shards by the specified masterchain block.
     *
     * @param {number} seqno - Masterchain block sequence number.
     * @returns {Promise<BlockList>} - The response containing the list of shards for the specified masterchain block.
     */
    public async getMasterchainBlockShardState(seqno: number): Promise<BlockList> {
        // Create query parameters with 'seqno' as key and the sequence number as value
        const queryParams = [['seqno', seqno.toString()]]

        // Make a GET request to the /masterchainBlockShardState endpoint
        const response = await this.get('/masterchainBlockShardState', queryParams)

        // Return the response or throw an error based on the blockListSchema
        return this.returnOrThrow(response, blockListSchema)
    }

    /**
     * Fetches an address book for a given list of addresses.
     *
     * @param {string[]} addresses - List of addresses in any accepted TON form. (https://ton.org/address/) Each address must have a length <= 1024 characters.
     * @returns {Promise<AddressBook>} - The response containing the address book data.
     * @throws {Error} - Throws an error if any address exceeds 1024 characters.
     */
    public async getAddressBook(addresses: string[]): Promise<AddressBook> {
        // Validate each address length
        addresses.forEach((value) => {
            if (value.length > 1024) {
                throw new Error(`Address ${value} is too long`)
            }
        })

        // Create query parameters with 'address' as key and the address as value
        const queryParams = addresses.map((value) => ['address', value])

        // Make a GET request to the /addressBook endpoint
        const response = await this.get('/addressBook', queryParams)

        // Return the response or throw an error based on the schema
        return this.returnOrThrow(response, addressBookSchema)
    }

    /**
     * Fetches all workchain blocks that appeared after the specified masterchain block.
     *
     * @param {number} seqno - Masterchain block sequence number.
     * @param {boolean} [include_mc_block=false] - Whether to include the masterchain block. Default is false.
     * @returns {Promise<BlockList>} - The response containing the list of workchain blocks.
     */
    public async getMasterchainBlockShards(seqno: number, include_mc_block = false): Promise<BlockList> {
        // Create query parameters with 'seqno' and 'include_mc_block' as keys
        const queryParams = [
            ['seqno', seqno.toString()],
            ['include_mc_block', include_mc_block.toString()],
        ]

        // Make a GET request to the /masterchainBlockShards endpoint
        const response = await this.get('/masterchainBlockShards', queryParams)

        // Return the response or throw an error based on the blockListSchema
        return this.returnOrThrow(response, blockListSchema)
    }

    /**
     * Retrieves transactions based on specified parameters.
     *
     * @param account - Account addresses to get transactions for. Can be in hex, base64 or base64url form.
     * @param start_lt - Query transactions with lt >= start_lt.
     * @param end_lt - Query transactions with lt <= end_lt.
     * @param hash - Transaction hash. Acceptable in hex, base64 and base64url forms.
     * @param limit - Limit number of queried rows. Default is 128. Maximum is 256.
     * @param offset - Skip first N rows. Used with limit to implement pagination. Default is 0.
     * @param sort - Sort transactions by logical time. Can be 'asc' or 'desc'. Default is 'desc'.
     *
     * @returns {Promise<BlockTransactions>} A promise that resolves to the block transactions data.
     */
    public async getTransactions(options: {
        account?: string[]
        start_lt?: string
        end_lt?: string
        hash?: string
        limit?: number
        offset?: number
        sort?: 'asc' | 'desc'
    }): Promise<BlockTransactions> {
        // Create query parameters with 'direction', 'msg_hash', 'limit', and 'offset' as keys
        const queryParams = [
            ...(options.account?.map((value) => ['account', value]) ?? []),
            ...(options.start_lt ? [['start_lt', options.start_lt]] : []),
            ...(options.end_lt ? [['end_lt', options.end_lt]] : []),
            ...(options.hash ? [['hash', options.hash]] : []),
            ['limit', options.limit?.toString() ?? '100'],
            ['offset', options.offset?.toString() ?? '0'],
            ['sort', options.sort ?? 'desc'],
        ]

        // Make a GET request to the /transactions endpoint
        const response = await this.get('/transactions', queryParams)

        // Return the response or throw an error based on the blockTransactionsSchema
        return this.returnOrThrow(response, blockTransactionsSchema)
    }   


    /**
     * Returns transactions from the specified masterchain block and all shards.
     *
     * @param {number} seqno - Masterchain block sequence number.
     * @param {number} [limit=128] - Limit number of queried rows. Maximum is 256, minimum is 1. Use with offset for batch reading.
     * @param {number} [offset=0] - Skip the first N rows. Minimum is 0. Use with limit for batch reading.
     * @param {string} [sort="desc"] - Sort transactions by order. Can be "desc", "asc", or "none". Default is descending ("desc").
     * @returns {Promise<BlockTransactions>} - The response containing the transactions from the masterchain block.
     */
    public async getTransactionsByMasterchainBlock(
        seqno: number,
        limit = 128,
        offset = 0,
        sort: 'asc' | 'desc' | 'none' = 'desc'
    ): Promise<BlockTransactions> {
        // Create query parameters with 'seqno', 'limit', 'offset', and 'sort' as keys
        const queryParams = [
            ['seqno', seqno.toString()],
            ['limit', limit.toString()],
            ['offset', offset.toString()],
            ['sort', sort],
        ]

        // Make a GET request to the /transactionsByMasterchainBlock endpoint
        const response = await this.get('/transactionsByMasterchainBlock', queryParams)

        // Return the response or throw an error based on the masterchainBlockTransactionsSchema
        return this.returnOrThrow(response, blockTransactionsSchema)
    }

    /**
     * Fetches transactions whose inbound or outbound message has the specified hash.
     *
     * @param {string} direction - Message direction. Must be either "in" or "out".
     * @param {string} msg_hash - Message hash. Acceptable in hex, base64, or base64url forms.
     * @param {number} [limit=128] - Limit number of queried rows. Maximum is 256, minimum is 1. Use with offset for batch reading.
     * @param {number} [offset=0] - Skip the first N rows. Minimum is 0. Use with limit for batch reading.
     * @returns {Promise<BlockTransactions>} - The response containing the transactions with the specified message hash.
     */
    public async getTransactionsByMessage(
        direction: string,
        msg_hash: string,
        limit = 128,
        offset = 0
    ): Promise<BlockTransactions> {
        // Create query parameters with 'direction', 'msg_hash', 'limit', and 'offset' as keys
        const queryParams = [
            ['direction', direction],
            ['msg_hash', msg_hash],
            ['limit', limit.toString()],
            ['offset', offset.toString()],
        ]

        // Make a GET request to the /transactionsByMessage endpoint
        const response = await this.get('/transactionsByMessage', queryParams)

        // Return the response or throw an error based on the blockTransactionsSchema
        return this.returnOrThrow(response, blockTransactionsSchema)
    }

    /**
     * Fetches parent and/or child transactions for a specified transaction.
     * @param {string} hash - Transaction hash. Acceptable in hex, base64, or base64url forms.
     * @param {string} [direction="both"] - Direction of transactions by logical timestamp. Options are "both", "in", or "out".
     * @param {number} [limit=128] - Limit number of queried rows. Maximum is 256, minimum is 1. Use with offset for batch reading.
     * @param {number} [offset=0] - Skip the first N rows. Minimum is 0. Use with limit for batch reading.
     * @param {string} [sort="desc"] - Sort transactions by order. Can be "desc", "asc", or "none". Default is descending ("desc").
     * @returns {Promise<BlockTransactions>} - The response containing the adjacent transactions.
     */
    public async getAdjacentTransactions(
        hash: string,
        direction = 'both',
        limit = 128,
        offset = 0,
        sort: 'asc' | 'desc' | 'none' = 'desc'
    ): Promise<BlockTransactions> {
        // Create query parameters with 'hash', 'direction', 'limit', 'offset', and 'sort' as keys
        const queryParams = [
            ['hash', hash],
            ['direction', direction],
            ['limit', limit.toString()],
            ['offset', offset.toString()],
            ['sort', sort],
        ]

        // Make a GET request to the /adjacentTransactions endpoint
        const response = await this.get('/adjacentTransactions', queryParams)

        // Return the response or throw an error based on the blockTransactionsSchema
        return this.returnOrThrow(response, blockTransactionsSchema)
    }

    /**
     * Fetches messages by specified filters.
     *
     * @param {string} hash - Message hash. Acceptable in hex, base64, and base64url forms.
     * @param {string} [source] - The source account address. Can be in hex, base64, or base64url form. Use 'null' to get external messages.
     * @param {string} [destination] - The destination account address. Can be in hex, base64, or base64url form. Use 'null' to get log messages.
     * @param {string} [body_hash] - Message body hash. Acceptable in hex, base64, and base64url forms.
     * @param {number} [limit=128] - Limit number of queried rows. Maximum is 256, minimum is 1. Use with offset for batch reading.
     * @param {number} [offset=0] - Skip the first N rows. Minimum is 0. Use with limit for batch reading.
     * @returns {Promise<MessageList>} - The response containing the list of messages.
     */
    public async getMessages(
        hash?: string,
        source?: string,
        destination?: string,
        body_hash?: string,
        limit = 128,
        offset = 0
    ): Promise<MessageList> {
        const queryParams = [
            ['hash', hash ?? ''],
            ['source', source ?? ''],
            ['destination', destination ?? ''],
            ['body_hash', body_hash ?? ''],
            ['limit', limit.toString()],
            ['offset', offset.toString()],
        ]

        const response = await this.get('/messages', queryParams)

        return this.returnOrThrow(response, messageListSchema)
    }

    // TODO: get nft/colections
    // TODO: get nft/items
    // TODO: get nft/transfers
    // TODO: get jetton/masters
    // TODO: get jetton/wallets
    // TODO: get jetton/transfers
    // TODO: get jetton/burns

    // TODO: Test this one properly. [can't test because my wallet has been garbage collected?]
    // WIP: sendMessage, probably unstable.
    async sendMessage(address: string, message: Maybe<Cell>): Promise<SendMessageResponse> {
        // Resolve init
        const neededInit: StateInit | null = null
        // if (init && !await client.isContractDeployed(address)) {
        //     neededInit = init;
        // }

        // send Package
        const ext = external({
            to: address,
            init: neededInit,
            body: message,
        })
        const boc = beginCell().store(storeMessage(ext)).endCell().toBoc().toString('base64')

        const response = await this.post('/message', {boc})
        return this.returnOrThrow(response, sendMessageResponseSchema)
    }

    // WIP: sendMessageFromString, probably unstable.
    // Assumes you've already created+signed the message and are sending it as a string
    async sendMessageFromString(message: string): Promise<SendMessageResponse> {
        const response = await this.post('/message', {boc: message})
        return this.returnOrThrow(response, sendMessageResponseSchema)
    }

    /**
     * Fetches the result of a getMethod request.
     *
     * @param {GetMethodRequest} body - The request body containing the method and parameters.
     * @returns {Promise<GetMethodResponse>} - The response containing the result of the getMethod request. The stack field contains the stack initially sent inside the request body and the result of the method execution in the same format.
     *
     * @throws {Error} - Throws an error if the body is not valid.
     * @throws {Error} - Throws an error if the response is not valid.
     *
     */
    public async postRunGetMethod(body: GetMethodRequest): Promise<GetMethodResponse> {
        const parsedBody: GetMethodRequest = this.returnOrThrow(body, getMethodRequestSchema, 'body')

        const response = await this.post('/runGetMethod', parsedBody)
        return this.returnOrThrow(response, getMethodResponseSchema)
    }

    // TODO: post estimateFee

    /**
     * Check if contract is deployed
     * @param address addres to check
     * @returns true if contract is in active state
     */
    async isContractDeployed(address: Address) {
        return (await this.getAccountInfo(address.toRawString())).status === 'active';
    }

    /**
     * Fetches smart contract information for a given account address.
     *
     * @param {string} address - Account address. Can be sent in raw or user-friendly form.
     * @returns {Promise<Account>} - The response containing the account information.
     */
    public async getAccountInfo(address: string): Promise<Account> {
        // Create query parameters with 'address' as key and the provided address as value
        const queryParams = [['address', address]]

        // Make a GET request to the /account endpoint
        const response = await this.get('/account', queryParams)

        // Return the response or throw an error based on the accountSchema
        return this.returnOrThrow(response, accountSchema)
    }

    /**
     * Fetches smart contract information for a given wallet address.
     *
     * @param {string} address - Smart contract address. Can be sent in raw or user-friendly form.
     * @returns {Promise<WalletInfo>} - The response containing the wallet smart contract information.
     * @throws {Error} - Throws an error if the account is not a wallet (HTTP status code 409).
     */
    public async getWalletInfo(address: string): Promise<WalletInfo> {
        // Create query parameters with 'address' as key and the provided address as value
        const queryParams = [['address', address]]

        // Make a GET request to the /wallet endpoint
        const response = await this.get('/wallet', queryParams)

        // Return the response or throw an error based on the walletInfoSchema
        return this.returnOrThrow(response, walletInfoSchema)
    }

    // TODO: official API documentation is missing for this endpoint (WIP)
    public async getTransactionTrace(
        transaction_hash: string,
    ): Promise<TransactionTrace> {
        try {
            // Supposed to the the production ready implementation (currently on mainnet API docs)
            const queryParams = [['tx_hash', transaction_hash]]
            const response = (await this.get('/events', queryParams)) as Traces

            return this.returnOrThrow(
                transformToTransactionTrace((response.traces ?? response.events)[0]),
                transactionTraceSchema,
            )
        } catch {}

        try {
            // The one listed on the testnet API docs
            const queryParams = [['tx_hash', transaction_hash]]
            const response = await this.get('/traces', queryParams) as Traces

            return this.returnOrThrow(
                transformToTransactionTrace((response.traces ?? response.events)[0]),
                transactionTraceSchema,
            )
        } catch {}

        const queryParams = [['hash', transaction_hash]]
        const response = await this.get('/transactionTrace', queryParams)
        return this.returnOrThrow(response, transactionTraceSchema)
    }

    /**
     * Open contract
     * @param src source contract
     * @returns contract
     */
    open<T extends Contract>(src: T) {
        return openContract<T>(src, (args) => createProvider(this, args.address, args.init));
    }

    /**
     * Create a provider
     * @param address address
     * @param init optional init
     * @returns provider
     */
    provider(address: Address, init?: StateInit | null) {
        return createProvider(this, address, init ?? null);
    }
}

function createProvider(client: TonClient3, address: Address, init: StateInit | null): ContractProvider {
    return {
        async getState(): Promise<ContractState> {
            let account = await client.getAccountInfo(address.toRawString());
            let balance = BigInt(account.balance);
            let last = account.last_transaction_lt && account.last_transaction_hash ? {
                lt: BigInt(account.last_transaction_lt),
                hash: Buffer.from(account.last_transaction_hash, 'base64')
            } : null;
            let storage: {
                type: 'uninit';
            } | {
                type: 'active';
                code: Maybe<Buffer>;
                data: Maybe<Buffer>;
            } | {
                type: 'frozen';
                stateHash: Buffer;
            };
            if (account.status === 'active') {
                storage = {
                    type: 'active',
                    code: account.code ? Buffer.from(account.code, 'base64') : null,
                    data: account.data ? Buffer.from(account.data, 'base64') : null,
                };
            } else if (account.status === 'uninit') {
                storage = {
                    type: 'uninit',
                };
            } else if (account.status === 'frozen') {
                storage = {
                    type: 'frozen',
                    stateHash: Buffer.alloc(0),
                };
            } else {
                throw Error('Unsupported state');
            }
            return {
                balance,
                last,
                state: storage,
            };
        },
        async get(name, args) {
            if (typeof name !== 'string') {
                throw new Error('Method name must be a string for TonClient3 provider');
            }

            let response = await client.postRunGetMethod({
                address: address.toRawString(),
                method: name,
                stack: serializeStack(args)
            });
            return {stack: parseStack(response.stack)};
        },
        async external(message) {

            //
            // Resolve init
            //

            let neededInit: StateInit | null = null;
            if (init && !await client.isContractDeployed(address)) {
                neededInit = init;
            }

            //
            // Send package
            //

            const ext = external({
                to: address,
                init: neededInit,
                body: message
            })
            let boc = beginCell()
                .store(storeMessage(ext))
                .endCell()
                .toBoc();
            await client.sendMessageFromString(boc.toString('base64'));
        },
        async internal(via, message) {

            // Resolve init
            let neededInit: StateInit | null = null;
            if (init && (!await client.isContractDeployed(address))) {
                neededInit = init;
            }

            // Resolve bounce
            let bounce = true;
            if (message.bounce !== null && message.bounce !== undefined) {
                bounce = message.bounce;
            }

            // Resolve value
            let value: bigint;
            if (typeof message.value === 'string') {
                value = toNano(message.value);
            } else {
                value = message.value;
            }

            // Resolve body
            let body: Cell | null = null;
            if (typeof message.body === 'string') {
                body = comment(message.body);
            } else if (message.body) {
                body = message.body;
            }

            // Send internal message
            await via.send({
                to: address,
                value,
                bounce,
                sendMode: message.sendMode,
                init: neededInit,
                body
            });
        },
        open<T extends Contract>(contract: T): OpenedContract<T> {
            return openContract<T>(contract, (args) => createProvider(client, args.address, args.init ?? null));
        },
        async getTransactions(address: Address, lt: bigint, hash: Buffer, limit?: number): Promise<Transaction[]> {
            const response = await client.getTransactions({account: [address.toRawString()], start_lt: lt.toString(), end_lt: lt.toString(), hash: hash.toString('base64'), limit, sort: 'asc'});
            const messages: string[] = []
            for (let transaction of response.transactions) {
                if (transaction.in_msg?.message_content?.body !== undefined) {
                    messages.push(transaction.in_msg.message_content.body);
                }
            }
            return messages.map(message => {
                return loadTransaction(Cell.fromBoc(Buffer.from(message, 'base64'))[0].beginParse())
            })
        }
    }
}

function serializeStack(src: TupleItem[]): GetMethodRequestStack[] {
    let stack: GetMethodRequestStack[] = [];
    for (let s of src) {
        if (s.type === 'int') {
            stack.push({
                type: 'num',
                value: s.value.toString()
            });
        } else if (s.type === 'cell' || s.type === 'builder') {
            stack.push({
                type: 'cell',
                value: s.cell.toBoc().toString('base64')
            });
        } else if (s.type === 'slice') {
            stack.push({
                type: 'slice',
                value: s.cell.toBoc().toString('base64')
            });
        } else {
            throw Error('Unsupported stack item type: ' + s.type)
        }
    }
    return stack;
}

function parseStackEntry(x: any): any {
    const typeName = x['@type'];
    switch (typeName) {
        case 'tvm.list':
        case 'tvm.tuple':
            return x.elements.map(parseStackEntry);
        case 'tvm.cell':
            return Cell.fromBoc(Buffer.from(x.bytes, 'base64'))[0];
        case 'tvm.slice':
            return Cell.fromBoc(Buffer.from(x.bytes, 'base64'))[0];
        case 'tvm.stackEntryCell':
            return parseStackEntry(x.cell);
        case 'tvm.stackEntrySlice':
            return parseStackEntry(x.slice);
        case 'tvm.stackEntryTuple':
            return parseStackEntry(x.tuple);
        case 'tvm.stackEntryList':
            return parseStackEntry(x.list);
        case 'tvm.stackEntryNumber':
            return parseStackEntry(x.number);
        case 'tvm.numberDecimal':
            return BigInt(x.number);
        default:
            throw Error('Unsupported item type: ' + typeName);
    }
}

function parseStackItem(s: GetMethodResponseStack): TupleItem {
    if (s.value === null) {
        return {type: 'null'};
    }
    // type: 'cell' | 'slice' | 'num' | 'list' | 'tuple' | 'unsupported_type'
    if (s.type === 'num') {
        let val = s.value as string;
        if (val.startsWith('-')) {
            return {type: 'int', value: -BigInt(val.slice(1))};
        } else {
            return {type: 'int', value: BigInt(val)};
        }
    }
    if (s.type === 'cell') {
        return {type: 'cell', cell: Cell.fromBoc(Buffer.from(s.value as string, 'base64'))[0]};
    }
    if (s.type === 'slice') {
        return {type: 'slice', cell: Cell.fromBoc(Buffer.from(s.value as string, 'base64'))[0]};
    }
    if (s.type === 'tuple' || s.type === 'list') {
        const elements = (s.value as unknown[])
        if (elements.length === 0) {
            return {type: 'null'};
        }
        return {type: 'tuple', items: elements.map(parseStackEntry)};
    }
    throw Error('Unsupported stack item type: ' + s.type)
}

export function parseStack(src: GetMethodResponseStack[]) {
    let stack: TupleItem[] = [];
    for (let s of src) {
        stack.push(parseStackItem(s));
    }
    return new TupleReader(stack);
}

export default TonClient3
