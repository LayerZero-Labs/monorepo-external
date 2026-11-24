import { defineConfig } from 'tsup';

import { createPackageTsupConfig } from '@layerzerolabs/tsup-configuration';

export default defineConfig(({ watch }) => ({
    ...createPackageTsupConfig({ entry: ['src/cli.ts'] }),
    clean: !watch,
}));
