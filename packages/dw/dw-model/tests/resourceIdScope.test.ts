import { describe, expect, it } from 'vitest';

import { isCompositeResourceIdInScope } from '@layerzerolabs/dw-model';

describe('isCompositeResourceIdInScope', () => {
    it('matches resource-only and subkey composite refs', () => {
        expect(isCompositeResourceIdInScope({ compositeRef: 'my-oft', resourceId: 'my-oft' })).toBe(
            true,
        );
        expect(
            isCompositeResourceIdInScope({
                compositeRef: 'my-oft/factory',
                resourceId: 'my-oft',
            }),
        ).toBe(true);
    });

    it('does not match a longer resourceId that shares a prefix', () => {
        expect(
            isCompositeResourceIdInScope({ compositeRef: 'my-oft-v2', resourceId: 'my-oft' }),
        ).toBe(false);
        expect(
            isCompositeResourceIdInScope({
                compositeRef: 'my-oft-v2/factory',
                resourceId: 'my-oft',
            }),
        ).toBe(false);
    });
});
