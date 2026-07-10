import type { z } from 'zod';

import type { Dependencies } from '@layerzerolabs/dependency-graph';
import { DependencyNode } from '@layerzerolabs/dependency-graph';
import type { FunctionPointer } from '@layerzerolabs/function-pointer';
import type {
    AdvancedRecord,
    AdvancedRecordLookup,
    Merge,
    MethodNameOf,
    RemoveNever,
    UnionToIntersection,
} from '@layerzerolabs/typescript-utils';
import type { IsAny } from '@layerzerolabs/typescript-utils';

export type DimensionToSchemaMap<DimConstraint extends object = object> = {
    byDimension?: AdvancedRecord<DimConstraint, z.ZodType>;
    base: z.ZodType;
};

export type FactorySpecialization<DMap extends DimensionToSchemaMap = DimensionToSchemaMap> = {
    spec: z.ZodObject<any>;
    exempt: readonly MethodNameOf<GetSupersetOfModelsFromSchema<DMap>>[];
};

export type WithInjectedSpecialization<T, Specialization extends FactorySpecialization<any>> = [
    {},
] extends [z.infer<Specialization['spec']>]
    ? T
    : {
          [K in keyof T]: K extends Specialization['exempt'][number]
              ? T[K]
              : T[K] extends (...args: infer A) => infer R
                ? (specialization: z.infer<Specialization['spec']>, ...args: A) => R
                : T[K];
      };

export type WithSpecializeMethod<WithInjection, WithoutInjection, S> = {} extends S
    ? WithoutInjection
    : WithInjection extends (...args: infer Args) => infer Ret
      ? (...args: Args) => Ret
      : WithInjection & {
            specialize: (specialization: S) => WithoutInjection;
        };

export type GetModelFromSchema<DMap extends DimensionToSchemaMap, Dim> =
    IsAny<Dim> extends true
        ? z.infer<DMap['base']>
        : AdvancedRecordLookup<DMap['byDimension'], Dim> extends never
          ? z.infer<DMap['base']>
          : Merge<z.infer<DMap['base']>, z.infer<AdvancedRecordLookup<DMap['byDimension'], Dim>>>;

export type GetSupersetOfModelsFromSchema<DMap extends DimensionToSchemaMap> = UnionToIntersection<
    {
        [Key in keyof DMap['byDimension']]: DMap['byDimension'][Key] extends [any, any]
            ? z.infer<DMap['byDimension'][Key][1]>
            : never;
    }[keyof DMap['byDimension']]
> &
    z.infer<DMap['base']>;

type GetImplFunctionWithConditionalOptionalDim<Dim, Return> = {} extends Dim
    ? (dim?: Dim) => Return
    : (dim: Dim) => Return;

type GetImplOverloads<
    Dim extends z.ZodObject<any>,
    Specialization extends FactorySpecialization<DMap>,
    DMap extends DimensionToSchemaMap<z.infer<Dim>>,
> = UnionToIntersection<
    | {
          [I in keyof DMap['byDimension']]: DMap['byDimension'][I] extends readonly [infer K, any]
              ? {
                    getImpl: GetImplFunctionWithConditionalOptionalDim<
                        K,
                        WithSpecializeMethod<
                            WithInjectedSpecialization<GetModelFromSchema<DMap, K>, Specialization>,
                            GetModelFromSchema<DMap, K>,
                            z.infer<Specialization['spec']>
                        >
                    >;
                }
              : never;
      }[keyof DMap['byDimension']]
    | {
          getImpl: GetImplFunctionWithConditionalOptionalDim<
              z.infer<Dim>,
              WithSpecializeMethod<
                  WithInjectedSpecialization<z.infer<DMap['base']>, Specialization>,
                  z.infer<DMap['base']>,
                  z.infer<Specialization['spec']>
              >
          >;
      }
>;

export type Factory<
    _Dependencies extends Dependencies,
    Dim extends z.ZodObject<any>,
    Specialization extends FactorySpecialization<DMap>,
    DMap extends DimensionToSchemaMap<z.infer<Dim>>,
> = {
    name: string;
    implKeys: string[];
    dimensionToSchemaMap: DMap;
} & GetImplOverloads<Dim, Specialization, DMap>;

