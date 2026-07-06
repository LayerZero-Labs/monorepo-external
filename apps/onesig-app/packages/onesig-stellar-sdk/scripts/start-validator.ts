import { execSync } from 'child_process';

const CONTAINER_NAME = 'onesig-stellar-service';
const IMAGE = 'stellar/quickstart:testing';
const HOST_PORT = 8586;
const CONTAINER_PORT = 8000;

function exec(cmd: string) {
    execSync(cmd, { stdio: 'inherit' });
}

function startValidator() {
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
            `-p ${HOST_PORT}:${CONTAINER_PORT}`,
            `--label com.container.type=chain-node`,
            `--health-cmd "curl -f http://localhost:${CONTAINER_PORT} --fail --silent"`,
            '--health-interval 10s',
            '--health-timeout 5s',
            '--health-retries 5',
            '--health-start-period 30s',
            IMAGE,
            '--local',
        ].join(' '),
    );

    // Wait for healthy
    console.log('Waiting for Stellar validator to be healthy...');
    for (let i = 0; i < 30; i++) {
        try {
            const status = execSync(
                `docker inspect --format='{{.State.Health.Status}}' ${CONTAINER_NAME}`,
            )
                .toString()
                .trim();
            if (status === 'healthy') {
                console.log('Stellar validator is healthy');
                return;
            }
        } catch {
            // Container not ready yet
        }
        execSync('sleep 2');
    }
    throw new Error('Stellar validator failed to become healthy');
}

startValidator();
