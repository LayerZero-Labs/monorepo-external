import { createStellarTestEnv } from '@layerzerolabs/test-utils-stellar';

/**
 * Pin stellar/quickstart by multi-arch index digest (resolved from :latest on 2026-08-05).
 * Avoids the private LayerZero ECR localnet snapshot from @layerzerolabs/localnet-image-builder.
 */
export const STELLAR_QUICKSTART_IMAGE =
    'stellar/quickstart@sha256:ccb7e1a24c1d0878be4163836c863960445ffa670c382bdb39d4996f05c30130';

export const env = createStellarTestEnv({
    containerName: 'stellar-protocol-sdk',
    hostPort: 8086,
    dockerImage: STELLAR_QUICKSTART_IMAGE,
    // RPC is on by default in current quickstart; --local selects the standalone network.
    dockerCommand: ['--local'],
});

export const {
    CONTAINER_NAME,
    HOST_PORT,
    RPC_URL,
    NETWORK_PASSPHRASE,
    JUNK_WALLET,
    DEFAULT_DEPLOYER,
    ZRO_DISTRIBUTOR,
    EXECUTOR_ADMIN,
    CHAIN_B_DEPLOYER,
    DVN_SIGNER,
    DVN_VID,
    EID_A,
    EID_B,
    EID,
    NATIVE_TOKEN_ADDRESS,
    ZRO_ASSET,
    ZRO_TOKEN_ADDRESS,
    MSG_TYPE_VANILLA,
    MSG_TYPE_COMPOSED,
    MSG_TYPE_ABA,
    MSG_TYPE_COMPOSED_ABA,
} = env;
