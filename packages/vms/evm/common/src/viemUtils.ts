import type { AbiStateMutability, SolidityArrayWithTuple, SolidityTuple } from 'abitype';
import type {
    Abi,
    AbiEvent,
    AbiFunction,
    AbiParameter,
    AbiParameterKind,
    AbiParameterToPrimitiveType,
    ContractEventName,
    ContractFunctionName,
    GetContractEventsReturnType,
    GetContractReturnType,
    Hex,
    Prettify,
    ReadContractParameters,
    TransactionReceipt,
} from 'viem';
import type { PublicClient } from 'viem';
import { encodeDeployData, encodeFunctionData, getContract, parseEventLogs } from 'viem';
import { encodeDeployData as encodeDeployDataZk } from 'viem/zksync';

import { addressParser } from '@layerzerolabs/chain-utils';
import type { TransactionResult } from '@layerzerolabs/common-chain-model';
import {
    type NormalizedHexString,
    normalizeHex,
    type TransactionWithResult,
} from '@layerzerolabs/common-chain-model';
import { raceToSuccess } from '@layerzerolabs/common-concurrency-utils';
import { ensure0xPrefixed } from '@layerzerolabs/common-encoding-utils';
import type {
    ChainType,
    Environment,
    InferChainNamesForChainType,
} from '@layerzerolabs/layerzero-definitions';
import type {
    IsAny,
    TuplesToObject,
    UnionToIntersection,
    UnionToTuple,
    ValueOf,
} from '@layerzerolabs/typescript-utils';

import type {
    EvmPopulatedTransaction,
    EvmTransactionOverrides,
    EvmTransactionPayableOverrides,
} from './transaction';

type KeyefyAbiParameter<abiParameter extends AbiParameter> =
    undefined extends abiParameter['internalType']
        ? abiParameter extends {
              type: SolidityTuple;
              components: infer components extends readonly AbiParameter[];
          }
            ? KeyAbiParameters<components>
            : abiParameter extends {
                    type: `tuple[${infer arrayExtension}`;
                    components: infer components extends readonly AbiParameter[];
                }
              ? `${KeyAbiParameters<components>}[${arrayExtension}`
              : abiParameter['type']
        : abiParameter['internalType'];

type KeyAbiParameters<
    parameters extends readonly AbiParameter[],
    cursor extends string = '',
> = parameters extends readonly [
    infer head extends AbiParameter,
    ...infer rest extends readonly AbiParameter[],
]
    ? KeyAbiParameters<
          rest,
          '' extends cursor
              ? `(${KeyefyAbiParameter<head>}`
              : `${cursor}, ${KeyefyAbiParameter<head>}`
      >
    : '' extends cursor
      ? '()'
      : `${cursor})`;

type KeyAbiFunction<abiFunction extends AbiFunction> =
    '' extends KeyAbiParameters<abiFunction['inputs']>
        ? abiFunction['name']
        : `${abiFunction['name']}-${KeyAbiParameters<abiFunction['inputs']>}`;

type GetFunctionAbiItemsWithMutability<
    abi extends Abi,
    mutability extends AbiStateMutability,
> = abi extends readonly [infer abiItem, ...infer rest extends Abi]
    ? abiItem extends AbiFunction
        ? abiItem['stateMutability'] extends mutability
            ? readonly [abiItem, ...GetFunctionAbiItemsWithMutability<rest, mutability>]
            : GetFunctionAbiItemsWithMutability<rest, mutability>
        : GetFunctionAbiItemsWithMutability<rest, mutability>
    : readonly [];

type FunctionArrayToOverloadMap<
    functionAbis extends readonly AbiFunction[],
    abiToMethod extends Record<string, any>,
> = functionAbis extends readonly [
    infer first extends AbiFunction,
    ...infer rest extends readonly AbiFunction[],
]
    ? Prettify<
          {
              [_ in KeyAbiParameters<first['inputs']>]: abiToMethod[KeyAbiFunction<first>];
          } & FunctionArrayToOverloadMap<rest, abiToMethod>
      >
    : {};

type GroupedAbiByFunctionName<abi extends Abi> =
    UnionToIntersection<
        abi[number] extends infer abiItem
            ? abiItem extends AbiFunction
                ? {
                      [_ in abiItem['name']]: {
                          [_ in KeyAbiParameters<abiItem['inputs']>]: abiItem;
                      };
                  }
                : never
            : never
    > extends infer functionGroup
        ? {
              [functionName in keyof functionGroup]: UnionToTuple<
                  ValueOf<functionGroup[functionName]>
              >;
          }
        : never;

