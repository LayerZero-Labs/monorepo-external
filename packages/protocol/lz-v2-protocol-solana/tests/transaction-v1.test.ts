import { type Instruction, publicKey } from '@metaplex-foundation/umi';
import { generateSigner } from '@metaplex-foundation/umi';
import {
    AccountRole,
    address,
    blockhash,
    createKeyPairSignerFromBytes,
    getCompiledTransactionMessageDecoder,
    getPublicKeyFromAddress,
    getTransactionDecoder,
    getTransactionEncoder,
    signTransaction,
    verifySignature,
} from '@solana/kit';
import { describe, expect, it } from 'vitest';

import { EDDSA } from '../src/pda';
import { compileTransactionV1, toKitInstruction } from '../src/transaction-v1';

const key = (n: number) => publicKey(new Uint8Array(32).fill(n));
const payer = key(1);
const lifetime = { blockhash: blockhash(key(9)), lastValidBlockHeight: 100n };
const budgets = {
    computeUnitLimit: 200_000,
    loadedAccountsDataSizeLimit: 1 << 20,
    heapSize: 32 * 1024,
};
const instruction = (accounts = 0, bytes = 0): Instruction => ({
    programId: key(2),
    keys: Array.from({ length: accounts }, (_, n) => ({
        pubkey: key(n + 3),
        isSigner: false,
        isWritable: false,
    })),
    data: new Uint8Array(bytes),
});

describe('Solana Transaction V1 (Kit)', () => {
    it('preserves duplicate metas, order and all four privilege combinations', () => {
        const ix = instruction(4);
        ix.keys = ix.keys.map((meta, i) => ({
            ...meta,
            pubkey: key(3),
            isWritable: (i & 1) !== 0,
            isSigner: (i & 2) !== 0,
        }));
        expect(toKitInstruction(ix).accounts).toEqual([
            { address: key(3), role: AccountRole.READONLY },
            { address: key(3), role: AccountRole.WRITABLE },
            { address: key(3), role: AccountRole.READONLY_SIGNER },
            { address: key(3), role: AccountRole.WRITABLE_SIGNER },
        ]);
        const tx = compileTransactionV1(payer, [ix], lifetime, budgets);
        const message = getCompiledTransactionMessageDecoder().decode(tx.messageBytes);
        if (message.version !== 1) throw new Error('Expected V1');
        expect(message.instructionPayloads[0].instructionAccountIndices).toEqual([1, 1, 1, 1]);
        expect(message.header.numSignerAccounts).toBe(2);
    });

    it('uses the 4096-byte limit, not the V0 1232-byte limit (including signatures)', () => {
        const overhead = getTransactionEncoder().encode(
            compileTransactionV1(payer, [instruction()], lifetime, budgets),
        ).length;
        const exact = compileTransactionV1(
            payer,
            [instruction(0, 4096 - overhead)],
            lifetime,
            budgets,
        );
        expect(getTransactionEncoder().encode(exact)).toHaveLength(4096);
        expect(() =>
            compileTransactionV1(payer, [instruction(0, 4097 - overhead)], lifetime, budgets),
        ).toThrow();
    });

    it('accepts 64 total addresses and rejects 65 without ALTs', () => {
        expect(() =>
            compileTransactionV1(payer, [instruction(62)], lifetime, budgets),
        ).not.toThrow();
        expect(() => compileTransactionV1(payer, [instruction(63)], lifetime, budgets)).toThrow();
    });

    it('accepts 64 instructions and rejects 65', () => {
        expect(() =>
            compileTransactionV1(payer, Array(64).fill(instruction()), lifetime, budgets),
        ).not.toThrow();
        expect(() =>
            compileTransactionV1(payer, Array(65).fill(instruction()), lifetime, budgets),
        ).toThrow();
    });

    it('accepts 12 signers and rejects 13', () => {
        const ix = instruction(11);
        ix.keys.forEach((meta) => {
            meta.isSigner = true;
        });
        expect(
            Object.keys(compileTransactionV1(payer, [ix], lifetime, budgets).signatures),
        ).toHaveLength(12);
        ix.keys.push({ pubkey: key(20), isSigner: true, isWritable: false });
        expect(() => compileTransactionV1(payer, [ix], lifetime, budgets)).toThrow();
    });

    it('bounds account occurrences separately from unique account count', () => {
        const ix = instruction();
        ix.keys = Array(255).fill({ pubkey: key(3), isSigner: false, isWritable: false });
        expect(() => compileTransactionV1(payer, [ix], lifetime, budgets)).not.toThrow();
        ix.keys.push(ix.keys[0]);
        expect(() => compileTransactionV1(payer, [ix], lifetime, budgets)).toThrow();
    });

    it('requires nonzero resource budgets and config instead of budget instructions', () => {
        expect(() =>
            compileTransactionV1(payer, [instruction()], lifetime, {
                ...budgets,
                computeUnitLimit: 0,
            }),
        ).toThrow();
        expect(() =>
            compileTransactionV1(payer, [instruction()], lifetime, {
                ...budgets,
                loadedAccountsDataSizeLimit: 0,
            }),
        ).toThrow();
        expect(() =>
            compileTransactionV1(
                payer,
                [
                    {
                        ...instruction(),
                        programId: publicKey('ComputeBudget111111111111111111111111111111'),
                    },
                ],
                lifetime,
                budgets,
            ),
        ).toThrow();
        const tx = compileTransactionV1(payer, [instruction()], lifetime, {
            ...budgets,
            priorityFeeLamports: 500n,
        });
        const message = getCompiledTransactionMessageDecoder().decode(tx.messageBytes);
        if (message.version !== 1) throw new Error('Expected V1');
        expect(message.configValues[0]).toEqual({ kind: 'u64', value: 500n });
    });

    it('signs canonical V1 bytes with Umi keypairs and verifies after wire round-trip', async () => {
        const payerSigner = generateSigner({ eddsa: EDDSA });
        const extraSigner = generateSigner({ eddsa: EDDSA });
        const kitSigners = await Promise.all(
            [payerSigner, extraSigner].map((signer) =>
                createKeyPairSignerFromBytes(signer.secretKey),
            ),
        );
        const ix = instruction();
        ix.keys.push({ pubkey: extraSigner.publicKey, isSigner: true, isWritable: false });
        const tx = compileTransactionV1(payerSigner.publicKey, [ix], lifetime, budgets);
        await expect(signTransaction([kitSigners[0].keyPair], tx)).rejects.toThrow();
        const signed = await signTransaction(
            kitSigners.map((s) => s.keyPair),
            tx,
        );
        const wire = getTransactionEncoder().encode(signed);
        expect(wire[0]).toBe(0x81);
        const decoded = getTransactionDecoder().decode(wire);
        expect(decoded.messageBytes).toEqual(tx.messageBytes);
        expect(wire.slice(tx.messageBytes.length)).toHaveLength(2 * 64);
        for (const [signer, signature] of Object.entries(decoded.signatures)) {
            expect(signature).not.toBeNull();
            expect(
                await verifySignature(
                    await getPublicKeyFromAddress(address(signer)),
                    signature!,
                    decoded.messageBytes,
                ),
            ).toBe(true);
        }
    });
});
