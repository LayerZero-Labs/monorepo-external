import { defineConfig } from 'tsup';

import { createPackageTsupConfig } from '@layerzerolabs/tsup-configuration';

export default defineConfig([
    createPackageTsupConfig({ entry: ['src/index.ts'] }),
    {
        ...createPackageTsupConfig({ entry: ['src/require.ts'] }),
        bundle: false,
        onSuccess: undefined,
    },
]);
