import type { Option, u32 } from '@stellar/stellar-sdk/contract';
import {
    AssembledTransaction,
    Client as ContractClient,
    ClientOptions as ContractClientOptions,
    MethodOptions,
    Spec as ContractSpec,
} from '@stellar/stellar-sdk/contract';
import { Buffer } from 'buffer';
export * from '@stellar/stellar-sdk';
export * as contract from '@stellar/stellar-sdk/contract';
export * as rpc from '@stellar/stellar-sdk/rpc';

if (typeof window !== 'undefined') {
    //@ts-ignore Buffer exists
    window.Buffer = window.Buffer || Buffer;
}

export const BufferReaderError = {
    1000: { message: 'InvalidLength' },
    1001: { message: 'InvalidAddressPayload' },
};

export const BufferWriterError = {
    1100: { message: 'InvalidAddressPayload' },
};

export const TtlError = {
    1200: { message: 'InvalidTtlConfig' },
    1201: { message: 'TtlConfigFrozen' },
    1202: { message: 'TtlConfigAlreadyFrozen' },
};

export const OwnableError = {
    1300: { message: 'OwnerAlreadySet' },
    1301: { message: 'OwnerNotSet' },
};

export const BytesExtError = {
    1400: { message: 'LengthMismatch' },
};

export const UpgradeableError = {
    1500: { message: 'MigrationNotAllowed' },
};

export type DefaultOwnableStorage = { tag: 'Owner'; values: void };

/**
 * A pair of TTL values: threshold (when to trigger extension) and extend_to (target TTL).
 */
export interface TtlConfig {
    /**
     * Target TTL after extension (in ledgers).
     */
    extend_to: u32;
    /**
     * TTL threshold that triggers extension (in ledgers).
     */
    threshold: u32;
}

export type TtlConfigStorage =
    | { tag: 'Frozen'; values: void }
    | { tag: 'Instance'; values: void }
    | { tag: 'Persistent'; values: void };

export type UpgradeableStorage = { tag: 'Migrating'; values: void };

export interface Client {
    /**
     * Construct and simulate a owner transaction. Returns an `AssembledTransaction` object which will have a `result` field containing the result of the simulation. If this transaction changes contract state, you will need to call `signAndSend()` on the returned object.
     */
    owner: (options?: MethodOptions) => Promise<AssembledTransaction<Option<string>>>;

    /**
     * Construct and simulate a transfer_ownership transaction. Returns an `AssembledTransaction` object which will have a `result` field containing the result of the simulation. If this transaction changes contract state, you will need to call `signAndSend()` on the returned object.
     */
    transfer_ownership: (
        { new_owner }: { new_owner: string },
        options?: MethodOptions,
    ) => Promise<AssembledTransaction<null>>;

    /**
     * Construct and simulate a renounce_ownership transaction. Returns an `AssembledTransaction` object which will have a `result` field containing the result of the simulation. If this transaction changes contract state, you will need to call `signAndSend()` on the returned object.
     */
    renounce_ownership: (options?: MethodOptions) => Promise<AssembledTransaction<null>>;

    /**
     * Construct and simulate a upgrade transaction. Returns an `AssembledTransaction` object which will have a `result` field containing the result of the simulation. If this transaction changes contract state, you will need to call `signAndSend()` on the returned object.
     */
    upgrade: (
        { new_wasm_hash }: { new_wasm_hash: Buffer },
        options?: MethodOptions,
    ) => Promise<AssembledTransaction<null>>;

    /**
     * Construct and simulate a migrate transaction. Returns an `AssembledTransaction` object which will have a `result` field containing the result of the simulation. If this transaction changes contract state, you will need to call `signAndSend()` on the returned object.
     */
    migrate: (
        { migration_data }: { migration_data: MigrationData },
        options?: MethodOptions,
    ) => Promise<AssembledTransaction<null>>;

    /**
     * Construct and simulate a counter transaction. Returns an `AssembledTransaction` object which will have a `result` field containing the result of the simulation. If this transaction changes contract state, you will need to call `signAndSend()` on the returned object.
     */
    counter: (options?: MethodOptions) => Promise<AssembledTransaction<u32>>;

