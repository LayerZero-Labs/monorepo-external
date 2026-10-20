import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, rmSync, symlinkSync } from 'node:fs';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';

import {
    cargoMetadata,
    createFixture,
    DOCKERFILE,
    fileState,
    type Fixture,
    GUARD_BIN,
    GUARD_MESSAGE,
    guardedPath,
    OVERFLOW_LINE,
    OVERFLOW_STEP,
    readPackageScripts,
    runGuarded,
    runUnguarded,
    STDOUT_OVERFLOW_STEP,
    type StubPackage,
    SYSTEM_PATH,
    writeExecutable,
    writeFixtureFile,
    writeStep,
} from './stubs';

const BUILD_SBF = 'cargo build-sbf --tools-version v1.57 --arch v3';
const UNCHECKED_OUTPUT_MESSAGE = 'sbf-guard could not capture or read the build output';
const METADATA_FAILED_MESSAGE =
    'sbf-guard: could not find the program files of this build (cargo metadata failed); deleted nothing';
const JQ_FAILED_MESSAGE =
    'sbf-guard: could not find the program files of this build (jq could not read the cargo metadata output); deleted nothing';
const NEWLINE_PATH_MESSAGE =
    'sbf-guard: could not find the program files of this build (a directory path contains a newline); deleted nothing';
const DEPLOY_ONESIG = 'target/deploy/onesig.so';
const RELEASE_V3 = 'target/sbpfv3-solana-solana/release';

const fixtures: Fixture[] = [];
const newFixture = (packages?: readonly StubPackage[]): Fixture => {
    const fixture = createFixture(packages);
    fixtures.push(fixture);
    return fixture;
};

afterEach(() => {
    for (const fixture of fixtures.splice(0)) {
        rmSync(fixture.root, { recursive: true, force: true });
    }
});

const deletedLines = (stderr: string): string[] =>
    stderr
        .split('\n')
        .filter((line) => line.startsWith('sbf-guard: deleted '))
        .map((line) => line.slice('sbf-guard: deleted '.length))
        .sort();

const inWorkspace = (fixture: Fixture, ...paths: string[]): string[] =>
    paths.map((path) => join(fixture.workspaceDir, path)).sort();

const exists = (fixture: Fixture, path: string): boolean =>
    existsSync(join(fixture.workspaceDir, path));

const writeExisting = (fixture: Fixture, paths: readonly string[]): void => {
    for (const path of paths) {
        writeFixtureFile(join(fixture.workspaceDir, path), `existing ${path}`);
    }
};

const cargoCalls = (fixture: Fixture): string[] =>
    existsSync(fixture.cargoCalls)
        ? readFileSync(fixture.cargoCalls, 'utf8').trim().split('\n')
        : [];

