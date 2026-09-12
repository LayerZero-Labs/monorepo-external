import type { $ZodType } from 'zod/v4/core';

import { ObjectDefinition } from '@layerzerolabs/base-definitions';

export class ContextDefinition<
    Name extends string,
    Schema extends $ZodType<string | number | boolean>,
> extends ObjectDefinition<Name, Schema, {}> {
    public readonly type = 'ContextDefinition' as const;
    constructor({
        ...args
    }: Omit<ConstructorParameters<typeof ObjectDefinition<Name, Schema, {}>>[0], 'dependencies'>) {
        super(args);
    }
}
