import { keccak_256 } from '@noble/hashes/sha3';

import {
    base58ToBytes,
    bigIntToBytes,
    bytesToHexPrefixed,
    hexToBytes,
    hexZeroPad,
} from '@layerzerolabs/common-encoding-utils';

export type PacketHeader = {
    version: number;
    nonce: string;
    srcEid: number;
    sender: string;
    dstEid: number;
    receiver: string;
};

export type Packet = PacketHeader & {
    guid: string;
    message: string;
    payload: string;
};

const NONCE_OFFSET = 1;
const SRC_EID_OFFSET = 9;
const SENDER_OFFSET = 13;
const DST_EID_OFFSET = 45;
const RECEIVER_OFFSET = 49;
const GUID_OFFSET = 81;
const MESSAGE_OFFSET = 113;

const solanaAddressRegex = /^[1-9A-HJ-NP-Za-km-z]{32,44}$/;

export const addressToBytes32 = (address: string): Uint8Array => {
    if (solanaAddressRegex.test(address)) {
        const bytes = base58ToBytes(address);
        if (bytes.length !== 32) {
            throw new Error('Invalid address');
        }
        return bytes;
    }
    if (address.startsWith('0x') && address.length <= 66) {
        return hexToBytes(hexZeroPad(address, 32));
    }
    throw new Error('Invalid address');
};

const keccak256Hex = (bytes: Uint8Array): string => bytesToHexPrefixed(keccak_256(bytes));

const u32 = (value: number): Uint8Array => bigIntToBytes(BigInt(value), 4);

export const calculatePacketGuid = (header: PacketHeader): string =>
    keccak256Hex(
        new Uint8Array([
            ...bigIntToBytes(BigInt(header.nonce), 8),
            ...u32(header.srcEid),
            ...addressToBytes32(header.sender),
            ...u32(header.dstEid),
            ...addressToBytes32(header.receiver),
        ]),
    );

export class PacketV1Codec {
    private readonly view: DataView;

    private constructor(private readonly bytes: Uint8Array) {
        this.view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    }

    static from(payload: string | Uint8Array | Packet): PacketV1Codec {
        if (payload instanceof Uint8Array) {
            return PacketV1Codec.fromBytes(payload);
        }
        if (typeof payload === 'object') {
            return PacketV1Codec.fromBytes(PacketV1Codec.encodeBytes(payload));
        }
        return PacketV1Codec.fromBytes(hexToBytes(payload));
    }

    static fromBytes(payload: Uint8Array): PacketV1Codec {
        return new PacketV1Codec(Uint8Array.from(payload));
    }

    static encode(packet: Packet): string {
        return bytesToHexPrefixed(PacketV1Codec.encodeBytes(packet));
    }

    static encodeBytes(packet: Packet): Uint8Array {
        const message = hexToBytes(packet.message);
        const bytes = new Uint8Array(MESSAGE_OFFSET + message.length);
        bytes.set(bigIntToBytes(BigInt(packet.version), 1), 0);
        bytes.set(bigIntToBytes(BigInt(packet.nonce), 8), NONCE_OFFSET);
        bytes.set(u32(packet.srcEid), SRC_EID_OFFSET);
        bytes.set(addressToBytes32(packet.sender), SENDER_OFFSET);
        bytes.set(u32(packet.dstEid), DST_EID_OFFSET);
        bytes.set(addressToBytes32(packet.receiver), RECEIVER_OFFSET);
        bytes.set(hexToBytes(packet.guid), GUID_OFFSET);
        bytes.set(message, MESSAGE_OFFSET);
        return bytes;
    }

    private hex(start: number, end?: number): string {
        return bytesToHexPrefixed(this.bytes.subarray(start, end));
    }

    version(): number {
        return this.view.getUint8(0);
    }

    nonce(): string {
        return this.view.getBigUint64(NONCE_OFFSET).toString();
    }

    srcEid(): number {
        return this.view.getUint32(SRC_EID_OFFSET);
    }

    sender(): string {
        return this.hex(SENDER_OFFSET, DST_EID_OFFSET);
    }

    dstEid(): number {
        return this.view.getUint32(DST_EID_OFFSET);
    }

    receiver(): string {
        return this.hex(RECEIVER_OFFSET, GUID_OFFSET);
    }

    guid(): string {
        return this.hex(GUID_OFFSET, MESSAGE_OFFSET);
    }

    message(): string {
        return this.hex(MESSAGE_OFFSET);
    }

    payload(): string {
        return this.hex(GUID_OFFSET);
    }

    payloadHash(): string {
        return keccak256Hex(this.bytes.subarray(GUID_OFFSET));
    }

    header(): string {
        return this.hex(0, GUID_OFFSET);
    }

    headerHash(): string {
        return keccak256Hex(this.bytes.subarray(0, GUID_OFFSET));
    }

    toPacket(): Packet {
        return {
            version: this.version(),
            nonce: this.nonce(),
            srcEid: this.srcEid(),
            sender: this.sender(),
            dstEid: this.dstEid(),
            receiver: this.receiver(),
            guid: this.guid(),
            message: this.message(),
            payload: this.payload(),
        };
    }
}

export class PacketSerializer {
    static serialize(packet: Packet): string {
        return PacketV1Codec.encode(packet);
    }

    static serializeBytes(packet: Packet): Uint8Array {
        return PacketV1Codec.encodeBytes(packet);
    }

    static deserialize(bytesLike: Uint8Array | string): Packet {
        return PacketV1Codec.from(bytesLike).toPacket();
    }
}
