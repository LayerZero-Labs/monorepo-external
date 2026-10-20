import { readFileSync } from 'fs';
import { resolve } from 'path';
import { describe, expect, it } from 'vitest';

const DEPLOYED_PROGRAM_PATH = resolve(__dirname, '..', 'target', 'deploy', 'onesig.so');

const ELF_MAGIC = [0x7f, 0x45, 0x4c, 0x46];
const ELF_CLASS_OFFSET = 4;
const ELF_CLASS_64 = 2;
const ELF_DATA_OFFSET = 5;
const ELF_DATA_LITTLE_ENDIAN = 1;
const ELF64_E_FLAGS_OFFSET = 0x30;
const ELF64_HEADER_SIZE = 64;
const SBPF_V3_E_FLAGS = 3;

const readElfFlags = (elf: Uint8Array): number => {
    if (elf.length < ELF64_HEADER_SIZE) {
        throw new Error(`not an ELF64 file: ${elf.length} bytes is shorter than the header`);
    }
    if (!ELF_MAGIC.every((byte, index) => elf[index] === byte)) {
        throw new Error('not an ELF file: bad magic');
    }
    if (elf[ELF_CLASS_OFFSET] !== ELF_CLASS_64) {
        throw new Error(`not an ELF64 file: class ${elf[ELF_CLASS_OFFSET]}`);
    }
    if (elf[ELF_DATA_OFFSET] !== ELF_DATA_LITTLE_ENDIAN) {
        throw new Error(`not a little-endian ELF file: data ${elf[ELF_DATA_OFFSET]}`);
    }
    return new DataView(elf.buffer, elf.byteOffset, elf.byteLength).getUint32(
        ELF64_E_FLAGS_OFFSET,
        true,
    );
};

const assertSbpfV3 = (elf: Uint8Array): void => {
    const flags = readElfFlags(elf);
    if (flags !== SBPF_V3_E_FLAGS) {
        throw new Error(`expected SBPF v3 (e_flags ${SBPF_V3_E_FLAGS}), found e_flags ${flags}`);
    }
};

const syntheticElfHeader = (flags: number): Uint8Array => {
    const header = new Uint8Array(ELF64_HEADER_SIZE);
    header.set(ELF_MAGIC, 0);
    header[ELF_CLASS_OFFSET] = ELF_CLASS_64;
    header[ELF_DATA_OFFSET] = ELF_DATA_LITTLE_ENDIAN;
    new DataView(header.buffer).setUint32(ELF64_E_FLAGS_OFFSET, flags, true);
    return header;
};

describe('SBPF version of the deployable program', () => {
    it('SBPF-1.S1: target/deploy/onesig.so is an SBPF v3 ELF', () => {
        const elf = readFileSync(DEPLOYED_PROGRAM_PATH);

        expect(readElfFlags(elf)).toBe(SBPF_V3_E_FLAGS);
        expect(() => assertSbpfV3(elf)).not.toThrow();
    });

    it.each([0, 1, 2])('SBPF-1.S2: the check rejects an SBPF v%i header', (flags) => {
        expect(() => assertSbpfV3(syntheticElfHeader(flags))).toThrow(
            `expected SBPF v3 (e_flags 3), found e_flags ${flags}`,
        );
    });

    it('SBPF-1.S2: the check accepts a synthetic SBPF v3 header', () => {
        expect(() => assertSbpfV3(syntheticElfHeader(SBPF_V3_E_FLAGS))).not.toThrow();
    });
});
