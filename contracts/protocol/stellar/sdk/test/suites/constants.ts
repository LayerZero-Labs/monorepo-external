import { createStellarTestEnv } from '@layerzerolabs/test-utils-stellar';

export const env = createStellarTestEnv({
    containerName: 'stellar-protocol-sdk',
    hostPort: 8086,
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
