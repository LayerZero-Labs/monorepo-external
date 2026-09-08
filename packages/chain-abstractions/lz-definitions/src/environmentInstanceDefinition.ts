import { ContextDefinition } from '@layerzerolabs/context-node';
import type { Identity } from '@layerzerolabs/typescript-utils';

import { environmentInstanceSchema } from './schema';

export const _environmentInstanceDefinition = new ContextDefinition({
    name: 'EnvironmentInstance',
    schema: environmentInstanceSchema,
});

export interface EnvironmentInstanceDefinition
    extends Identity<typeof _environmentInstanceDefinition> {}

export const environmentInstanceDefinition: EnvironmentInstanceDefinition =
    _environmentInstanceDefinition;