describe('SBF stack-frame guard: rejection', () => {
    it('fails a v1.57 build that prints an overflow line and exits 0, keeping its output', () => {
        const fixture = newFixture();
        const build = `echo 'Compiling onesig'; ${OVERFLOW_STEP}; echo 'Finished release'`;

        const unguarded = runUnguarded(fixture, BUILD_SBF, { build });
        const result = runGuarded(fixture, BUILD_SBF, { build });

        expect(unguarded.status).toBe(0);
        expect(result.status).toBe(1);
        expect(result.stdout).toBe(unguarded.stdout);
        expect(result.stderr.startsWith(unguarded.stderr)).toBe(true);
        expect(result.stderr).toContain(OVERFLOW_LINE);
        expect(result.stderr).toContain(GUARD_MESSAGE);
    });

    it('fails a build whose overflow line is printed on stdout only', () => {
        const fixture = newFixture();
        const build = `echo 'Compiling onesig'; ${STDOUT_OVERFLOW_STEP}; ${writeStep(DEPLOY_ONESIG, 'rejected')}`;

        const unguarded = runUnguarded(fixture, BUILD_SBF, { build });
        rmSync(join(fixture.workspaceDir, 'target'), { recursive: true });
        const result = runGuarded(fixture, BUILD_SBF, { build });

        expect(unguarded.status).toBe(0);
        expect(unguarded.stderr).not.toContain(OVERFLOW_LINE);
        expect(result.status).toBe(1);
        expect(result.stdout).toBe(unguarded.stdout);
        expect(result.stdout).toContain(OVERFLOW_LINE);
        expect(result.stderr).toContain(GUARD_MESSAGE);
        expect(deletedLines(result.stderr)).toEqual(inWorkspace(fixture, DEPLOY_ONESIG));
    });

    it('fails a plain anchor build and deletes only the .so of the program it built', () => {
        const fixture = newFixture();
        writeExisting(fixture, ['target/deploy/other_program.so']);
        const build = `${writeStep(`../../${DEPLOY_ONESIG}`, 'rejected')}; ${writeStep(`../../${RELEASE_V3}/onesig.so`, 'rejected')}; ${OVERFLOW_STEP}`;

        const result = runGuarded(fixture, 'anchor build', {
            build,
            env: { STUB_ANCHOR_PROGRAM_DIR: 'programs/onesig' },
        });

        expect(result.status).toBe(1);
        expect(result.stderr).toContain(OVERFLOW_LINE);
        expect(result.stderr).toContain(GUARD_MESSAGE);
        expect(cargoCalls(fixture)).toContain('build-sbf --tools-version v1.57 --arch v3');
        expect(deletedLines(result.stderr)).toEqual(
            inWorkspace(fixture, DEPLOY_ONESIG, `${RELEASE_V3}/onesig.so`),
        );
        expect(exists(fixture, 'target/deploy/other_program.so')).toBe(true);
    });

    it('fails a direct cargo build-sbf with --manifest-path and --sbf-out-dir', () => {
        const fixture = newFixture();
        writeExisting(fixture, ['target/test-deploy/token_manager.so']);
        const args =
            '--tools-version v1.57 --arch v3 --manifest-path programs/onesig/Cargo.toml --sbf-out-dir target/test-deploy -- --locked';
        const build = `${writeStep('target/test-deploy/onesig.so', 'rejected')}; ${OVERFLOW_STEP}`;

        const result = runGuarded(fixture, `cargo build-sbf ${args}`, { build });

        expect(result.status).toBe(1);
        expect(result.stderr).toContain(GUARD_MESSAGE);
        expect(cargoCalls(fixture)).toContain(`build-sbf ${args}`);
        expect(cargoCalls(fixture)).toContain(
            'metadata --no-deps --format-version 1 --offline --manifest-path programs/onesig/Cargo.toml',
        );
        expect(deletedLines(result.stderr)).toEqual(
            inWorkspace(fixture, 'target/test-deploy/onesig.so'),
        );
        expect(exists(fixture, 'target/test-deploy/token_manager.so')).toBe(true);
    });

    it.each([
        '--locked',
        '-q',
        '+solana --frozen',
        '--color never --config net.offline=true -v',
        '-Z unstable-options -C .',
        '-qZ unstable-options',
    ])('fails cargo %s build-sbf, with cargo options before the command', (options) => {
        const fixture = newFixture();
        const args = `${options} build-sbf --tools-version v1.57 --arch v3`;
        const build = `${writeStep(DEPLOY_ONESIG, 'rejected')}; ${OVERFLOW_STEP}`;

        const result = runGuarded(fixture, `cargo ${args}`, { build });

        expect(result.status).toBe(1);
        expect(result.stderr).toContain(GUARD_MESSAGE);
        expect(cargoCalls(fixture)).toContain(args);
        expect(cargoCalls(fixture)).toContain(
            `${options} metadata --no-deps --format-version 1 --offline`,
        );
        expect(exists(fixture, DEPLOY_ONESIG)).toBe(false);
    });

    it.each([
        ['-C ../workspace', (_fixture: Fixture) => '-C ../workspace'],
        ['-C=<relative dir>', (_fixture: Fixture) => '-C=../workspace'],
        ['-C=<absolute dir>', (fixture: Fixture) => `-C=${fixture.workspaceDir}`],
    ])('with cargo %s, reads the programs of that directory', (_kind, directoryOption) => {
        const fixture = newFixture();
        const option = directoryOption(fixture);
        const build = `${writeStep(join(fixture.workspaceDir, DEPLOY_ONESIG), 'rejected')}; ${OVERFLOW_STEP}`;

        const result = runGuarded(
            fixture,
            `cargo -Z unstable-options ${option} build-sbf --tools-version v1.57`,
            { build, cwd: fixture.outsideDir },
        );

        expect(result.status).toBe(1);
        expect(result.stderr).toContain(GUARD_MESSAGE);
        expect(cargoCalls(fixture)).toContain(
            `-Z unstable-options ${option} metadata --no-deps --format-version 1 --offline`,
        );
        expect(deletedLines(result.stderr)).toEqual(inWorkspace(fixture, DEPLOY_ONESIG));
    });

    it('with cargo -C <dir>, resolves a relative --sbf-out-dir in that directory', () => {
        const fixture = newFixture();
        writeFixtureFile(join(fixture.outsideDir, 'out/onesig.so'), 'not this build');
        const build = `${writeStep(join(fixture.workspaceDir, 'out/onesig.so'), 'rejected')}; ${OVERFLOW_STEP}`;

        const result = runGuarded(
            fixture,
            'cargo -C ../workspace build-sbf --tools-version v1.57 --sbf-out-dir out',
            { build, cwd: fixture.outsideDir },
        );

        expect(result.status).toBe(1);
        expect(deletedLines(result.stderr)).toEqual(inWorkspace(fixture, 'out/onesig.so'));
        expect(readFileSync(join(fixture.outsideDir, 'out/onesig.so'), 'utf8')).toBe(
            'not this build',
        );
    });

    it.each([
        [
            'set -e',
            (first: string, second: string) => `set -e\n${first}\n${second}\ntouch ran-third`,
        ],
        ['&&', (first: string, second: string) => `${first} && ${second} && touch ran-third`],
    ])(
        'a script that stops on a failure (%s) stops with exit 1 at the rejected second build',
        (_kind, compose) => {
            const fixture = newFixture();
            const build = `case "$*" in
                (*programs/onesig/Cargo.toml*) ${writeStep(DEPLOY_ONESIG, 'first')} ;;
                (*programs/other-program/Cargo.toml*) ${writeStep('target/deploy/other_program.so', 'second')}; ${OVERFLOW_STEP} ;;
            esac`;
            const first = `${BUILD_SBF} --manifest-path programs/onesig/Cargo.toml`;
            const second = `${BUILD_SBF} --manifest-path programs/other-program/Cargo.toml`;

            const result = runGuarded(fixture, compose(first, second), { build });

            expect(result.status).toBe(1);
            expect(result.stderr).toContain(GUARD_MESSAGE);
            expect(exists(fixture, 'ran-third')).toBe(false);
            expect(readFileSync(join(fixture.workspaceDir, DEPLOY_ONESIG), 'utf8')).toBe('first');
            expect(exists(fixture, 'target/deploy/other_program.so')).toBe(false);
        },
    );

    it('keeps a non-zero build exit code, prints the guard message, and deletes the program files', () => {
        const fixture = newFixture();
        const build = `${writeStep(DEPLOY_ONESIG, 'rejected')}; ${OVERFLOW_STEP}; exit 101`;

        const result = runGuarded(fixture, BUILD_SBF, { build });

        expect(result.status).toBe(101);
        expect(result.stderr).toContain(GUARD_MESSAGE);
        expect(deletedLines(result.stderr)).toEqual(inWorkspace(fixture, DEPLOY_ONESIG));
    });

    it.each([
        ['the output capture fails', 'tee', `PATH=${SYSTEM_PATH} tee "$@"\nexit 1`],
        [
            'the output check cannot read the log',
            'grep',
            `if [ "$1" = -qF ]; then exit 2; fi\nPATH=${SYSTEM_PATH} exec grep "$@"`,
        ],
    ])('fails closed and deletes the program files when %s', (_kind, command, body) => {
        for (const step of [OVERFLOW_STEP, 'echo clean']) {
            const fixture = newFixture();
            writeExecutable(join(fixture.stubDir, command), `#!/bin/bash\n${body}\n`);
            const build = `${writeStep(DEPLOY_ONESIG, 'unchecked')}; ${step}`;

            const result = runGuarded(fixture, BUILD_SBF, { build });

            expect(result.status).toBe(1);
            expect(result.stderr).toContain(UNCHECKED_OUTPUT_MESSAGE);
            expect(result.stderr).not.toContain(GUARD_MESSAGE);
            expect(deletedLines(result.stderr)).toEqual(inWorkspace(fixture, DEPLOY_ONESIG));
        }
    });

    it.each([
        ['exits 0', '', 1],
        ['exits 101', '; exit 101', 101],
    ])(
        'fails a rejected build that %s and deletes nothing when cargo metadata fails',
        (_kind, exitStep, expectedStatus) => {
            const fixture = newFixture();
            const build = `${writeStep(DEPLOY_ONESIG, 'rejected')}; ${OVERFLOW_STEP}${exitStep}`;

            const result = runGuarded(fixture, BUILD_SBF, {
                build,
                env: { STUB_CARGO_METADATA_EXIT: '101' },
            });

            expect(result.status).toBe(expectedStatus);
            expect(result.stderr).toContain(GUARD_MESSAGE);
            expect(result.stderr).toContain(METADATA_FAILED_MESSAGE);
            expect(result.stderr).not.toContain(JQ_FAILED_MESSAGE);
            expect(deletedLines(result.stderr)).toEqual([]);
            expect(readFileSync(join(fixture.workspaceDir, DEPLOY_ONESIG), 'utf8')).toBe(
                'rejected',
            );
        },
    );

    it('fails a rejected build, names the jq step, and deletes nothing when jq cannot read the cargo metadata output', () => {
        const fixture = newFixture();
        writeExecutable(join(fixture.stubDir, 'jq'), '#!/bin/bash\nexit 5\n');
        const build = `${writeStep(DEPLOY_ONESIG, 'rejected')}; ${OVERFLOW_STEP}`;

        const result = runGuarded(fixture, BUILD_SBF, { build });

        expect(result.status).toBe(1);
        expect(result.stderr).toContain(GUARD_MESSAGE);
        expect(result.stderr).toContain(JQ_FAILED_MESSAGE);
        expect(result.stderr).not.toContain(METADATA_FAILED_MESSAGE);
        expect(deletedLines(result.stderr)).toEqual([]);
        expect(readFileSync(join(fixture.workspaceDir, DEPLOY_ONESIG), 'utf8')).toBe('rejected');
    });

    it.each([
        [
            'the target directory from cargo metadata has a newline inside',
            (fixture: Fixture) => ({
                targetDirectory: `${join(fixture.outsideDir, 'decoy-a')}\n${join(fixture.outsideDir, 'decoy-b')}`,
            }),
            (fixture: Fixture) => [
                join(fixture.outsideDir, 'decoy-a'),
                join(fixture.outsideDir, 'decoy-b/deploy/onesig.so'),
            ],
        ],
        [
            'the target directory from cargo metadata ends with a newline',
            (fixture: Fixture) => ({ targetDirectory: `${join(fixture.outsideDir, 'decoy')}\n` }),
            (fixture: Fixture) => [join(fixture.outsideDir, 'decoy/deploy/onesig.so')],
        ],
        [
            '--sbf-out-dir has a newline',
            (fixture: Fixture) => ({
                flag: ' --sbf-out-dir "$NEWLINE_DIR"',
                newlineDir: `${join(fixture.outsideDir, 'decoy-a')}\n${join(fixture.outsideDir, 'decoy-b')}`,
            }),
            (fixture: Fixture) => [
                join(fixture.outsideDir, 'decoy-a'),
                join(fixture.outsideDir, 'decoy-b/onesig.so'),
            ],
        ],
        [
            'SBF_OUT_PATH has a newline',
            (fixture: Fixture) => ({
                sbfOutPath: `${join(fixture.outsideDir, 'decoy-a')}\n${join(fixture.outsideDir, 'decoy-b')}`,
            }),
            (fixture: Fixture) => [
                join(fixture.outsideDir, 'decoy-a'),
                join(fixture.outsideDir, 'decoy-b/onesig.so'),
            ],
        ],
    ])(
        'fails a rejected build and deletes nothing, not even a file at a path fragment, when %s',
        (_kind, paths, decoys) => {
            const fixture = newFixture();
            const {
                targetDirectory = join(fixture.workspaceDir, 'target'),
                flag = '',
                newlineDir = '',
                sbfOutPath,
            }: {
                targetDirectory?: string;
                flag?: string;
                newlineDir?: string;
                sbfOutPath?: string;
            } = paths(fixture);
            const rejected = join(
                newlineDir || sbfOutPath || join(targetDirectory, 'deploy'),
                'onesig.so',
            );
            writeFixtureFile(rejected, 'rejected');
            for (const decoy of decoys(fixture)) {
                writeFixtureFile(decoy, 'decoy');
            }

            const result = runGuarded(
                fixture,
                `${BUILD_SBF}${flag} --manifest-path programs/onesig/Cargo.toml`,
                {
                    build: OVERFLOW_STEP,
                    metadata: cargoMetadata(fixture, { targetDirectory }),
                    env: {
                        NEWLINE_DIR: newlineDir,
                        ...(sbfOutPath === undefined ? {} : { SBF_OUT_PATH: sbfOutPath }),
                    },
                },
            );

            expect(result.status).toBe(1);
            expect(result.stderr).toContain(GUARD_MESSAGE);
            expect(result.stderr).toContain(NEWLINE_PATH_MESSAGE);
            expect(deletedLines(result.stderr)).toEqual([]);
            for (const decoy of decoys(fixture)) {
                expect(readFileSync(decoy, 'utf8')).toBe('decoy');
            }
            expect(readFileSync(rejected, 'utf8')).toBe('rejected');
        },
    );

    it('fails a rejected build and deletes nothing when the resolved --sbf-out-dir ends with a newline', () => {
        const fixture = newFixture();
        const newlineDir = join(fixture.workspaceDir, 'out\n');
        const decoy = join(fixture.workspaceDir, 'out/onesig.so');
        const rejected = join(newlineDir, 'onesig.so');
        writeFixtureFile(rejected, 'rejected');
        writeFixtureFile(decoy, 'decoy');

        const result = runGuarded(
            fixture,
            `${BUILD_SBF} --sbf-out-dir . --manifest-path ../programs/onesig/Cargo.toml`,
            { build: OVERFLOW_STEP, cwd: newlineDir },
        );

        expect(result.status).toBe(1);
        expect(result.stderr).toContain(GUARD_MESSAGE);
        expect(result.stderr).toContain(NEWLINE_PATH_MESSAGE);
        expect(deletedLines(result.stderr)).toEqual([]);
        expect(readFileSync(decoy, 'utf8')).toBe('decoy');
        expect(readFileSync(rejected, 'utf8')).toBe('rejected');
    });

    it('fails with exit 1 without running the build and without a message of its own when mktemp fails', () => {
        const fixture = newFixture();
        writeExisting(fixture, [DEPLOY_ONESIG]);
        writeExecutable(join(fixture.stubDir, 'mktemp'), '#!/bin/bash\nexit 1\n');

        const result = runGuarded(fixture, BUILD_SBF, { build: writeStep('build-ran', 'yes') });

        expect(result.status).toBe(1);
        expect(result.stderr).toBe('');
        expect(exists(fixture, 'build-ran')).toBe(false);
        expect(exists(fixture, DEPLOY_ONESIG)).toBe(true);
    });

    it('fails with exit 1 without running the build, prints the capture message, and deletes the program files when mkfifo fails', () => {
        const fixture = newFixture();
        writeExisting(fixture, [DEPLOY_ONESIG]);
        writeExecutable(join(fixture.stubDir, 'mkfifo'), '#!/bin/bash\nexit 1\n');

        const result = runGuarded(fixture, BUILD_SBF, { build: writeStep('build-ran', 'yes') });

        expect(result.status).toBe(1);
        expect(result.stderr).toContain(UNCHECKED_OUTPUT_MESSAGE);
        expect(exists(fixture, 'build-ran')).toBe(false);
        expect(deletedLines(result.stderr)).toEqual(inWorkspace(fixture, DEPLOY_ONESIG));
    });
});

