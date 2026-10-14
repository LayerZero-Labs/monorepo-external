import { ExecutorProgram } from '@layerzerolabs/lz-v2-protocol-solana';
import { executor as protocolExecutor } from '@layerzerolabs/test-utils-solana';

// The shared infrastructure supplies the deployed Executor ID; receive/compose discovery uses the
// protocol package's V3 planner client.
export const executor = new ExecutorProgram.Executor(protocolExecutor.programId);

export { CONSOLE_OFT_PROGRAM_ID as OFT_PROGRAM_ID } from '../build/console_oft/programs';
export { EXAMPLE_COMPOSER_PROGRAM_ID as COMPOSER_PROGRAM_ID } from '../build/example_composer/programs';
export {
    DST_EID,
    DVN_SIGNERS,
    dvns,
    EDDSA,
    endpoint,
    SRC_EID,
    uln,
} from '@layerzerolabs/test-utils-solana';

/** Mint decimals equal shared decimals, so every amount is dust-free (ld2sd rate 1). */
export const OFT_DECIMALS = 6;
