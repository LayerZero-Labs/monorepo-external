import { sha256 } from '@noble/hashes/sha2';

export function instructionDiscriminator(method: string): Buffer {
    return Buffer.from(sha256(Buffer.from(`global:${method}`))).subarray(0, 8);
}
