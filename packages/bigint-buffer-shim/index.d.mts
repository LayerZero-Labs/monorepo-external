/// <reference types="node" />

export declare function toBigIntLE(buf: Uint8Array): bigint;
export declare function toBigIntBE(buf: Uint8Array): bigint;
export declare function toBufferLE(num: bigint, width: number): Buffer;
export declare function toBufferBE(num: bigint, width: number): Buffer;
