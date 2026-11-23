import { z } from 'zod';

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

export const extractMethodInputSchema = ({
    factory,
    dimension,
    methodName,
}: {
    factory: FactoryDefinition<any, any, any, any, any>;
    dimension: object;
    methodName: string;
}): z.ZodTuple | undefined => {
    const shape = extractSchemaFromFactory(factory, dimension).shape;
    const input = Object.hasOwn(shape, methodName)
        ? (shape[methodName] as { input?: z.ZodTuple }).input
        : undefined;
    const { spec, exempt } = factory.specialization;
    if (!input || !Object.keys(spec.shape).length || exempt.includes(methodName)) return input;

    const items = [spec, ...input.def.items] as [z.ZodType, ...z.ZodType[]];
    return input.def.rest ? z.tuple(items, input.def.rest) : z.tuple(items);
};
