import { execSync } from 'child_process';
import { join } from 'path';

import { getFullyQualifiedRepoRootPath } from '@layerzerolabs/common-node-utils';

const CONTAINER_NAME = 'onesig-solana-validator';
const HOST_RPC_PORT = 8799;
const HOST_WS_PORT = 8800;
const PROGRAM_ID = '5XDrnPsfpZ29v7DRrUtUBJ3yr5n1mhSUDyEzPuAvakHv';

async function getImageUri(): Promise<string> {
    const workspaceRoot = await getFullyQualifiedRepoRootPath();

    const { registry, imageDirectory } = (
        await import(join(workspaceRoot, 'configs', 'vm-tooling', 'values', 'docker-image-repo.ts'))
    ).default;

    const { images, versionCombinations } = await import(
        join(workspaceRoot, 'tools', 'vm-tooling-solana', 'src', 'config.ts')
    );

    const stableCombination = versionCombinations.find((c: { stable?: boolean }) => c.stable);
    const imageId = stableCombination.images.anchor;
    const image = images[imageId];

    const tag = [
        ...Object.entries(image.versions as Record<string, string>)
            .sort()
            .flat(),
        ...(image.patch ? ['patch', image.patch] : []),
    ].join('_');

    return `${registry}/${imageDirectory}/${image.name}-tooling:${tag}`;
}

function exec(cmd: string) {
    execSync(cmd, { stdio: 'inherit' });
}

async function startValidator() {
    const image = await getImageUri();

    // Remove existing container if present
    try {
        execSync(
            `docker stop ${CONTAINER_NAME} 2>/dev/null && docker rm ${CONTAINER_NAME} 2>/dev/null`,
        );
    } catch {
        // Container doesn't exist, ignore
    }

    exec(
        [
            'docker run -d',
            `--name ${CONTAINER_NAME}`,
            `-p ${HOST_RPC_PORT}:8899`,
            `-p ${HOST_WS_PORT}:8900`,
            `-v ${join(process.cwd(), 'target', 'deploy')}:/workspace/target/deploy:ro`,
            `--label com.container.type=chain-node`,
            `--health-cmd "solana cluster-version -u http://localhost:8899"`,
            '--health-interval 5s',
            '--health-timeout 5s',
            '--health-retries 10',
            '--health-start-period 10s',
            image,
            'solana-test-validator',
            '--bpf-program',
            PROGRAM_ID,
            '/workspace/target/deploy/onesig.so',
            '--reset',
            '-q',
        ].join(' '),
    );

    // Wait for healthy
    console.log('Waiting for Solana validator to be healthy...');
    for (let i = 0; i < 30; i++) {
        try {
            const status = execSync(
                `docker inspect --format='{{.State.Health.Status}}' ${CONTAINER_NAME}`,
            )
                .toString()
                .trim();
            if (status === 'healthy') {
                console.log('Solana validator is healthy');
                return;
            }
        } catch {
            // Container not ready yet
        }
        execSync('sleep 2');
    }
    throw new Error('Solana validator failed to become healthy');
}

startValidator().catch((err) => {
    console.error('Failed to start validator:', err);
    process.exit(1);
});
