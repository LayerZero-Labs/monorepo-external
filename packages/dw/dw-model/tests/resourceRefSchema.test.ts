import { describe, expect, it } from 'vitest';

import { resourceRefSchema } from '@layerzerolabs/dw-model';

describe('resourceRefSchema', () => {
    it('rejects empty resourceId', () => {
        expect(resourceRefSchema.safeParse({ resourceId: '' }).success).toBe(false);
    });

    it('rejects empty resourceSubKey when present', () => {
        expect(
            resourceRefSchema.safeParse({ resourceId: 'my-resource', resourceSubKey: '' }).success,
        ).toBe(false);
    });

    it('accepts a ref without a subkey', () => {
        expect(resourceRefSchema.safeParse({ resourceId: 'my-resource' }).success).toBe(true);
    });

    it('rejects resourceId containing /', () => {
        expect(resourceRefSchema.safeParse({ resourceId: 'a/b' }).success).toBe(false);
    });

    it('rejects resourceSubKey containing /', () => {
        expect(
            resourceRefSchema.safeParse({ resourceId: 'my-resource', resourceSubKey: 'foo/bar' })
                .success,
        ).toBe(false);
    });
});
