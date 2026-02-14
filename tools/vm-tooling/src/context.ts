import type { Image, VersionCombination } from './config';
import type { Tool } from './config';

export interface ChainContext<TImageId extends string> {
    tools: readonly [Tool, ...Tool[]];
    images: Record<TImageId, Image>;
    versionCombinations: [VersionCombination<TImageId>, ...VersionCombination<TImageId>[]];
}
