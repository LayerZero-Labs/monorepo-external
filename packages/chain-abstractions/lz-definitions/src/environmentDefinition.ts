import { ContextDefinition } from '@layerzerolabs/context-node';
export type { ContextDefinition } from '@layerzerolabs/context-node';

import type { Identity } from '@layerzerolabs/typescript-utils';

import { environmentSchema } from './schema';

export const _environmentDefinition = new ContextDefinition({
    name: 'Environment',
    schema: environmentSchema,
});

export interface EnvironmentDefinition extends Identity<typeof _environmentDefinition> {}

export const environmentDefinition: EnvironmentDefinition = _environmentDefinition;