describe('SBF stack-frame guard: version gate', () => {
    it.each(['v1.53', 'v2.0', '2.0', 'v1.57.1'])(
        'guards a build that passes --tools-version %s',
        (version) => {
            const fixture = newFixture();

            const result = runGuarded(fixture, `cargo build-sbf --tools-version ${version}`, {
                build: OVERFLOW_STEP,
            });

            expect(result.status).toBe(1);
            expect(result.stderr).toContain(GUARD_MESSAGE);
        },
    );

    it('leaves a --tools-version v1.52 build unchanged: exit code, output, and files', () => {
        const fixture = newFixture();
        const build = `echo out; ${writeStep(DEPLOY_ONESIG, 'old-tools')}; ${OVERFLOW_STEP}`;
        const command = 'cargo build-sbf --tools-version=v1.52 --arch v3';

        const unguarded = runUnguarded(fixture, command, { build });
        const unguardedFile = readFileSync(join(fixture.workspaceDir, DEPLOY_ONESIG), 'utf8');
        rmSync(join(fixture.workspaceDir, 'target'), { recursive: true });
        const result = runGuarded(fixture, command, { build });

        expect(result.status).toBe(unguarded.status);
        expect(result.stdout).toBe(unguarded.stdout);
        expect(result.stderr).toBe(unguarded.stderr);
        expect(readFileSync(join(fixture.workspaceDir, DEPLOY_ONESIG), 'utf8')).toBe(unguardedFile);
        expect(cargoCalls(fixture).filter((call) => call.includes('metadata'))).toEqual([]);
    });

    it.each([
        ['platform-tools v1.52', 0, true],
        ['platform-tools v1.57', 1, false],
        ['platform-tools v2.0', 1, false],
    ])(
        'without --tools-version, decides from the default of cargo build-sbf (%s)',
        (platformTools, expectedStatus, isFileKept) => {
            const fixture = newFixture();
            const build = `${writeStep(DEPLOY_ONESIG, 'default-tools')}; ${OVERFLOW_STEP}`;

            const result = runGuarded(fixture, 'cargo build-sbf --arch v3', {
                build,
                env: {
                    STUB_CARGO_VERSION_OUTPUT: `solana-cargo-build-sbf 4.3.0\\n${platformTools}\\nrustc 1.95.0\\n`,
                },
            });

            expect(result.status).toBe(expectedStatus);
            expect(result.stderr.includes(GUARD_MESSAGE)).toBe(!isFileKept);
            expect(exists(fixture, DEPLOY_ONESIG)).toBe(isFileKept);
            expect(cargoCalls(fixture)).toContain('build-sbf --version');
        },
    );

    it.each([
        ['cargo build-sbf --version fails', { STUB_CARGO_VERSION_EXIT: '1' }, 'cargo build-sbf'],
        [
            'no platform-tools line',
            { STUB_CARGO_VERSION_OUTPUT: 'cargo-build-sbf 9.9.9\\n' },
            'cargo build-sbf',
        ],
        ['unparsable --tools-version', {}, 'cargo build-sbf --tools-version latest'],
    ])('runs the guard when the version cannot be found (%s)', (_case, env, command) => {
        const fixture = newFixture();

        const result = runGuarded(fixture, command, { build: OVERFLOW_STEP, env });

        expect(result.status).toBe(1);
        expect(result.stderr).toContain(GUARD_MESSAGE);
    });
});

