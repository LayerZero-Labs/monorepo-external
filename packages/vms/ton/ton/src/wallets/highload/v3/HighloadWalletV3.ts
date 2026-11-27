import {
    Address,
    Cell,
    Contract,
    ContractProvider,
    MessageRelaxed,
    OutAction,
    OutActionSendMsg,
    SendMode,
    Sender,
    beginCell,
    contractAddress,
    internal as internal_relaxed,
    storeMessageRelaxed,
    storeOutList,
    toNano,
} from "@ton/core";
import { sign } from "@ton/crypto";

import { HighloadQueryId } from "./HighloadQueryId";
import { OP } from "./const";

export interface HighloadWalletV3Config {
    publicKey: Buffer;
    subwalletId: number;
    timeout: number;
}

export const TIMESTAMP_SIZE = 64;
export const TIMEOUT_SIZE = 22;

export function highloadWalletV3ConfigToCell(
    config: HighloadWalletV3Config
): Cell {
    return beginCell()
    .storeBuffer(config.publicKey)
    .storeUint(config.subwalletId, 32)
    .storeUint(0, 1 + 1 + TIMESTAMP_SIZE)
    .storeUint(config.timeout, TIMEOUT_SIZE)
    .endCell();
}

export class HighloadWalletV3 implements Contract {
    constructor(
        readonly address: Address,
        readonly init?: { code: Cell; data: Cell }
    ) {}
    
    static createFromAddress(address: Address): HighloadWalletV3 {
        return new HighloadWalletV3(address);
    }
    
    static createFromConfig(
        config: HighloadWalletV3Config,
        workchain = 0
    ): HighloadWalletV3 {
        // https://github.com/aSpite/highload-wallet-contract-v3/blob/main/build/HighloadWalletV3.compiled.json
        // hex to base64
        const code = Cell.fromBoc(
            Buffer.from(
                "te6cckECEAEAAigAART/APSkE/S88sgLAQIBIAINAgFIAwQAeNAg10vAAQHAYLCRW+EB0NMDAXGwkVvg+kAw+CjHBbORMODTHwGCEK5C5aS6nYBA1yHXTPgqAe1V+wTgMAIBIAUKAgJzBgcAEa3OdqJoa4X/wAIBIAgJABqrtu1E0IEBItch1ws/ABiqO+1E0IMH1yHXCx8CASALDAAbuabu1E0IEBYtch1wsVgA5bi/Ltou37IasJAoQJsO1E0IEBINch9AT0BNM/0xXRBY4b+CMloVIQuZ8ybfgjBaoAFaESuZIwbd6SMDPikjAz4lIwgA30D2+hntAh1yHXCgCVXwN/2zHgkTDiWYAN9A9voZzQAdch1woAk3/bMeCRW+JwgB9vLUgwjXGNEh+QDtRNDT/9Mf9AT0BNM/0xXR+CMhoVIguY4SM234IySqAKESuZJtMt5Y+CMB3lQWdfkQ8qEG0NMf1NMH0wzTCdM/0xXRUWi68qJRWrrypvgjKqFSULzyowT4I7vyo1MEgA30D2+hmdAk1yHXCgDyZJEw4g4B/lMJgA30D2+hjhPQUATXGNIAAfJkyFjPFs+DAc8WjhAwyCTPQM+DhAlQBaGlFM9A4vgAyUA5gA30FwTIy/8Tyx/0ABL0ABLLPxLLFcntVPgPIdDTAAHyZdMCAXGwkl8D4PpAAdcLAcAA8qX6QDH6ADH0AfoAMfoAMYBg1yHTAAEPACDyZdIAAZPUMdGRMOJysfsAtYW/Aw==",
                "base64"
            )
        )[0];
        const data = highloadWalletV3ConfigToCell(config);
        const init = { code, data };
        return new HighloadWalletV3(contractAddress(workchain, init), init);
    }
    
    /**
    * Get Wallet Balance
    */
    async getBalance(provider: ContractProvider): Promise<bigint> {
        let state = await provider.getState();
        return state.balance;
    }
    
    /**
    * Get Wallet Seqno
    */
    async getSeqno(provider: ContractProvider): Promise<number> {
        let state = await provider.getState();
        if (state.state.type === "active") {
            let res = await provider.get("seqno", []);
            return res.stack.readNumber();
        } else {
            return 0;
        }
    }
    
    async sendDeploy(
        provider: ContractProvider,
        via: Sender,
        value: bigint
    ): Promise<void> {
        await provider.internal(via, {
            value,
            bounce: false,
            sendMode: SendMode.PAY_GAS_SEPARATELY,
            body: beginCell().endCell(),
        });
    }
    
