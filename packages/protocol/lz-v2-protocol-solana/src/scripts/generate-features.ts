import { fileURLToPath } from 'node:url';

import { generateFeatures } from './helpers';

// Only run if this file is executed directly (not imported)
if (process.argv[1] === fileURLToPath(import.meta.url)) {
    generateFeatures().catch((err: unknown) => {
        console.error(err);
        process.exit(1);
    });
}
