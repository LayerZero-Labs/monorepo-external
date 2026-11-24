import {
    type ChainContext,
    executeToolCommand,
    type ToolCommandExecutionOptions,
} from '@layerzerolabs/vm-tooling';

import type { ImageId } from '../config';

// Default Daml ledger JSON-API client output directory inside the consumer package.
export const DEFAULT_OPENAPI_OUTPUT_DIR = 'src/open-api';

const buildScript = (outputDir: string): string => {
    const generate = [
        'canton-openapi-generator',
        'generate',
        '-g typescript-fetch',
        `-o "${outputDir}"`,
        '--additional-properties=importFileExtension=.js',
    ].join(' ');

    return ['set -euo pipefail', `rm -rf "${outputDir}"`, generate].join(' && ');
};

/**
 * Generate the Canton ledger JSON-API TypeScript client into `<outputDir>` of the
 * caller's package (relative to `cwd`).
 *
 * Runs inside the canton-openapi image so the OpenAPI generator JAR and the
 * SDK-matched `openapi.yaml` are pulled from the image rather than fetched per build.
 */
export const generateOpenapi =
    (context: ChainContext<ImageId>) =>
    async (outputDir: string, options: ToolCommandExecutionOptions): Promise<void> => {
        await executeToolCommand(context, 'openapi-generator', [], {
            ...options,
            script: buildScript(outputDir),
        });
    };
