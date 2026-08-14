import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, test } from 'vitest';

import { getDepcheckConfig } from '../src/utils';

let temporaryDirectory: string;

beforeEach(async () => {
    temporaryDirectory = await mkdtemp(join(tmpdir(), 'depcheck-config-'));
});

afterEach(async () => {
    await rm(temporaryDirectory, { recursive: true, force: true });
});

const createPackageDirectory = async (depcheckrc?: string): Promise<string> => {
    const directory = await mkdtemp(join(temporaryDirectory, 'package-'));

    if (depcheckrc !== undefined) {
        await writeFile(join(directory, '.depcheckrc'), depcheckrc);
    }

    return directory;
};

describe('getDepcheckConfig', () => {
    test('should read every setting', async () => {
        const directory = await createPackageDirectory(
            JSON.stringify({ ignores: ['@ui-internal/*'], catalogize: false }),
        );

        expect(await getDepcheckConfig(directory)).toEqual({
            ignores: ['@ui-internal/*'],
            catalogize: false,
        });
    });

    test('should read an unconfigured package as empty', async () => {
        expect(await getDepcheckConfig(await createPackageDirectory())).toEqual({});
    });

    test('should read a comment alongside the settings', async () => {
        const directory = await createPackageDirectory(
            JSON.stringify({ _comment: 'why these are pinned', catalogize: false }),
        );

        expect(await getDepcheckConfig(directory)).toEqual({
            _comment: 'why these are pinned',
            catalogize: false,
        });
    });

    test('should throw on a setting it does not read', async () => {
        const directory = await createPackageDirectory(JSON.stringify({ 'skip-missing': true }));

        await expect(getDepcheckConfig(directory)).rejects.toThrow('skip-missing');
    });

    test('should throw on a misspelled opt-out rather than catalogizing the package', async () => {
        const directory = await createPackageDirectory(JSON.stringify({ catalogise: false }));

        await expect(getDepcheckConfig(directory)).rejects.toThrow('catalogise');
    });

    test('should throw on a setting of the wrong type', async () => {
        const directory = await createPackageDirectory(JSON.stringify({ catalogize: 'false' }));

        await expect(getDepcheckConfig(directory)).rejects.toThrow('Invalid');
    });

    test('should throw on a malformed file', async () => {
        const directory = await createPackageDirectory('{ "ignores": [ }');

        await expect(getDepcheckConfig(directory)).rejects.toThrow('is not valid JSON');
    });

    test('should throw on an unreadable file', async () => {
        const directory = await createPackageDirectory();
        await mkdir(join(directory, '.depcheckrc'));

        await expect(getDepcheckConfig(directory)).rejects.toThrow('EISDIR');
    });
});
