import { normalizeIotaAddress } from '@iota/iota-sdk/utils';
import type {
    CoinStruct,
    GetObjectParams,
    GetTransactionBlockParams,
    SuiObjectChange,
    SuiObjectDataOptions,
    SuiTransactionBlockResponseOptions,
} from '@mysten/sui/client';
import { fromBase64, normalizeSuiAddress, parseStructTag } from '@mysten/sui/utils';

import { ChainName } from '@layerzerolabs/layerzero-definitions';
import type {
    AllRequired,
    MaybePartial,
    Prettify,
    RemoveNever,
} from '@layerzerolabs/typescript-utils';

import { SuiMoveAbortError, SuiMoveUnclassifiedError } from './error';
import type { SuiMoveProvider } from './provider';
import type { SuiMoveTransaction } from './transaction';
import type {
    SuiMoveEvent,
    SuiMoveExecutionResult,
    SuiMoveObjectResponse,
    SuiMoveTransactionBlockResponse,
    SuiMoveViewResult,
} from './types';

const MOCK_SENDER = '0x1234567890123456789012345678901234567890123456789012345678901234';

export interface MatchQuery {
    type: string;
    check: 'includes' | 'startsWith' | 'endsWith' | 'equals' | 'regex';
}

type FullObjectOptions = AllRequired<SuiObjectDataOptions>;
type FullBlockResponseOptions = AllRequired<SuiTransactionBlockResponseOptions>;

type ObjectChangeTypes = SuiObjectChange['type'];
type ObjectChangeTypesOptions = {
    [K in ObjectChangeTypes as `show${Capitalize<K>}`]?: boolean;
};

type ObjectChangeTypeResults<Options extends ObjectChangeTypesOptions> = Prettify<
    RemoveNever<{
        [K in ObjectChangeTypes]: `show${Capitalize<K>}` extends keyof Options
            ? Options[`show${Capitalize<K>}`] extends true
                ? Extract<SuiObjectChange, { type: K }>[]
                : never
            : never;
    }>
>;

const objectOptionKeys: (keyof FullObjectOptions)[] = [
    'showBcs',
    'showContent',
    'showType',
    'showDisplay',
    'showOwner',
    'showPreviousTransaction',
    'showStorageRebate',
] as const;

const blockResponseOptionsKeys: (keyof FullBlockResponseOptions)[] = [
    'showBalanceChanges',
    'showEffects',
    'showEvents',
    'showObjectChanges',
    'showRawEffects',
] as const;

type OptionsValidated<
    FullOptions extends Record<string, any>,
    CurrentOptions extends Record<string, any>,
    Data extends Record<string, any>,
> = Prettify<
    RemoveNever<{
        [key in keyof AllRequired<Data>]: key extends string
            ? `show${Capitalize<key>}` extends keyof FullOptions
                ? CurrentOptions[`show${Capitalize<key>}`] extends true
                    ? NonNullable<Data[key]>
                    : never
                : Data[key]
            : never;
    }>
>;

const validateOptions = <
    FullOptions extends Record<string, any>,
    Options extends Record<string, any>,
    Data extends Record<string, any>,
>(
    data: Data,
    fullOptionKeys: string[],
    options?: Options,
): OptionsValidated<FullOptions, Options, Data> => {
    // check inclusion of all options
    fullOptionKeys.forEach((option) => {
        // Remove 'show' prefix and convert first letter to lowercase for camelCase
        const fieldName = option.slice('show'.length);
        const field = fieldName.charAt(0).toLowerCase() + fieldName.slice(1);
        if (options?.[option] && !data[field]) {
            throw new Error(`Missing required field ${field} on data object ${data}`);
        }
    });

    // check validity of inclusions:
    return Object.fromEntries(
        Object.entries(data).map(([key, value]) => {
            for (const option of fullOptionKeys) {
                // Convert option to expected field name
                const fieldName = option.slice('show'.length);
                const expectedField = fieldName.charAt(0).toLowerCase() + fieldName.slice(1);
                if (expectedField === key && options?.[option] && !value) {
                    throw new Error(
                        `Failed fetching data for option ${option} on object ${data.objectId}`,
                    );
                }
            }
            return [key, value];
        }),
    ) as OptionsValidated<FullObjectOptions, Options, Data>;
};

