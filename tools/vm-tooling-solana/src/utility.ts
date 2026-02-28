import { readFile } from 'node:fs/promises';

import { findFileInParentDirectory } from '@layerzerolabs/vm-tooling';

export const parseAnchorTomlVersion = async (
    cwd: string,
    name: 'anchor' | 'solana',
): Promise<string> => {
    const path = await findFileInParentDirectory(cwd, 'Anchor.toml');

    if (!path) {
        throw new Error('Anchor project not found');
    }

    const toml = await readFile(path, 'utf-8');
    const pattern = /^([a-z]+)(?:_version ?= ?")((?:[0-9]+\.?){3})(?:")$/gm;

    let match;
    while ((match = pattern.exec(toml))) {
        const [, matchedName, version] = match;
        if (matchedName === name && version) {
            return version;
        }
    }

    throw new Error(`${name} version not found in ${path}`);
};