type CollectAbiOverloads<
    abi extends Abi,
    mutability extends AbiStateMutability,
    abiToMethod extends Record<string, any>,
    groupedAbi extends Record<string, Abi> = GroupedAbiByFunctionName<abi>,
> = Prettify<
    UnionToIntersection<
        {
            [index in keyof abi]: abi[index] extends infer functionAbi extends AbiFunction
                ? functionAbi['stateMutability'] extends mutability
                    ? groupedAbi[functionAbi['name']] extends infer functionAbiItems extends
                          readonly AbiFunction[]
                        ? {
                              [_ in functionAbi['name']]: functionAbiItems extends readonly [
                                  AbiFunction,
                                  AbiFunction,
                                  ...AbiFunction[],
                              ]
                                  ? FunctionArrayToOverloadMap<functionAbiItems, abiToMethod>
                                  : abiToMethod[KeyAbiFunction<functionAbi>];
                          }
                        : never
                    : never
                : never;
        }[number]
    >
>;

type ReadMethods = 'view' | 'pure';

export type OReadAbiToMethod<functionAbi extends AbiFunction> = functionAbi extends {
    inputs: infer inputs extends readonly AbiParameter[];
    outputs: infer outputs extends readonly AbiParameter[];
}
    ? (
          ...parameters: AbiParameterToPrimitiveTypeAsObject<inputs, 'inputs'> extends never
              ? readonly [
                    options?: Omit<
                        ReadContractParameters,
                        'abi' | 'address' | 'args' | 'functionName'
                    >,
                ]
              : readonly [
                    args: Prettify<AbiParameterToPrimitiveTypeAsObject<inputs, 'inputs'>>,
                    options?: Omit<
                        ReadContractParameters,
                        'abi' | 'address' | 'args' | 'functionName'
                    >,
                ]
      ) => Promise<Prettify<AbiParameterToPrimitiveTypeAsObject<outputs, 'outputs'>>>
    : never;

export type OReadResolveCollectedAbiOverloads<
    abi extends Abi,
    trimmedAbi extends readonly AbiFunction[] = GetFunctionAbiItemsWithMutability<abi, ReadMethods>,
> = CollectAbiOverloads<
    abi,
    ReadMethods,
    TuplesToObject<{
        [index in keyof trimmedAbi]: trimmedAbi[index] extends infer functionAbi extends AbiFunction
            ? readonly [KeyAbiFunction<functionAbi>, OReadAbiToMethod<functionAbi>]
            : never;
    }>
>;

type WriteMethods = 'nonpayable' | 'payable';

export type OPopulateTransactionAbiToMethod<functionAbi extends AbiFunction> = functionAbi extends {
    stateMutability: infer mutability extends AbiStateMutability;
    inputs: infer inputs extends readonly AbiParameter[];
}
    ? (
          ...parameters: AbiParameterToPrimitiveTypeAsObject<inputs, 'inputs'> extends never
              ? readonly [
                    options?: mutability extends 'nonpayable'
                        ? EvmTransactionOverrides
                        : EvmTransactionPayableOverrides,
                ]
              : readonly [
                    args: Prettify<AbiParameterToPrimitiveTypeAsObject<inputs, 'inputs'>>,
                    options?: mutability extends 'nonpayable'
                        ? EvmTransactionOverrides
                        : EvmTransactionPayableOverrides,
                ]
      ) => Promise<EvmPopulatedTransaction>
    : never;

export type OPopulateTransactionResolveCollectedAbiOverloads<
    abi extends Abi,
    trimmedAbi extends readonly AbiFunction[] = GetFunctionAbiItemsWithMutability<
        abi,
        WriteMethods
    >,
> = CollectAbiOverloads<
    abi,
    WriteMethods,
    TuplesToObject<{
        [index in keyof trimmedAbi]: trimmedAbi[index] extends infer functionAbi extends AbiFunction
            ? [KeyAbiFunction<functionAbi>, OPopulateTransactionAbiToMethod<functionAbi>]
            : never;
    }>
>;

export type ContractType<AbiSchema extends Abi> = GetContractReturnType<AbiSchema, PublicClient>;

export type AbiParameterToPrimitiveTypeAsObject<
    args extends readonly AbiParameter[],
    abiParameterKind extends AbiParameterKind,
