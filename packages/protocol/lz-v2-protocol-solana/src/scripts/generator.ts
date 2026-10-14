import { fileURLToPath } from 'node:url';

import { addresses } from '../addresses';
import { generateTypeScriptSDKs } from './helpers';

// Only run if this file is executed directly (not imported)
if (process.argv[1] === fileURLToPath(import.meta.url)) {
    generateTypeScriptSDKs(Object.keys(addresses), '@layerzerolabs/lz-v2-protocol-solana').catch(
        (err: unknown) => {
            console.error(err);
            process.exit(1);
        },
    );
}
