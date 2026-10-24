import { describe, expect, it } from 'vitest';

import { bytesToHexPrefixed } from '@layerzerolabs/common-encoding-utils';

import { Options } from '../src/options';

const evmAddress = '0x1a44076050125825900e736c501f859c50fE728c';
const evmBytes32 = '0x0000000000000000000000001a44076050125825900e736c501f859c50fe728c';
const stellarBytes32 = `0x${'cd'.repeat(32)}`;

const decodeAll = (options: Options) => ({
    lzReceive: options.decodeExecutorLzReceiveOption(),
    nativeDrop: options.decodeExecutorNativeDropOption(),
    compose: options.decodeExecutorComposeOption(),
    ordered: options.decodeExecutorOrderedExecutionOption(),
    lzRead: options.decodeExecutorLzReadOption(),
});

const everyOption =
    '0x0003010011010000000000000000000000000000006401002101000000000000000000000000000000320000000000000000000000000000000701003102000000000000000000000000000000030000000000000000000000001a44076050125825900e736c501f859c50fe728c01003102000000000000000000000000000000040000000000000000000000001a44076050125825900e736c501f859c50fe728c0100310200000000000000000000000000000009cdcdcdcdcdcdcdcdcdcdcdcdcdcdcdcdcdcdcdcdcdcdcdcdcdcdcdcdcdcdcdcd0100130300020000000000000000000000000000012c010023030000000000000000000000000000000001900000000000000000000000000000000b01002303000200000000000000000000000000000001000000000000000000000000000000010100010401001505000000000000000000000000000003e800000040010025050000000000000000000000000000000100000002000000000000000000000000000000030200020301';

describe('Options builder', () => {
    it('encodes an lzReceive gas limit without native drop', () => {
        expect(Options.newOptions().addExecutorLzReceiveOption(500000, 0).toHex()).toBe(
            '0x0003010011010000000000000000000000000007a120',
        );
    });

    it('encodes lzReceive with value and native drops to bytes32 and EVM receivers', () => {
        const options = Options.newOptions()
            .addExecutorLzReceiveOption(200000n, '1000')
            .addExecutorNativeDropOption(1n, stellarBytes32)
            .addExecutorNativeDropOption(5, evmAddress);
        const expected =
            '0x00030100210100000000000000000000000000030d40000000000000000000000000000003e80100310200000000000000000000000000000001cdcdcdcdcdcdcdcdcdcdcdcdcdcdcdcdcdcdcdcdcdcdcdcdcdcdcdcdcdcdcdcd01003102000000000000000000000000000000050000000000000000000000001a44076050125825900e736c501f859c50fe728c';
        expect(options.toHex()).toBe(expected);
        expect(bytesToHexPrefixed(options.toBytes())).toBe(expected);
    });

    it('encodes an empty options set as the type 3 prefix', () => {
        expect(Options.newOptions().toHex()).toBe('0x0003');
    });

    it('rejects a gas limit above uint128', () => {
        expect(() => Options.newOptions().addExecutorLzReceiveOption(1n << 128n)).toThrow();
    });
});

describe('Options.fromOptions', () => {
    it('sums repeated options and merges native drops by receiver and composes by index', () => {
        const options = Options.fromOptions(everyOption);
        expect(decodeAll(options)).toEqual({
            lzReceive: { gas: 150n, value: 7n },
            nativeDrop: [
                { amount: 7n, receiver: evmBytes32 },
                { amount: 9n, receiver: stellarBytes32 },
            ],
            compose: [
                { index: 0, gas: 400n, value: 11n },
                { index: 2, gas: 301n, value: 1n },
            ],
            ordered: true,
            lzRead: { gas: 1001n, dataSize: 66n, value: 3n },
        });
        expect(options.toHex()).toBe(everyOption);
    });

    it('decodes legacy type 1 options', () => {
        const options = Options.fromOptions(
            '0x0001000000000000000000000000000000000000000000000000000000000001e240',
        );
        expect(decodeAll(options)).toEqual({
            lzReceive: { gas: 123456n, value: 0n },
            nativeDrop: [],
            compose: [],
            ordered: false,
            lzRead: undefined,
        });
        expect(options.toHex()).toBe('0x0003010011010000000000000000000000000001e240');
    });

    it('decodes legacy type 2 options', () => {
        const options = Options.fromOptions(
            '0x0002000000000000000000000000000000000000000000000000000000000000030900000000000000000000000000000000000000000000000000000000000003781a44076050125825900e736c501f859c50fe728c',
        );
        expect(decodeAll(options)).toEqual({
            lzReceive: { gas: 777n, value: 0n },
            nativeDrop: [{ amount: 888n, receiver: evmBytes32 }],
            compose: [],
            ordered: false,
            lzRead: undefined,
        });
        expect(options.toHex()).toBe(
            '0x0003010011010000000000000000000000000000030901003102000000000000000000000000000003780000000000000000000000001a44076050125825900e736c501f859c50fe728c',
        );
    });

    it('decodes nothing from verifier-only and empty options', () => {
        const empty = {
            lzReceive: undefined,
            nativeDrop: [],
            compose: [],
            ordered: false,
            lzRead: undefined,
        };
        expect(decodeAll(Options.fromOptions('0x0003'))).toEqual(empty);
        const verifierOnly = Options.fromOptions('0x000302000201010200020301');
        expect(decodeAll(verifierOnly)).toEqual(empty);
        expect(verifierOnly.toHex()).toBe('0x000302000201010200020301');
    });

    it('rejects truncated options', () => {
        expect(() => Options.fromOptions('0x')).toThrow();
        expect(() => Options.fromOptions('0x0001')).toThrow();
        expect(() => Options.fromOptions('0x0003010000')).toThrow();
        expect(() => Options.fromOptions('0x0003010001').decodeExecutorLzReceiveOption()).toThrow();
        expect(() =>
            Options.fromOptions('0x000301000102').decodeExecutorNativeDropOption(),
        ).toThrow();
    });

    it('reads a compose value only from 34-byte params', () => {
        const gasOnly = `0x000301001503${'00'.repeat(17)}64ffff`;
        expect(Options.fromOptions(gasOnly).decodeExecutorComposeOption()).toEqual([
            { index: 0, gas: 100n, value: 0n },
        ]);
    });
});
