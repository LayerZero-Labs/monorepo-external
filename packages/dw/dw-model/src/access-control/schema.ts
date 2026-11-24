import { z } from 'zod';

import { NORMALIZED_HEX_ZERO, normalizedHexSchema } from '@layerzerolabs/common-chain-model';

export const accessControlAddressSchema = z.union([
    normalizedHexSchema.refine((address) => address !== NORMALIZED_HEX_ZERO, {
        message:
            'the zero address is not a valid access-control address; leave the entry undeclared until the real address is known',
    }),
    z.object({ senderEntity: z.string() }),
]);

export type AccessControlAddress = z.infer<typeof accessControlAddressSchema>;

export const isSenderEntityAccessControlAddress = (
    address: AccessControlAddress,
): address is { senderEntity: string } => typeof address === 'object';

export const describeAccessControlAddress = (address: AccessControlAddress): string =>
    isSenderEntityAccessControlAddress(address)
        ? `sender entity ${address.senderEntity}`
        : String(address);

export const roleMemberSchema = z.object({
    address: accessControlAddressSchema,
    hasRole: z.boolean(),
});

export type RoleMember = z.infer<typeof roleMemberSchema>;

export const roleMapSchema = z.record(z.string(), z.array(roleMemberSchema));

export type RoleMap = z.infer<typeof roleMapSchema>;

export const accessControlConfigSchema = z.object({
    resources: z.record(z.string(), roleMapSchema),
});

export type AccessControlConfig = z.infer<typeof accessControlConfigSchema>;

export const withRole = (address: AccessControlAddress): RoleMember => ({
    address,
    hasRole: true,
});

export const withoutRole = (address: AccessControlAddress): RoleMember => ({
    address,
    hasRole: false,
});
