import { z } from 'zod';
import type { $ZodType } from 'zod/v4/core';

import type { FunctionPointer } from '@layerzerolabs/function-pointer';

export type InferredArray<T extends $ZodType[], Output extends any[] = []> = T extends []
    ? Output
    : T extends [infer Head, ...infer Tail extends $ZodType[]]
      ? InferredArray<Tail, [...Output, z.infer<Head>]>
      : never;

export const functionSchemaTag = '__FUNCTION_SCHEMA_TAG';

// type assert that the z.ZodType type doesn't have a property `input` or `output` as it would conflict with our function schema type injection
const _check: true = null as any as keyof z.ZodType<string> extends infer U
    ? 'input' extends U
        ? false
        : 'output' extends U
          ? false
          : true
    : false;

// This essentially replicates the functionality of z.function in zod v3
export const functionSchema = <Input extends z.ZodTuple, Output extends $ZodType>({
    input,
    output,
}: {
    input: Input;
    output: Output;
}) => {
    const obj = z.object({
        input,
        output: output as unknown as z.ZodType,
    });
    Object.defineProperty(obj, functionSchemaTag, { value: true, writable: false });
    (obj as any).input = input;
    (obj as any).output = output;
    // We don't expect the function to actually be an object with an input field and an output field
    // so we override the parse function. We can't actually parse functions since input and output
    // types are lost at runtime, but we can check the runtime type of the object
    obj.parse = (i) => {
        if (typeof i !== 'function') {
            throw new Error(`${i} is not a function`);
        }
        // The return type here just has to match the inference of z.object,
        // the actual inference of the schema will be the z.ZodType custom
        return i as any;
    };

    // we have to decide here whether the args should be typed as the input or the output of the schema--
    // neither answer is correct and this is probably why zod dropped the function schema in v4
    // use infer for now because many of our schemata don't have a defined input and will silently produce `unknown`
    return obj as unknown as z.ZodType<(...args: z.infer<Input>) => z.infer<Output>> & {
        // inject these fields so that the original input and output schemata can be recovered pre-inference
        input: Input;
        output: Output;
        __FUNCTION_SCHEMA_TAG: true;
    };
};

// takes the z.infer of the schema, except for any top-level function schemata,
// which are introspected to extract their input's output type
export type InferSchemaOutputWithInvertedFunctionSchemata<T extends $ZodType> =
    T extends z.ZodObject
        ? z.infer<
              z.ZodObject<{
                  [K in keyof T['shape']]: T['shape'][K] extends {
                      input: z.ZodTuple;
                      output: $ZodType;
                  }
                      ? z.ZodType<
                            (
                                ...args: z.infer<T['shape'][K]['input']>
                            ) => z.infer<T['shape'][K]['output']>
                        >
                      : T['shape'][K] extends $ZodType
                        ? T['shape'][K]
                        : never;
              }>
          >
        : z.infer<T>;

export const schemaIsFunctionSchema = (
    schema: $ZodType,
): schema is ReturnType<typeof functionSchema> => {
    return Object.hasOwn(schema, functionSchemaTag);
};

export const customSchema = <T>(validate?: (data: any) => T) =>
    z.custom<T>(validate) as z.ZodType<T, T>;

export const createFunctionPointerSchema = <T extends FunctionPointer>() =>
    // TODO: replace with a concrete zod schema
    customSchema<T>();

export type BuildZodObject<T extends object> = z.ZodObject<
    {
        [K in keyof T]: z.ZodType<T[K]>;
    },
    z.core.$strip
>;

// utils for branding schemata with names
const brandedSchemaPropertyKey = '__BRANDED_SCHEMA_NAME' as const;

/** Unavoidably, this mutates the underlying schema. Use with caution. */
export const brandSchema = <Schema extends $ZodType>(schema: Schema, name: string): Schema =>
    Object.defineProperty(schema, brandedSchemaPropertyKey, {
        enumerable: false,
        configurable: false,
        writable: false,
        value: name,
    });

export const isBrandedWith = <Branded extends $ZodType>(
    expected: Branded,
    schema: $ZodType,
): schema is Branded => {
    if (!(brandedSchemaPropertyKey in expected)) {
        throw new Error('Branded model is not itself branded');
    }

    if (!(brandedSchemaPropertyKey in schema)) {
        return false;
    }

    return schema[brandedSchemaPropertyKey] === expected[brandedSchemaPropertyKey];
};
