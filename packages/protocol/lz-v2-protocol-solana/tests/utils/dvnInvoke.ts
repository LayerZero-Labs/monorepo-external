import { SolanaSigner } from '@layerzerolabs/lz-corekit-solana';
import { HashSigner } from '@layerzerolabs/lz-foundation';

import { SignFunc } from '../../src/dvn';
import { buildHashSignerFromSolanaSigner } from './util';

export class DVNSigner implements SignFunc {
    private signers: HashSigner[];

    constructor(signers: SolanaSigner[]) {
        this.signers = signers.map((s) => buildHashSignerFromSolanaSigner(s));
    }

    async sign(message: Buffer): Promise<{ signature: Uint8Array; recoveryId: number }[]> {
        return Promise.all(
            this.signers.map(async (s) => {
                const rv = await s.signHash(message);
                return { signature: rv.slice(0, 64), recoveryId: rv[64] };
            }),
        );
    }
}
