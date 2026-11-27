// from: https://toncenter.com/api/v3/doc.json

// --- types for AddressBook ---
// each input address is mapped to an object with key 'user_friendly' and value the address
// from #/definitions/AddressBookRow

export interface AddressBook {
    [key: string]: {
        user_friendly: string
    }
}

// These are the states an account can be in, some responses will include null as well,
// so we define those separately as AccountStatus | null
export type AccountStatusCode = 'uninit' | 'frozen' | 'active' | 'nonexist'

// --- types for WalletInfo ---
// [description of each field not verified yet, chatgpt generated]
// #/definitions/V2WalletInformation

export interface WalletInfo {
    balance: string // The balance is a string that might represent a large number.
    wallet_type: string | null // Description of the wallet type.
    seqno: number | null // Sequence number, a simple number.
    wallet_id: number | null // Identifier for the wallet, also a number.
    last_transaction_lt: string | null // The last transaction logical time, represented as a string.
    last_transaction_hash: string | null // The hash of the last transaction, a base64 encoded string.
    status: AccountStatusCode | null
}

// --- types for MasterchainInfo ---
// from #/definitions/BlockId
export interface BlockRef {
    workchain: number
    shard: string
    seqno: number
}

// from #/definitions/Block
export interface Block {
    workchain: number
    shard: string
    seqno: number
    root_hash: string
    file_hash: string
    global_id: number
    version: number
    after_merge: boolean
    before_split: boolean
    after_split: boolean
    want_merge: boolean
    want_split: boolean
    key_block: boolean
    vert_seqno_incr: boolean
    flags: number
    gen_utime: string
    start_lt: string
    end_lt: string
    validator_list_hash_short: number
    gen_catchain_seqno: number
    min_ref_mc_seqno: number
    prev_key_block_seqno: number
    vert_seqno: number
    master_ref_seqno: number | null
    rand_seed: string
    created_by: string
    tx_count: number | null
    masterchain_block_ref: BlockRef | null
    prev_blocks: BlockRef[]
}

export interface BlockList {
    blocks: Block[]
}

// from #/definitions/MasterchainInfo
export interface MasterchainInfo {
    last: Block
    first: Block
}

// --- types for AccountInfo ---
// Not found in https://toncenter.com/api/v3/doc.json
export interface Account {
    balance: string // "balance" is a required string.
    code: string | null // "code" can be a string or null.
    data: string | null // "data" can be a string or null.
    last_transaction_lt: string | null // "last_transaction_lt" can be a string or null.
    last_transaction_hash: string | null // "last_transaction_hash" can be a string or null.
    frozen_hash?: string | null // "frozen_hash" can be a string or null.
    status: AccountStatusCode // "status" must be one of these specified strings.
}

// from #/definitions/AccountState
export interface AccountState {
    hash: string // "hash" is a required string.
    balance: string | null // "balance" can be a string or null.
    account_status: AccountStatusCode | null // "account_status" can be one of these specified strings or null.
    frozen_hash?: string | null // "frozen_hash" can be a string or null.
    code_hash: string | null // "code_hash" can be a string or null.
    data_hash: string | null // "data_hash" can be a string or null.
}

// -- types for transactionTrace ---
// from #/definitions/MsgSize
export interface TotalMsgSize {
    bits: string // (but it's a number)
    cells: string // (but it's a number)
}

// from #/definitions/ActionPhase
export interface Action {
    valid: boolean
    success: boolean
    no_funds: boolean
    result_code: number
    tot_actions: number
    msgs_created: number
    spec_actions: number
    tot_msg_size: TotalMsgSize
    status_change: string // TODO: This one might only accept certain strings
    total_fwd_fees?: string // (but it's a number)
    skipped_actions: number
    action_list_hash: string
    total_action_fees?: string // (but it's a number)
}

// from #/definitions/BouncePhase
export interface Bounce {
    type: string // TODO: This one might only accept certain strings
}

// from #/definitions/CreditPhase
export interface CreditPh {
    credit: string // (but it's a number)
    due_fees_collected?: string // (but it's a number)
}

// from #/definitions/ComputePhase
export interface ComputePh {
    mode?: number
    type?: string // TODO: This one might only accept certain strings
    success?: boolean
    gas_fees?: string // (but it's a number)
    gas_used?: string // (but it's a number)
    vm_steps?: number
    exit_code?: number
    gas_limit?: string // (but it's a number)
    gas_credit?: string // (but it's a number)
    msg_state_used?: boolean
    account_activated?: boolean
    vm_init_state_hash?: string
    vm_final_state_hash?: string
}

