import type { GrpcTypes, SuiGrpcClient } from '@mysten/sui-v2/grpc';
import { RpcError } from '@protobuf-ts/runtime-rpc';
import { describe, expect, it, vi } from 'vitest';

import { isSuiCompatProviderSpecificError, toJsonRpcError } from '../../errors';
import fixture from '../fixtures/wbtcAddressBalance.json';
import {
    getAddressBalanceReservation,
    getReservationByObjectId,
    getReservationsByObjectIds,
} from './coinReservations';

const OWNER = fixture.reservation.owner.AddressOwner;
const COIN_TYPE = fixture.reservation.type.slice('0x2::coin::Coin<'.length, -1);
const RAW_ID = fixture.accumulator.objectId;
const ID = fixture.reservation.objectId;
const INFO = { chainId: fixture.chainId, epoch: BigInt(fixture.epoch) };

const makeClient = () => {
    const raw = {
        ...structuredClone(fixture.accumulator),
        version: BigInt(fixture.accumulator.version),
        previousTransaction: fixture.reservation.previousTransaction,
    };
    const ledgerService = {
        getServiceInfo: vi.fn().mockResolvedValue({ response: INFO }),
        getObject: vi.fn().mockResolvedValue({ response: { object: raw } }),
        batchGetObjects: vi.fn().mockResolvedValue({
            response: { objects: [{ result: { oneofKind: 'object', object: raw } }] },
        }),
    };
    return { raw, ledgerService, grpcClient: { ledgerService } as unknown as SuiGrpcClient };
};

const setBalance = (raw: ReturnType<typeof makeClient>['raw'], balance: string) => {
    raw.json.kind.structValue.fields.value.kind.structValue.fields.value.kind.stringValue = balance;
};

