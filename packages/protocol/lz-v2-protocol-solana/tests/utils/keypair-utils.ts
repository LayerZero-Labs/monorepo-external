import { Keypair } from '@solana/web3.js';
import fs from 'fs';
import process from 'process';
import invariant from 'tiny-invariant';

export function loadKeypair(filepath: string): Keypair {
    return Keypair.fromSecretKey(
        Buffer.from(
            JSON.parse(
                fs.readFileSync(filepath, {
                    encoding: 'utf-8',
                }),
            ),
        ),
    );
}

export function saveKeypair(keypair: Keypair, keypairPath: string): void {
    fs.writeFileSync(keypairPath, JSON.stringify(Array.from(keypair.secretKey)));
}

export function loadAnchorKeypair(): Keypair {
    invariant(process.env.ANCHOR_WALLET, 'missing ANCHOR_WALLET env');
    return loadKeypair(process.env.ANCHOR_WALLET);
}
