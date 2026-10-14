import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

describe('generated IDLs carry no V2 planner or lookup-table ABI', () => {
    it.each(['console_oft', 'example_composer'])(
        '%s generates only V3 planner instructions',
        (name) => {
            const idl = JSON.parse(
                readFileSync(new URL(`../../build/${name}.json`, import.meta.url), 'utf8'),
            );
            const instructions = idl.instructions.map((ix: { name: string }) => ix.name);
            expect(instructions).toContain(
                name === 'console_oft' ? 'lz_receive_types_v3' : 'lz_compose_types_v3',
            );
            expect(instructions.some((name: string) => name.endsWith('_types_v2'))).toBe(false);
            expect(instructions).not.toContain('set_alts');
            expect(instructions).not.toContain('get_alts');
            if (name === 'console_oft') {
                expect(instructions).not.toContain('grow_lz_plan');
                expect(instructions).not.toContain('close_lz_plan');
                const store = idl.types.find((type: { name: string }) => type.name === 'OFTStore');
                expect(
                    store.type.fields.some((field: { name: string }) => field.name === 'alts'),
                ).toBe(false);
            }
        },
    );
});
