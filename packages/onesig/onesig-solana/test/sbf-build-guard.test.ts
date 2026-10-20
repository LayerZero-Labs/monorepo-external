import { spawnSync } from 'child_process';
import { readFileSync } from 'fs';
import { join, resolve } from 'path';
import { describe, expect, it } from 'vitest';

const PACKAGE_ROOT = resolve(__dirname, '..');
const GUARD_SCRIPT = join(PACKAGE_ROOT, 'scripts', 'sbf-build.sh');
const GUARDED_ANCHOR_BUILD = 'bash scripts/sbf-build.sh anchor build';
const SBF_BUILD_SCRIPTS = ['build:anchor', 'build:anchor:native', 'build:anchor:heap-profiling'];

const OVERFLOW_LINE =
    'Error: Function _RNvMNtNtCs8FHk3Klo7Hk_6onesig12instructions10set_configNtB2_9SetConfig5apply overflows the maximum allowed frame space by accessing an offset 4416 bytes greater than the maximum of 4096. Please, minimize large stack variables. Estimated function frame size: 8512 bytes. Exceeding the maximum stack offset may cause undefined behavior during execution.';
const GUARD_MESSAGE = 'a function overflows its 4 KiB SBF stack frame';

const runStub = (stub: string) =>
    spawnSync('bash', ['-c', stub], { cwd: PACKAGE_ROOT, encoding: 'utf8' });

const runGuarded = (stub: string) =>
    spawnSync('bash', [GUARD_SCRIPT, 'bash', '-c', stub], {
        cwd: PACKAGE_ROOT,
        encoding: 'utf8',
    });

const countOccurrences = (text: string, search: string): number => text.split(search).length - 1;

const unguardedAnchorBuildCount = (script: string): number =>
    countOccurrences(script, 'anchor build') - countOccurrences(script, GUARDED_ANCHOR_BUILD);

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

describe('SBF build stack-frame guard', () => {
    it('STACK-1.S1: fails and names the cause when the compiler reports a stack-frame overflow', () => {
        const result = runGuarded(`echo '${OVERFLOW_LINE}'; echo 'Finished release'`);

        expect(result.status).toBe(1);
        expect(result.stdout).toContain(OVERFLOW_LINE);
        expect(result.stderr).toContain(GUARD_MESSAGE);
    });

    it('STACK-1.S2: exits 0 with unchanged output when no function overflows', () => {
        const stub = "echo 'Compiling onesig'; echo 'warning: unused' >&2; echo 'Finished release'";
        const unguarded = runStub(`(${stub}) 2>&1`);

        const result = runGuarded(stub);

        expect(result.status).toBe(0);
        expect(result.stdout).toBe(unguarded.stdout);
        expect(result.stderr).toBe('');
    });

    it('STACK-1.S3: fails with the build failure when the build command itself fails', () => {
        const result = runGuarded("echo 'error: could not compile onesig'; exit 1");

        expect(result.status).toBe(1);
        expect(result.stdout).toContain('error: could not compile onesig');
        expect(result.stderr).not.toContain(GUARD_MESSAGE);
    });

    it.each(SBF_BUILD_SCRIPTS)('STACK-1.S4: %s runs anchor build through the guard', (name) => {
        const script = readPackageScripts()[name];

        expect(script).toContain(GUARDED_ANCHOR_BUILD);
        expect(unguardedAnchorBuildCount(script ?? '')).toBe(0);
    });

    it('STACK-1.S4: no package script runs anchor build without the guard', () => {
        const unguarded = Object.entries(readPackageScripts())
            .filter(([, command]) => unguardedAnchorBuildCount(command) > 0)
            .map(([name]) => name);

        expect(unguarded).toEqual([]);
    });

    it('STACK-1.S4: the wiring check detects an unguarded anchor build', () => {
        expect(
            unguardedAnchorBuildCount(
                "pnpm exec lz-tool --script 'anchor build --ignore-keys' anchor",
            ),
        ).toBe(1);
    });
});