> = [args['length'], abiParameterKind] extends [1, 'outputs']
    ? AbiParameterToPrimitiveType<args[0], abiParameterKind>
    : args['length'] extends 0
      ? never
      : {
            // Required properties (named parameters)
            [argName in Exclude<keyof args, keyof []> as args[argName] extends {
                name: infer FieldName extends string;
            }
                ? FieldName extends ''
                    ? never
                    : FieldName
                : never]: args[argName] extends AbiParameter | { name: string; type: unknown }
                ? AbiParameterToPrimitiveType<args[argName], abiParameterKind>
                : never;
        } & {
            // Optional properties (unnamed parameters)
            [argIndex in Exclude<keyof args, keyof []> as args[argIndex] extends {
                name: infer FieldName extends string;
            }
                ? FieldName extends ''
                    ? `${argIndex & string}_${abiParameterKind}`
                    : never
                : never]: args[argIndex] extends AbiParameter | { name: string; type: unknown }
                ? AbiParameterToPrimitiveType<args[argIndex], abiParameterKind>
                : never;
        };

export type ExtractConstructorArgs<abi extends Abi> =
    IsAny<abi> extends true
        ? any[]
        : IsAny<abi[number]> extends true
          ? any[]
          : Extract<abi[number], { type: 'constructor' }>['inputs'] extends infer inputs extends
                  readonly AbiParameter[]
            ? [inputs] extends [readonly []]
                ? []
                : [args: AbiParameterToPrimitiveTypeAsObject<inputs, 'inputs'>]
            : // case where the contract has no constructor
              [];

export type ExtractFunctionArgs<
    abi extends Abi,
    functionName extends ContractFunctionName<abi>,
> = Extract<
    abi[number],
    { type: 'function'; name: functionName }
>['inputs'] extends infer inputs extends readonly AbiParameter[]
    ? inputs extends readonly []
        ? []
        : [args: AbiParameterToPrimitiveTypeAsObject<inputs, 'inputs'>]
    : never;

// Helper type for populateTransaction parameters
type PopulateTransactionParams<
    abi extends Abi,
    contract extends ContractType<abi>,
> = contract extends { write: any }
    ? {
          [functionName in ContractFunctionName<abi, 'nonpayable' | 'payable'>]: (
              ...parameters: Parameters<contract['write'][functionName]> extends [
                  infer args,
                  any, // Ensure there is more than one param
              ]
                  ? [
                        args: args,
                        overrides?: functionName extends ContractFunctionName<abi, 'nonpayable'>
                            ? EvmTransactionOverrides
                            : EvmTransactionPayableOverrides,
                    ]
                  : [
                        overrides?: functionName extends ContractFunctionName<abi, 'nonpayable'>
                            ? EvmTransactionOverrides
                            : EvmTransactionPayableOverrides,
                    ]
          ) => Promise<EvmPopulatedTransaction>;
      }
    : never;

/**
 * Enhanced Contracts adds helper methods to interact with the contracts on top of viem.
 *
 * - getEventsFromReceipt: Useful to
 * - populateTransaction: viem doesn't natively support creating a transaction object without sending it, and this is required to compose the transactions without defining the singer (also useful for OneSig)
 * - o[PopulateTransaction|Read]: Object versions of the viem contracts. This is something that viem doesn't want to support natively, but it's useful for PR reviews and code readability. https://viem.sh/docs/faq#why-are-contract-function-args-with-fully-named-inputs-represented-as-unnamed-tuple-types-instead-of-object-types
 *
 * Note: For the unnamed inputs and outputs we will give them a name on the o[PopulateTransaction|Read] of `${index}_inputs` and `${index}_outputs`. The reason we start with the index is to avoid conflicts with the named params on EVM since EVM variables must not start with a number.
 * Note 2: When the functions have overloads, the o[PopulateTransaction|Read] will be an object with the keys being the input types joined with a dash. For example, for a function `foo(uint256,address)` the key will be `contract.foo['(uint256, address)']`. If the function has no inputs, the key will be `()`.
 * Note 3: If there's a single output we will follow the same pattern that viem does, so we will return the value directly instead of returning an object with a single key.
 */
export type EnhancedContract<abi extends Abi> = ContractType<abi> & {
    populateTransaction: PopulateTransactionParams<abi, ContractType<abi>>;
    oPopulateTransaction: OPopulateTransactionResolveCollectedAbiOverloads<abi>;
    oRead: OReadResolveCollectedAbiOverloads<abi>;
    getEventsFromReceipt: {
        [eventName in ContractEventName<abi>]: (
            receipt: TransactionReceipt,
        ) => GetContractEventsReturnType<abi, eventName, true>;
    };
};

