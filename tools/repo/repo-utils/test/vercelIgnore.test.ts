import { spawnSync } from 'node:child_process';
import {
    chmodSync,
    existsSync,
    mkdirSync,
    mkdtempSync,
    readFileSync,
    rmSync,
    writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

const script = resolve(import.meta.dirname, '../../vercel-ignore.sh');

const gitEnv = {
    GIT_CONFIG_NOSYSTEM: '1',
    GIT_AUTHOR_NAME: 'test',
    GIT_AUTHOR_EMAIL: 'test@example.com',
    GIT_COMMITTER_NAME: 'test',
    GIT_COMMITTER_EMAIL: 'test@example.com',
};

describe('vercel-ignore', () => {
    let sandbox: string;
    let origin: string;
    let work: string;
    let bin: string;
    let log: string;
    let mainSha: string;
    let docsSha: string;
    let scanSha: string;
    let stackSha: string;

    beforeEach(() => {
        sandbox = mkdtempSync(join(tmpdir(), 'vercel-ignore-'));
        origin = join(sandbox, 'origin');
        work = join(sandbox, 'work');
        bin = join(sandbox, 'bin');
        log = join(sandbox, 'commands.log');
        mkdirSync(bin);

        writeExecutable(
            join(bin, 'npx'),
            `#!/bin/bash
printf '%s\\n' "$*" >> "$MOCK_LOG"
[ "$3" = "query" ] && [ "$4" = "affected" ] && exit "$MOCK_AFFECTED_STATUS"
if [ "$3" = "query" ] && [ "$4" = "ls" ]; then
    [ "$MOCK_LS_STATUS" = "0" ] && printf '{"name": "%s"}\\n' "\${@: -1}"
    exit "$MOCK_LS_STATUS"
fi
exit 2
`,
        );

        mkdirSync(origin);
        git(origin, ['init', '-b', 'main']);
        git(origin, ['config', 'user.name', 'test']);
        git(origin, ['config', 'user.email', 'test@example.com']);
        git(origin, ['config', 'commit.gpgsign', 'false']);
        mkdirSync(join(origin, 'apps/scan'), { recursive: true });
        mkdirSync(join(origin, 'docs'), { recursive: true });
        mkdirSync(join(origin, 'tools/repo'), { recursive: true });
        writeFileSync(join(origin, 'pnpm-workspace.yaml'), 'catalog:\n    turbo: 2.10.8\n');
        writeFileSync(join(origin, 'tools/repo/vercel-build.sh'), '#!/bin/bash\n');
        writeFileSync(join(origin, 'docs/readme.md'), 'docs\n');
        writeFileSync(join(origin, 'apps/scan/index.js'), 'scan\n');
        git(origin, ['add', '-A']);
        git(origin, ['commit', '-m', 'main']);
        mainSha = git(origin, ['rev-parse', 'HEAD']);

        git(origin, ['checkout', '-b', 'docs-only']);
        writeFileSync(join(origin, 'docs/readme.md'), 'docs-only\n');
        git(origin, ['add', 'docs/readme.md']);
        git(origin, ['commit', '-m', 'docs']);
        docsSha = git(origin, ['rev-parse', 'HEAD']);

        git(origin, ['checkout', 'main']);
        git(origin, ['checkout', '-b', 'scan-change']);
        writeFileSync(join(origin, 'apps/scan/index.js'), 'scan-changed\n');
        git(origin, ['add', 'apps/scan/index.js']);
        git(origin, ['commit', '-m', 'scan']);
        scanSha = git(origin, ['rev-parse', 'HEAD']);

        git(origin, ['checkout', '-b', 'scan-then-docs']);
        writeFileSync(join(origin, 'docs/readme.md'), 'docs-after-scan\n');
        git(origin, ['add', 'docs/readme.md']);
        git(origin, ['commit', '-m', 'docs after scan']);
        stackSha = git(origin, ['rev-parse', 'HEAD']);
        git(origin, ['checkout', 'main']);
    });

    afterEach(() => {
        rmSync(sandbox, { recursive: true, force: true });
    });

    it('skips a first-push preview by comparing against origin/main', () => {
        clone('docs-only');

        const result = run({ previousDeployment: '' });

        expect(result.status).toBe(0);
        expect(npxLog()).toContain(
            `turbo@2.10.8 query affected --base=${mainSha} --head=${docsSha} --packages=app --exit-code`,
        );
    });

    it('treats an unset previous SHA like an empty one', () => {
        clone('docs-only');

        const result = run({ previousDeployment: null });

        expect(result.status).toBe(0);
        expect(npxLog()).toContain(`--base=${mainSha} --head=${docsSha}`);
    });

    it('skips when invoked from the app directory, not the repo root', () => {
        clone('docs-only');

        const result = run({ previousDeployment: '', cwd: join(work, 'apps/scan') });

        expect(result.status).toBe(0);
        expect(npxLog()).toContain(`--base=${mainSha} --head=${docsSha}`);
    });

    it('builds a first-push when the package is affected vs main', () => {
        clone('scan-change');

        expect(run({ previousDeployment: '', affectedStatus: 1 }).status).toBe(1);
        expect(npxLog()).toContain(
            `--base=${mainSha} --head=${scanSha} --packages=app --exit-code`,
        );
    });

    it('compares incremental pushes to the previous deploy, not main', () => {
        clone('scan-then-docs');

        const result = run({ previousDeployment: scanSha });

        expect(result.status).toBe(0);
        expect(npxLog()).toContain(
            `--base=${scanSha} --head=${stackSha} --packages=app --exit-code`,
        );
        expect(npxLog()).not.toContain(`--base=${mainSha}`);
    });

    it('compares incremental pushes without a fetch when the previous SHA is already local', () => {
        clone('scan-then-docs', []);

        const result = run({ previousDeployment: scanSha });

        expect(result.status).toBe(0);
        expect(npxLog()).toContain(`--base=${scanSha} --head=${stackSha}`);
        expect(npxLog()).not.toContain(`--base=${mainSha}`);
    });

    it('builds an incremental push when Turbo reports the package affected', () => {
        clone('scan-then-docs');

        expect(run({ previousDeployment: scanSha, affectedStatus: 1 }).status).toBe(1);
        expect(npxLog()).toContain(`--base=${scanSha} --head=${stackSha}`);
    });

    it('falls back to origin/main when the previous deploy SHA is gone (force-push)', () => {
        clone('docs-only');

        const result = run({ previousDeployment: '0'.repeat(40) });

        expect(result.status).toBe(0);
        expect(npxLog()).toContain(
            `--base=${mainSha} --head=${docsSha} --packages=app --exit-code`,
        );
    });

    it('builds production without a previous deploy SHA', () => {
        clone('main');

        expect(run({ previousDeployment: '', vercelEnv: 'production' }).status).toBe(1);
        expect(existsSync(log)).toBe(false);
    });

    it('builds a production redeploy of the same SHA', () => {
        clone('main');

        expect(run({ previousDeployment: mainSha, vercelEnv: 'production' }).status).toBe(1);
        expect(existsSync(log)).toBe(false);
    });

    it('skips production docs-only pushes when a previous SHA exists', () => {
        clone('docs-only');

        const result = run({ previousDeployment: mainSha, vercelEnv: 'production' });

        expect(result.status).toBe(0);
        expect(npxLog()).toContain(
            `--base=${mainSha} --head=${docsSha} --packages=app --exit-code`,
        );
    });

    it('builds production when Turbo reports the package affected', () => {
        clone('scan-change');

        expect(
            run({ previousDeployment: mainSha, vercelEnv: 'production', affectedStatus: 1 }).status,
        ).toBe(1);
        expect(npxLog()).toContain(`--base=${mainSha} --head=${scanSha}`);
    });

    it('builds when vercel-build.sh changed even if Turbo reports unaffected', () => {
        clone('docs-only');
        writeFileSync(join(work, 'tools/repo/vercel-build.sh'), '#!/bin/bash\n# changed\n');
        git(work, ['add', 'tools/repo/vercel-build.sh']);
        git(work, ['-c', 'commit.gpgsign=false', 'commit', '-m', 'build script']);

        expect(run({ previousDeployment: docsSha }).status).toBe(1);
        expect(existsSync(log)).toBe(false);
    });

    it('builds a first-push that only changes vercel-build.sh', () => {
        clone('docs-only');
        writeFileSync(join(work, 'tools/repo/vercel-build.sh'), '#!/bin/bash\n# changed\n');
        git(work, ['add', 'tools/repo/vercel-build.sh']);
        git(work, ['-c', 'commit.gpgsign=false', 'commit', '-m', 'build script']);

        expect(run({ previousDeployment: '' }).status).toBe(1);
        expect(existsSync(log)).toBe(false);
    });

    it('builds when vercel-ignore.sh changed even if Turbo reports unaffected', () => {
        clone('docs-only');
        writeFileSync(join(work, 'tools/repo/vercel-ignore.sh'), '#!/bin/bash\n# changed\n');
        git(work, ['add', 'tools/repo/vercel-ignore.sh']);
        git(work, ['-c', 'commit.gpgsign=false', 'commit', '-m', 'ignore script']);

        expect(run({ previousDeployment: docsSha }).status).toBe(1);
        expect(existsSync(log)).toBe(false);
    });

    it.each([
        ['a trailing comment', 'catalog:\n    turbo: 2.10.8 # pinned\n'],
        ['double quotes', 'catalog:\n    turbo: "2.10.8"\n'],
        ['single quotes', "catalog:\n    turbo: '2.10.8'\n"],
    ])('accepts %s on the Turbo catalog pin', (_name, contents) => {
        clone('docs-only');
        writeFileSync(join(work, 'pnpm-workspace.yaml'), contents);

        const result = run({ previousDeployment: '' });

        expect(result.status).toBe(0);
        expect(npxLog()).toContain('turbo@2.10.8 query affected');
    });

    it.each([
        ['an affected package', { affectedStatus: 1 }],
        ['a Turbo query error', { affectedStatus: 2 }],
        ['the same commit', { previousDeployment: 'HEAD' }],
    ])('builds for %s', (_name, options) => {
        clone('docs-only');
        const previousDeployment = options.previousDeployment === 'HEAD' ? docsSha : mainSha;

        expect(run({ ...options, previousDeployment }).status).toBe(1);
    });

    it('builds when the comparison ref is missing', () => {
        clone('docs-only');
        git(work, ['remote', 'remove', 'origin']);

        expect(run({ previousDeployment: '' }).status).toBe(1);
        expect(existsSync(log)).toBe(false);
    });

    it('builds without a package argument', () => {
        clone('docs-only');

        expect(run({ packageName: '' }).status).toBe(1);
        expect(existsSync(log)).toBe(false);
    });

    it('builds when the package name is unknown', () => {
        clone('docs-only');

        expect(run({ packageName: 'typo-pkg', lsStatus: 1 }).status).toBe(1);
        expect(npxLog()).toContain('query ls');
    });

    it.each([
        ['a range pin', 'catalog:\n    turbo: ^2.10.8\n'],
        ['a two-part pin', 'catalog:\n    turbo: 2.10\n'],
        ['a missing pin', 'catalog:\n    foo: 1\n'],
    ])('builds when the Turbo catalog has %s', (_name, contents) => {
        clone('docs-only');
        writeFileSync(join(work, 'pnpm-workspace.yaml'), contents);

        expect(run({ previousDeployment: '' }).status).toBe(1);
        expect(existsSync(log)).toBe(false);
    });

    it('builds a checkout of main with no previous deploy', () => {
        clone('main');

        expect(run({ previousDeployment: '' }).status).toBe(1);
        expect(existsSync(log)).toBe(false);
    });

    it('builds preview when origin/main cannot be fetched and no previous SHA exists', () => {
        clone('docs-only');
        git(work, ['remote', 'set-url', 'origin', join(sandbox, 'missing')]);

        expect(run({ previousDeployment: '' }).status).toBe(1);
        expect(existsSync(log)).toBe(false);
    });

    function clone(branch: string, extraArgs: string[] = ['--depth=1', '--single-branch']): void {
        git(sandbox, ['clone', ...extraArgs, '--branch', branch, origin, work]);
    }

    function git(cwd: string, args: string[]): string {
        const result = spawnSync('git', args, {
            cwd,
            encoding: 'utf8',
            env: { ...process.env, ...gitEnv },
        });
        if (result.status !== 0) {
            throw new Error(`git ${args.join(' ')} failed:\n${result.stderr}`);
        }

        return result.stdout.trim();
    }

    function npxLog(): string {
        return readFileSync(log, 'utf8');
    }

    function run({
        packageName = 'app',
        previousDeployment,
        affectedStatus = 0,
        lsStatus = 0,
        vercelEnv = '',
        cwd = work,
    }: {
        packageName?: string;
        previousDeployment?: string | null;
        affectedStatus?: number;
        lsStatus?: number;
        vercelEnv?: string;
        cwd?: string;
    } = {}) {
        const env: Record<string, string | undefined> = {
            ...process.env,
            ...gitEnv,
            PATH: `${bin}:${process.env.PATH}`,
            MOCK_LOG: log,
            MOCK_AFFECTED_STATUS: String(affectedStatus),
            MOCK_LS_STATUS: String(lsStatus),
            VERCEL_ENV: vercelEnv,
        };
        if (previousDeployment === null) {
            delete env.VERCEL_GIT_PREVIOUS_SHA;
        } else {
            env.VERCEL_GIT_PREVIOUS_SHA =
                previousDeployment === undefined ? mainSha : previousDeployment;
        }

        return spawnSync('bash', packageName ? [script, packageName] : [script], {
            cwd,
            encoding: 'utf8',
            env,
        });
    }
});

const writeExecutable = (path: string, contents: string): void => {
    writeFileSync(path, contents);
    chmodSync(path, 0o755);
};
