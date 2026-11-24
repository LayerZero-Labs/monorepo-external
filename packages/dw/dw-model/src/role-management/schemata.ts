import { z } from 'zod';

import { normalizedHexSchema, transactionSchema } from '@layerzerolabs/common-chain-model';
import { gatedTransactionSchema } from '@layerzerolabs/gated-transaction';
import { functionSchema } from '@layerzerolabs/zod-utils';

export const generateCreateSetRoleTransactionsSchema = <
    const T extends readonly [string, ...string[]],
>(
    roles: T,
) =>
    functionSchema({
        input: z.tuple([
            z.object({
                role: z.enum(roles),
                accountAddress: normalizedHexSchema,
                shouldGrant: z.boolean(),
            }),
        ]),
        output: z.promise(
            gatedTransactionSchema({
                name: z.string(),
                transactionSchema: transactionSchema,
            }).array(),
        ),
    });

export const generateHasRoleSchema = <const T extends readonly [string, ...string[]]>(roles: T) =>
    functionSchema({
        input: z.tuple([
            z.object({
                role: z.enum(roles),
                accountAddress: normalizedHexSchema,
            }),
        ]),
        output: z.promise(z.boolean()),
    });

export const generateGetRoleMembersSchema = <const T extends readonly [string, ...string[]]>(
    roles: T,
) =>
    functionSchema({
        input: z.tuple([
            z.object({
                role: z.enum(roles),
            }),
        ]),
        output: z.promise(z.array(normalizedHexSchema)),
    });

export const generateRoleManagementSchemas = <const T extends readonly [string, ...string[]]>(
    roles: T,
) => ({
    createSetRoleTransactions: generateCreateSetRoleTransactionsSchema(roles),
    hasRole: generateHasRoleSchema(roles),
});

export const generateEnumerableRoleManagementSchemas = <
    const T extends readonly [string, ...string[]],
>(
    roles: T,
) => ({
    ...generateRoleManagementSchemas(roles),
    getRoleMembers: generateGetRoleMembersSchema(roles),
});

export const createSetRoleTransactionsWithSpecializedInputSchema = functionSchema({
    input: z.tuple([
        z.object({
            address: normalizedHexSchema,
        }),
        z.object({
            role: z.string(),
            accountAddress: normalizedHexSchema,
            shouldGrant: z.boolean(),
        }),
    ]),
    output: z.promise(
        gatedTransactionSchema({
            name: z.string(),
            transactionSchema: transactionSchema,
        }).array(),
    ),
});

export const hasRoleWithSpecializedInputSchema = functionSchema({
    input: z.tuple([
        z.object({
            address: normalizedHexSchema,
        }),
        z.object({
            role: z.string(),
            accountAddress: normalizedHexSchema,
        }),
    ]),
    output: z.promise(z.boolean()),
});

export const getRoleMembersWithSpecializedInputSchema = functionSchema({
    input: z.tuple([
        z.object({
            address: normalizedHexSchema,
        }),
        z.object({
            role: z.string(),
        }),
    ]),
    output: z.promise(z.array(normalizedHexSchema)),
});

export type CreateSetRoleTransactionsWithSpecializedInput = z.infer<
    typeof createSetRoleTransactionsWithSpecializedInputSchema
>;
export type HasRoleWithSpecializedInput = z.infer<typeof hasRoleWithSpecializedInputSchema>;
export type GetRoleMembersWithSpecializedInput = z.infer<
    typeof getRoleMembersWithSpecializedInputSchema
>;

// ---------------------------------------------------------------------------
// Admin 2-step transfer schemas
// ---------------------------------------------------------------------------

const admin2StepTransactionOutputSchema = z.promise(
    gatedTransactionSchema({
        name: z.string(),
        transactionSchema: transactionSchema,
    }).array(),
);

export const getPendingAdminSchema = functionSchema({
    input: z.tuple([]),
    output: z.promise(normalizedHexSchema),
});

export const isAdminTransferStartedOrCompleteSchema = functionSchema({
    input: z.tuple([z.object({ newAdmin: normalizedHexSchema })]),
    output: z.promise(z.boolean()),
});

export const createBeginAdminTransferTransactionsSchema = functionSchema({
    input: z.tuple([z.object({ newAdmin: normalizedHexSchema })]),
    output: admin2StepTransactionOutputSchema,
});

export const createAcceptAdminTransferTransactionsSchema = functionSchema({
    input: z.tuple([z.object({ newAdmin: normalizedHexSchema })]),
    output: admin2StepTransactionOutputSchema,
});

export const generateAdmin2StepSchemas = () => ({
    getPendingAdmin: getPendingAdminSchema,
    isAdminTransferStartedOrComplete: isAdminTransferStartedOrCompleteSchema,
    createBeginAdminTransferTransactions: createBeginAdminTransferTransactionsSchema,
    createAcceptAdminTransferTransactions: createAcceptAdminTransferTransactionsSchema,
});

export const getPendingAdminWithSpecializedInputSchema = functionSchema({
    input: z.tuple([z.object({ address: normalizedHexSchema })]),
    output: z.promise(normalizedHexSchema),
});

export const isAdminTransferStartedOrCompleteWithSpecializedInputSchema = functionSchema({
    input: z.tuple([
        z.object({ address: normalizedHexSchema }),
        z.object({ newAdmin: normalizedHexSchema }),
    ]),
    output: z.promise(z.boolean()),
});

export const createBeginAdminTransferTransactionsWithSpecializedInputSchema = functionSchema({
    input: z.tuple([
        z.object({ address: normalizedHexSchema }),
        z.object({ newAdmin: normalizedHexSchema }),
    ]),
    output: admin2StepTransactionOutputSchema,
});

export const createAcceptAdminTransferTransactionsWithSpecializedInputSchema = functionSchema({
    input: z.tuple([
        z.object({ address: normalizedHexSchema }),
        z.object({ newAdmin: normalizedHexSchema }),
    ]),
    output: admin2StepTransactionOutputSchema,
});

export type GetPendingAdminWithSpecializedInput = z.infer<
    typeof getPendingAdminWithSpecializedInputSchema
>;
export type IsAdminTransferStartedOrCompleteWithSpecializedInput = z.infer<
    typeof isAdminTransferStartedOrCompleteWithSpecializedInputSchema
>;
export type CreateBeginAdminTransferTransactionsWithSpecializedInput = z.infer<
    typeof createBeginAdminTransferTransactionsWithSpecializedInputSchema
>;
export type CreateAcceptAdminTransferTransactionsWithSpecializedInput = z.infer<
    typeof createAcceptAdminTransferTransactionsWithSpecializedInputSchema
>;