export const checkInclusion = (objectType: string, query: MatchQuery) => {
    const check = query.check;
    const type = query.type;
    switch (check) {
        case 'includes':
            return objectType.includes(type);
        case 'startsWith':
            return objectType.startsWith(type);
        case 'endsWith':
            return objectType.endsWith(type);
        case 'equals':
            return objectType === type;
        case 'regex':
            return new RegExp(type).test(objectType);
        default:
            throw new Error(`Unknown check type: ${check}`);
    }
};

export const filterObjectChanges = <Options extends ObjectChangeTypesOptions>(
    objectChanges: SuiObjectChange[],
    query: MatchQuery | 'all',
    options?: Options,
): ObjectChangeTypeResults<Options> => {
    const result = {} as ObjectChangeTypeResults<Options>;
    type key = keyof ObjectChangeTypeResults<Options>;
    const capitalize = (s: string) => s.slice(0, 1).toUpperCase() + s.slice(1);

    for (const objectChange of objectChanges) {
        // Published has packageId
        if (objectChange.type === 'published') {
            if (
                options?.showPublished &&
                (query === 'all' || checkInclusion(objectChange.packageId, query))
            ) {
                // TODO: consider removing `as` casts
                result['published' as key] ??= [] as any;
                result['published' as key].push(objectChange as any);
            }
        } else {
            // Everyone else has objectType
            const show = `show${capitalize(objectChange.type)}` as keyof Options;
            if (
                options?.[show] &&
                (query === 'all' || checkInclusion(objectChange.objectType, query))
            ) {
                // TODO: consider removing `as` casts
                result[objectChange.type as key] ??= [] as any;
                result[objectChange.type as key].push(objectChange as any);
            }
        }
    }

    return result;
};

/**
 * Converts raw Sui move events to SuiMoveEvent format
 */
export const convertToSuiMoveEvents = (rawEvents: any[]): SuiMoveEvent[] => {
    return rawEvents.map((event) => ({
        type: event.type,
        data: event.parsedJson,
        txHash: event.id.txDigest,
    }));
};

export function handleError(e: string): unknown {
    if (e.includes('ExecutionError')) {
        const majorStatusMatch = e.match(/major_status:\s([A-Z_]+)/);
        if (majorStatusMatch !== null) {
            const major_status = majorStatusMatch[1];
            if (major_status === 'ABORTED') {
                const subStatusMatch = e.match(/sub_status:\sSome\((\d+)\)/);
                if (subStatusMatch === null) {
                    return new SuiMoveAbortError(Number.NEGATIVE_INFINITY, e);
                } else {
                    return new SuiMoveAbortError(Number(subStatusMatch[1]), e);
                }
            }
        } else {
            return new SuiMoveUnclassifiedError(e);
        }
    }
    return new Error(e);
}

export async function suiMoveViewMultiResult(
    client: SuiMoveProvider,
    tx: SuiMoveTransaction,
    resultIndex: number[],
): Promise<SuiMoveViewResult[][]> {
    const { results, error } = await client.devInspectSuiMoveTransactionBlock({
        transactionBlock: tx,
        sender: MOCK_SENDER,
    });

    if (error != undefined && error != null) {
        throw handleError(error);
    }
    if (results === undefined || results === null) {
        throw new Error('No results found');
    }

    const selectedResults: SuiMoveExecutionResult[] = resultIndex.map((idx) => {
        return results[idx];
    });

    return selectedResults.map((result) => {
        if (result.returnValues === undefined) {
            throw new Error('No return values found');
        }
        return result.returnValues.map((result) => {
            return {
                value:
                    typeof result[0] === 'string'
                        ? fromBase64(result[0])
                        : new Uint8Array(result[0]),
                type: result[1],
            };
        });
    });
}

