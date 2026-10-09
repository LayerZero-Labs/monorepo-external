import { SuiClient } from '@mysten/sui/client';

import { SuiCompatTransport } from './transport';
import type { SuiCompatClientOptions } from './types';

/**
 * Creates the real Mysten 1.45 client with a transport that dispatches supported methods
 * through the v2 clients. Unsupported methods throw until wired incrementally.
 */
export const createSuiCompatClient = (options: SuiCompatClientOptions): SuiClient =>
    new SuiClient({
        transport: new SuiCompatTransport(options),
        network: options.network,
    });
