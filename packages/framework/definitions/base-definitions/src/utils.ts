import type z from 'zod';

import type { AdvancedRecord } from '@layerzerolabs/typescript-utils';

import type { Factory } from './definitions';
import { type FactoryDefinition, serializeDimensions } from './definitions';

export const extractSchemaFromFactory = <Dim extends z.ZodObject>(
    factory: FactoryDefinition<any, Dim, any, any, any> | Factory<any, any, any, any>,
    dimension: z.infer<Dim>,
): z.ZodObject => {
    const schema =
        (factory.dimensionToSchemaMap.byDimension &&
            Object.values(factory.dimensionToSchemaMap.byDimension as AdvancedRecord).find(
                ([dim]) => serializeDimensions(dim) === serializeDimensions(dimension),
            )?.[1]) ??
        factory.dimensionToSchemaMap.base;
    if (!schema?.shape) {
        throw new Error(
            `Couldn't resolve the schema of factory ${factory.name} for dim ${JSON.stringify(dimension)}`,
        );
    }

    return schema;
};