    /**
     * Construct and simulate a counter2 transaction. Returns an `AssembledTransaction` object which will have a `result` field containing the result of the simulation. If this transaction changes contract state, you will need to call `signAndSend()` on the returned object.
     */
    counter2: (options?: MethodOptions) => Promise<AssembledTransaction<u32>>;
}
export class Client extends ContractClient {
    static async deploy<T = Client>(
        /** Options for initializing a Client as well as for calling a method, with extras specific to deploying. */
        options: MethodOptions &
            Omit<ContractClientOptions, 'contractId'> & {
                /** The hash of the Wasm blob, which must already be installed on-chain. */
                wasmHash: Buffer | string;
                /** Salt used to generate the contract's ID. Passed through to {@link Operation.createCustomContract}. Default: random. */
                salt?: Buffer | Uint8Array;
                /** The format used to decode `wasmHash`, if it's provided as a string. */
                format?: 'hex' | 'base64';
            },
    ): Promise<AssembledTransaction<T>> {
        return ContractClient.deploy(null, options);
    }
    constructor(public readonly options: ContractClientOptions) {
        super(
            new ContractSpec([
                'AAAAAAAAAAAAAAAFb3duZXIAAAAAAAAAAAAAAQAAA+gAAAAT',
                'AAAAAAAAAAAAAAASdHJhbnNmZXJfb3duZXJzaGlwAAAAAAABAAAAAAAAAAluZXdfb3duZXIAAAAAAAATAAAAAA==',
                'AAAAAAAAAAAAAAAScmVub3VuY2Vfb3duZXJzaGlwAAAAAAAAAAAAAA==',
                'AAAAAAAAAAAAAAAHdXBncmFkZQAAAAABAAAAAAAAAA1uZXdfd2FzbV9oYXNoAAAAAAAD7gAAACAAAAAA',
                'AAAAAAAAAAAAAAAHbWlncmF0ZQAAAAABAAAAAAAAAA5taWdyYXRpb25fZGF0YQAAAAAH0AAAAA1NaWdyYXRpb25EYXRhAAAAAAAAAA==',
                'AAAAAAAAAAAAAAAHY291bnRlcgAAAAAAAAAAAQAAAAQ=',
                'AAAAAAAAAAAAAAAIY291bnRlcjIAAAAAAAAAAQAAAAQ=',
                'AAAABAAAAAAAAAAAAAAAEUJ1ZmZlclJlYWRlckVycm9yAAAAAAAAAgAAAAAAAAANSW52YWxpZExlbmd0aAAAAAAAA+gAAAAAAAAAFUludmFsaWRBZGRyZXNzUGF5bG9hZAAAAAAAA+k=',
                'AAAABAAAAAAAAAAAAAAAEUJ1ZmZlcldyaXRlckVycm9yAAAAAAAAAQAAAAAAAAAVSW52YWxpZEFkZHJlc3NQYXlsb2FkAAAAAAAETA==',
                'AAAABAAAAAAAAAAAAAAACFR0bEVycm9yAAAAAwAAAAAAAAAQSW52YWxpZFR0bENvbmZpZwAABLAAAAAAAAAAD1R0bENvbmZpZ0Zyb3plbgAAAASxAAAAAAAAABZUdGxDb25maWdBbHJlYWR5RnJvemVuAAAAAASy',
                'AAAABAAAAAAAAAAAAAAADE93bmFibGVFcnJvcgAAAAIAAAAAAAAAD093bmVyQWxyZWFkeVNldAAAAAUUAAAAAAAAAAtPd25lck5vdFNldAAAAAUV',
                'AAAABAAAAAAAAAAAAAAADUJ5dGVzRXh0RXJyb3IAAAAAAAABAAAAAAAAAA5MZW5ndGhNaXNtYXRjaAAAAAAFeA==',
                'AAAABAAAAAAAAAAAAAAAEFVwZ3JhZGVhYmxlRXJyb3IAAAABAAAAAAAAABNNaWdyYXRpb25Ob3RBbGxvd2VkAAAABdw=',
                'AAAABQAAACxFdmVudCBlbWl0dGVkIHdoZW4gb3duZXJzaGlwIGlzIHRyYW5zZmVycmVkLgAAAAAAAAAUT3duZXJzaGlwVHJhbnNmZXJyZWQAAAABAAAAFE93bmVyc2hpcFRyYW5zZmVycmVkAAAAAgAAAAAAAAAJb2xkX293bmVyAAAAAAAAEwAAAAAAAAAAAAAACW5ld19vd25lcgAAAAAAABMAAAAAAAAAAg==',
                'AAAABQAAACpFdmVudCBlbWl0dGVkIHdoZW4gb3duZXJzaGlwIGlzIHJlbm91bmNlZC4AAAAAAAAAAAAST3duZXJzaGlwUmVub3VuY2VkAAAAAAABAAAAEk93bmVyc2hpcFJlbm91bmNlZAAAAAAAAQAAAAAAAAAJb2xkX293bmVyAAAAAAAAEwAAAAAAAAAC',
                'AAAAAgAAAAAAAAAAAAAAFURlZmF1bHRPd25hYmxlU3RvcmFnZQAAAAAAAAEAAAAAAAAAAAAAAAVPd25lcgAAAA==',
                'AAAAAQAAAFdBIHBhaXIgb2YgVFRMIHZhbHVlczogdGhyZXNob2xkICh3aGVuIHRvIHRyaWdnZXIgZXh0ZW5zaW9uKSBhbmQgZXh0ZW5kX3RvICh0YXJnZXQgVFRMKS4AAAAAAAAAAAlUdGxDb25maWcAAAAAAAACAAAAKFRhcmdldCBUVEwgYWZ0ZXIgZXh0ZW5zaW9uIChpbiBsZWRnZXJzKS4AAAAJZXh0ZW5kX3RvAAAAAAAABAAAADNUVEwgdGhyZXNob2xkIHRoYXQgdHJpZ2dlcnMgZXh0ZW5zaW9uIChpbiBsZWRnZXJzKS4AAAAACXRocmVzaG9sZAAAAAAAAAQ=',
                'AAAAAgAAAAAAAAAAAAAAEFR0bENvbmZpZ1N0b3JhZ2UAAAADAAAAAAAAAAAAAAAGRnJvemVuAAAAAAAAAAAAAAAAAAhJbnN0YW5jZQAAAAAAAAAAAAAAClBlcnNpc3RlbnQAAA==',
                'AAAABQAAACdFdmVudCBlbWl0dGVkIHdoZW4gVFRMIGNvbmZpZ3MgYXJlIHNldC4AAAAAAAAAAA1UdGxDb25maWdzU2V0AAAAAAAAAQAAAA1UdGxDb25maWdzU2V0AAAAAAAAAgAAAAAAAAAIaW5zdGFuY2UAAAPoAAAH0AAAAAlUdGxDb25maWcAAAAAAAAAAAAAAAAAAApwZXJzaXN0ZW50AAAAAAPoAAAH0AAAAAlUdGxDb25maWcAAAAAAAAAAAAAAg==',
                'AAAABQAAACpFdmVudCBlbWl0dGVkIHdoZW4gVFRMIGNvbmZpZ3MgYXJlIGZyb3plbi4AAAAAAAAAAAAQVHRsQ29uZmlnc0Zyb3plbgAAAAEAAAAQVHRsQ29uZmlnc0Zyb3plbgAAAAAAAAAC',
                'AAAAAgAAAAAAAAAAAAAAElVwZ3JhZGVhYmxlU3RvcmFnZQAAAAAAAQAAAAAAAAAAAAAACU1pZ3JhdGluZwAAAA==',
            ]),
            options,
        );
    }
    public readonly fromJSON = {
        owner: this.txFromJSON<Option<string>>,
        transfer_ownership: this.txFromJSON<null>,
        renounce_ownership: this.txFromJSON<null>,
        upgrade: this.txFromJSON<null>,
        migrate: this.txFromJSON<null>,
        counter: this.txFromJSON<u32>,
        counter2: this.txFromJSON<u32>,
    };
}

export type MigrationData = void;
