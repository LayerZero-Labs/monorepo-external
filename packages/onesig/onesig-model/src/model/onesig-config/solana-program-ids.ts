import { Environment } from '@layerzerolabs/layerzero-definitions';

/**
 * Per environment rather than the contract package's generated `ONESIG_PROGRAM_ID`: that is the
 * `declare_id!` value in source, while each environment gets its own address at deploy time.
 * Leaf hashing derives the `oneSigSigner` PDA from this, so encoding against one program and
 * executing against another fails as `InvalidProof` — only at execution, after signing.
 *
 * The wallet's `@offchain-monorepo/onesig-model` re-exports this; that indirection should go
 * away with the client and backend model unification.
 */
const programIdPerEnvironment: Partial<Record<Environment, string>> = {
    [Environment.MAINNET]: '6VhT6ASR4Ytg2AZbrKAcn1YFzRwaUJ2ANiTB9hueVPpr',
    // Solana devnet, which is what the wallet `testnet` stage points at.
    [Environment.TESTNET]: '6VhT6ASR4Ytg2AZbrKAcn1YFzRwaUJ2ANiTB9hueVPpr',
};

const isEnvironment = (value: string): value is Environment =>
    (Object.values(Environment) as string[]).includes(value);

/** Takes a string because the wallet threads `environment` as one down to `BootstrapChainConfig`. */
export function getOneSigSolanaProgramAddress(environment: string): string {
    const programId = isEnvironment(environment) ? programIdPerEnvironment[environment] : undefined;
    if (!programId) {
        throw new Error(`Solana: OneSig program is not deployed for environment ${environment}`);
    }
    return programId;
}
