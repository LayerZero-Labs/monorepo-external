import { describe, expectTypeOf, it } from 'vitest';

import type { Merge } from '../src/merge';

describe('Merge type utility', () => {
    it('should handle empty object edge cases correctly', () => {
        // Test the main fix: empty objects should be handled properly
        type EmptyLeftMerge = Merge<{}, { a: string; b: number }>;
        expectTypeOf<EmptyLeftMerge>().toEqualTypeOf<{ a: string; b: number }>();

        type EmptyRightMerge = Merge<{ a: string; b: number }, {}>;
        expectTypeOf<EmptyRightMerge>().toEqualTypeOf<{ a: string; b: number }>();

        type BothEmptyMerge = Merge<{}, {}>;
        expectTypeOf<BothEmptyMerge>().toEqualTypeOf<{}>();
    });

    it('should merge types correctly for non-empty objects', () => {
        // Basic functionality should still work
        type BasicMerge = Merge<{ a: string }, { b: number }>;
        expectTypeOf<BasicMerge>().toEqualTypeOf<{ a: string; b: number }>();

        // Property override should work
        type OverrideMerge = Merge<{ a: string; b: string }, { b: number; c: boolean }>;
        expectTypeOf<OverrideMerge>().toEqualTypeOf<{ a: string; b: number; c: boolean }>();
    });
});