describe('SBF stack-frame guard: other builds do not change', () => {
    it('a passing v1.57 build exits 0 with byte-identical output and keeps its files', () => {
        const fixture = newFixture();
        const build = `echo 'Compiling onesig'; echo 'warning: unused' >&2; ${writeStep(DEPLOY_ONESIG, 'ok')}; echo 'Finished release'`;

        const unguarded = runUnguarded(fixture, BUILD_SBF, { build });
        const result = runGuarded(fixture, BUILD_SBF, { build });

        expect(result.status).toBe(0);
        expect(result.stdout).toBe(unguarded.stdout);
        expect(result.stderr).toBe(unguarded.stderr);
        expect(result.stderr).not.toContain(GUARD_MESSAGE);
        expect(readFileSync(join(fixture.workspaceDir, DEPLOY_ONESIG), 'utf8')).toBe('ok');
        expect(cargoCalls(fixture).filter((call) => call.includes('metadata'))).toEqual([]);
    });

    it.each([
        'build --release',
        '--version',
        '+nightly-2025-06-01 fmt --all --check',
        '+1.95.0-sbpf-solana-v1.57 build --target sbpfv3-solana-solana --release',
        'test -p onesig -- build-sbf',
        '-v build --release',
        '--color never test -- build-sbf',
        '--config build-sbf build',
        '-Z build-sbf build',
        'metadata --no-deps --format-version 1',
    ])('passes cargo %s to the real cargo unchanged, even with an overflow line', (args) => {
        const fixture = newFixture();
        const build = `echo "args:$*"; ${OVERFLOW_STEP}; exit 3`;

        const unguarded = runUnguarded(fixture, `cargo ${args}`, { build });
        const result = runGuarded(fixture, `cargo ${args}`, { build });

        expect(result.status).toBe(unguarded.status);
        expect(result.stdout).toBe(unguarded.stdout);
        expect(result.stderr).toBe(unguarded.stderr);
        expect(cargoCalls(fixture)).toEqual([args, args]);
    });

    it('a v1.57 build that fails without an overflow line keeps its exit code and files', () => {
        const fixture = newFixture();
        const build = `${writeStep(DEPLOY_ONESIG, 'partial')}; echo 'error: could not compile onesig' >&2; exit 101`;

        const unguarded = runUnguarded(fixture, BUILD_SBF, { build });
        const result = runGuarded(fixture, BUILD_SBF, { build });

        expect(result.status).toBe(101);
        expect(result.stderr).toBe(unguarded.stderr);
        expect(result.stderr).not.toContain(GUARD_MESSAGE);
        expect(readFileSync(join(fixture.workspaceDir, DEPLOY_ONESIG), 'utf8')).toBe('partial');
    });
});