// from #/definitions/StoragePhase
export interface StoragePh {
    status_change: string // TODO: This one might only accept certain strings
    storage_fees_collected: string // (but it's a number)
}

// from #/definitions/TransactionDescr
export interface Description {
    type: string
    action?: Action
    bounce?: Bounce
    aborted: boolean
    credit_ph?: CreditPh
    destroyed: boolean
    compute_ph: ComputePh
    storage_ph: StoragePh
    credit_first?: boolean
}

// It's only a generic object, with no specific fields in https://toncenter.com/api/v3/doc.json
export interface Decoded {
}

// from #/definitions/MessageContent
export interface MessageContent {
    hash: string
    body: string
    decoded: Decoded | null
}

// from #/definitions/MessageContent
export interface InitState {
    hash: string
    body: string
}

// from #/definitions/Message
export interface Message {
    hash: string
    source: string | null
    destination: string | null
    value: string | null
    fwd_fee: string | null
    ihr_fee: string | null
    created_lt: string | null
    created_at: string | null
    opcode: string | null // CRC-16 hash of the string corresponding to the opcode
    ihr_disabled: boolean | null
    bounce: boolean | null
    bounced: boolean | null
    import_fee: string | null // (but it's a number)
    message_content: MessageContent
    init_state: InitState | null
}

export interface MessageList {
    messages: Message[]
}

// from #/definitions/Transaction
export interface Transaction {
    account: string // chain:hex address
    hash: string
    lt: string // logical time (it's a number)
    now: number // unix timestamp in seconds when this transaction was executed
    orig_status: AccountStatusCode
    end_status: AccountStatusCode
    total_fees: string // Total fees that were collected for this transaction (it's a number)
    prev_trans_hash: string // Hash of the previous transaction for this account
    prev_trans_lt: string // The lt of the previous transaction for this account
    description: Description
    block_ref: BlockRef
    in_msg: Message | null
    out_msgs: Message[]
    account_state_before: AccountState
    account_state_after: AccountState
    mc_block_seqno: number
}

// not found in https://toncenter.com/api/v3/doc.json
export interface TransactionTrace {
    transaction: Transaction
    children: TransactionTrace[]
}

// from #definitions/TransactionsResponse
export interface BlockTransactions {
    transactions: Transaction[]
    address_book: AddressBook
}

// --- types for postRunGetMethod ---

// Request

// from #definitions/V2StackEntity
export interface GetMethodRequestStack {
    type: 'cell' | 'slice' | 'num'
    value: string
}

// from #definitions/V2RunGetMethodRequest
export interface GetMethodRequest {
    address: string
    method: string
    stack: GetMethodRequestStack[]
}

// Response

// Not found in https://toncenter.com/api/v3/doc.json
export interface GetMethodResponseStack {
    type: 'cell' | 'slice' | 'num' | 'list' | 'tuple' | 'unsupported_type'
    value: unknown[] | string | null
}

// Not found in https://toncenter.com/api/v3/doc.json
export interface GetMethodResponse {
    gas_used: number
    exit_code: number
    stack: GetMethodResponseStack[]
}

// from #/definitions/V2SendMessageResult
export interface SendMessageResponse {
    message_hash: string
}

// from #/definitions/TraceNode
export interface TraceNode {
    tx_hash: string
    in_msg_hash: string
    children: TraceNode[]
}

// from #definitions/Trace
// from #definitions/TraceMeta for (trace_info)
export interface TraceItem {
    trace_id: string
    external_hash: string
    mc_seqno_start: string
    mc_seqno_end: string
    start_lt: string
    start_utime: number
    end_lt: string
    end_utime: number
    trace_info: {
        trace_state: string
        messages: number
        transactions: number
        pending_messages: number
        classification_state: string
    }
    is_incomplete: boolean
    transactions_order: string[]
    trace: TraceNode
    transactions: {
        [key: string]: Transaction
    }
}

export type Traces = {
    addressBook: {
        [key: string]: {
            user_friendly: string
        }
    }
} & (
    | {
          events: never
          traces: TraceItem[]
      }
    | {
          events: TraceItem[]
          traces: never
      }
)
