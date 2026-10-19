import { defineConfig } from 'tsup';

import { createPackageTsupConfig } from '@layerzerolabs/tsup-configuration';

export default defineConfig(({ watch }) => ({
    ...createPackageTsupConfig({
        // Keep the build deterministic: multi-entry splitting emits hash-named chunks that drift between runs.
        entry: ['src/index.ts'],
        splitting: false,
    }),
    clean: !watch,
}));