const isTupleType = (
    input: AbiParameter,
): input is { type: SolidityTuple; components: readonly AbiParameter[] } => {
    return input.type === 'tuple';
};

const isTupleArrayType = (
    input: AbiParameter,
): input is { type: SolidityArrayWithTuple; components: readonly AbiParameter[] } => {
    return input.type.startsWith('tuple') && input.type.endsWith(']');
};

/**
 * This function enhances a contract object with the following properties:
 * - populateTransaction: A set of functions that create a transaction object wiht encoded data. The transaction can then be separately singed and sent.
 * There is a function for each function in the contract that is writable.
 * - getEventsFromReceipt: A set of functions that retrieves events from a receipt. There is a function for each event in the contract.
 * The function is generic, typesafe and can be used with any viem contract object.
 */
// Helper to generate key from inputs
const generateKeyFromInputs = (inputs: readonly AbiParameter[]): string => {
    if (inputs.length === 0) {
        return '()';
    }

    const paramsStringified = inputs
        .map((input) => {
            if (input.internalType) {
                return input.internalType;
            }

            if (isTupleType(input)) {
                return generateKeyFromInputs(input.components);
            }

            if (isTupleArrayType(input)) {
                const tupleKey = generateKeyFromInputs(input.components);
                const arrayShapeString = input.type.slice(input.type.indexOf('['));

                return `${tupleKey}${arrayShapeString}`;
            }

            return input.type;
        })
        .join(', ');

    return `(${paramsStringified})`;
};

export const enhanceContractObject = <abi extends Abi, contract extends ContractType<abi>>(
    contract: contract,
    abi: abi,
): EnhancedContract<abi> => {
    const populateTransaction: Record<string, any> = {};
    const oPopulateTransaction: Record<string, any> = {};
    const oRead: Record<string, any> = {};
    const getEventsFromReceipt: Record<string, any> = {};

    // Group functions by name to detect overloads
    const functionsByName: {
        [name: string]: AbiFunction[];
    } = {};

    abi.forEach((item) => {
        if (item.type !== 'function') {
            return;
        }

        if (!functionsByName[item.name]) {
            functionsByName[item.name] = [];
        }

        functionsByName[item.name].push(item);
    });

    abi.forEach((item) => {
        if (item.type === 'event') {
            getEventsFromReceipt[item.name] = (receipt: TransactionReceipt) => {
                return parseEventLogs({
                    abi: abi,
                    logs: receipt.logs.filter(
                        (l) => l.address.toLowerCase() === contract.address.toLowerCase(),
                    ),
                    eventName: item.name as any,
                    strict: true,
                });
            };
        }

        if (item.type !== 'function') {
            return;
        }

        const hasOverloads = functionsByName[item.name].length > 1;
        const overloadKey = generateKeyFromInputs(item.inputs);

        if (item.stateMutability === 'nonpayable' || item.stateMutability === 'payable') {
            populateTransaction[item.name] = async (...parameters: any[]) => {
                const data = encodeFunctionData<Abi>({
                    abi: abi,
                    functionName: item.name,
                    args: item.inputs.length > 0 ? parameters[0] : [],
                });

                const tx: EvmPopulatedTransaction = {
                    data,
                    to: normalizeHex(contract.address),
                    ...((item.inputs.length > 0 ? parameters[1] : parameters[0]) ?? {}),
                };

                return tx;
            };

            const createOPopulateTransaction = () => {
                return async (...parameters: any[]) => {
                    return populateTransaction[item.name](
                        // First argument is not required if there are no inputs
                        ...(item.inputs.length > 0
                            ? [
                                  item.inputs.map((input, index: number) =>
                                      input.name
                                          ? parameters[0][input.name]
                                          : parameters[0][`${index}_inputs`],
                                  ),
                                  parameters[1],
                              ]
                            : [parameters[0]]),
                    );
                };
            };

            if (hasOverloads) {
                oPopulateTransaction[item.name] ??= {};
                oPopulateTransaction[item.name][overloadKey] = createOPopulateTransaction();
            } else {
                oPopulateTransaction[item.name] = createOPopulateTransaction();
            }
        }

        if (item.stateMutability === 'view' || item.stateMutability === 'pure') {
            const createORead = () => {
                return async (...parameters: any[]) => {
                    const results = await (
                        contract as unknown as {
                            read: {
                                [item.name]: (...parameters: any[]) => Promise<any | any[]>;
                            };
                        }
                    ).read[item.name](
                        // First argument is not required if there are no inputs
                        ...(item.inputs.length > 0
                            ? [
                                  item.inputs.map((input, index: number) =>
                                      input.name
                                          ? parameters[0][input.name]
                                          : parameters[0][`${index}_inputs`],
                                  ),
                                  parameters[1],
                              ]
                            : [parameters[0]]),
                    );

                    if (item.outputs.length === 1) {
                        // If there's a single output, we return the value directly
                        // since viem doesn't return an array in this case
                        return results;
                    }

                    return Object.fromEntries(
                        (results as any[]).map((resultEntry, index) => {
                            const output = item.outputs[index];

                            return output.name
                                ? [output.name, resultEntry]
                                : [`${index}_outputs`, resultEntry];
                        }),
                    );
                };
            };

            if (hasOverloads) {
                oRead[item.name] ??= {};
                oRead[item.name][overloadKey] = createORead();
            } else {
                oRead[item.name] = createORead();
            }
        }
    });

    return Object.assign(contract, {
        populateTransaction,
        getEventsFromReceipt,
        oPopulateTransaction,
        oRead,
    }) as unknown as EnhancedContract<abi>;
};

