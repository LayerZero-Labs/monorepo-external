/**
 * Shared constants for Solana integration tests.
 *
 * Pre-instantiated LayerZero protocol program clients (endpoint, uln, dvn,
 * executor, pricefeed, simple-messagelib) using sandbox-local program IDs
 * from @layerzerolabs/lz-solana-sdk-v2. SRC_EID/DST_EID define two distinct
 * simulated chain endpoints on a single validator.
 */

import type { EddsaInterface } from '@metaplex-foundation/umi';
import { publicKey } from '@metaplex-foundation/umi';
import { createWeb3JsEddsa } from '@metaplex-foundation/umi-eddsa-web3js';
import { createHash } from 'crypto';

import { UMI } from '@layerzerolabs/lz-solana-sdk-v2';

export const EDDSA: EddsaInterface = createWeb3JsEddsa();

export const SRC_EID = 1;
export const DST_EID = 2;

// Deterministic DVN signers — must produce identical keys across globalSetup (main process)
// and test files (forked worker). Random keys break because the two processes diverge.
export const DVN_SIGNERS = Array.from(
    { length: 4 },
    (_, i) => new Uint8Array(createHash('sha256').update(`dvn-signer-${i}`).digest()),
);

export const defaultMultiplierBps = 12500;

export const simpleMessageLib: UMI.SimpleMessageLibProgram.SimpleMessageLib =
    new UMI.SimpleMessageLibProgram.SimpleMessageLib(
        UMI.SimpleMessageLibProgram.SIMPLE_MESSAGELIB_PROGRAM_ID,
    );

export const endpoint: UMI.EndpointProgram.Endpoint = new UMI.EndpointProgram.Endpoint(
    UMI.EndpointProgram.ENDPOINT_PROGRAM_ID,
);
export const uln: UMI.UlnProgram.Uln = new UMI.UlnProgram.Uln(UMI.UlnProgram.ULN_PROGRAM_ID);
export const executor: UMI.ExecutorProgram.Executor = new UMI.ExecutorProgram.Executor(
    UMI.ExecutorProgram.EXECUTOR_PROGRAM_ID,
);
export const priceFeed: UMI.PriceFeedProgram.PriceFeed = new UMI.PriceFeedProgram.PriceFeed(
    UMI.PriceFeedProgram.PRICEFEED_PROGRAM_ID,
);

export const dvns = [publicKey(UMI.DVNProgram.DVN_PROGRAM_ID)];
