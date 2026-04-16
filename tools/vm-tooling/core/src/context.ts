import type { Image, VersionCombination } from './config';
import type { Tool } from './config';

export interface ChainContext<TImageId extends string> {
    tools: readonly [Tool, ...Tool[]];
    images: Record<TImageId, Image>;
    versionCombinations: [VersionCombination<TImageId>, ...VersionCombination<TImageId>[]];
    /**
     * Optional hook to read default tool versions from project config files
     * (e.g., Anchor.toml for Solana, Move.toml for Aptos/Sui).
     * Returned versions are used as defaults — CLI flags override.
     */
    getDefaultVersions?: (cwd: string) => Promise<Record<string, string>>;
}
