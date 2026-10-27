import {
    createNoopSigner,
    createSignerFromKeypair,
    signerIdentity,
} from '@metaplex-foundation/umi';
import { createUmi } from '@metaplex-foundation/umi-bundle-defaults';
import { createWeb3JsEddsa } from '@metaplex-foundation/umi-eddsa-web3js';
import { fromWeb3JsPublicKey, toWeb3JsKeypair } from '@metaplex-foundation/umi-web3js-adapters';
import type { Connection, PublicKey } from '@solana/web3.js';

export { generateSigner, transactionBuilder } from '@metaplex-foundation/umi';

export const getUnsignableUmiClient = (rpc: string | Connection, signerPk: PublicKey) => {
    const umi = typeof rpc === 'string' ? createUmi(rpc, 'confirmed') : createUmi(rpc);
    umi.use(
        signerIdentity(
            // by default using createFungible, this will also become the freeze authority
            createNoopSigner(fromWeb3JsPublicKey(signerPk)),
        ),
    );
    return umi;
};

export const getUmiKeyPair = () => {
    const eddsa = createWeb3JsEddsa();
    const escrowKp = eddsa.generateKeypair();
    const signer = createSignerFromKeypair({ eddsa }, escrowKp);
    return toWeb3JsKeypair(signer);
};
