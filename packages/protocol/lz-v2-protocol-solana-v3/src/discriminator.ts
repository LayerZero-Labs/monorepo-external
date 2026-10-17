import { sha2_256 } from '@layerzerolabs/lz-foundation';

export function instructionDiscriminator(method: string): Buffer {
    return Buffer.from(sha2_256(Buffer.from(`global:${method}`))).subarray(0, 8);
}
