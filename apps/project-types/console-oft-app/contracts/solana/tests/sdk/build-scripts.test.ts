import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const SBF_BUILD_SCRIPTS = ['build', 'build:composer', 'build:native', 'build:oft'];
const ANCHOR_BUILD = 'anchor build';
const CARGO_BUILD_SBF = 'cargo build-sbf';
const LZ_TOOL_ANCHOR_SCRIPT = /lz-tool\s[^']*--script '([^']*)' anchor(?=\s|$)/g;
const IMAGE_GUARD_BYPASS_PATTERNS = [/sbf-build\.sh/, /cargo-build-sbf/, /\/cargo(?=[\s'"]|$)/];

const readPackageFile = (path: string): string =>
    readFileSync(new URL(`../../${path}`, import.meta.url), 'utf8');

const readPackageScripts = (): Record<string, string> => {
    const manifest: unknown = JSON.parse(readPackageFile('package.json'));
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

    it('build-test-fixtures.sh runs each cargo build-sbf directly in lz-tool anchor', () => {
        const fixtures = readPackageFile('scripts/build-test-fixtures.sh');
        const isCommand = (line: string) => !line.startsWith('#');
        const sbfBuildLines = fixtures
            .split('\n')
            .map((line) => line.trim())
            .filter((line) => isCommand(line) && line.includes('build-sbf'));
        const sbfBuildsInAnchorTool = commandsInAnchorTool(fixtures).filter((part) =>
            part.startsWith(`${CARGO_BUILD_SBF} `),
        );

        expect(sbfBuildLines.length).toBeGreaterThan(0);
        expect(sbfBuildLines).toEqual(sbfBuildsInAnchorTool);
    });

    it('no build script calls sbf-build.sh, cargo by path, or cargo-build-sbf', () => {
        const sources = {
            ...readPackageScripts(),
            'scripts/build-test-fixtures.sh': readPackageFile('scripts/build-test-fixtures.sh'),
        };
        const bypassing = Object.entries(sources)
            .filter(([, command]) =>
                IMAGE_GUARD_BYPASS_PATTERNS.some((pattern) => pattern.test(command)),
            )
            .map(([name]) => name);

        expect(bypassing).toEqual([]);
    });
});