export async function suiMoveView(
    suiClient: SuiMoveProvider,
    tx: SuiMoveTransaction,
): Promise<SuiMoveViewResult[]> {
    const results = await suiMoveViewMultiResult(suiClient, tx, [
        tx.getData().commands.length - 1, // last command
    ]);
    return results[0];
}

export async function suiMoveViewParsed<T>({
    client,
    tx,
    parser,
}: {
    client: SuiMoveProvider;
    tx: SuiMoveTransaction;
    parser: (result: { value: Uint8Array }[]) => T;
}): Promise<T> {
    const results = await suiMoveViewMultiResult(client, tx, [
        tx.getData().commands.length - 1, // last command
    ]);
    return parser(results[0]);
}

/**
 * Returns the defining package ID for a given object type. This is the package
 * that defined the object's Move type at the time the object was created.
 *
 * @param objectType The object type, e.g. 0xc6b8aab4e0124a27071228cb4c2b422344cb13574a9641ed0d9177c7111ed7::my_coin::MY_COIN
 * @returns The defining package ID, e.g. 0xc6b8aab4e0124a27071228cb4c2b422344cb13574a9641ed0d9177c7111ed7
 */
export function getDefiningPackageIdFromObjectType(
    chainName: ChainName,
    objectType: string,
): string {
    const address = parseStructTag(objectType).address;
    return normalizeSuiMoveAddress(address, chainName);
}

export async function getSuiMoveObjectValidated<const Options extends SuiObjectDataOptions>(
    args: Omit<GetObjectParams, 'options'> & { options?: Options; client: SuiMoveProvider },
): Promise<
    OptionsValidated<FullObjectOptions, Options, NonNullable<SuiMoveObjectResponse['data']>>
> {
    const object = await args.client.getSuiMoveObject(args);
    if (object.error) {
        throw new Error(`Failed to get object ${args.id}`, { cause: object.error });
    } else if (!object.data) {
        throw new Error(`Object not found: ${args.id}`);
    }

    return validateOptions<FullObjectOptions, Options, NonNullable<SuiMoveObjectResponse['data']>>(
        object.data,
        objectOptionKeys,
        args.options,
    );
}

export async function getSuiMoveTransactionBlockValidated<
    const Options extends SuiTransactionBlockResponseOptions,
>(
    args: Omit<GetTransactionBlockParams, 'options'> & {
        options?: Options;
        client: SuiMoveProvider;
    },
): Promise<OptionsValidated<FullBlockResponseOptions, Options, SuiMoveTransactionBlockResponse>> {
    const txBlock = await args.client.getSuiMoveTransactionBlock(args);
    if (txBlock.errors?.length) {
        throw new Error(`Couldn't fetch transaction block due to errors: ${txBlock.errors}`);
    }

    return validateOptions<FullBlockResponseOptions, Options, SuiMoveTransactionBlockResponse>(
        txBlock,
        blockResponseOptionsKeys,
        args.options,
    );
}

/**
 * Fetches all owned coins that have the specified package id
 * @param chainName chainName to denormalize the addresses
 * @param normalizedCoinPackageId Coin package id to search for
 * @param normalizedWalletAddress Wallet address to search for coins on
 * @returns Array of all found coin objects, sorted by balance
 */
export async function searchForCoinTypeInWallet(
    chainName: ChainName,
    coinPackageId: string,
    walletAddress: string,
    client: SuiMoveProvider,
): Promise<CoinStruct[]> {
    let cursor: string | undefined | null = undefined;
    let hasNextPage = true;
    let coinObjects = [] as CoinStruct[];

    while (hasNextPage) {
        const coins = await client.getAllSuiMoveCoins({
            owner: walletAddress,
            limit: 50,
            cursor,
        });

        // Sui has its own normalization for addresses that we need to use to compare addresses
        const normalizedCoinPackageId = normalizeSuiMoveAddress(coinPackageId, chainName);

        const matchedCoins = coins.data.filter((coin) => {
            const coinType = coin.coinType;
            const definingPackageId = getDefiningPackageIdFromObjectType(chainName, coinType);
            return definingPackageId === normalizedCoinPackageId;
        });

        coinObjects = coinObjects.concat(matchedCoins);
        cursor = coins.nextCursor;
        hasNextPage = coins.hasNextPage;
    }
    return coinObjects.sort((a, b) => Number(BigInt(b.balance) - BigInt(a.balance)));
}

