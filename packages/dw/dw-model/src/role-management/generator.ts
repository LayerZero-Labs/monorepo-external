import type { CreateSetRoleTransactionsWithSpecializedInput, HasRoleWithSpecializedInput } from '.';

export const generateThrowCreateSetRoleTransactions =
    (): CreateSetRoleTransactionsWithSpecializedInput => () => {
        throw new Error('Not implemented');
    };

export const generateThrowHasRole = (): HasRoleWithSpecializedInput => () => {
    throw new Error('Not implemented');
};

export const generateThrowRoleManagement = () => {
    return {
        createSetRoleTransactions: generateThrowCreateSetRoleTransactions(),
        hasRole: generateThrowHasRole(),
    };
};
