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

/**
 * Read all tool versions from Anchor.toml [toolchain] section.
 * Returns a map of tool name → version. Returns empty record if
 * no Anchor.toml is found (non-Solana packages just get defaults).
 */
export const readAnchorTomlVersions = async (cwd: string): Promise<Record<string, string>> => {
    const versions: Record<string, string> = {};
    for (const name of ['anchor', 'solana'] as const) {
        try {
            versions[name] = await parseAnchorTomlVersion(cwd, name);
        } catch {
            // Anchor.toml not found or key missing — skip
        }
    }
    return versions;
};