describe('SBF stack-frame guard: cleanup deletes only the program .so files', () => {
    it('deletes the program .so in target/deploy and in the release directory of the arch, and keeps the .rlib, .d, IDL, and types files', () => {
        const fixture = newFixture();
        const kept = [
            `${RELEASE_V3}/libonesig.rlib`,
            `${RELEASE_V3}/onesig.d`,
            `${RELEASE_V3}/deps/onesig.so`,
            'target/idl/onesig.json',
            'target/types/onesig.ts',
        ];
        const build = `${[DEPLOY_ONESIG, `${RELEASE_V3}/onesig.so`, ...kept].map((path) => writeStep(`../../${path}`, 'rejected')).join('; ')}; ${OVERFLOW_STEP}`;

        const result = runGuarded(fixture, 'anchor build', {
            build,
            env: { STUB_ANCHOR_PROGRAM_DIR: 'programs/onesig' },
        });

        expect(result.status).toBe(1);
        expect(deletedLines(result.stderr)).toEqual(
            inWorkspace(fixture, DEPLOY_ONESIG, `${RELEASE_V3}/onesig.so`),
        );
        for (const path of kept) {
            expect(exists(fixture, path)).toBe(true);
        }
    });

    it.each([
        ['no --arch', '', 'sbpf-solana-solana'],
        ['--arch v0', ' --arch v0', 'sbpf-solana-solana'],
        ['--arch=v2', ' --arch=v2', 'sbpfv2-solana-solana'],
        ['--arch v4', ' --arch v4', 'sbpfv4-solana-solana'],
    ])(
        'with %s, deletes the .so in the release directory that cargo build-sbf uses for it',
        (_kind, archOption, triple) => {
            const fixture = newFixture();
            const otherArch = `${RELEASE_V3}/onesig.so`;
            if (triple !== 'sbpfv3-solana-solana') {
                writeExisting(fixture, [otherArch]);
            }
            const build = `${writeStep(`target/${triple}/release/onesig.so`, 'rejected')}; ${OVERFLOW_STEP}`;

            const result = runGuarded(
                fixture,
                `cargo build-sbf --tools-version v1.57${archOption} --manifest-path programs/onesig/Cargo.toml`,
                { build },
            );

            expect(result.status).toBe(1);
            expect(deletedLines(result.stderr)).toEqual(
                inWorkspace(fixture, `target/${triple}/release/onesig.so`),
            );
            expect(exists(fixture, otherArch)).toBe(true);
        },
    );

    it('deletes the .so written to --sbf-out-dir ./target relative to the program directory', () => {
        const fixture = newFixture();
        writeExisting(fixture, [DEPLOY_ONESIG]);
        const build = `${writeStep('target/onesig.so', 'rejected')}; ${OVERFLOW_STEP}`;

        const result = runGuarded(fixture, `${BUILD_SBF} --sbf-out-dir ./target`, {
            build,
            cwd: join(fixture.workspaceDir, 'programs/onesig'),
        });

        expect(result.status).toBe(1);
        expect(deletedLines(result.stderr)).toEqual(
            inWorkspace(fixture, 'programs/onesig/target/onesig.so'),
        );
        expect(exists(fixture, DEPLOY_ONESIG)).toBe(true);
    });

    it.each([
        ['SBF_OUT_PATH when no --sbf-out-dir is given', '', 'env-out/onesig.so'],
        [
            '--sbf-out-dir when SBF_OUT_PATH is also set',
            ' --sbf-out-dir=flag-out',
            'flag-out/onesig.so',
        ],
    ])('takes the out directory from %s', (_kind, flag, expected) => {
        const fixture = newFixture();
        writeExisting(fixture, ['env-out/onesig.so', 'flag-out/onesig.so', DEPLOY_ONESIG]);

        const result = runGuarded(
            fixture,
            `${BUILD_SBF}${flag} --manifest-path programs/onesig/Cargo.toml`,
            { build: OVERFLOW_STEP, env: { SBF_OUT_PATH: 'env-out' } },
        );

        expect(result.status).toBe(1);
        expect(deletedLines(result.stderr)).toEqual(inWorkspace(fixture, expected));
    });

    it.each([
        ['at the workspace root, every workspace member with a cdylib target', BUILD_SBF, ''],
        [
            'with --workspace in a member directory, every workspace member with a cdylib target',
            `${BUILD_SBF} --workspace`,
            'programs/onesig',
        ],
        [
            'with --all (the --workspace alias) in a member directory, every workspace member with a cdylib target',
            `${BUILD_SBF} --all`,
            'programs/onesig',
        ],
        [
            'with -- --workspace in a member directory, every workspace member with a cdylib target',
            `${BUILD_SBF} -- --workspace`,
            'programs/onesig',
        ],
    ])('selects %s', (_kind, command, cwd) => {
        const fixture = newFixture();
        writeExisting(fixture, [
            DEPLOY_ONESIG,
            'target/deploy/other_program.so',
            'target/deploy/shared_utils.so',
        ]);

        const result = runGuarded(fixture, command, {
            build: OVERFLOW_STEP,
            cwd: join(fixture.workspaceDir, cwd),
        });

        expect(result.status).toBe(1);
        expect(deletedLines(result.stderr)).toEqual(
            inWorkspace(fixture, DEPLOY_ONESIG, 'target/deploy/other_program.so'),
        );
        expect(exists(fixture, 'target/deploy/shared_utils.so')).toBe(true);
    });

    it('in a subdirectory of a program, selects only the package of the nearest Cargo.toml', () => {
        const fixture = newFixture();
        writeExisting(fixture, [
            DEPLOY_ONESIG,
            'target/deploy/other_program.so',
            'programs/other-program/src/lib.rs',
        ]);

        const result = runGuarded(fixture, BUILD_SBF, {
            build: OVERFLOW_STEP,
            cwd: join(fixture.workspaceDir, 'programs/other-program/src'),
        });

        expect(result.status).toBe(1);
        expect(deletedLines(result.stderr)).toEqual(
            inWorkspace(fixture, 'target/deploy/other_program.so'),
        );
        expect(exists(fixture, DEPLOY_ONESIG)).toBe(true);
    });

    it.each([
        ['-- -p other-program', '-- -p other-program'],
        ['-- --package=other-program@0.1.0', '-- --package=other-program@0.1.0'],
        ['-- -pother-program', '-- -pother-program'],
    ])('selects only the package named by cargo %s', (_kind, packageArgs) => {
        const fixture = newFixture();
        writeExisting(fixture, [DEPLOY_ONESIG, 'target/deploy/other_program.so']);

        const result = runGuarded(fixture, `${BUILD_SBF} ${packageArgs}`, {
            build: OVERFLOW_STEP,
        });

        expect(result.status).toBe(1);
        expect(deletedLines(result.stderr)).toEqual(
            inWorkspace(fixture, 'target/deploy/other_program.so'),
        );
        expect(exists(fixture, DEPLOY_ONESIG)).toBe(true);
    });

    it('names the file by the lib target name, with - replaced by _', () => {
        const packages: StubPackage[] = [
            { name: 'token-manager', dir: 'programs/token-manager', libName: 'tm-core' },
        ];
        const fixture = newFixture(packages);
        writeExisting(fixture, ['target/deploy/tm_core.so', 'target/deploy/token_manager.so']);

        const result = runGuarded(fixture, BUILD_SBF, {
            build: OVERFLOW_STEP,
            metadata: cargoMetadata(fixture, { packages }),
        });

        expect(result.status).toBe(1);
        expect(deletedLines(result.stderr)).toEqual(
            inWorkspace(fixture, 'target/deploy/tm_core.so'),
        );
        expect(exists(fixture, 'target/deploy/token_manager.so')).toBe(true);
    });

    it('uses the target directory that cargo metadata reports', () => {
        const fixture = newFixture();
        const targetDirectory = join(fixture.outsideDir, 'custom-target');
        writeFixtureFile(join(targetDirectory, 'deploy/onesig.so'), 'rejected');
        writeExisting(fixture, [DEPLOY_ONESIG]);

        const result = runGuarded(
            fixture,
            `${BUILD_SBF} --manifest-path programs/onesig/Cargo.toml`,
            { build: OVERFLOW_STEP, metadata: cargoMetadata(fixture, { targetDirectory }) },
        );

        expect(result.status).toBe(1);
        expect(deletedLines(result.stderr)).toEqual([join(targetDirectory, 'deploy/onesig.so')]);
        expect(exists(fixture, DEPLOY_ONESIG)).toBe(true);
    });

    it('with cargo -- --target-dir <relative dir>, deletes the .so in that deploy and release directory, relative to the build directory, and keeps the same-named .so in the default target directory', () => {
        const fixture = newFixture();
        const rejected = [
            'programs/onesig/custom-target/deploy/onesig.so',
            'programs/onesig/custom-target/sbpfv3-solana-solana/release/onesig.so',
        ];
        const kept = [
            DEPLOY_ONESIG,
            `${RELEASE_V3}/onesig.so`,
            'custom-target/deploy/onesig.so',
            'custom-target/sbpfv3-solana-solana/release/onesig.so',
        ];
        writeExisting(fixture, [...rejected, ...kept]);

        const result = runGuarded(fixture, `${BUILD_SBF} -- --target-dir custom-target`, {
            build: OVERFLOW_STEP,
            cwd: join(fixture.workspaceDir, 'programs/onesig'),
        });

        expect(result.status).toBe(1);
        expect(deletedLines(result.stderr)).toEqual(inWorkspace(fixture, ...rejected));
        for (const path of kept) {
            expect(readFileSync(join(fixture.workspaceDir, path), 'utf8')).toBe(`existing ${path}`);
        }
    });

    it.each([
        [
            'relative to the package directory of the manifest',
            `${BUILD_SBF} --manifest-path programs/onesig/Cargo.toml -- --target-dir=custom-target`,
            '',
            ['programs/onesig/custom-target/sbpfv3-solana-solana/release/onesig.so', DEPLOY_ONESIG],
            [
                'custom-target/sbpfv3-solana-solana/release/onesig.so',
                'programs/onesig/custom-target/deploy/onesig.so',
                `${RELEASE_V3}/onesig.so`,
            ],
        ],
        [
            'relative to the workspace root with --workspace',
            `${BUILD_SBF} --workspace -- --target-dir=custom-target`,
            'programs/onesig',
            ['custom-target/sbpfv3-solana-solana/release/onesig.so', DEPLOY_ONESIG],
            [
                'programs/onesig/custom-target/sbpfv3-solana-solana/release/onesig.so',
                'custom-target/deploy/onesig.so',
                `${RELEASE_V3}/onesig.so`,
            ],
        ],
    ])(
        'with cargo -- --target-dir=<relative dir>, deletes the .so that cargo writes to that release directory, %s, and the .so in the default deploy directory',
        (_kind, command, cwd, rejected, kept) => {
            const fixture = newFixture();
            writeExisting(fixture, [...rejected, ...kept]);

            const result = runGuarded(fixture, command, {
                build: OVERFLOW_STEP,
                cwd: join(fixture.workspaceDir, cwd),
            });

            expect(result.status).toBe(1);
            expect(deletedLines(result.stderr)).toEqual(inWorkspace(fixture, ...rejected));
            for (const path of kept) {
                expect(readFileSync(join(fixture.workspaceDir, path), 'utf8')).toBe(
                    `existing ${path}`,
                );
            }
        },
    );

    it('with --sbf-out-dir and cargo -- --target-dir, takes the out directory from --sbf-out-dir and the release directory from --target-dir', () => {
        const fixture = newFixture();
        const rejected = ['out/onesig.so', 'custom-target/sbpfv3-solana-solana/release/onesig.so'];
        const kept = [DEPLOY_ONESIG, `${RELEASE_V3}/onesig.so`, 'custom-target/deploy/onesig.so'];
        writeExisting(fixture, [...rejected, ...kept]);

        const result = runGuarded(
            fixture,
            `${BUILD_SBF} --sbf-out-dir out --manifest-path programs/onesig/Cargo.toml -- --target-dir custom-target`,
            { build: OVERFLOW_STEP },
        );

        expect(result.status).toBe(1);
        expect(deletedLines(result.stderr)).toEqual(inWorkspace(fixture, ...rejected));
        for (const path of kept) {
            expect(exists(fixture, path)).toBe(true);
        }
    });

    it('with cargo -- --target-dir <symlink>/.., deletes the .so in the physical directory that the build wrote, not in the logical sibling', () => {
        const fixture = newFixture();
        mkdirSync(join(fixture.outsideDir, 'sub'), { recursive: true });
        symlinkSync(
            join(fixture.outsideDir, 'sub'),
            join(fixture.workspaceDir, 'programs/onesig/link'),
        );
        const rejected = [
            join(fixture.outsideDir, 'custom-target/deploy/onesig.so'),
            join(fixture.outsideDir, 'custom-target/sbpfv3-solana-solana/release/onesig.so'),
        ];
        const kept = [
            'programs/onesig/custom-target/deploy/onesig.so',
            'programs/onesig/custom-target/sbpfv3-solana-solana/release/onesig.so',
        ];
        for (const path of rejected) {
            writeFixtureFile(path, 'rejected');
        }
        writeExisting(fixture, kept);

        const result = runGuarded(fixture, `${BUILD_SBF} -- --target-dir link/../custom-target`, {
            build: OVERFLOW_STEP,
            cwd: join(fixture.workspaceDir, 'programs/onesig'),
        });

        expect(result.status).toBe(1);
        expect(deletedLines(result.stderr)).toEqual([...rejected].sort());
        for (const path of kept) {
            expect(readFileSync(join(fixture.workspaceDir, path), 'utf8')).toBe(`existing ${path}`);
        }
    });

    it('with cargo -- --target-dir=-P, deletes the .so in <package dir>/-P and nothing under HOME', () => {
        const fixture = newFixture();
        const home = join(fixture.root, 'home');
        const rejected = [
            'programs/onesig/-P/sbpfv3-solana-solana/release/onesig.so',
            DEPLOY_ONESIG,
        ];
        const kept = [
            join(home, 'sbpfv3-solana-solana/release/onesig.so'),
            join(home, 'deploy/onesig.so'),
        ];
        writeExisting(fixture, rejected);
        for (const path of kept) {
            writeFixtureFile(path, 'not this build');
        }

        const result = runGuarded(
            fixture,
            `${BUILD_SBF} --manifest-path programs/onesig/Cargo.toml -- --target-dir=-P`,
            { build: OVERFLOW_STEP, env: { HOME: home } },
        );

        expect(result.status).toBe(1);
        expect(deletedLines(result.stderr)).toEqual(inWorkspace(fixture, ...rejected));
        for (const path of kept) {
            expect(readFileSync(path, 'utf8')).toBe('not this build');
        }
    });

    it('with an exported CDPATH, resolves a relative --sbf-out-dir in the build directory', () => {
        const fixture = newFixture();
        const decoy = join(fixture.outsideDir, 'out/onesig.so');
        writeFixtureFile(decoy, 'not this build');
        writeExisting(fixture, ['out/onesig.so']);

        const result = runGuarded(
            fixture,
            `${BUILD_SBF} --manifest-path programs/onesig/Cargo.toml --sbf-out-dir out`,
            { build: OVERFLOW_STEP, env: { CDPATH: fixture.outsideDir } },
        );

        expect(result.status).toBe(1);
        expect(deletedLines(result.stderr)).toEqual(inWorkspace(fixture, 'out/onesig.so'));
        expect(readFileSync(decoy, 'utf8')).toBe('not this build');
    });

    it.each([
        ['cargo -- --target-dir <dir> has a newline', '-- --target-dir "$NEWLINE_DIR"'],
        ['cargo -- --target-dir=<dir> has a newline', '-- "--target-dir=$NEWLINE_DIR"'],
    ])('fails a rejected build and deletes nothing when %s', (_kind, targetDirArgs) => {
        const fixture = newFixture();
        const newlineDir = `${join(fixture.outsideDir, 'decoy-a')}\n${join(fixture.outsideDir, 'decoy-b')}`;
        const decoys = [
            join(fixture.outsideDir, 'decoy-a'),
            join(fixture.outsideDir, 'decoy-b/deploy/onesig.so'),
            join(fixture.outsideDir, 'decoy-b/sbpfv3-solana-solana/release/onesig.so'),
        ];
        for (const decoy of decoys) {
            writeFixtureFile(decoy, 'decoy');
        }
        writeExisting(fixture, [DEPLOY_ONESIG, `${RELEASE_V3}/onesig.so`]);

        const result = runGuarded(
            fixture,
            `${BUILD_SBF} --manifest-path programs/onesig/Cargo.toml ${targetDirArgs}`,
            { build: OVERFLOW_STEP, env: { NEWLINE_DIR: newlineDir } },
        );

        expect(result.status).toBe(1);
        expect(result.stderr).toContain(GUARD_MESSAGE);
        expect(result.stderr).toContain(NEWLINE_PATH_MESSAGE);
        expect(deletedLines(result.stderr)).toEqual([]);
        for (const decoy of decoys) {
            expect(readFileSync(decoy, 'utf8')).toBe('decoy');
        }
        expect(exists(fixture, DEPLOY_ONESIG)).toBe(true);
        expect(exists(fixture, `${RELEASE_V3}/onesig.so`)).toBe(true);
    });

    it('fails a rejected build and deletes nothing when cargo -- --target-dir . resolves to a directory that ends with a newline', () => {
        const fixture = newFixture();
        const newlineDir = join(fixture.workspaceDir, 'out\n');
        const decoy = join(fixture.workspaceDir, 'out/deploy/onesig.so');
        const rejected = join(newlineDir, 'deploy/onesig.so');
        writeFixtureFile(rejected, 'rejected');
        writeFixtureFile(decoy, 'decoy');
        writeExisting(fixture, [DEPLOY_ONESIG]);

        const result = runGuarded(
            fixture,
            `${BUILD_SBF} --manifest-path ../programs/onesig/Cargo.toml -- --target-dir .`,
            { build: OVERFLOW_STEP, cwd: newlineDir },
        );

        expect(result.status).toBe(1);
        expect(result.stderr).toContain(NEWLINE_PATH_MESSAGE);
        expect(deletedLines(result.stderr)).toEqual([]);
        expect(readFileSync(decoy, 'utf8')).toBe('decoy');
        expect(readFileSync(rejected, 'utf8')).toBe('rejected');
        expect(exists(fixture, DEPLOY_ONESIG)).toBe(true);
    });

    it('deletes the program .so that a cached rebuild left in place without writing it', () => {
        const fixture = newFixture();
        writeExisting(fixture, [DEPLOY_ONESIG, `${RELEASE_V3}/onesig.so`]);

        const result = runGuarded(
            fixture,
            `${BUILD_SBF} --manifest-path programs/onesig/Cargo.toml`,
            { build: `echo 'Fresh onesig' >&2; ${OVERFLOW_STEP}` },
        );

        expect(result.status).toBe(1);
        expect(deletedLines(result.stderr)).toEqual(
            inWorkspace(fixture, DEPLOY_ONESIG, `${RELEASE_V3}/onesig.so`),
        );
    });

    it('leaves every file that is not a program .so of this call unchanged, byte for byte', () => {
        const fixture = newFixture();
        const untouched = [
            'target/test-deploy/token_manager.so',
            'target/deploy/other_program.so',
            'target/deploy/onesig-keypair.json',
            `${RELEASE_V3}/.cargo-lock`,
            `${RELEASE_V3}/other_program.so`,
            `${RELEASE_V3}/libonesig.rlib`,
            'target/idl/onesig.json',
        ];
        writeExisting(fixture, untouched);
        const before = untouched.map((path) => fileState(join(fixture.workspaceDir, path)));
        const build = `${writeStep(DEPLOY_ONESIG, 'rejected')}; ${OVERFLOW_STEP}`;

        const result = runGuarded(
            fixture,
            `${BUILD_SBF} --manifest-path programs/onesig/Cargo.toml`,
            { build },
        );

        expect(result.status).toBe(1);
        expect(untouched.map((path) => fileState(join(fixture.workspaceDir, path)))).toEqual(
            before,
        );
        expect(deletedLines(result.stderr)).toEqual(inWorkspace(fixture, DEPLOY_ONESIG));
    });

    it('deletes nothing in the cargo build directory (the lz-tool cache volume)', () => {
        const fixture = newFixture();
        const buildDirectory = join(fixture.outsideDir, 'cargo-target/key');
        const cached = [
            join(buildDirectory, 'sbpfv3-solana-solana/release/deps/onesig.so'),
            join(buildDirectory, 'sbpfv3-solana-solana/release/deps/libonesig.rlib'),
        ];
        const metadata = cargoMetadata(fixture, { buildDirectory });
        const build = `${cached.map((path) => writeStep(path, 'cache')).join('; ')}; ${writeStep(DEPLOY_ONESIG, 'rejected')}; ${OVERFLOW_STEP}`;

        const result = runGuarded(
            fixture,
            `${BUILD_SBF} --manifest-path programs/onesig/Cargo.toml`,
            { build, metadata },
        );

        expect(result.status).toBe(1);
        for (const path of cached) {
            expect(readFileSync(path, 'utf8')).toBe('cache');
        }
        expect(deletedLines(result.stderr)).toEqual(inWorkspace(fixture, DEPLOY_ONESIG));
    });

    it('prints sbf-guard: deleted <path> for each program file that existed, and nothing for the others', () => {
        const fixture = newFixture();
        writeExisting(fixture, ['target/deploy/other_program.so']);

        const result = runGuarded(fixture, BUILD_SBF, { build: OVERFLOW_STEP });

        expect(result.status).toBe(1);
        expect(result.stderr.split('\n').filter((line) => line.startsWith('sbf-guard:'))).toEqual([
            `sbf-guard: deleted ${join(fixture.workspaceDir, 'target/deploy/other_program.so')}`,
        ]);
    });
});