    async sendExternalMessage(
        provider: ContractProvider,
        secretKey: Buffer,
        opts: {
            message: MessageRelaxed | Cell;
            mode: number;
            query_id: bigint | HighloadQueryId;
            createdAt: number;
            subwalletId: number;
            timeout: number;
        }
    ): Promise<void> {
        let messageCell: Cell;
        
        if (opts.message instanceof Cell) {
            messageCell = opts.message;
        } else {
            const messageBuilder = beginCell();
            messageBuilder.store(storeMessageRelaxed(opts.message));
            messageCell = messageBuilder.endCell();
        }
        
        const queryId =
        opts.query_id instanceof HighloadQueryId
        ? opts.query_id.getQueryId()
        : opts.query_id;
        
        const messageInner = beginCell()
        .storeUint(opts.subwalletId, 32)
        .storeRef(messageCell)
        .storeUint(opts.mode, 8)
        .storeUint(queryId, 23)
        .storeUint(opts.createdAt, TIMESTAMP_SIZE)
        .storeUint(opts.timeout, TIMEOUT_SIZE)
        .endCell();
        
        await provider.external(
            beginCell()
            .storeBuffer(sign(messageInner.hash(), secretKey))
            .storeRef(messageInner)
            .endCell()
        );
    }
    
    async sendBatch(
        provider: ContractProvider,
        secretKey: Buffer,
        messages: OutActionSendMsg[],
        subwallet: number,
        query_id: HighloadQueryId,
        timeout: number,
        createdAt?: number,
        value = 0n
    ): Promise<void> {
        if (createdAt == undefined) {
            createdAt = Math.floor(Date.now() / 1000);
        }
        return this.sendExternalMessage(provider, secretKey, {
            message: this.packActions(messages, value, query_id),
            mode:
            value > 0n
            ? SendMode.PAY_GAS_SEPARATELY
            : SendMode.CARRY_ALL_REMAINING_BALANCE,
            query_id: query_id,
            createdAt: createdAt,
            subwalletId: subwallet,
            timeout: timeout,
        });
    }
    
    static createInternalTransferBody(opts: {
        actions: OutAction[] | Cell;
        queryId: HighloadQueryId;
    }): Cell {
        let actionsCell: Cell;
        if (opts.actions instanceof Cell) {
            actionsCell = opts.actions;
        } else {
            if (opts.actions.length > 254) {
                throw TypeError(
                    "Max allowed action count is 254. Use packActions instead."
                );
            }
            const actionsBuilder = beginCell();
            storeOutList(opts.actions)(actionsBuilder);
            actionsCell = actionsBuilder.endCell();
        }
        return beginCell()
        .storeUint(OP.InternalTransfer, 32)
        .storeUint(opts.queryId.getQueryId(), 64)
        .storeRef(actionsCell)
        .endCell();
    }
    
    createInternalTransfer(opts: {
        actions: OutAction[] | Cell;
        queryId: HighloadQueryId;
        value: bigint;
    }): MessageRelaxed {
        return internal_relaxed({
            to: this.address,
            value: opts.value,
            body: HighloadWalletV3.createInternalTransferBody(opts),
        });
        /*beginCell()
        .storeUint(0x10, 6)
        .storeAddress(this.address)
        .storeCoins(opts.value)
        .storeUint(0, 107)
        .storeSlice(body.asSlice())
        .endCell();
        */
    }
    
    packActions(
        messages: OutAction[],
        value: bigint = toNano("1"),
        query_id: HighloadQueryId
    ): MessageRelaxed {
        let batch: OutAction[];
        if (messages.length > 254) {
            batch = messages.slice(0, 253);
            batch.push({
                type: "sendMsg",
                mode:
                value > 0n
                ? SendMode.PAY_GAS_SEPARATELY
                : SendMode.CARRY_ALL_REMAINING_BALANCE,
                outMsg: this.packActions(messages.slice(253), value, query_id),
            });
        } else {
            batch = messages;
        }
        return this.createInternalTransfer({
            actions: batch,
            queryId: query_id,
            value,
        });
    }
    
    async getPublicKey(provider: ContractProvider): Promise<Buffer> {
        const res = (await provider.get("get_public_key", [])).stack;
        const pubKeyU = res.readBigNumber();
        return Buffer.from(pubKeyU.toString(16).padStart(32 * 2, "0"), "hex");
    }
    
    async getSubwalletId(provider: ContractProvider): Promise<number> {
        const res = (await provider.get("get_subwallet_id", [])).stack;
        return res.readNumber();
    }
    
    async getTimeout(provider: ContractProvider): Promise<number> {
        const res = (await provider.get("get_timeout", [])).stack;
        return res.readNumber();
    }
    
    async getLastCleaned(provider: ContractProvider): Promise<number> {
        const res = (await provider.get("get_last_clean_time", [])).stack;
        return res.readNumber();
    }
    
    async getProcessed(
        provider: ContractProvider,
        queryId: HighloadQueryId,
        needClean = true
    ): Promise<boolean> {
        const res = (
            await provider.get("processed?", [
                { type: "int", value: queryId.getQueryId() },
                {
                    type: "int",
                    value: needClean ? -1n : 0n,
                },
            ])
        ).stack;
        return res.readBoolean();
    }
}
