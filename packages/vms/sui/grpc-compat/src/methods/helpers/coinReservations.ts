import type { CoinStruct, SuiObjectData, SuiObjectDataOptions } from '@mysten/sui/client';
import { bcs, TypeTagSerializer } from '@mysten/sui-v2/bcs';
import type { GrpcTypes, SuiGrpcClient } from '@mysten/sui-v2/grpc';
import {
    deriveDynamicFieldID,
    fromBase58,
    fromHex,
    normalizeSuiAddress,
    toBase58,
    toHex,
} from '@mysten/sui-v2/utils';
import { RpcError } from '@protobuf-ts/runtime-rpc';

import { assertDefined, protoValueToPlain, toShortStructTag } from '../../utils';
import { GRPC_CODE_NOT_FOUND, grpcStatusName } from './grpcStatus';

type CoinReservationGrpcClient = Pick<SuiGrpcClient, 'ledgerService'>;
interface ReservationContext {
    chainId: string;
    epoch: bigint;
}

interface CoinReservation {
    objectId: string;
    version: string;
    digest: string;
    owner: string;
    coinType: string;
    balance: string;
    previousTransaction: string;
}

const ACCUMULATOR_ROOT_ID = normalizeSuiAddress('0xacc');
const RESERVATION_DIGEST_MAGIC_BYTE = 0xac;
const ACCUMULATOR_READ_MASK = {
    paths: ['object_id', 'version', 'object_type', 'json', 'previous_transaction'],
};

const accumulatorId = (owner: string, coinType: string): string =>
    deriveDynamicFieldID(
        ACCUMULATOR_ROOT_ID,
        TypeTagSerializer.parseFromStr(`0x2::accumulator::Key<0x2::balance::Balance<${coinType}>>`),
        bcs.Address.serialize(owner).toBytes(),
    );

// Sui's legacy reservation protocol: XOR the accumulator ID with the full genesis digest.
// The same operation masks and unmasks; no endpoint-local cache is needed for object reads.
// https://github.com/MystenLabs/sui/blob/main/crates/sui-types/src/coin_reservation.rs
const maskObjectId = (method: string, id: string, chainId: string): string => {
    let mask: Uint8Array;
    try {
        mask = fromBase58(chainId);
    } catch (cause) {
        throw new Error(
            `Sui gRPC compat ${method}: invalid reservation chainId=${chainId} for objectId=${id}`,
            { cause },
        );
    }
    if (mask.length !== 32) {
        throw new Error(
            `Sui gRPC compat ${method}: invalid reservation chainId=${chainId} for objectId=${id}; expected 32 bytes, received ${mask.length}`,
        );
    }
    const bytes = fromHex(normalizeSuiAddress(id));
    return `0x${toHex(bytes.map((byte, i) => byte ^ mask[i]!))}`;
};

const getReservationContext = async (
    method: string,
    grpcClient: CoinReservationGrpcClient,
    signal?: AbortSignal,
): Promise<ReservationContext> => {
    const { response } = await grpcClient.ledgerService.getServiceInfo({}, { abort: signal });
    return {
        chainId: assertDefined(response.chainId, method, 'getServiceInfo.chainId'),
        epoch: assertDefined(response.epoch, method, 'getServiceInfo.epoch'),
    };
};

const readAccumulator = async (
    grpcClient: CoinReservationGrpcClient,
    rawId: string,
    signal?: AbortSignal,
): Promise<GrpcTypes.Object | undefined> => {
    try {
        const { response } = await grpcClient.ledgerService.getObject(
            { objectId: rawId, readMask: ACCUMULATOR_READ_MASK },
            { abort: signal },
        );
        return response.object;
    } catch (error) {
        if (error instanceof RpcError && error.code === 'NOT_FOUND') {
            return undefined;
        }
        throw error;
    }
};

const isRecord = (value: unknown): value is Record<string, unknown> =>
    typeof value === 'object' && value !== null && !Array.isArray(value);

