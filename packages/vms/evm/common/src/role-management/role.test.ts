import { describe, expect, it } from 'vitest';

import { addressParser } from '@layerzerolabs/chain-utils';
import { createFunctionPointer } from '@layerzerolabs/function-pointer';
import { getIdForGatedTransaction } from '@layerzerolabs/gated-transaction';
import { ChainName } from '@layerzerolabs/layerzero-definitions';

import type { IViemClientWrapper } from '../provider';
import { createSetRoleTransaction, getRoleHash, isRoleManager } from './role';
import type { EvmAccessControl2StepContractGetter, EvmContractGetter } from './types';

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
    it('declares no sender permission without a role-manager pointer', async () => {
        const [grant] = await buildSetRole(true);
        expect(grant!.hasPermission).toBeUndefined();
    });

    it('checks the sender with the role-manager pointer on the contract', async () => {
        const address = parser.nativeToNormalized(`0x${'11'.repeat(20)}`);
        const isRoleManagerPointer = createFunctionPointer({
            factoryName: 'token',
            dimKey: 'evm',
            methodName: 'isRoleManager',
        });
        const [grant] = await createSetRoleTransaction({
            contractGetter,
            providerAdapter: { viem: {} } as unknown as IViemClientWrapper,
            hasRoleFunctionPointer: createFunctionPointer({
                factoryName: 'token',
                dimKey: 'evm',
                methodName: 'hasRole',
            }),
            isRoleManagerFunctionPointer: isRoleManagerPointer,
            contractName: 'Token',
            address,
            role: 'MINTER_ROLE',
            accountAddress: parser.nativeToNormalized(`0x${'22'.repeat(20)}`),
            shouldGrant: true,
            chainName: ChainName.ETHEREUM,
            gas: 100_000n,
        });
        expect(grant!.hasPermission).toEqual({
            type: 'function',
            functionPointer: { ...isRoleManagerPointer, args: [{ address }] },
        });
    });

    it('gives grant and revoke of the same role and account one id', async () => {
        const [[grant], [revoke]] = await Promise.all([buildSetRole(true), buildSetRole(false)]);

        expect(getIdForGatedTransaction(grant)).toEqual(getIdForGatedTransaction(revoke));
        expect(grant.check.expectedResult.comparisonValue).toBe(true);
        expect(revoke.check.expectedResult.comparisonValue).toBe(false);
    });
});

describe('isRoleManager', () => {
    const admin = parser.nativeToNormalized(`0x${'33'.repeat(20)}`);
    const other = parser.nativeToNormalized(`0x${'44'.repeat(20)}`);
    const check = (caller: typeof admin) =>
        isRoleManager({
            contractGetter: (() => ({
                oRead: {
                    hasRole: async ({ role, account }: { role: string; account: string }) =>
                        role === getRoleHash('DEFAULT_ADMIN_ROLE') &&
                        account.toLowerCase() ===
                            parser.normalizedToNativeString(admin).toLowerCase(),
                },
            })) as unknown as EvmAccessControl2StepContractGetter,
            providerAdapter: { viem: {} } as unknown as IViemClientWrapper,
            address: parser.nativeToNormalized(`0x${'11'.repeat(20)}`),
            adminRole: 'DEFAULT_ADMIN_ROLE',
            caller,
            chainName: ChainName.ETHEREUM,
        });

    it('holds for a holder of the admin role', async () => {
        await expect(check(admin)).resolves.toBe(true);
    });

    it('fails for a caller that does not hold the admin role', async () => {
        await expect(check(other)).resolves.toBe(false);
    });
});