describe('coin reservation helpers', () => {
    it('starts the accumulator read before service metadata resolves', async () => {
        const { grpcClient, ledgerService } = makeClient();
        let resolveInfo!: (value: { response: typeof INFO }) => void;
        ledgerService.getServiceInfo.mockReturnValue(
            new Promise((resolve) => {
                resolveInfo = resolve;
            }),
        );
        const result = getAddressBalanceReservation('getCoins', grpcClient, OWNER, COIN_TYPE);
        expect(ledgerService.getObject).toHaveBeenCalledWith(
            expect.objectContaining({ objectId: RAW_ID }),
            { abort: undefined },
        );
        resolveInfo({ response: INFO });
        expect(await result).toMatchObject({ objectId: ID, digest: fixture.reservation.digest });
    });

    it.each(['1', '@invalid'])(
        'includes method, ID, and invalid chain identifier %s',
        async (chainId) => {
            const { grpcClient, ledgerService } = makeClient();
            ledgerService.getServiceInfo.mockResolvedValue({ response: { ...INFO, chainId } });
            await expect(getReservationByObjectId('getObject', grpcClient, ID)).rejects.toThrow(
                `Sui gRPC compat getObject: invalid reservation chainId=${chainId} for objectId=${ID}`,
            );
        },
    );

    it.each(['18446744073709551616', '-1', 'not-a-number'])(
        'includes rawId, amount, and epoch for an invalid amount %s',
        async (balance) => {
            const { grpcClient, raw } = makeClient();
            setBalance(raw, balance);
            const error = await getAddressBalanceReservation(
                'getCoins',
                grpcClient,
                OWNER,
                COIN_TYPE,
            ).then(
                () => undefined,
                (error: Error) => error,
            );
            expect(error?.message).toContain('Sui gRPC compat getCoins:');
            expect(error?.message).toContain(`rawId=${RAW_ID}`);
            expect(error?.message).toContain(`amount=${balance}`);
            expect(error?.message).toContain(`epoch=${INFO.epoch}`);
        },
    );

    it('includes rawId, amount, and epoch when the epoch exceeds the digest capacity', async () => {
        const { grpcClient, ledgerService } = makeClient();
        ledgerService.getServiceInfo.mockResolvedValue({
            response: { ...INFO, epoch: 4294967296n },
        });
        await expect(
            getAddressBalanceReservation('getCoins', grpcClient, OWNER, COIN_TYPE),
        ).rejects.toThrow(
            `Sui gRPC compat getCoins: reservation amount or epoch out of range; rawId=${RAW_ID}, amount=1061, epoch=4294967296`,
        );
    });

    it('validates JSON structure at runtime and includes malformed content', async () => {
        const { grpcClient, ledgerService, raw } = makeClient();
        const malformed: GrpcTypes.Object = {
            ...raw,
            json: { kind: { oneofKind: 'stringValue', stringValue: 'invalid-json-struct' } },
        };
        ledgerService.getObject.mockResolvedValue({ response: { object: malformed } });
        await expect(
            getAddressBalanceReservation('getCoins', grpcClient, OWNER, COIN_TYPE),
        ).rejects.toThrow(
            `Sui gRPC compat getCoins: invalid reservation accumulator rawId=${RAW_ID}, json="invalid-json-struct"`,
        );
    });

    it('uses the calling method and rawId for missing required object fields', async () => {
        const { grpcClient, ledgerService, raw } = makeClient();
        ledgerService.getObject.mockResolvedValue({
            response: { object: { ...raw, version: undefined } },
        });
        await expect(getReservationByObjectId('getObject', grpcClient, ID)).rejects.toThrow(
            `Sui gRPC compat getObject: expected field to be present: accumulator ${RAW_ID}.version`,
        );
    });

    it('passes the same abort signal to the shared metadata and batch reads', async () => {
        const { grpcClient, ledgerService } = makeClient();
        const signal = new AbortController().signal;
        const reservations = await getReservationsByObjectIds(
            'multiGetObjects',
            grpcClient,
            [ID],
            signal,
        );
        expect(reservations.get(ID)?.digest).toBe(fixture.reservation.digest);
        expect(ledgerService.getServiceInfo).toHaveBeenCalledExactlyOnceWith({}, { abort: signal });
        expect(ledgerService.batchGetObjects).toHaveBeenCalledExactlyOnceWith(
            {
                requests: [{ objectId: RAW_ID }],
                readMask: {
                    paths: ['object_id', 'version', 'object_type', 'json', 'previous_transaction'],
                },
            },
            { abort: signal },
        );
        expect(ledgerService.getObject).not.toHaveBeenCalled();
    });

    it.each([
        [14, -32050],
        [4, -32050],
        [8, -32604],
        [13, -32603],
    ])(
        'preserves provider-specific classification for batch status %i',
        async (code, jsonRpcCode) => {
            const { grpcClient, ledgerService } = makeClient();
            ledgerService.batchGetObjects.mockResolvedValue({
                response: {
                    objects: [
                        {
                            result: {
                                oneofKind: 'error',
                                error: { code, message: 'provider failed' },
                            },
                        },
                    ],
                },
            });
            const error = await getReservationsByObjectIds('multiGetObjects', grpcClient, [
                ID,
            ]).then(
                () => undefined,
                (error: unknown) => error,
            );
            expect(error).toBeInstanceOf(RpcError);
            expect(toJsonRpcError(error)).toMatchObject({
                name: 'SuiCompatProviderSpecificError',
                code: jsonRpcCode,
            });
            expect((error as Error).message).toContain(`rawId=${RAW_ID}`);
            expect((error as Error).message).toContain('Sui gRPC compat multiGetObjects:');
        },
    );

    it('does not classify invalid batch input as a retryable provider failure', async () => {
        const { grpcClient, ledgerService } = makeClient();
        ledgerService.batchGetObjects.mockResolvedValue({
            response: {
                objects: [
                    {
                        result: {
                            oneofKind: 'error',
                            error: { code: 3, message: 'invalid input' },
                        },
                    },
                ],
            },
        });
        const error = await getReservationsByObjectIds('multiGetObjects', grpcClient, [ID]).then(
            () => undefined,
            (error: unknown) => error,
        );
        expect(toJsonRpcError(error).code).toBe(-32602);
        expect(isSuiCompatProviderSpecificError(toJsonRpcError(error))).toBe(false);
    });
});
