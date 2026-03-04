import { runCli } from '@layerzerolabs/vm-tooling';

import { images, tools, versionCombinations } from './config';

export const main = (): Promise<void> => runCli({ tools, images, versionCombinations });
