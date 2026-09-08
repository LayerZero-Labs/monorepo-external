import type { z } from 'zod';

import { ObjectDefinition } from '@layerzerolabs/base-definitions';

export class ContextDefinition<
    Name extends string,
    Schema extends z.ZodType<string | number | boolean>,
> extends ObjectDefinition<Name, Schema, {}> {
    public readonly type = 'ContextDefinition' as const;
    constructor({
        ...args
    }: Omit<ConstructorParameters<typeof ObjectDefinition<Name, Schema, {}>>[0], 'dependencies'>) {
        super(args);
    }
}
