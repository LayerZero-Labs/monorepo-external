import { spawnSync, type SpawnSyncReturns } from 'node:child_process';
import { createHash } from 'node:crypto';
import {
    chmodSync,
    mkdirSync,
    mkdtempSync,
    readFileSync,
    realpathSync,
    statSync,
    writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

export const PACKAGE_ROOT = fileURLToPath(new URL('../../../..', import.meta.url));
export const GUARD_BIN = join(PACKAGE_ROOT, 'docker', 'solana', 'sbf-guard');
export const DOCKERFILE = join(PACKAGE_ROOT, 'docker', 'solana', 'Dockerfile');

export const OVERFLOW_LINE =
    'Error: Function _RNvMNtNtCs8FHk3Klo7Hk_6onesig12instructions10set_configNtB2_9SetConfig5apply overflows the maximum allowed frame space by accessing an offset 4416 bytes greater than the maximum of 4096. Please, minimize large stack variables. Estimated function frame size: 8512 bytes. Exceeding the maximum stack offset may cause undefined behavior during execution.';
export const GUARD_MESSAGE = 'a function overflows its 4 KiB SBF stack frame';
export const SYSTEM_PATH = '/usr/bin:/bin';

const STUB_CARGO = `#!/bin/bash
printf '%s\\n' "$*" >> "$STUB_CARGO_CALLS"
if [ "\${1#+}" != "$1" ]; then shift; fi
case " $* " in
    (*" metadata --no-deps --format-version 1 --offline"*)
        if [ -n "\${STUB_CARGO_METADATA_EXIT:-}" ]; then echo 'error: could not read Cargo.toml' >&2; exit "$STUB_CARGO_METADATA_EXIT"; fi
        printf '%s\\n' "$STUB_CARGO_METADATA"
        exit 0
        ;;
esac
case " $* " in
    (*" locate-project --message-format plain"*)
        manifest=
        while [ $# -gt 0 ]; do
            case $1 in
                (-C) cd "$2" || exit 1; shift ;;
                (-C=*) cd "\${1#-C=}" || exit 1 ;;
                (--manifest-path) manifest=$2; shift ;;
            esac
            shift
        done
        if [ -n "$manifest" ]; then
            printf '%s/%s\\n' "$(cd "$(dirname "$manifest")" && pwd -P)" "$(basename "$manifest")"
            exit 0
        fi
        dir=$(pwd -P)
        while [ ! -f "$dir/Cargo.toml" ] && [ "$dir" != / ]; do dir=$(dirname "$dir"); done
        printf '%s/Cargo.toml\\n' "$dir"
        exit 0
        ;;
esac
if [ "$1" = build-sbf ] && [ "$2" = --version ]; then
    if [ -n "\${STUB_CARGO_VERSION_EXIT:-}" ]; then exit "$STUB_CARGO_VERSION_EXIT"; fi
    printf '%b' "\${STUB_CARGO_VERSION_OUTPUT-solana-cargo-build-sbf 4.3.0\\nplatform-tools v1.57\\nrustc 1.95.0\\n}"
    exit 0
fi
exec /bin/bash -c "$STUB_CARGO_BUILD" stub-cargo "$@"
`;

const STUB_ANCHOR = `#!/bin/bash
if [ "$1" != build ]; then exit 2; fi
cd "\${STUB_ANCHOR_PROGRAM_DIR:-.}" || exit 2
cargo build-sbf --tools-version v1.57 --arch v3
`;

export interface Fixture {
    root: string;
    workspaceDir: string;
    outsideDir: string;
    stubDir: string;
    cargoCalls: string;
}

export interface StubPackage {
    name: string;
    dir: string;
    libName?: string;
    kind?: string[];
}

export const writeExecutable = (path: string, content: string): void => {
    mkdirSync(dirname(path), { recursive: true });
    writeFileSync(path, content);
    chmodSync(path, 0o755);
};

export const writeFixtureFile = (path: string, content: string): void => {
    mkdirSync(dirname(path), { recursive: true });
    writeFileSync(path, content);
};

export const DEFAULT_PACKAGES: readonly StubPackage[] = [
    { name: 'onesig', dir: 'programs/onesig' },
    { name: 'other-program', dir: 'programs/other-program' },
    { name: 'shared-utils', dir: 'libs/shared-utils', kind: ['lib'] },
];

export const createFixture = (packages: readonly StubPackage[] = DEFAULT_PACKAGES): Fixture => {
    const root = realpathSync(mkdtempSync(join(tmpdir(), 'sbf-guard-')));
    const workspaceDir = join(root, 'workspace');
    const outsideDir = join(root, 'outside');
    const stubDir = join(root, 'stubs');
    for (const dir of [workspaceDir, outsideDir, join(root, 'tmp'), join(root, 'home')]) {
        mkdirSync(dir, { recursive: true });
    }
    writeFixtureFile(join(workspaceDir, 'Cargo.toml'), '[workspace]\n');
    for (const { name, dir } of packages) {
        writeFixtureFile(join(workspaceDir, dir, 'Cargo.toml'), `[package]\nname = "${name}"\n`);
    }
    writeExecutable(join(stubDir, 'cargo'), STUB_CARGO);
    writeExecutable(join(stubDir, 'anchor'), STUB_ANCHOR);
    return { root, workspaceDir, outsideDir, stubDir, cargoCalls: join(root, 'cargo-calls.log') };
};

export interface MetadataOptions {
    packages?: readonly StubPackage[];
    targetDirectory?: string;
    buildDirectory?: string;
}

export const cargoMetadata = (
    fixture: Fixture,
    {
        packages = DEFAULT_PACKAGES,
        targetDirectory = join(fixture.workspaceDir, 'target'),
        buildDirectory = targetDirectory,
    }: MetadataOptions = {},
): string => {
    const entries = packages.map(({ name, dir, libName, kind = ['cdylib', 'lib'] }) => ({
        name,
        id: `path+file://${join(fixture.workspaceDir, dir)}#0.1.0`,
        manifest_path: join(fixture.workspaceDir, dir, 'Cargo.toml'),
        targets: [
            { name: libName ?? name.replaceAll('-', '_'), kind, crate_types: kind },
            { name: 'build-script-build', kind: ['custom-build'], crate_types: ['bin'] },
        ],
    }));
    return JSON.stringify({
        packages: entries,
        workspace_members: entries.map(({ id }) => id),
        target_directory: targetDirectory,
        build_directory: buildDirectory,
        workspace_root: fixture.workspaceDir,
        version: 1,
    });
};

export interface RunOptions {
    build: string;
    cwd?: string;
    env?: Record<string, string>;
    metadata?: string;
}

const baseEnv = (
    fixture: Fixture,
    { build, env = {}, metadata }: RunOptions,
): Record<string, string> => ({
    HOME: join(fixture.root, 'home'),
    TMPDIR: join(fixture.root, 'tmp'),
    STUB_CARGO_CALLS: fixture.cargoCalls,
    STUB_CARGO_BUILD: build,
    STUB_CARGO_METADATA: metadata ?? cargoMetadata(fixture),
    OVERFLOW_LINE,
    ...env,
});

const run = (
    fixture: Fixture,
    script: string,
    options: RunOptions,
    path: string,
): SpawnSyncReturns<string> =>
    spawnSync('/bin/bash', ['-c', script], {
        cwd: options.cwd ?? fixture.workspaceDir,
        encoding: 'utf8',
        env: { ...baseEnv(fixture, options), PATH: path },
    });

export const guardedPath = (fixture: Fixture): string =>
    `${GUARD_BIN}:${fixture.stubDir}:${SYSTEM_PATH}`;

export const runGuarded = (
    fixture: Fixture,
    script: string,
    options: RunOptions,
): SpawnSyncReturns<string> => run(fixture, script, options, guardedPath(fixture));

export const runUnguarded = (
    fixture: Fixture,
    script: string,
    options: RunOptions,
): SpawnSyncReturns<string> => run(fixture, script, options, `${fixture.stubDir}:${SYSTEM_PATH}`);

export interface FileState {
    sha256: string;
    mtimeMs: number;
}

export const fileState = (path: string): FileState => ({
    sha256: createHash('sha256').update(readFileSync(path)).digest('hex'),
    mtimeMs: statSync(path).mtimeMs,
});

export const readPackageScripts = (): Record<string, string> => {
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

export const writeStep = (path: string, content: string): string =>
    `mkdir -p "$(dirname '${path}')" && printf '%s' '${content}' > '${path}'`;

export const OVERFLOW_STEP = 'printf "%s\\n" "$OVERFLOW_LINE" >&2';
export const STDOUT_OVERFLOW_STEP = 'printf "%s\\n" "$OVERFLOW_LINE"';
