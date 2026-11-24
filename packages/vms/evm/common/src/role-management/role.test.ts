import { describe, expect, it } from 'vitest';

import { addressParser } from '@layerzerolabs/chain-utils';
import { createFunctionPointer } from '@layerzerolabs/function-pointer';
import { getIdForGatedTransaction } from '@layerzerolabs/gated-transaction';
import { ChainName } from '@layerzerolabs/layerzero-definitions';

import type { IViemClientWrapper } from '../provider';
import { createSetRoleTransaction } from './role';
import type { EvmContractGetter } from './types';

const contractGetter = (() => ({
    oPopulateTransaction: {
        grantRole: async () => ({ to: '0x1', data: '0x2f2ff15d' }),
        revokeRole: async () => ({ to: '0x1', data: '0xd547741f' }),
    },
})) as unknown as EvmContractGetter;

const parser = addressParser(ChainName.ETHEREUM);

const buildSetRole = (shouldGrant: boolean) =>
    createSetRoleTransaction({
        contractGetter,
        providerAdapter: { viem: {} } as unknown as IViemClientWrapper,
        hasRoleFunctionPointer: createFunctionPointer({
            factoryName: 'token',
            dimKey: 'evm',
            methodName: 'hasRole',
        }),
        contractName: 'Token',
        address: parser.nativeToNormalized(`0x${'11'.repeat(20)}`),
        role: 'MINTER_ROLE',
        accountAddress: parser.nativeToNormalized(`0x${'22'.repeat(20)}`),
        shouldGrant,
        chainName: ChainName.ETHEREUM,
        gas: 100_000n,
    });

describe('createSetRoleTransaction', () => {
    it('gives grant and revoke of the same role and account one id', async () => {
        const [[grant], [revoke]] = await Promise.all([buildSetRole(true), buildSetRole(false)]);

        expect(getIdForGatedTransaction(grant)).toEqual(getIdForGatedTransaction(revoke));
        expect(grant.check.expectedResult.comparisonValue).toBe(true);
        expect(revoke.check.expectedResult.comparisonValue).toBe(false);
    });
});
