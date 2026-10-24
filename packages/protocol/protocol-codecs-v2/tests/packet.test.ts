import { describe, expect, it } from 'vitest';

import { bytesToHexPrefixed, hexToBytes } from '@layerzerolabs/common-encoding-utils';

import {
    addressToBytes32,
    calculatePacketGuid,
    type Packet,
    PacketSerializer,
    PacketV1Codec,
} from '../src/packet';

const evmAddress = '0x1a44076050125825900e736c501f859c50fE728c';
const solanaAddress = '7a4WjyR8VZ7yZz5XJAKm39BUGn5iT9CKcv2pjhqWzY3h';

const header = {
    version: 1,
    nonce: '12345678901234',
    srcEid: 30101,
    sender: evmAddress,
    dstEid: 30168,
    receiver: solanaAddress,
};
const guid = '0x0b2afc8dd6e413ba1bcb7c6caa45dbd4a54f3537eaca63465229b35717e47e22';
const packet = { ...header, guid, message: '0xdeadbeef01', payload: '' };
const encodedHeader =
    '0x0100000b3a73ce2ff2000075950000000000000000000000001a44076050125825900e736c501f859c50fe728c000075d8619e429a1de67854bd455ee6643f568d6236cde8e9442a3abf029be0e87f5bb0';
const encoded = `${encodedHeader}${guid.slice(2)}deadbeef01`;
const decoded: Packet = {
    version: 1,
    nonce: '12345678901234',
    srcEid: 30101,
    sender: '0x0000000000000000000000001a44076050125825900e736c501f859c50fe728c',
    dstEid: 30168,
    receiver: '0x619e429a1de67854bd455ee6643f568d6236cde8e9442a3abf029be0e87f5bb0',
    guid,
    message: '0xdeadbeef01',
    payload: `${guid}deadbeef01`,
};

describe('addressToBytes32', () => {
    it.each([
        [evmAddress, '0x0000000000000000000000001a44076050125825900e736c501f859c50fe728c'],
        ['0x1', '0x0000000000000000000000000000000000000000000000000000000000000001'],
        [`0x${'ab'.repeat(32)}`, `0x${'ab'.repeat(32)}`],
        [solanaAddress, '0x619e429a1de67854bd455ee6643f568d6236cde8e9442a3abf029be0e87f5bb0'],
    ])('pads %s to 32 bytes', (address, expected) => {
        expect(bytesToHexPrefixed(addressToBytes32(address))).toBe(expected);
    });

    it('rejects a base58 address that does not decode to 32 bytes', () => {
        expect(() => addressToBytes32('TJRabPrwbZy45sbavfcjinPJC18kjpRTv8')).toThrow();
        expect(() => addressToBytes32('2'.repeat(32))).toThrow();
        expect(() => addressToBytes32('z'.repeat(44))).toThrow();
    });

    it('rejects an address that is neither hex nor base58', () => {
        expect(() => addressToBytes32('not-an-address')).toThrow('Invalid address');
        expect(() => addressToBytes32(`0x${'ab'.repeat(33)}`)).toThrow('Invalid address');
    });
});

describe('calculatePacketGuid', () => {
    it('hashes nonce, eids and padded addresses', () => {
        expect(calculatePacketGuid(header)).toBe(guid);
        expect(
            calculatePacketGuid({
                version: 1,
                nonce: '1',
                srcEid: 40161,
                sender: `0x${'ab'.repeat(32)}`,
                dstEid: 40168,
                receiver: '0x1',
            }),
        ).toBe('0xd1d192493a009a36774cc2798a3747489a95908a15abb176ff337fa7922a8347');
    });
});

describe('PacketV1Codec', () => {
    it('encodes every header field, the guid and the message', () => {
        expect(PacketV1Codec.encode(packet)).toBe(encoded);
        expect(bytesToHexPrefixed(PacketV1Codec.encodeBytes(packet))).toBe(encoded);
        expect(
            PacketV1Codec.encode({
                version: 1,
                nonce: '1',
                srcEid: 40161,
                sender: `0x${'ab'.repeat(32)}`,
                dstEid: 40168,
                receiver: '0x1',
                guid: `0x${'11'.repeat(32)}`,
                message: '0x',
                payload: '',
            }),
        ).toBe(
            `0x01000000000000000100009ce1${'ab'.repeat(32)}00009ce8${'00'.repeat(31)}01${'11'.repeat(32)}`,
        );
    });

    it.each([
        ['hex', PacketV1Codec.from(encoded)],
        ['bytes', PacketV1Codec.fromBytes(hexToBytes(encoded))],
        ['packet', PacketV1Codec.from(packet)],
    ])('decodes every field from %s', (_, codec) => {
        expect(codec.version()).toBe(decoded.version);
        expect(codec.nonce()).toBe(decoded.nonce);
        expect(codec.srcEid()).toBe(decoded.srcEid);
        expect(codec.sender()).toBe(decoded.sender);
        expect(codec.dstEid()).toBe(decoded.dstEid);
        expect(codec.receiver()).toBe(decoded.receiver);
        expect(codec.guid()).toBe(decoded.guid);
        expect(codec.message()).toBe(decoded.message);
        expect(codec.payload()).toBe(decoded.payload);
        expect(codec.header()).toBe(encodedHeader);
        expect(codec.headerHash()).toBe(
            '0xd4152250dd7accef1f8c64f95bf3a498ad5d6209562a417d73c950141202e362',
        );
        expect(codec.payloadHash()).toBe(
            '0x7cdfbb83612c788fb814e408bb0b8c5f697f7a1ee8b3632f92cb082069c68902',
        );
        expect(codec.toPacket()).toEqual(decoded);
    });

    it('rejects header fields outside their widths', () => {
        for (const bad of [
            { version: 256 },
            { nonce: String(2n ** 64n) },
            { nonce: '-1' },
            { srcEid: 2 ** 32 },
            { dstEid: 2 ** 32 + 5 },
        ]) {
            expect(() => PacketV1Codec.encode({ ...packet, ...bad })).toThrow();
        }
    });

    it('reads a packet that sits at an offset in a larger buffer', () => {
        const backing = new Uint8Array([0xff, ...hexToBytes(encoded)]);
        expect(PacketV1Codec.fromBytes(backing.subarray(1)).toPacket()).toEqual(decoded);
    });
});

describe('PacketSerializer', () => {
    it('round-trips through hex and bytes', () => {
        expect(PacketSerializer.serialize(packet)).toBe(encoded);
        expect(PacketSerializer.deserialize(PacketSerializer.serialize(packet))).toEqual(decoded);
        expect(PacketSerializer.deserialize(PacketSerializer.serializeBytes(packet))).toEqual(
            decoded,
        );
        expect(PacketSerializer.serialize(decoded)).toBe(encoded);
    });
});
