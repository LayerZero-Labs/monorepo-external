import { readFileSync } from 'fs';
import { join, resolve } from 'path';
import { describe, expect, it } from 'vitest';

const PACKAGE_ROOT = resolve(__dirname, '..');
const SBF_BUILD_SCRIPTS = ['build:anchor', 'build:anchor:heap-profiling', 'build:anchor:native'];
const ANCHOR_BUILD = 'anchor build';
const LZ_TOOL_ANCHOR_SCRIPT = /lz-tool\s[^']*--script '([^']*)' anchor(?=\s|$)/g;
const IMAGE_GUARD_BYPASS_PATTERNS = [/sbf-build\.sh/, /cargo-build-sbf/, /\/cargo(?=[\s'"]|$)/];

const readPackageScripts = (): Record<string, string> => {
    const manifest: unknown = JSON.parse(readFileSync(join(PACKAGE_ROOT, 'package.json'), 'utf8'));
    if (
        typeof manifest !== 'object' ||
        manifest === null ||
        !('scripts' in manifest) ||
        typeof manifest.scripts !== 'object' ||
        manifest.scripts === null
    ) {
        throw new Error('package.json has no scripts object');
    }
    return Object.fromEntries(
        Object.entries(manifest.scripts).map(([name, command]) => {
            if (typeof command !== 'string') {
                throw new Error(`package.json script ${name} is not a string`);
            }
            return [name, command];
        }),
    );
};

const readPackageScript = (name: string): string => {
    const command = readPackageScripts()[name];
    if (command === undefined) {
        throw new Error(`package.json has no script ${name}`);
    }
    return command;
};

const commandsInAnchorTool = (command: string): string[] =>
    [...command.matchAll(LZ_TOOL_ANCHOR_SCRIPT)].flatMap(([, body]) =>
        (body ?? '').split(/&&|;|\n/).map((part) => part.trim()),
    );

const countOccurrences = (text: string, search: string): number => text.split(search).length - 1;

describe('SBF build scripts', () => {
    it('the SBF build scripts are the scripts that run anchor build', () => {
        const names = Object.entries(readPackageScripts())
            .filter(([, command]) => command.includes(ANCHOR_BUILD))
            .map(([name]) => name);

        expect(names.sort()).toEqual(SBF_BUILD_SCRIPTS);
    });

    it.each(SBF_BUILD_SCRIPTS)('%s runs anchor build directly in lz-tool anchor', (name) => {
        const command = readPackageScript(name);
        const anchorBuilds = commandsInAnchorTool(command).filter((part) =>
            part.startsWith(`${ANCHOR_BUILD} `),
        );

        expect(countOccurrences(command, ANCHOR_BUILD)).toBe(1);
        expect(anchorBuilds).toHaveLength(1);
    });

    it('no package script calls sbf-build.sh, cargo by path, or cargo-build-sbf', () => {
        const bypassing = Object.entries(readPackageScripts())
            .filter(([, command]) =>
                IMAGE_GUARD_BYPASS_PATTERNS.some((pattern) => pattern.test(command)),
            )
            .map(([name]) => name);

        expect(bypassing).toEqual([]);
    });
});
