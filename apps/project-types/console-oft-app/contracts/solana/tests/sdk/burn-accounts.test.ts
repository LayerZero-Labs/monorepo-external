import { createNoopSigner, publicKey } from '@metaplex-foundation/umi';
import { createUmi } from '@metaplex-foundation/umi-bundle-defaults';
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

import { send } from '../../build/console_oft/instructions/send';
import { CONSOLE_OFT_PROGRAM_ID } from '../../build/console_oft/programs';

const key = (byte: number) => publicKey(new Uint8Array(32).fill(byte));
const umi = createUmi('http://127.0.0.1:8899');
const program = CONSOLE_OFT_PROGRAM_ID;
const idl = JSON.parse(
    readFileSync(new URL('../../build/console_oft.json', import.meta.url), 'utf8'),
);
const accounts = idl.instructions.find((ix: { name: string }) => ix.name === 'send').accounts;
const indexOf = (name: string) =>
    accounts.findIndex((account: { name: string }) => account.name === name);

const input: Parameters<typeof send>[1] = {
    signer: createNoopSigner(key(1)),
    oftStore: key(2),
    peer: key(3),
    enforcedOptions: key(4),
    pauseConfig: key(5),
    feeConfig: key(6),
    defaultRateLimit: key(7),
    rateLimit: key(8),
    addressExemption: key(9),
    tokenSource: key(10),
    oftEscrow: key(11),
    feeDeposit: key(12),
    tokenMint: key(13),
    tokenProgram: publicKey('TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb'),
    eventAuthority: key(14),
    program,
    dstEid: 2,
    to: new Uint8Array(32),
    amountLd: 100,
    minAmountLd: 0,
    extraOptions: new Uint8Array(),
    composeMsg: null,
    nativeFee: 0,
    lzTokenFee: 0,
};

describe('send accounts in the generated client', () => {
    it('lists 20 accounts: the permissioned-burn slots follow the token program, no sender-policy slots', () => {
        expect(accounts.map((account: { name: string }) => account.name)).toEqual([
            'signer',
            'oft_store',
            'peer',
            'enforced_options',
            'pause_config',
            'fee_config',
            'default_rate_limit',
            'rate_limit',
            'address_exemption',
            'token_source',
            'oft_escrow',
            'fee_deposit',
            'token_mint',
            'token_program',
            'burn_policy',
            'burn_role',
            'burn_manager',
            'burn_signer',
            'event_authority',
            'program',
        ]);
    });

    it('keeps optional PB slots as program-ID sentinels without shifting subsequent accounts', () => {
        const ix = send(umi, input).getInstructions()[0];
        expect(ix.keys).toHaveLength(accounts.length);
        for (const name of ['burn_policy', 'burn_role', 'burn_manager', 'burn_signer']) {
            const index = indexOf(name);
            expect(index).toBeGreaterThanOrEqual(0);
            expect(accounts[index].optional).toBe(true);
            expect(ix.keys[index]).toEqual({ pubkey: program, isSigner: false, isWritable: false });
        }
        expect(ix.keys[indexOf('event_authority')].pubkey).toBe(input.eventAuthority);
        expect(ix.keys[indexOf('program')].pubkey).toBe(program);
    });

    it('places supplied PB keys in their own slots without shifting the event accounts', () => {
        const pb = {
            burnPolicy: key(20),
            burnRole: key(22),
            burnManager: key(23),
            burnSigner: key(24),
        };
        const ix = send(umi, { ...input, ...pb }).getInstructions()[0];
        expect(ix.keys).toHaveLength(accounts.length);
        expect(
            ['burn_policy', 'burn_role', 'burn_manager', 'burn_signer'].map(
                (name) => ix.keys[indexOf(name)].pubkey,
            ),
        ).toEqual(Object.values(pb));
        expect(ix.keys[indexOf('event_authority')].pubkey).toBe(input.eventAuthority);
        expect(ix.keys[indexOf('program')].pubkey).toBe(program);
    });
});
