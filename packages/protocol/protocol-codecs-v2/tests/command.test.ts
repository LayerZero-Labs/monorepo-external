import { describe, expect, it } from 'vitest';

import {
    Command,
    ComputeEVM,
    ComputeHeader,
    ComputeSetting,
    ComputeType,
    Header,
    RequestHeader,
    ResolverType,
    SingleViewFunctionEVMCall,
    TimestampBlockConfiguration,
} from '../src/command';

const request = new SingleViewFunctionEVMCall(
    new RequestHeader(1, 'abcd', ResolverType.SingleViewFunctionEVMCall, 37),
    30101,
    TimestampBlockConfiguration.Timestamp,
    5,
    '1234567890abcdef1234567890abcdef12345678',
    'abcd',
    1627502400n,
);
const compute = new ComputeEVM(
    new ComputeHeader(1, ComputeType.SingleViewFunctionEVMCall, ComputeSetting.MapReduce),
    30110,
    TimestampBlockConfiguration.BlockNumber,
    10,
    'abcdefabcdefabcdefabcdefabcdefabcdefabcd',
    undefined,
    1234567890n,
);
const requestHex =
    '00010001000101abcd000100250000759500000000006101b74000051234567890abcdef1234567890abcdef12345678abcd';
const computeHex = '010001020000759e0100000000499602d2000aabcdefabcdefabcdefabcdefabcdefabcdefabcd';

describe('Command', () => {
    it('encodes a command with one request and no compute', () => {
        expect(new Command(new Header(1, '0001', 1), [request]).encode()).toBe(requestHex);
    });

    it('encodes a command with a compute', () => {
        expect(new Command(new Header(1, '0001', 1), [request], compute).encode()).toBe(
            requestHex + computeHex,
        );
    });

    it('decodes what it encodes', () => {
        const decoded = Command.decode(requestHex + computeHex);
        expect(decoded.header).toMatchObject({ globalVersion: 1, appCommandLabel: '0001' });
        expect(decoded.requests).toHaveLength(1);
        expect(decoded.requests[0]).toMatchObject({
            targetEid: 30101,
            timestamp: 1627502400n,
            blockNumber: undefined,
            to: '1234567890abcdef1234567890abcdef12345678',
            calldata: 'abcd',
        });
        expect(decoded.compute).toMatchObject({
            computeHeader: { computeSetting: ComputeSetting.MapReduce },
            targetEid: 30110,
            blockNumber: 1234567890n,
        });
        expect(decoded.encode()).toBe(requestHex + computeHex);
        expect(Command.decode(requestHex).compute).toBeUndefined();
    });

    it('measures a compute as its header plus its EVM fields', () => {
        expect(compute.getByteLength()).toBe(4 + 35);
    });

    it('rejects an unknown resolver type', () => {
        const unknownResolver = `${requestHex.slice(0, 18)}0002${requestHex.slice(22)}`;
        expect(() => Command.decode(unknownResolver)).toThrow('Invalid resolver type');
    });

    it('rejects a requestSize that does not match the calldata', () => {
        const bad = new SingleViewFunctionEVMCall(
            new RequestHeader(1, 'abcd', ResolverType.SingleViewFunctionEVMCall, 35),
            30101,
            TimestampBlockConfiguration.Timestamp,
            5,
            '1234567890abcdef1234567890abcdef12345678',
            'abcdef',
            1627502400n,
        );
        expect(() => bad.encode()).toThrow('requestSize 35');
    });

    it('rejects values that do not fit their field', () => {
        const overflow = new SingleViewFunctionEVMCall(
            new RequestHeader(1, 'abcd', ResolverType.SingleViewFunctionEVMCall, 37),
            30101,
            TimestampBlockConfiguration.Timestamp,
            70000,
            '1234567890abcdef1234567890abcdef12345678',
            'abcd',
            1627502400n,
        );
        expect(() => overflow.encode()).toThrow('does not fit in 2 bytes');
        expect(() => new Header(-1, '0001', 1).encode()).toThrow('does not fit');
    });

    it('rejects 0x-prefixed or too-long hex fields', () => {
        const prefixed = new SingleViewFunctionEVMCall(
            new RequestHeader(1, 'abcd', ResolverType.SingleViewFunctionEVMCall, 37),
            30101,
            TimestampBlockConfiguration.Timestamp,
            5,
            '0x1234567890abcdef1234567890abcdef12345678',
            'abcd',
            1627502400n,
        );
        expect(() => prefixed.encode()).toThrow('not unprefixed hex');
        expect(() => new Header(1, '000001', 1).encode()).toThrow('longer than 2 bytes');
    });

    it('rejects a timestamp/block flag that does not match the value set', () => {
        const mismatch = new SingleViewFunctionEVMCall(
            new RequestHeader(1, 'abcd', ResolverType.SingleViewFunctionEVMCall, 37),
            30101,
            TimestampBlockConfiguration.BlockNumber,
            5,
            '1234567890abcdef1234567890abcdef12345678',
            'abcd',
            1700000000n,
        );
        expect(() => mismatch.encode()).toThrow('timestampBlockFlag');
    });

    it('rejects commands ReadCmdCodecV1 rejects', () => {
        expect(() => Command.decode(`${requestHex}${computeHex}deadbeef`)).toThrow(
            'trailing bytes',
        );
        expect(() => Command.decode(`000100010000${computeHex}`)).toThrow('no requests');
        expect(() => Command.decode(requestHex.slice(0, -2))).toThrow('Command ends');
        expect(() => Command.decode(`0002${requestHex.slice(4)}`)).toThrow(
            'Invalid command version 2',
        );
        expect(() => Command.decode(`${requestHex.slice(0, 12)}02${requestHex.slice(14)}`)).toThrow(
            'Invalid request version 2',
        );
        expect(() => Command.decode(`${requestHex}02${computeHex.slice(2)}`)).toThrow(
            'Invalid compute version 2',
        );
        expect(() =>
            Command.decode(`${requestHex}${computeHex.slice(0, 6)}03${computeHex.slice(8)}`),
        ).toThrow('Invalid compute setting 3');
    });

    it('rejects bytes that are not hex', () => {
        expect(() =>
            Command.decode(`${requestHex.slice(0, 22)}0z25${requestHex.slice(26)}`),
        ).toThrow('not hex');
    });

    it('rejects a requestCount that does not match the requests', () => {
        expect(() => new Command(new Header(1, '0001', 2), [request]).encode()).toThrow(
            'requestCount 2',
        );
        expect(() => new Command(new Header(1, '0001', 0), []).encode()).toThrow('no requests');
    });

    it('reads a flag other than 1 as a timestamp, as ReadCmdCodecV1 does', () => {
        const flag2 = `${requestHex.slice(0, 34)}02${requestHex.slice(36)}`;
        expect(Command.decode(flag2).requests[0]).toMatchObject({
            timestampBlockFlag: 2,
            timestamp: 1627502400n,
            blockNumber: undefined,
        });
        expect(Command.decode(flag2).encode()).toBe(flag2);
    });
});