export type ContractEvent<
    abi extends Abi,
    EventName extends ContractEventName<abi>,
> = GetContractEventsReturnType<abi, EventName, true>[0];

export const getViemContract = <abi extends Abi>(
    chainName: InferChainNamesForChainType<ChainType.EVM>,
    address: NormalizedHexString,
    viemClient: PublicClient,
    abi: abi,
): ContractType<abi> => {
    const viemContract = getContract({
        address: addressParser(chainName).normalizedToNativeString(address),
        abi,
        client: viemClient,
    });
    return viemContract;
};

export const getEnhancedContract = <abi extends Abi>(
    chainName: InferChainNamesForChainType<ChainType.EVM>,
    address: NormalizedHexString,
    viemClient: PublicClient,
    abi: abi,
): EnhancedContract<abi> => {
    const viemContract = getViemContract(chainName, address, viemClient, abi);
    return enhanceContractObject(viemContract, abi);
};

export type EnhancedContractGetter<abi extends Abi> = (
    chainName: InferChainNamesForChainType<ChainType.EVM>,
    address: NormalizedHexString,
    viemClient: PublicClient,
) => EnhancedContract<abi>;

export const enhancedContractGetter =
    <abi extends Abi>(abi: abi): EnhancedContractGetter<abi> =>
    (
        chainName: InferChainNamesForChainType<ChainType.EVM>,
        address: NormalizedHexString,
        viemClient: PublicClient,
    ) =>
        getEnhancedContract<abi>(chainName, address, viemClient, abi);

export type AddressResolvingContractGetter<abi extends Abi> = (
    chainName: InferChainNamesForChainType<ChainType.EVM>,
    environment: Environment,
    viemClient: PublicClient,
) => EnhancedContract<abi>;

export const addressResolvingContractGetter =
    <abi extends Abi>(
        addressResolver: (
            chainName: InferChainNamesForChainType<ChainType.EVM>,
            environment: Environment,
        ) => NormalizedHexString,
        contractGetter: EnhancedContractGetter<abi>,
    ): AddressResolvingContractGetter<abi> =>
    (
        chainName: InferChainNamesForChainType<ChainType.EVM>,
        environment: Environment,
        viemClient: PublicClient,
    ): EnhancedContract<abi> => {
        const resolvedAddress = addressResolver(chainName, environment);
        return contractGetter(chainName, resolvedAddress, viemClient);
    };

export type ExtractFunction<
    abi extends Abi,
    functionName extends ContractFunctionName<abi>,
> = abi[number] extends infer AbiItem
    ? AbiItem extends AbiFunction
        ? AbiItem['name'] extends functionName
            ? AbiItem
            : never
        : never
    : never;

export const getAbiFunction = <abi extends Abi, functionName extends ContractFunctionName<abi>>(
    abi: abi,
    functionName: functionName,
): ExtractFunction<abi, functionName> => {
    return abi.map((a) => a as AbiFunction).find((a) => a.name === functionName) as ExtractFunction<
        abi,
        functionName
    >;
};

export type ExtractEvent<
    abi extends Abi,
    eventName extends ContractEventName<abi>,
> = abi[number] extends infer AbiItem
    ? AbiItem extends AbiEvent
        ? AbiItem['name'] extends eventName
            ? AbiItem
            : never
        : never
    : never;