export async function getSuiMoveOwnedObjectsByType<
    T extends Record<string, MatchQuery>,
    Options extends SuiObjectDataOptions,
    AllowPartial extends boolean = false,
>({
    walletAddress,
    typeInclusions,
    options,
    client,
}: {
    walletAddress: string;
    typeInclusions: T;
    options?: Omit<Options, 'showType'> & { allowPartial?: AllowPartial };
    client: SuiMoveProvider;
}): Promise<
    Record<
        keyof T,
        MaybePartial<
            OptionsValidated<
                FullObjectOptions,
                Options & { showType: true },
                NonNullable<SuiMoveObjectResponse['data']>
            >[],
            AllowPartial
        >
    >
> {
    let cursor: string | undefined | null = undefined;
    let hasNextPage = true;
    const result = {} as Record<
        keyof T,
        OptionsValidated<
            FullObjectOptions,
            Options & { showType: true },
            NonNullable<SuiMoveObjectResponse['data']>
        >[]
    >;
    const typeInclusionsArray = Object.entries(typeInclusions);

    while (hasNextPage) {
        const objects = await client.getSuiMoveOwnedObject({
            owner: walletAddress,
            options: {
                ...options,
                showType: true,
            },
            cursor,
            limit: 50,
        });
        for (const object of objects.data) {
            if (!object.data) continue;
            const objectType = object.data.type;
            if (!objectType) {
                continue;
            }
            for (const [key, query] of typeInclusionsArray) {
                if (checkInclusion(objectType, query)) {
                    const validated = validateOptions<
                        FullObjectOptions,
                        Options,
                        NonNullable<SuiMoveObjectResponse['data']>
                    >(object.data, objectOptionKeys, options as Options | undefined);
                    result[key as keyof T] ??= [];
                    result[key as keyof T].push(validated);
                }
            }
        }
        cursor = objects.nextCursor;
        hasNextPage = objects.hasNextPage;
    }

    if (!options?.allowPartial && Object.keys(result).length !== typeInclusionsArray.length) {
        const difference = new Set(typeInclusionsArray.map(([k]) => k));
        Object.keys(result).forEach((key) => difference.delete(key));
        throw new Error(`Couldn't find all objects, missing: ${[...difference]}`);
    }

    return result;
}

export async function getSuiMovePackagePublishObjectChanges<
    Queries extends Record<string, MatchQuery | 'all'>,
    ChangeOptions extends ObjectChangeTypesOptions,
>({
    packageId,
    queries,
    options,
    client,
}: {
    packageId: string;
    queries: Queries;
    client: SuiMoveProvider;
    options?: ChangeOptions;
}): Promise<Record<keyof Queries, ObjectChangeTypeResults<ChangeOptions>>> {
    const pkgObject = await getSuiMoveObjectValidated({
        id: packageId,
        client,
        options: { showPreviousTransaction: true },
    });

    const txBlock = await getSuiMoveTransactionBlockValidated({
        digest: pkgObject.previousTransaction,
        options: { showObjectChanges: true },
        client,
    });

    return Object.fromEntries(
        Object.entries(queries).map(([k, query]) => {
            return [k, filterObjectChanges(txBlock.objectChanges, query, options)];
        }),
    ) as Record<keyof Queries, ObjectChangeTypeResults<ChangeOptions>>;
}

export const normalizeSuiMoveAddress = (address: string, chainName: ChainName) => {
    if (chainName === ChainName.IOTAL1) {
        return normalizeIotaAddress(address);
    }
    return normalizeSuiAddress(address);
};
