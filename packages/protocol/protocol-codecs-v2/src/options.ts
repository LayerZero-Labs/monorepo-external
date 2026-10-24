import {
    bigIntToBytes,
    bytesToBigInt,
    bytesToHexPrefixed,
    hexToBytes,
} from '@layerzerolabs/common-encoding-utils';

import { addressToBytes32 } from './packet';

export enum WorkerId {
    EXECUTOR = 1,
    VERIFIER = 2,
}

export enum ExecutorOptionType {
    LZ_RECEIVE = 1,
    NATIVE_DROP = 2,
    COMPOSE = 3,
    ORDERED = 4,
    LZ_READ = 5,
}

const OPTIONS_TYPE_1 = 1;
const OPTIONS_TYPE_2 = 2;
const OPTIONS_TYPE_3 = 3;

const MAX_UINT_128 = (1n << 128n) - 1n;

export type ExecutorLzReceiveOption = { gas: bigint; value: bigint };
export type ExecutorLzReadOption = { gas: bigint; dataSize: bigint; value: bigint };
export type ExecutorNativeDropOption = { amount: bigint; receiver: string }[];
export type ComposeOption = { index: number; gas: bigint; value: bigint }[];

type WorkerOption = { workerId: WorkerId; type: number; index?: number; params: Uint8Array };

const uint128 = (value: string | number | bigint): Uint8Array => {
    const n = BigInt(value);
    if (n > MAX_UINT_128) {
        throw new Error(`${value} is greater than MAX_UINT_128`);
    }
    return bigIntToBytes(n, 16);
};

const uint = (bytes: Uint8Array, start: number, end: number): bigint => {
    const slice = bytes.subarray(start, end);
    if (slice.length === 0) {
        throw new Error(`no bytes to decode at offset ${start}`);
    }
    return bytesToBigInt(slice);
};

export class Options {
    private readonly options: WorkerOption[] = [];

    private constructor() {}

    static newOptions(): Options {
        return new Options();
    }

    static fromOptions(optionsHex: string): Options {
        const options = new Options();
        const bytes = hexToBytes(optionsHex);
        const optionsType = Number(uint(bytes, 0, 2));
        if (optionsType === OPTIONS_TYPE_1) {
            return options.addExecutorLzReceiveOption(uint(bytes, 2, 34));
        }
        if (optionsType === OPTIONS_TYPE_2) {
            return options
                .addExecutorLzReceiveOption(uint(bytes, 2, 34))
                .addExecutorNativeDropOption(
                    uint(bytes, 34, 66),
                    bytesToHexPrefixed(bytes.subarray(66)),
                );
        }
        if (optionsType !== OPTIONS_TYPE_3) {
            return options;
        }
        let cursor = 2;
        while (cursor < bytes.length) {
            const workerId = bytes[cursor]!;
            const size = Number(uint(bytes, cursor + 1, cursor + 3));
            const body = bytes.subarray(cursor + 3, cursor + 3 + size);
            cursor += 3 + size;
            if (workerId === WorkerId.EXECUTOR) {
                options.options.push({
                    workerId,
                    type: Number(uint(body, 0, 1)),
                    params: body.slice(1),
                });
            } else if (workerId === WorkerId.VERIFIER) {
                options.options.push({
                    workerId,
                    index: Number(uint(body, 0, 1)),
                    type: Number(uint(body, 1, 2)),
                    params: body.slice(2),
                });
            }
        }
        return options;
    }

    private addExecutorOption(type: ExecutorOptionType, ...params: Uint8Array[]): this {
        this.options.push({
            workerId: WorkerId.EXECUTOR,
            type,
            params: new Uint8Array(params.flatMap((p) => [...p])),
        });
        return this;
    }

    addExecutorLzReceiveOption(
        gasLimit: string | number | bigint,
        nativeDrop: string | number | bigint = 0,
    ): this {
        const gas = uint128(gasLimit);
        const value = uint128(nativeDrop);
        return BigInt(nativeDrop) === 0n
            ? this.addExecutorOption(ExecutorOptionType.LZ_RECEIVE, gas)
            : this.addExecutorOption(ExecutorOptionType.LZ_RECEIVE, gas, value);
    }

    addExecutorNativeDropOption(nativeDrop: string | number | bigint, receiver: string): this {
        return this.addExecutorOption(
            ExecutorOptionType.NATIVE_DROP,
            uint128(nativeDrop),
            addressToBytes32(receiver),
        );
    }

    toBytes(): Uint8Array {
        const workerIds = [...new Set(this.options.map((o) => o.workerId))];
        const encoded = workerIds.flatMap((workerId) =>
            this.options
                .filter((o) => o.workerId === workerId)
                .flatMap((o) => {
                    const head = o.index === undefined ? [o.type] : [o.index, o.type];
                    const size = head.length + o.params.length;
                    return [workerId, size >> 8, size & 0xff, ...head, ...o.params];
                }),
        );
        return new Uint8Array([0, OPTIONS_TYPE_3, ...encoded]);
    }

    toHex(): string {
        return bytesToHexPrefixed(this.toBytes());
    }

    private executorParams(type: ExecutorOptionType): Uint8Array[] {
        return this.options
            .filter((o) => o.workerId === WorkerId.EXECUTOR && o.type === type)
            .map((o) => o.params);
    }

    decodeExecutorLzReceiveOption(): ExecutorLzReceiveOption | undefined {
        const params = this.executorParams(ExecutorOptionType.LZ_RECEIVE);
        if (params.length === 0) {
            return undefined;
        }
        return params.reduce(
            (acc, p) => ({
                gas: acc.gas + uint(p, 0, 16),
                value: acc.value + (p.length === 16 ? 0n : uint(p, 16, 32)),
            }),
            { gas: 0n, value: 0n },
        );
    }

    decodeExecutorNativeDropOption(): ExecutorNativeDropOption {
        const drops = new Map<string, bigint>();
        for (const p of this.executorParams(ExecutorOptionType.NATIVE_DROP)) {
            const receiver = bytesToHexPrefixed(p.subarray(16, 48));
            drops.set(receiver, (drops.get(receiver) ?? 0n) + uint(p, 0, 16));
        }
        return [...drops].map(([receiver, amount]) => ({ amount, receiver }));
    }

    decodeExecutorComposeOption(): ComposeOption {
        const composes = new Map<number, { gas: bigint; value: bigint }>();
        for (const p of this.executorParams(ExecutorOptionType.COMPOSE)) {
            const index = Number(uint(p, 0, 2));
            const prev = composes.get(index) ?? { gas: 0n, value: 0n };
            composes.set(index, {
                gas: prev.gas + uint(p, 2, 18),
                value: prev.value + (p.length === 34 ? uint(p, 18, 34) : 0n),
            });
        }
        return [...composes]
            .sort(([a], [b]) => a - b)
            .map(([index, { gas, value }]) => ({ index, gas, value }));
    }

    decodeExecutorOrderedExecutionOption(): boolean {
        return this.executorParams(ExecutorOptionType.ORDERED).length > 0;
    }

    decodeExecutorLzReadOption(): ExecutorLzReadOption | undefined {
        const params = this.executorParams(ExecutorOptionType.LZ_READ);
        if (params.length === 0) {
            return undefined;
        }
        return params.reduce(
            (acc, p) => ({
                gas: acc.gas + uint(p, 0, 16),
                dataSize: acc.dataSize + uint(p, 16, 20),
                value: acc.value + (p.length === 20 ? 0n : uint(p, 20, 36)),
            }),
            { gas: 0n, dataSize: 0n, value: 0n },
        );
    }
}