export const getAbiEvent = <abi extends Abi, eventName extends ContractEventName<abi>>(
    abi: abi,
    eventName: eventName,
): ExtractEvent<abi, eventName> => {
    return abi.map((a) => a as AbiEvent).find((a) => a.name === eventName) as ExtractEvent<
        abi,
        eventName
    >;
};

type GenerateGetDeployDataOptions = {
    isZkChain: boolean;
};

export const generateGetDeployData = <const abi extends Abi>(
    abi: abi,
    bytecode: Hex,
    options: GenerateGetDeployDataOptions,
): ((...args: ExtractConstructorArgs<abi>) => Hex) => {
    return (...args: ExtractConstructorArgs<abi>): Hex => {
        const { inputs } = (abi.find(({ type }) => type === 'constructor') ?? {
            inputs: [],
        }) as AbiFunction;

        const constructorArgs = (args as unknown[])[0] as Record<string, unknown> | undefined;
        const data = options.isZkChain
            ? encodeDeployDataZk<Abi>({
                  abi,
                  bytecode,
                  args: inputs.map(
                      (input, index: number) => constructorArgs?.[input.name || `${index}_inputs`],
                  ),
              })
            : encodeDeployData<Abi>({
                  abi,
                  bytecode,
                  args: inputs.map(
                      (input, index: number) => constructorArgs?.[input.name || `${index}_inputs`],
                  ),
              });

        if (!data || data === '0x') {
            throw new Error(
                'Failed to generate encoded deploy data: the contract is either invalid or abstract (possibly missing a concrete implementation or deployable bytecode).',
            );
        }

        return data;
    };
};

export const generateEncodeFunctionData = <const abi extends Abi>(
    abi: abi,
): (<functionName extends ContractFunctionName<abi>>(
    functionName: functionName,
    ...args: ExtractFunctionArgs<abi, functionName>
) => Hex) => {
    return <functionName extends ContractFunctionName<abi>>(
        functionName: functionName,
        ...args: ExtractFunctionArgs<abi, functionName>
    ): Hex => {
        const functionAbi = abi.find(
            (item) => item.type === 'function' && item.name === functionName,
        ) as AbiFunction | undefined;

        const inputs = functionAbi?.inputs ?? [];
        const functionArgs = (args as unknown[])[0] as Record<string, unknown> | undefined;

        // Note: Unlike encodeDeployData, encodeFunctionData is the same for both EVM and zkSync
        const data = encodeFunctionData<Abi>({
            abi,
            functionName: functionName as string,
            args: inputs.map(
                (input, index: number) => functionArgs?.[input.name || `${index}_inputs`],
            ),
        });

        return data;
    };
};

type ReceiptLookupTransaction = {
    result: TransactionResult;
    inflightTransactions?: { txHash: string }[];
};

export const getReceiptWithFallback = async (
    transaction: ReceiptLookupTransaction,
    viemClient: PublicClient,
): Promise<TransactionReceipt | null> => {
    if (transaction.result.type !== 'success') {
        return null;
    }

    const receipt = await viemClient
        .getTransactionReceipt({ hash: ensure0xPrefixed(transaction.result.minedTxHash) })
        // Sometime the chain reorgs and we get another transaction
        .catch(async () => {
            const potentialReorgedTxHash: string[] = (transaction.inflightTransactions ?? []).map(
                (t) => t.txHash,
            );
            return raceToSuccess(
                potentialReorgedTxHash.map(async (txHash: string) => {
                    return viemClient.getTransactionReceipt({
                        hash: ensure0xPrefixed(txHash),
                    });
                }),
            );
        });

    return receipt;
};

/**
 * Gets the successful deployment info from a transaction result.
 * Returns null if the deployment was not successful.
 */
export const getSuccessfulDeploymentInfo = async (
    transaction: TransactionWithResult | undefined,
    viemClient: PublicClient,
): Promise<{
    receipt: TransactionReceipt;
    code: Hex;
    result: TransactionWithResult['result'];
} | null> => {
    if (transaction?.result.type !== 'success') {
        return null;
    }

    const receipt = await viemClient.getTransactionReceipt({
        hash: ensure0xPrefixed(transaction.result.minedTxHash),
    });

    if (receipt.status !== 'success' || !receipt.contractAddress) {
        return null;
    }

    const code = await viemClient.getCode({
        address: receipt.contractAddress,
    });

    if (!code || code === '0x') {
        return null;
    }

    return {
        receipt,
        code,
        result: transaction.result,
    };
};