/** Convert a verified accumulator into the legacy, epoch-bound coin reservation. */
const toCoinReservation = (
    method: string,
    rawId: string,
    raw: GrpcTypes.Object | undefined,
    { chainId, epoch }: ReservationContext,
): CoinReservation | undefined => {
    if (!raw) {
        return undefined;
    }
    const coinType = toShortStructTag(raw.objectType ?? '').match(
        /^0x2::dynamic_field::Field<0x2::accumulator::Key<0x2::balance::Balance<(.+)>>, 0x2::accumulator::U128>$/,
    )?.[1];
    if (!coinType) {
        return undefined;
    }
    const json = protoValueToPlain(raw.json, method);
    const owner = isRecord(json) && isRecord(json.name) ? json.name.address : undefined;
    const balance = isRecord(json) && isRecord(json.value) ? json.value.value : undefined;
    if (typeof owner !== 'string' || typeof balance !== 'string') {
        throw new Error(
            `Sui gRPC compat ${method}: invalid reservation accumulator rawId=${rawId}, json=${JSON.stringify(json)}`,
        );
    }
    // A similarly typed dynamic field under any other root is not a balance accumulator.
    if (accumulatorId(owner, coinType) !== rawId) {
        return undefined;
    }
    if (!/^[0-9]+$/.test(balance)) {
        throw new Error(
            `Sui gRPC compat ${method}: invalid reservation amount=${balance}, epoch=${epoch}, rawId=${rawId}`,
        );
    }
    const amount = BigInt(balance);
    // Sui's get_address_balance_coin_info returns no synthetic object once the funds are spent.
    if (amount === 0n) {
        return undefined;
    }
    if (amount > 0xffffffffffffffffn || epoch < 0n || epoch > 0xffffffffn) {
        throw new Error(
            `Sui gRPC compat ${method}: reservation amount or epoch out of range; rawId=${rawId}, amount=${amount}, epoch=${epoch}`,
        );
    }
    const digest = new Uint8Array(32).fill(RESERVATION_DIGEST_MAGIC_BYTE);
    const view = new DataView(digest.buffer);
    view.setBigUint64(0, amount, true);
    view.setUint32(8, Number(epoch), true);
    return {
        objectId: maskObjectId(method, rawId, chainId),
        version: assertDefined(raw.version, method, `accumulator ${rawId}.version`).toString(),
        digest: toBase58(digest),
        owner,
        coinType,
        balance,
        previousTransaction: assertDefined(
            raw.previousTransaction,
            method,
            `accumulator ${rawId}.previousTransaction`,
        ),
    };
};

export const getAddressBalanceReservation = async (
    method: string,
    grpcClient: CoinReservationGrpcClient,
    owner: string,
    coinType: string,
    signal?: AbortSignal,
): Promise<CoinReservation | undefined> => {
    const rawId = accumulatorId(owner, coinType);
    // Deriving this ID does not depend on chain metadata, so these reads are independent.
    const [context, raw] = await Promise.all([
        getReservationContext(method, grpcClient, signal),
        readAccumulator(grpcClient, rawId, signal),
    ]);
    return toCoinReservation(method, rawId, raw, context);
};

export const getReservationByObjectId = async (
    method: string,
    grpcClient: CoinReservationGrpcClient,
    objectId: string,
    signal?: AbortSignal,
): Promise<CoinReservation | undefined> => {
    const context = await getReservationContext(method, grpcClient, signal);
    const rawId = maskObjectId(method, objectId, context.chainId);
    const raw = await readAccumulator(grpcClient, rawId, signal);
    return toCoinReservation(method, rawId, raw, context);
};

/** At most two additional RPCs for all missing IDs in a multiGetObjects batch. */
export const getReservationsByObjectIds = async (
    method: string,
    grpcClient: CoinReservationGrpcClient,
    objectIds: string[],
    signal?: AbortSignal,
): Promise<Map<string, CoinReservation>> => {
    const reservations = new Map<string, CoinReservation>();
    if (objectIds.length === 0) {
        return reservations;
    }
    const context = await getReservationContext(method, grpcClient, signal);
    const rawIds = objectIds.map((id) => maskObjectId(method, id, context.chainId));
    const { response } = await grpcClient.ledgerService.batchGetObjects(
        { requests: rawIds.map((objectId) => ({ objectId })), readMask: ACCUMULATOR_READ_MASK },
        { abort: signal },
    );
    for (const [index, objectId] of objectIds.entries()) {
        const result = response.objects[index]?.result;
        if (result?.oneofKind === 'error' && result.error.code === GRPC_CODE_NOT_FOUND) {
            continue;
        }
        if (result?.oneofKind !== 'object') {
            const status = result?.oneofKind === 'error' ? result.error : undefined;
            throw new RpcError(
                `Sui gRPC compat ${method}: reservation batchGetObjects failed for objectId=${objectId}, rawId=${rawIds[index]}, code=${status?.code ?? 'unknown'}: ${status?.message ?? 'no result'}`,
                grpcStatusName(status?.code),
            );
        }
        const reservation = toCoinReservation(method, rawIds[index]!, result.object, context);
        if (reservation) {
            reservations.set(objectId, reservation);
        }
    }
    return reservations;
};

export const toReservationCoin = (reservation: CoinReservation): CoinStruct => ({
    coinObjectId: reservation.objectId,
    coinType: reservation.coinType,
    balance: reservation.balance,
    digest: reservation.digest,
    version: reservation.version,
    previousTransaction: reservation.previousTransaction,
});

export const toReservationObjectData = (
    reservation: CoinReservation,
    options: SuiObjectDataOptions | null | undefined,
): SuiObjectData => {
    const { objectId, version, digest, owner, coinType, balance, previousTransaction } =
        reservation;
    const type = `0x2::coin::Coin<${coinType}>`;
    return {
        objectId,
        version,
        digest,
        type: options?.showType ? type : undefined,
        owner: options?.showOwner ? { AddressOwner: owner } : undefined,
        content: options?.showContent
            ? {
                  dataType: 'moveObject',
                  type,
                  hasPublicTransfer: true,
                  fields: { id: { id: objectId }, balance },
              }
            : undefined,
        previousTransaction: options?.showPreviousTransaction ? previousTransaction : undefined,
        storageRebate: options?.showStorageRebate ? '0' : undefined,
    };
};