export type GetFactory<
    _Dependencies extends Dependencies,
    Dim extends z.ZodObject<any>,
    Specialization extends FactorySpecialization<DMap>,
    DMap extends DimensionToSchemaMap<z.infer<Dim>>,
> = () =>
    | Factory<_Dependencies, Dim, Specialization, DMap>
    | Promise<Factory<_Dependencies, Dim, Specialization, DMap>>;

/**
 * <!-- anchor:FactoryDefinition -->
 * Factory definitions are a type of dependency node that shall be resolved to a *factory*.
 * A factory is an object that provides a getImpl method which accepts some parameters `dim`,
 * and returns some object `getImplMetadata.getModel(dim)`.
 * That is, a factory definition is given by the set of parameters it uses to get its implementations,
 * and a function defining the schema it will return for each set of parameters.
 * @param name inherited from {@link DependencyNode}
 * @param dependencies inherited from {@link DependencyNode}
 * @param dimensions a Zod schema for the parameters this factory operates on.
 * @param dimensionToSchemaMap A map from dimension objects to the Zod schema for the implementation.
 * @param getFactory a method that should return an object with a `getImpl` method that returns
 * entities adhering to the schema for the corresponding `getModel` call
 */
export class FactoryDefinition<
    Name extends string,
    Dim extends z.ZodObject<any>,
    const Specialization extends FactorySpecialization<DMap>,
    DMap extends DimensionToSchemaMap<z.infer<Dim>>,
    _Dependencies extends Dependencies,
> extends DependencyNode<Name, _Dependencies> {
    public readonly dimensions: Dim;
    public readonly specialization: Specialization;
    public readonly dimensionToSchemaMap: DMap;
    public readonly getFactory: GetFactory<_Dependencies, Dim, Specialization, DMap>;
    constructor({
        dimensions,
        specialization,
        dimensionToSchemaMap,
        getFactory,
        ...args
    }: {
        dimensions: Dim;
        specialization: Specialization;
        dimensionToSchemaMap: DMap;
        getFactory: GetFactory<_Dependencies, Dim, Specialization, DMap>;
    } & ConstructorParameters<typeof DependencyNode<Name, _Dependencies>>[0]) {
        super(args);
        this.dimensions = dimensions;
        this.specialization = specialization;
        this.dimensionToSchemaMap = dimensionToSchemaMap;
        this.getFactory = getFactory;
    }
}

/**
 * <!-- anchor:ObjectDefinition -->
 * An object definition is a dependency node that refers to some entity
 * matching a given schema. That is, it may be resolved to any entity
 * that adheres to the {@link schema}.
 * The object definition is abstract, as it cannot be meaningfully resolved without
 * additional information. For an example of an object definition, see ReflexiveObjectDefinition or ContextDefinition
 * @param name inherited from {@link DependencyNode}
 * @param dependencies inherited from {@link DependencyNode}
 * @param schema a Zod schema defining the expected resolution for this definition
 */
export abstract class ObjectDefinition<
    Name extends string,
    Schema extends z.ZodSchema,
    _Dependencies extends Dependencies,
> extends DependencyNode<Name, _Dependencies> {
    public readonly schema: Schema;

    constructor({
        schema,
        ...args
    }: {
        schema: Schema;
    } & ConstructorParameters<typeof DependencyNode<Name, _Dependencies>>[0]) {
        super(args);
        this.schema = schema;
    }
}

export type Definition<Name extends string> =
    | FactoryDefinition<Name, any, any, any, any>
    | ObjectDefinition<Name, any, any>;

/**
 * Infers the expected type of a definition once it has been resolved
 */
export type ResolvedDefinition<Definition extends DependencyNode<any, any>> =
    Definition extends ObjectDefinition<any, infer Schema, any>
        ? z.infer<Schema>
        : Definition extends FactoryDefinition<
                any,
                infer Dim,
                infer Specialization,
                infer DMap,
                any
            >
          ? Factory<Definition['dependencies'], Dim, Specialization, DMap>
          : Definition extends FactoryDefinition<any, any, any, any, any>
            ? Factory<
                  Definition['dependencies'],
                  Definition['dimensions'],
                  Definition['specialization'],
                  Definition['dimensionToSchemaMap']
              >
            : unknown;

