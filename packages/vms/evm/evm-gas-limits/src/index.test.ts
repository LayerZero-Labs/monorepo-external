import { describe, expect, it } from 'vitest';

import { ChainName } from '@layerzerolabs/layerzero-definitions';

import { getGasLimit } from './index';

const bytes = (length: number) => `0x${'5a'.repeat(length)}`;

describe('getGasLimit on a default-model chain', () => {
    it('adds 16 gas per calldata byte when that is above the EIP-7623 calldata floor', () => {
        expect(
            getGasLimit({ chainName: ChainName.ETHEREUM, gas: 200_000n, data: bytes(100) }),
        ).toBe(String(200_000n + 100n * 16n));
    });

    it('raises the limit to the EIP-7623 calldata floor when the calldata needs more', () => {
        const data = bytes(12 * 1024);

        expect(getGasLimit({ chainName: ChainName.ETHEREUM, gas: 200_000n, data })).toBe(
            String(21_000n + 12n * 1024n * 40n),
        );
    });
});
