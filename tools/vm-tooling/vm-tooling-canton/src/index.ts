import { runCli } from '@layerzerolabs/vm-tooling';

import { DEFAULT_OPENAPI_OUTPUT_DIR, generateOpenapi } from './commands/canton';
import { context } from './context';

export const main = (): Promise<void> =>
    runCli(context, (program, parseGlobalOptions) => {
        const extra = program.command('extra').description('Extra commands for VM tooling');
        const canton = extra.command('canton');

        canton
            .command('generate-openapi')
            .description(
                'Generate the Canton ledger JSON-API TypeScript client using the' +
                    ' OpenAPI generator and SDK-matched spec baked into the canton image',
            )
            .argument(
                '[output-dir]',
                'Output directory for the generated client (relative to cwd)',
                DEFAULT_OPENAPI_OUTPUT_DIR,
            )
            .action(async (outputDir: string) =>
                generateOpenapi(context)(outputDir, await parseGlobalOptions(program)),
            );
    });
