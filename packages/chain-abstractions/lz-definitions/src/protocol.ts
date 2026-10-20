import { z } from 'zod';

export enum UlnVersion {
    V1 = 'V1',
    V2 = 'V2',
    V300 = 'V300', // simpleMessageLib
    V301 = 'V301',
    V302 = 'V302',
    ReadV1002 = 'ReadV1002',
}

export const ulnVersionSchema = z.enum(UlnVersion);

export enum EndpointVersion {
    V1 = 'v1',
    V2 = 'v2',
}

export const endpointVersionSchema = z.enum(EndpointVersion);
