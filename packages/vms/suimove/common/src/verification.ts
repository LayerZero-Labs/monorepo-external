import { ChainType } from '@layerzerolabs/layerzero-definitions';

/**
 * Wraps verification data into the artifact shape expected by the
 * contract-verification-activity-factory for Sui Move chains
 * (discriminated by `kind: ChainType.SUIMOVE`).
 */
export const deriveSuiMoveVerificationArtifact = ({
    sourceCodeZipBase64,
}: {
    sourceCodeZipBase64: string;
}) => ({
    kind: ChainType.SUIMOVE as const,
    sourceCodeZipBase64,
});
