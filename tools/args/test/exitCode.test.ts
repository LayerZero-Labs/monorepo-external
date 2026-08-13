import { spawnSync } from 'node:child_process';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import * as path from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

// Exit codes can only be observed from a real child process, so the fixture imports the built
// package rather than the sources vitest would otherwise transpile in-process.
const packageUrl = new URL('../dist/index.js', import.meta.url).href;

const fixtureSource = `import { parse } from '${packageUrl}';

const args = parse({
    header: 'Fixture CLI',
    args: {
        needed: { type: String, description: 'A required argument' },
    },
});

console.log(JSON.stringify(args.needed));
`;

describe('parse', () => {
    let fixtureDirectory: string;
    let fixturePath: string;

    beforeAll(async () => {
        fixtureDirectory = await mkdtemp(path.join(tmpdir(), 'args-exit-code-'));
        fixturePath = path.join(fixtureDirectory, 'cli.mjs');
        await writeFile(fixturePath, fixtureSource);
    });

    afterAll(async () => {
        await rm(fixtureDirectory, { recursive: true, force: true });
    });

    const runFixture = (...argv: string[]) =>
        spawnSync(process.execPath, [fixturePath, ...argv], { encoding: 'utf8' });

    it('exits non-zero when a required argument is missing', () => {
        const { status, stderr } = runFixture();

        expect(stderr).toContain("Required parameter 'needed' was not passed");
        expect(status).toBe(1);
    });

    it('exits zero when every required argument is passed', () => {
        const { status, stdout } = runFixture('--needed', 'value');

        expect(stdout).toContain('"value"');
        expect(status).toBe(0);
    });

    it('exits zero when the usage guide is requested instead of the required arguments', () => {
        const { status, stdout } = runFixture('-h');

        expect(stdout).toContain('Fixture CLI');
        expect(status).toBe(0);
    });
});
