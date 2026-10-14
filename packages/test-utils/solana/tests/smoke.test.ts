/**
 * Smoke test: proves the Docker-based surfpool localnet works.
 *
 * 1. Starts surfpool via startValidator()
 * 2. Confirms RPC responds (getVersion)
 * 3. Airdrops SOL to a test wallet
 * 4. Checks balance
 * 5. Tears down
 * Plus a consumer-program case that exercises the surfnet_writeProgram load path.
 */

import { sol } from '@metaplex-foundation/umi';
import { PublicKey } from '@solana/web3.js';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { createSignerFromSeed, LZ_PROGRAMS, startValidator, type ValidatorEnv } from '../src';

let env: ValidatorEnv;

describe('surfpool localnet (Docker)', () => {
    beforeAll(async () => {
        env = await startValidator();
    }, 240_000); // > startValidator's 180s startup budget, leaving margin for the post-boot airdrop

    afterAll(async () => {
        await env?.teardown();
    });

    it('should respond to getVersion RPC call', async () => {
        const response = await fetch(env.rpc, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'getVersion' }),
        });
        const json = await response.json();
        expect(json.result).toBeDefined();
        expect(json.result['solana-core']).toBeDefined();
        console.log('Solana version:', json.result['solana-core']);
    });

    it('should airdrop SOL to a test wallet', async () => {
        const wallet = createSignerFromSeed('smoke-test-wallet');
        await env.umi.rpc.airdrop(wallet.publicKey, sol(10));

        // Wait for confirmation
        await new Promise((r) => setTimeout(r, 1000));

        const balance = await env.connection.getBalance(new PublicKey(wallet.publicKey.toString()));
        expect(balance).toBeGreaterThan(0);
        console.log('Balance:', balance / 1e9, 'SOL');
    });
});

describe('consumer program load (surfnet_writeProgram)', () => {
    // Exercises the writeProgram-after-boot loop in startValidator, the replacement for
    // solana-test-validator's --bpf-program. The suite above boots with no config.programs, so
    // without this the load-bearing branch ships unexercised. Loads an extracted protocol .so at a
    // fresh id (no separate fixture needed) and asserts the resulting account is executable.
    let progEnv: ValidatorEnv;
    const programId = createSignerFromSeed('smoke-consumer-program').publicKey.toString();

    beforeAll(async () => {
        progEnv = await startValidator({
            programs: [{ id: programId, soPath: 'target/programs/endpoint.so' }],
        });
    }, 240_000);

    afterAll(async () => {
        await progEnv?.teardown();
    });

    it('writes a consumer program and reports it executable', async () => {
        const info = await progEnv.connection.getAccountInfo(new PublicKey(programId));
        expect(info).not.toBeNull();
        expect(info?.executable).toBe(true);
        // Prove the bytecode actually landed, not just that an executable account exists: a
        // zero-length or truncated surfnet_writeProgram is the exact regression this case guards.
        expect(info?.data.length).toBeGreaterThan(0);
    });
});

describe('baked program skip (bakedIds)', () => {
    // The branch real consumers take: console-oft / omni-counter pass the full LZ_PROGRAMS list,
    // all already in base.json, so startValidator only ever hits the skip branch for them, the
    // case above only drives the write branch (a fresh id always misses bakedIds). Pass a baked id
    // with a deliberately bad soPath: if the skip fires the bad path is never read and boot
    // succeeds; a regression inverting the skip would read it and fail beforeAll.
    let bakedEnv: ValidatorEnv;
    const bakedId = LZ_PROGRAMS[0].id.toString(); // endpoint, baked into base.json

    beforeAll(async () => {
        bakedEnv = await startValidator({
            programs: [{ id: bakedId, soPath: 'target/programs/does-not-exist.so' }],
        });
    }, 240_000);

    afterAll(async () => {
        await bakedEnv?.teardown();
    });

    it('skips writeProgram for an id already in the snapshot', async () => {
        const info = await bakedEnv.connection.getAccountInfo(new PublicKey(bakedId));
        expect(info).not.toBeNull();
        expect(info?.executable).toBe(true);
    });
});
