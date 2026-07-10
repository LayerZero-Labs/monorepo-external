import { execSync } from 'child_process';
import { join } from 'path';

import { getFullyQualifiedRepoRootPath } from '@layerzerolabs/common-node-utils';
import { rpcCall, writeProgram } from '@layerzerolabs/vm-tooling-solana';

const CONTAINER_NAME = 'onesig-solana-validator';
const HOST_RPC_PORT = 8799;
const HOST_WS_PORT = 8800;
// surfpool's fixed in-container RPC/WS ports; the host ports above publish to these.
const CONTAINER_RPC_PORT = 8899;
const CONTAINER_WS_PORT = 8900;
const PROGRAM_ID = '5XDrnPsfpZ29v7DRrUtUBJ3yr5n1mhSUDyEzPuAvakHv';
const RPC_URL = `http://localhost:${HOST_RPC_PORT}`;

/** Resolve the surfpool runtime image URI from the vm-tooling-solana config. */
const getImageUri = async (): Promise<string> => {
    const workspaceRoot = await getFullyQualifiedRepoRootPath();

    const { registry, imageDirectory } = (
        await import(join(workspaceRoot, 'configs', 'vm-tooling', 'values', 'docker-image-repo.ts'))
    ).default;

    const { images, versionCombinations } = await import(
        join(workspaceRoot, 'tools', 'vm-tooling', 'vm-tooling-solana', 'src', 'config.ts')
    );

    const combination = versionCombinations.find(
        (c: { images: Record<string, string> }) => c.images.surfpool,
    );
    if (!combination) {
        throw new Error('No surfpool version combination found in vm-tooling-solana config');
    }
    const image = images[combination.images.surfpool];

    const tag = [
        ...Object.entries(image.versions as Record<string, string>)
            .sort()
            .flat(),
        ...(image.patch ? ['patch', image.patch] : []),
    ].join('-');

    return `${registry}/${imageDirectory}/${image.name}-tooling:${tag}`;
};

const exec = (cmd: string) => {
    execSync(cmd, { stdio: 'inherit' });
};

const startValidator = async () => {
    // TODO-SOLANA: invoke surfpool via lz-tool like the test-utils/lz-v2 harnesses, instead of the
    // raw `docker run` + hand-rolled getImageUri below, this was copied from an external repo and
    // never regularized to the standard pattern.
    const image = await getImageUri();

    // Remove existing container if present
    try {
        execSync(
            `docker stop ${CONTAINER_NAME} 2>/dev/null && docker rm ${CONTAINER_NAME} 2>/dev/null`,
        );
    } catch {
        // Container doesn't exist, ignore
    }

    // Publish to host loopback only: surfpool's RPC accepts state-mutating methods, so an
    // all-interfaces publish would let another host on a shared runner tamper with test state.
    exec(
        [
            'docker run -d',
            `--name ${CONTAINER_NAME}`,
            `-p 127.0.0.1:${HOST_RPC_PORT}:${CONTAINER_RPC_PORT}`,
            `-p 127.0.0.1:${HOST_WS_PORT}:${CONTAINER_WS_PORT}`,
            `--label com.container.type=chain-node`,
            image,
            `surfpool start --offline -o 0.0.0.0 -p ${CONTAINER_RPC_PORT} -w ${CONTAINER_WS_PORT} --no-tui --log-path /tmp/surfpool`,
        ].join(' '),
    );

    // Wait for the RPC to answer
    console.log('Waiting for surfpool RPC...');
    let ready = false;
    for (let i = 0; i < 60; i++) {
        try {
            await rpcCall({ rpc: RPC_URL, method: 'getVersion', params: [] });
            ready = true;
            break;
        } catch {
            await new Promise((resolve) => setTimeout(resolve, 1000));
        }
    }
    if (!ready) {
        throw new Error('surfpool failed to become ready');
    }

    // Load onesig.so at its program id (replaces solana-test-validator's --bpf-program). The .so is
    // read on the host and sent as hex over RPC, so no container mount is needed.
    await writeProgram({
        rpc: RPC_URL,
        id: PROGRAM_ID,
        soPath: join(process.cwd(), 'target', 'deploy', 'onesig.so'),
    });
    console.log('onesig program loaded; surfpool ready');
};

startValidator().catch((err) => {
    console.error('Failed to start validator:', err);
    process.exit(1);
});
