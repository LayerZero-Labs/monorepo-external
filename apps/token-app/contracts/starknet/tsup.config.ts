import { defineConfig } from 'tsup';
import { createPackageTsupConfig } from '@layerzerolabs/tsup-configuration';

export default defineConfig(({ watch }) => ({
    ...createPackageTsupConfig(),
    clean: !watch,
}));
