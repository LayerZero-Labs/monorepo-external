import { Asset, Keypair, Networks } from '@stellar/stellar-sdk';

import { Secp256k1KeyPair } from '../secp256k1.js';

const CORE_URL = 'http://localhost:8086';
export const RPC_URL = `${CORE_URL}/soroban/rpc`;
export const NETWORK_PASSPHRASE = Networks.STANDALONE;

// Pre-funded in the ECR localnet image (BIP39: "test test...junk", path m/44'/148'/0')
export const JUNK_WALLET = Keypair.fromSecret(
    'SCZ5VBFVGE4SLZV5WJO33LEEU36EEOEHWO27KYJIIUWGOKZB2OSNAQBI',
);
export const DEFAULT_DEPLOYER = Keypair.fromSecret(
    'SDLCA3JUES3G6R4FTI6XXDIWW7QCNMZNWPYQQIKQ26TEIZUFOLIVIUDK',
);
export const ZRO_DISTRIBUTOR = Keypair.fromSecret(
    'SB6QAFXFRR2MXYHW4RRZ23JDGKHDCYCT5YTQEGG3WNT5VKZADJQFVNWG',
);
// Use deterministic keypair for EXECUTOR_ADMIN to ensure consistency between globalSetup and test files
// (globalSetup runs in a separate process, so Keypair.random() would generate different keys)
export const EXECUTOR_ADMIN = Keypair.fromSecret(
    'SACWJCNRT2AYRPBWW7IBRNI765EMZSWPXXAAHYN57UFQNOXMGET7HM5K',
);
// Separate deployer for Chain B to enable parallel contract deployment in globalSetup
export const CHAIN_B_DEPLOYER = Keypair.fromSecret(
    'SDLIZSTG7W4C3FZYY52WIKF7FTWAXCWC5Z4OVVF3TDA3MBOR37LMIANJ',
);

// DVN secp256k1 signer for multisig (deterministic key for testing)
// Private key is keccak256("dvn_test_signer") truncated to 32 bytes
export const DVN_SIGNER = new Secp256k1KeyPair(
    '0x8d3f8d5d8f1c7e2a5b4c3d6e9f0a1b2c3d4e5f6a7b8c9d0e1f2a3b4c5d6e7f8a',
);

// DVN configuration
export const DVN_VID = 1;

// Two-chain EIDs for cross-chain testing
export const EID_A = 30401;
export const EID_B = 30402;

// Legacy single EID (kept for backwards compatibility)
export const EID = EID_A;

export const NATIVE_TOKEN_ADDRESS = Asset.native().contractId(NETWORK_PASSPHRASE);
export const ZRO_ASSET = new Asset('ZRO', DEFAULT_DEPLOYER.publicKey());
export const ZRO_TOKEN_ADDRESS = ZRO_ASSET.contractId(NETWORK_PASSPHRASE);
export const MSG_TYPE_VANILLA = 1;
export const MSG_TYPE_COMPOSED = 2;
export const MSG_TYPE_ABA = 3;
export const MSG_TYPE_COMPOSED_ABA = 4;
