import { mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'fs';
import JSON5 from 'json5';
import os from 'os';
import { dirname, join } from 'path';
import { afterEach, describe, expect, it } from 'vitest';

import { COPY_EXTENSIONS, EXCLUDE_DIR, EXCLUDE_FILE } from '../../src/resolve/exclude';
import { collectFiles } from '../../src/resolve/io';

const ROOT_TURBO_CONFIG = new URL('../../../../../../turbo.jsonc', import.meta.url).pathname;

const EXTENSION_PATTERN = /^\*\*\/\*(\.[^*/]+)$/;
const EXCLUDED_DIR_PATTERN = /^!\*\*\/([^*/]+)\/\*\*$/;
const EXCLUDED_FILE_PATTERN = /^!\*\*\/([^*/]+)$/;

const readRootVendorInputs = (): string[] => {
    const config = JSON5.parse(readFileSync(ROOT_TURBO_CONFIG, 'utf-8')) as {
        tasks?: { vendor?: { inputs?: unknown } };
    };
    const inputs = config.tasks?.vendor?.inputs;
    expect(inputs, 'turbo.jsonc defines tasks.vendor.inputs').toBeInstanceOf(Array);
    return inputs as string[];
};

const captureAll = (patterns: string[], pattern: RegExp): string[] =>
    patterns.flatMap((input) => {
        const match = pattern.exec(input);
        return match ? [match[1]] : [];
    });

let fixtureRoot: string | undefined;

afterEach(() => {
    if (fixtureRoot) rmSync(fixtureRoot, { recursive: true, force: true });
    fixtureRoot = undefined;
});

describe('root vendor task inputs', () => {
    it('use only extension includes and directory or file name excludes', () => {
        const inputs = readRootVendorInputs();
        const unrecognized = inputs.filter(
            (input) =>
                ![EXTENSION_PATTERN, EXCLUDED_DIR_PATTERN, EXCLUDED_FILE_PATTERN].some((pattern) =>
                    pattern.test(input),
                ),
        );

        expect(unrecognized).toEqual([]);
    });

    it('include exactly the file extensions that the resolver copies', () => {
        const extensions = captureAll(readRootVendorInputs(), EXTENSION_PATTERN);

        expect([...extensions].sort()).toEqual([...COPY_EXTENSIONS].sort());
    });

    it('exclude exactly the directory and file names that the resolver skips', () => {
        const inputs = readRootVendorInputs();

        expect([...captureAll(inputs, EXCLUDED_DIR_PATTERN)].sort()).toEqual(
            [...EXCLUDE_DIR].sort(),
        );
        expect([...captureAll(inputs, EXCLUDED_FILE_PATTERN)].sort()).toEqual(
            [...EXCLUDE_FILE].sort(),
        );
    });

    it('exclude only directories and files that the resolver does not copy', async () => {
        const inputs = readRootVendorInputs();
        const excludedDirs = captureAll(inputs, EXCLUDED_DIR_PATTERN);
        const excludedFiles = captureAll(inputs, EXCLUDED_FILE_PATTERN);
        fixtureRoot = realpathSync(mkdtempSync(join(os.tmpdir(), 'build-utils-vendor-inputs-')));
        const root = fixtureRoot;
        const writeFixtureFile = (relativePath: string) => {
            mkdirSync(dirname(join(root, relativePath)), { recursive: true });
            writeFileSync(join(root, relativePath), '');
        };
        const copiedFiles = ['Cargo.toml', join('src', 'lib.rs'), join('src', 'data.json')];
        copiedFiles.forEach(writeFixtureFile);
        excludedDirs.forEach((dir) => {
            writeFixtureFile(join(dir, 'lib.rs'));
            writeFixtureFile(join('src', dir, 'lib.rs'));
        });
        excludedFiles.forEach((file) => {
            writeFixtureFile(file);
            writeFixtureFile(join('src', file));
        });

        const collected = await collectFiles(root);

        expect(excludedDirs.length).toBeGreaterThan(0);
        expect(excludedFiles.length).toBeGreaterThan(0);
        expect([...collected.files].sort()).toEqual([...copiedFiles].sort());
    });
});
