import type { ChainContext } from '@layerzerolabs/vm-tooling';

import { type ImageId, images, tools, versionCombinations } from './config';

export const context: ChainContext<ImageId> = {
    tools,
    images,
    versionCombinations,
};
