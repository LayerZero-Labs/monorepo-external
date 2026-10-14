import { PublicKey } from '@solana/web3.js';

let _lzTokenMint: PublicKey;
export function getLzTokenMint(): PublicKey {
    return _lzTokenMint;
}

export function setLzTokenMint(mint: PublicKey): void {
    _lzTokenMint = mint;
}

let _fakeLzTokenMint: PublicKey;
export function getFakeLzTokenMint(): PublicKey {
    return _fakeLzTokenMint;
}

export function setFakeLzTokenMint(mint: PublicKey): void {
    _fakeLzTokenMint = mint;
}

// -- this is state of oapp (using simple-lib) path --
let _outNonce = 0n;
let _inNonce = 0n;
export function oAppOutBoundNonce(): bigint {
    return _outNonce;
}

export function setOAppOutBoundNonce(nonce: bigint): void {
    _outNonce = nonce;
}

export function oAppInBoundNonce(): bigint {
    return _inNonce;
}

export function setOAppInBoundNonce(nonce: bigint): void {
    _inNonce = nonce;
}
