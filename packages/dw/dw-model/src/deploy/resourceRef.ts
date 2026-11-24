import { z } from 'zod';

import { NonRetryableError } from '@layerzerolabs/common-error-utils';

const noSlash = (label: string) =>
    z
        .string()
        .min(1)
        .refine((s) => !s.includes('/'), {
            message: `${label} cannot include the character / (forward slash)`,
        });

/** `foo/bar` is a composite ref: resourceId `foo`, resourceSubKey `bar`. */
export const resourceIdSchema = noSlash('resourceId');

export const resourceSubKeySchema = noSlash('resourceSubKey');

/** Reference to a resource's identity RealID or one selected by resourceSubKey. */
export const resourceRefSchema = z.object({
    resourceId: resourceIdSchema,
    // Omit to reference the resource's identity RealID.
    resourceSubKey: resourceSubKeySchema.optional(),
});

export type ResourceRef = z.infer<typeof resourceRefSchema>;

/** Schema parse as NonRetryableError; ZodError is opaque and retryable. */
export const assertResourceRef = (ref: {
    resourceId: string;
    resourceSubKey?: string;
}): ResourceRef => {
    const parsed = resourceRefSchema.safeParse(ref);
    if (!parsed.success) {
        throw new NonRetryableError(parsed.error.issues.map((issue) => issue.message).join('; '));
    }
    return parsed.data;
};
