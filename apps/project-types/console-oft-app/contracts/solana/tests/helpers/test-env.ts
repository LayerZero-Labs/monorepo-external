/**
 * Per-file infrastructure environment.
 *
 * Delegates to @layerzerolabs/test-utils-solana for Docker-based validator + LZ infra.
 * Sets a package-specific base port to avoid cross-package collisions on CI.
 */

import {
    createInfraEnv as _createInfraEnv,
    type InfraEnv,
    type ValidatorConfig,
} from '@layerzerolabs/test-utils-solana';

/** Base port for console-oft validators (omnicounter uses default 13033). */
const BASE_PORT = 13100;

export const createInfraEnv = (config?: ValidatorConfig): Promise<InfraEnv> =>
    _createInfraEnv({ ...config, basePort: config?.basePort ?? BASE_PORT });

export type { InfraEnv };
