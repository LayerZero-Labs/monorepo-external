/**
 * Deterministic key generation for tests.
 *
 * Vitest forks worker processes — random keys would diverge between the main
 * process (globalSetup) and test workers. Seeded generation ensures the same
 * seed always produces the same keypair across all processes.
 */

import type { KeypairSigner } from '@metaplex-foundation/umi';
import { createSignerFromKeypair } from '@metaplex-foundation/umi';
import { createWeb3JsEddsa } from '@metaplex-foundation/umi-eddsa-web3js';
import { fromWeb3JsKeypair } from '@metaplex-foundation/umi-web3js-adapters';
import { Keypair } from '@solana/web3.js';
import { createHash } from 'crypto';

const eddsa = createWeb3JsEddsa();

/**
 * Creates a keypair from a seed for deterministic key generation.
 */
export const createKeypairFromSeed = (seed: string): Keypair => {
    const hash = createHash('sha256').update(seed, 'utf8').digest();
    return Keypair.fromSeed(hash.slice(0, 32));
};

/**
 * Creates a signer from a seed string.
 */
export const createSignerFromSeed = (seed: string): KeypairSigner => {
    const keypair = createKeypairFromSeed(seed);
    return createSignerFromKeypair({ eddsa }, fromWeb3JsKeypair(keypair));
};
