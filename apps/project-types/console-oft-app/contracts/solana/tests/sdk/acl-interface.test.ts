import { createNoopSigner, publicKey } from '@metaplex-foundation/umi';
import { createUmi } from '@metaplex-foundation/umi-bundle-defaults';
import { describe, expect, it } from 'vitest';

import { lzReceive, setPubkeyPolicy } from '../../build/console_oft/instructions';
import { CONSOLE_OFT_PROGRAM_ID } from '../../build/console_oft/programs';

const key = (byte: number) => publicKey(new Uint8Array(32).fill(byte));
const umi = createUmi('http://127.0.0.1:8899');
const payer = createNoopSigner(key(1));
const program = CONSOLE_OFT_PROGRAM_ID;
const fixed = {
    payer,
    oftStore: key(2),
    peer: key(3),
    defaultRateLimit: key(4),
    rateLimit: key(5),
    addressExemption: key(6),
    oftEscrow: key(7),
    toAddress: key(8),
    tokenDest: key(9),
    tokenMint: key(10),
    associatedTokenProgram: key(11),
    eventAuthority: key(12),
    program,
    params: {
        srcEid: 1,
        sender: new Uint8Array(32),
        nonce: 1n,
        guid: new Uint8Array(32),
        message: new Uint8Array(40),
        extraData: new Uint8Array(),
    },
};

describe('generated lz_receive and set_pubkey_policy account layouts', () => {
    it('keeps absent ACL slots read-only and does not require native program keys', () => {
        const ix = lzReceive(umi, fixed).items[0].instruction;
        expect(ix.keys).toHaveLength(24);
        expect(ix.keys.slice(17, 22)).toEqual(
            Array.from({ length: 5 }, () => ({
                pubkey: program,
                isSigner: false,
                isWritable: false,
            })),
        );
    });

    it('places the flag and fixed programs before the event accounts without signer elevation', () => {
        const accounts = [key(17), key(18), key(19), key(20), key(21)];
        const ix = lzReceive(umi, {
            ...fixed,
            aclMintConfig: accounts[0],
            aclThawMetas: accounts[1],
            aclFlag: accounts[2],
            aclProgram: accounts[3],
            aclGateProgram: accounts[4],
        }).items[0].instruction;
        expect(ix.keys.slice(17, 22)).toEqual(
            accounts.map((pubkey, index) => ({
                pubkey,
                isSigner: false,
                isWritable: index === 2,
            })),
        );
        expect(ix.keys[22].pubkey).toBe(fixed.eventAuthority);
        expect(ix.keys[23].pubkey).toBe(program);
    });

    it('selects the policy read-only, with no mint or manifest accounts', () => {
        const ix = setPubkeyPolicy(umi, {
            authority: payer,
            oftStore: key(2),
            pubkeyPolicy: key(15),
            roleMember: key(20),
            eventAuthority: key(12),
            program,
        }).items[0].instruction;
        expect(ix.keys.map((meta) => meta.pubkey)).toEqual([
            payer.publicKey,
            key(2),
            key(15),
            key(20),
            key(12),
            program,
        ]);
        expect(ix.keys[2]).toEqual({ pubkey: key(15), isSigner: false, isWritable: false });
    });
});
