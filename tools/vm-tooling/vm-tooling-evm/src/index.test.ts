import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import * as vitest from 'vitest';

import { getImageUri, testTools } from '@layerzerolabs/vm-tooling';

import { images, versionCombinations } from './config';

const { beforeAll, describe, it } = vitest;

const COMMAND_TIMEOUT = 5 * 60_000;
const execFileAsync = promisify(execFile);

const imageId = versionCombinations[0]?.images.hardhat;
if (imageId == null) {
    throw new Error('No hardhat image in the first version combination');
}

const image = images[imageId];
if (image == null) {
    throw new Error(`No image config for ${imageId}`);
}

const runDocker = async (args: string[]): Promise<void> => {
    try {
        await execFileAsync('docker', args, {
            timeout: COMMAND_TIMEOUT,
            killSignal: 'SIGKILL',
            maxBuffer: 10 * 1024 * 1024,
        });
    } catch (error) {
        const err = error as { message: string; stdout?: string; stderr?: string };
        throw new Error([err.message, err.stderr, err.stdout].filter(Boolean).join('\n'));
    }
};

const compileScript = (pragma: string, config: string, extraArgs: string): string => `
set -e
mkdir -p contracts
printf '%s\\n' '// SPDX-License-Identifier: MIT' 'pragma solidity ${pragma};' 'contract A {}' > contracts/A.sol
cat > hardhat.config.cjs << 'CFG'
${config}
CFG
hardhat compile ${extraArgs}
`;

const cases = [
    {
        name: 'evm',
        pragma: '0.8.26',
        extraArgs: '',
        config: `module.exports = {
    solidity: { compilers: [{ version: '0.8.26' }] },
};`,
    },
    {
        name: 'tron',
        pragma: '0.8.24',
        extraArgs: '--network tron-mainnet',
        config: `require('hardhat-deploy');
require('@layerzerolabs/hardhat-tron');
module.exports = {
    networks: { 'tron-mainnet': { url: 'http://127.0.0.1:8514/jsonrpc', tron: true } },
    solidity: { compilers: [{ version: '0.8.24' }] },
    tronSolc: { enable: true, compilers: [{ version: '0.8.24' }] },
};`,
    },
    {
        name: 'zksync',
        pragma: '0.8.26',
        extraArgs: '--network zksync',
        config: `require('@matterlabs/hardhat-zksync-solc');
module.exports = {
    networks: { zksync: { zksync: true, url: 'http://127.0.0.1' } },
    solidity: { compilers: [{ version: '0.8.26', eraVersion: '1.0.2' }] },
    zksolc: { version: '1.5.15', compilerSource: 'binary', settings: {} },
};`,
    },
] as const;

describe.sequential('evm tooling images', () => {
    testTools(vitest, images, versionCombinations, {
        forge: ['forge', '--version'],
        hardhat: ['hardhat', '--version'],
    });

    describe(`compiler cache (${imageId})`, () => {
        let imageUri = '';

        beforeAll(async () => {
            imageUri = await getImageUri(image);
        });

        for (const { name, pragma, extraArgs, config } of cases) {
            it(
                `compiles pre-downloaded ${name} with --network=none`,
                async () => {
                    await runDocker([
                        'run',
                        '--rm',
                        '--network=none',
                        '-w',
                        '/tmp/c',
                        imageUri,
                        'bash',
                        '-c',
                        compileScript(pragma, config, extraArgs),
                    ]);
                },
                COMMAND_TIMEOUT,
            );
        }
    });
});
