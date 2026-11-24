import type { z } from 'zod';

import { NonRetryableError } from '@layerzerolabs/common-error-utils';

export const parseInput = <Schema extends z.ZodType>(
    schema: Schema,
    input: unknown,
    description: string,
): z.infer<Schema> => {
    const result = schema.safeParse(input);
    if (!result.success) {
        throw new NonRetryableError(
            `Invalid ${description}: ${result.error.issues
                .map(({ path, message }) => `${path.join('.')} ${message}`)
                .join('; ')}`,
        );
    }
    return result.data;
};
