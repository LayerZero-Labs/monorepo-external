import { defineConfig } from 'tsup';

import { createPackageTsupConfig } from '@layerzerolabs/tsup-configuration';

const baseConfig = createPackageTsupConfig();

export default defineConfig(({ watch }) => ({
    ...baseConfig,
    clean: !watch,
}));