/**
 * Given a record from string to definition, maps each definition T to ResolvedDefinition<T>. Removes `definition` suffix from name
 */
export type ResolvedDefinitionMap<Deps extends Dependencies> = {
    [Key in keyof Deps as Key extends `${infer Name}Definition` ? Name : Key]: ResolvedDefinition<
        Deps[Key]
    >;
};

/**
 * For some factory definition F and some dimension D s.t. D ⊇ F.dimensions, infers the expected return type of
 * ResolvedDefinition<F>.getImpl(D)
 */
export type ResolvedFactoryImplementation<Definition extends DependencyNode<any, any>, Dim> =
    Definition extends FactoryDefinition<any, any, any, any, any>
        ? WithSpecializeMethod<
              WithInjectedSpecialization<
                  GetModelFromSchema<Definition['dimensionToSchemaMap'], Dim>,
                  Definition['specialization']
              >,
              GetModelFromSchema<Definition['dimensionToSchemaMap'], Dim>,
              z.infer<Definition['specialization']['spec']>
          >
        : never;

type RemoveDefinitionSuffix<Key extends string> = Key extends `${infer Name}Definition`
    ? Name
    : Key;
type ReplaceFactorySuffix<Key extends string> = Key extends `${infer Name}Factory`
    ? `${Name}Impl`
    : Key;

/**
 * Given a record from string to definition and some dimension D, maps each definition T to ResolvedFactoryImplementation<T, D>
 * Removes Definition | ActivityFactory | Factory from the suffix of the key
 */
export type ResolvedFactoryImplementationMap<Deps extends Dependencies, Dim> = RemoveNever<{
    [Key in keyof Deps as Key extends string
        ? ReplaceFactorySuffix<RemoveDefinitionSuffix<Key>>
        : never]: ResolvedFactoryImplementation<Deps[Key], Dim>;
}>;

type ActivityFactoryContext<
    _FactoryDefinition extends FactoryDefinition<any, any, any, any, any>,
    Dim,
    _PrivateSchemaExtension extends z.ZodObject = z.ZodObject<{}, z.core.$strip>,
> = {
    getFunctionPointer: <
        MethodName extends MethodNameOf<
            ResolvedFactoryImplementation<_FactoryDefinition, Dim> &
                z.infer<_PrivateSchemaExtension>
        >,
    >(
        methodName: MethodName,
    ) => (ResolvedFactoryImplementation<_FactoryDefinition, Dim> &
        z.infer<_PrivateSchemaExtension>)[MethodName] extends infer M extends (
        ...args: any[]
    ) => any
        ? FunctionPointer<M>
        : never;
};

/**
 * The parameters that shall be received by a factory's implementation getter
 */
export type Context<
    _FactoryDefinition extends FactoryDefinition<any, any, any, any, any>,
    Dim,
    _PrivateSchemaExtension extends z.ZodObject = z.ZodObject<{}, z.core.$strip>,
> = {
    name: _FactoryDefinition extends FactoryDefinition<infer Name, any, any, any, any>
        ? Name
        : never;
    dependencies: _FactoryDefinition extends FactoryDefinition<any, any, any, any, infer Deps>
        ? ResolvedDefinitionMap<Deps>
        : never;
    dim: Dim;
    impls: _FactoryDefinition extends FactoryDefinition<any, any, any, any, infer Deps>
        ? ResolvedFactoryImplementationMap<Deps, Dim>
        : never;
    self: ResolvedFactoryImplementation<_FactoryDefinition, Dim> & z.infer<_PrivateSchemaExtension>;
} & ActivityFactoryContext<_FactoryDefinition, Dim, _PrivateSchemaExtension>;

export const serializeDimensions = (dim: object = {}) => {
    return Object.keys(dim).length
        ? Object.entries(dim)
              .sort()
              .map(([dimName, dimVal]) => `${dimName}_${dimVal}`)
              .join('&')
        : '_base';
};

export const deserializeDimensions = (serializedDim: string) => {
    if (serializedDim === '_base') {
        return {};
    }

    return Object.fromEntries(
        serializedDim.split('&').map((pair) => {
            const [dimName, ...dimValParts] = pair.split('_');
            return [dimName, dimValParts.join('_')];
        }),
    );
};
