import { Asset, Keypair, Networks } from '@stellar/stellar-sdk';

import { Secp256k1KeyPair } from './secp256k1.js';

export interface CreateStellarTestEnvOptions {
    /** Docker container name — must be unique when suites run concurrently. */
    containerName: string;
    /** Host port mapped to the localnet container's RPC port. */
    hostPort: number;
    /**
     * Optional localnet image override. Defaults to the versioned LayerZero ECR snapshot.
     * Useful for testing a locally built image without changing the shared default.
     */
    dockerImage?: string;
}

/**
 * Shared Stellar E2E constants (RPC URL, keys, EIDs, token addresses).
 * Constructed from containerName/hostPort so concurrent suites do not collide.
 */
export interface StellarTestEnv {
    CONTAINER_NAME: string;
    HOST_PORT: number;
    /** Optional localnet Docker image override. */
    DOCKER_IMAGE?: string;
    RPC_URL: string;
    NETWORK_PASSPHRASE: typeof Networks.STANDALONE;
    JUNK_WALLET: Keypair;
    DEFAULT_DEPLOYER: Keypair;
    ZRO_DISTRIBUTOR: Keypair;
    EXECUTOR_ADMIN: Keypair;
    CHAIN_B_DEPLOYER: Keypair;
    DVN_SIGNER: Secp256k1KeyPair;
    DVN_VID: number;
    EID_A: number;
    EID_B: number;
    /** Legacy single EID (alias of EID_A). */
    EID: number;
    NATIVE_TOKEN_ADDRESS: string;
    ZRO_ASSET: Asset;
    ZRO_TOKEN_ADDRESS: string;
    MSG_TYPE_VANILLA: number;
    MSG_TYPE_COMPOSED: number;
    MSG_TYPE_ABA: number;
    MSG_TYPE_COMPOSED_ABA: number;
}

export function createStellarTestEnv(options: CreateStellarTestEnvOptions): StellarTestEnv {
    const { containerName, hostPort, dockerImage } = options;
    const networkPassphrase = Networks.STANDALONE;
    const coreUrl = `http://localhost:${hostPort}`;

    // Pre-funded in the ECR localnet image (BIP39: "test test...junk", path m/44'/148'/0')
    const junkWallet = Keypair.fromSecret(
        'SCZ5VBFVGE4SLZV5WJO33LEEU36EEOEHWO27KYJIIUWGOKZB2OSNAQBI',
    );
    const defaultDeployer = Keypair.fromSecret(
        'SDLCA3JUES3G6R4FTI6XXDIWW7QCNMZNWPYQQIKQ26TEIZUFOLIVIUDK',
    );
    const zroDistributor = Keypair.fromSecret(
        'SB6QAFXFRR2MXYHW4RRZ23JDGKHDCYCT5YTQEGG3WNT5VKZADJQFVNWG',
    );
    // Deterministic so globalSetup and test files agree (separate processes).
    const executorAdmin = Keypair.fromSecret(
        'SACWJCNRT2AYRPBWW7IBRNI765EMZSWPXXAAHYN57UFQNOXMGET7HM5K',
    );
    // Separate deployer for Chain B parallel deploy in protocol globalSetup.
    const chainBDeployer = Keypair.fromSecret(
        'SDLIZSTG7W4C3FZYY52WIKF7FTWAXCWC5Z4OVVF3TDA3MBOR37LMIANJ',
    );

    // Private key is keccak256("dvn_test_signer") truncated to 32 bytes
    const dvnSigner = new Secp256k1KeyPair(
        '0x8d3f8d5d8f1c7e2a5b4c3d6e9f0a1b2c3d4e5f6a7b8c9d0e1f2a3b4c5d6e7f8a',
    );

    const eidA = 30401;
    const zroAsset = new Asset('ZRO', defaultDeployer.publicKey());

    return {
        CONTAINER_NAME: containerName,
        HOST_PORT: hostPort,
        DOCKER_IMAGE: dockerImage,
        RPC_URL: `${coreUrl}/soroban/rpc`,
        NETWORK_PASSPHRASE: networkPassphrase,
        JUNK_WALLET: junkWallet,
        DEFAULT_DEPLOYER: defaultDeployer,
        ZRO_DISTRIBUTOR: zroDistributor,
        EXECUTOR_ADMIN: executorAdmin,
        CHAIN_B_DEPLOYER: chainBDeployer,
        DVN_SIGNER: dvnSigner,
        DVN_VID: 1,
        EID_A: eidA,
        EID_B: 30402,
        EID: eidA,
        NATIVE_TOKEN_ADDRESS: Asset.native().contractId(networkPassphrase),
        ZRO_ASSET: zroAsset,
        ZRO_TOKEN_ADDRESS: zroAsset.contractId(networkPassphrase),
        MSG_TYPE_VANILLA: 1,
        MSG_TYPE_COMPOSED: 2,
        MSG_TYPE_ABA: 3,
        MSG_TYPE_COMPOSED_ABA: 4,
    };
}