describe('SBF stack-frame guard: image and test command', () => {
    it('the Solana image installs the wrapper and puts its directory first on PATH, so every tool gets it, also with --no-default-volumes', () => {
        const lines = readFileSync(DOCKERFILE, 'utf8').split('\n');

        const copyIndex = lines.indexOf(
            'COPY --chmod=755 sbf-guard/cargo /opt/sbf-guard/bin/cargo',
        );
        const pathIndex = lines.indexOf('ENV PATH=/opt/sbf-guard/bin:$PATH');
        const finalStageIndex = lines.findLastIndex((line) => line.startsWith('FROM '));

        expect(copyIndex).toBeGreaterThan(finalStageIndex);
        expect(pathIndex).toBeGreaterThan(copyIndex);
        expect(lines.slice(pathIndex + 1).filter((line) => line.startsWith('ENV PATH='))).toEqual(
            [],
        );
    });

    it('the package test script runs the Docker-free guard tests with their own vitest config', () => {
        const scripts = readPackageScripts();

        expect(scripts['test:guard']).toBe('vitest --run --config vitest.guard.config.ts');
        expect(scripts.test).toContain('pnpm run test:guard');
        expect(scripts.test).toContain('vitest --run');
    });

    it('the guard tests resolve cargo to the wrapper and anchor to a stub, never to a real toolchain', () => {
        const fixture = newFixture();
        const resolve = (command: string): string =>
            spawnSync('/bin/bash', ['-c', `command -v ${command}`], {
                encoding: 'utf8',
                env: { PATH: guardedPath(fixture) },
            }).stdout.trim();

        expect(resolve('cargo')).toBe(join(GUARD_BIN, 'cargo'));
        expect(resolve('anchor')).toBe(join(fixture.stubDir, 'anchor'));
        expect(resolve('jq')).toMatch(/^\/(usr\/)?bin\/jq$/);
    });
});
