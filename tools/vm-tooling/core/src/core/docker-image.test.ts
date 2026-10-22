import { access, mkdir, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { afterAll, beforeAll, beforeEach, describe, it, vi } from 'vitest';

import type { Image } from '../config';
import type { ChainContext } from '../context';
import type { DockerCommandRunner, DockerPlatform } from '../utils/docker';
import { getImageUri, resolveDockerPlatform } from '../utils/docker';
import { dockerPlatformProbeStampPath, ensureDockerImage } from './docker-image';
import { executeToolCommand } from './tool-executor';

type FakeProcessEnv = Record<string, string | undefined> | undefined;

interface FakeCommandOutput {
    exitCode: number;
    stdout: string;
    stderr: string;
}

const fakeShell = await vi.hoisted(async () => {
    const { mkdtempSync } = await import('node:fs');
    const { tmpdir } = await import('node:os');
    const { join } = await import('node:path');
    const originalHome = globalThis.process.env.HOME;
    const home = mkdtempSync(join(tmpdir(), 'vm-tooling-docker-image-'));
    globalThis.process.env.HOME = home;
    globalThis.process.env.VM_TOOLING_REGISTRY = 'registry.example';
    globalThis.process.env.VM_TOOLING_IMAGE_DIRECTORY = 'layerzerolabs';

    const state: {
        handle?: (argv: string[], env: FakeProcessEnv) => FakeCommandOutput;
    } = {};

    const toArgv = (strings: readonly string[], values: readonly unknown[]): string[] =>
        strings.flatMap((literal, index) => {
            const tokens = literal.split(/\s+/).filter(Boolean);
            if (index >= values.length) {
                return tokens;
            }
            const value = values[index];
            return [...tokens, ...(Array.isArray(value) ? value.map(String) : [String(value)])];
        });

    const createProcess = (argv: string[], env: FakeProcessEnv) => {
        const result = Promise.resolve().then(() => {
            if (!state.handle) {
                throw new Error(`No fake shell handler for: ${argv.join(' ')}`);
            }
            return state.handle(argv, env);
        });
        const processPromise = {
            nothrow: () => processPromise,
            quiet: () => processPromise,
            then: result.then.bind(result),
        };
        return processPromise;
    };

    const isTemplate = (input: unknown): input is TemplateStringsArray =>
        Array.isArray(input) && 'raw' in input;

    const isShellOptions = (input: unknown): input is { env?: FakeProcessEnv } =>
        typeof input === 'object' && input !== null;

    const createShell = (env: FakeProcessEnv) => {
        const shell = (first: unknown, ...values: unknown[]): unknown => {
            if (isTemplate(first)) {
                return createProcess(toArgv(first, values), env);
            }
            return createShell(isShellOptions(first) ? first.env : undefined);
        };
        return shell;
    };

    return { state, shell: createShell(undefined), home, originalHome };
});

vi.mock('zx', async (importOriginal) => ({
    ...(await importOriginal<typeof import('zx')>()),
    $: fakeShell.shell,
}));

interface FakePlatform {
    os: string;
    architecture: string;
    variant?: string;
}

interface FakeImage {
    id: string;
    platform: FakePlatform;
}

interface FakeIndexManifest {
    digest: string;
    platform: FakePlatform;
}

type FakeRegistryEntry =
    | { kind: 'index'; digest: string; manifests: FakeIndexManifest[] }
    | { kind: 'manifest'; digest: string; platform: FakePlatform }
    | { kind: 'error'; stderr: string };

interface FakeEngine {
    Os?: string;
    Arch?: string;
    ApiVersion: string;
}

interface FakeDockerOptions {
    store?: 'classic' | 'containerd';
    engine?: FakeEngine | 'unavailable';
    clientApiVersion?: string;
    registry?: ReadonlyMap<string, FakeRegistryEntry>;
    local?: ReadonlyMap<string, FakeImage[]>;
    pullStderr?: string;
    containerCreateStderr?: string;
    containerRmStderr?: string;
    hasBuildx?: boolean;
    classicPlatformInspect?: 'mismatch-error' | 'tag-platform';
    containerdIndexRefs?: readonly string[];
    blobs?: ReadonlyMap<string, FakeImage>;
}

interface FakeCommand {
    argv: string[];
    dockerDefaultPlatform?: string;
}

interface FakeRun {
    ref: string;
    platformArg?: string;
    imagePlatform: string;
    dockerDefaultPlatform?: string;
}

const fakePlatformName = ({ os, architecture, variant }: FakePlatform): string =>
    [os, architecture, ...(variant ? [variant] : [])].join('/');

const fakeCanonical = (platform: FakePlatform | string): string => {
    const name = typeof platform === 'string' ? platform : fakePlatformName(platform);
    return name === 'linux/arm64/v8' ? 'linux/arm64' : name;
};

const imageForDigest = (digest: string, platform: FakePlatform): FakeImage => ({
    id: `sha256:image-of-${digest.replace('sha256:', '')}`,
    platform,
});

const ok = (stdout = ''): FakeCommandOutput => ({ exitCode: 0, stdout, stderr: '' });
const fail = (stderr: string, stdout = ''): FakeCommandOutput => ({ exitCode: 1, stdout, stderr });

const takeFlag = (argv: string[], flag: string): string | undefined => {
    const index = argv.indexOf(flag);
    return index === -1 ? undefined : argv[index + 1];
};

const renderInspectFormat = (format: string, platform: FakePlatform): string =>
    format
        .replace(/\{\{if \.Variant\}\}(.*?)\{\{end\}\}/g, (_match, body: string) =>
            platform.variant ? body : '',
        )
        .replace(/\{\{\.Os\}\}/g, platform.os)
        .replace(/\{\{\.Architecture\}\}/g, platform.architecture)
        .replace(/\{\{\.Variant\}\}/g, platform.variant ?? '');

class FakeDocker {
    readonly commands: FakeCommand[] = [];
    readonly runs: FakeRun[] = [];
    readonly nonDockerCommands: string[][] = [];
    private readonly tags: Map<string, FakeImage[]>;
    private readonly blobs = new Map<string, FakeImage>();
    private readonly options: FakeDockerOptions;

    constructor(options: FakeDockerOptions = {}) {
        this.options = options;
        this.tags = new Map(
            [...(options.local ?? new Map<string, FakeImage[]>())].map(([ref, images]) => [
                ref,
                [...images],
            ]),
        );
        for (const entry of options.registry?.values() ?? []) {
            if (entry.kind === 'index') {
                for (const manifest of entry.manifests) {
                    this.blobs.set(
                        manifest.digest,
                        imageForDigest(manifest.digest, manifest.platform),
                    );
                }
            }
            if (entry.kind === 'manifest') {
                this.blobs.set(entry.digest, imageForDigest(entry.digest, entry.platform));
            }
        }
        for (const [digest, image] of options.blobs ?? []) {
            this.blobs.set(digest, image);
        }
    }

    get store(): 'classic' | 'containerd' {
        return this.options.store ?? 'classic';
    }

    get engine(): FakeEngine | 'unavailable' {
        return this.options.engine ?? { Os: 'linux', Arch: 'arm64', ApiVersion: '1.56' };
    }

    get enginePlatform(): string {
        const engine = this.engine;
        return engine === 'unavailable' || !engine.Os || !engine.Arch
            ? 'linux/arm64'
            : `${engine.Os}/${engine.Arch}`;
    }

    runner(env: FakeProcessEnv = {}): DockerCommandRunner {
        return async (args) => this.handle(['docker', ...args], env);
    }

    argvs(fromIndex = 0): string[][] {
        return this.commands.slice(fromIndex).map(({ argv }) => argv);
    }

    dockerCommands(subcommand: string): string[][] {
        return this.commands
            .map(({ argv }) => argv)
            .filter((argv) => argv.slice(1).join(' ').startsWith(subcommand));
    }

    imageId(ref: string): string | undefined {
        return this.tags
            .get(ref)
            ?.map(({ id }) => id)
            .join(',');
    }

    imagePlatforms(ref: string): string[] | undefined {
        return this.tags.get(ref)?.map(({ platform }) => fakeCanonical(platform));
    }

    hasRef(ref: string): boolean {
        return this.tags.has(ref);
    }

    readonly handle = (argv: string[], env: FakeProcessEnv): FakeCommandOutput => {
        if (argv[0] !== 'docker') {
            this.nonDockerCommands.push(argv);
            return ok();
        }
        const dockerDefaultPlatform = (env ?? process.env).DOCKER_DEFAULT_PLATFORM;
        this.commands.push({ argv, dockerDefaultPlatform });
        const args = argv.slice(1);
        const command = args.slice(0, 2).join(' ');

        if (args[0] === 'version') {
            return this.version(args);
        }
        if (command === 'image inspect') {
            return this.inspect(args);
        }
        if (command === 'image rm') {
            return this.removeTag(args);
        }
        if (args[0] === 'buildx') {
            return this.buildx(args);
        }
        if (args[0] === 'pull') {
            return this.pull(args, dockerDefaultPlatform);
        }
        if (args[0] === 'tag') {
            return this.tag(args);
        }
        if (command === 'container create') {
            return this.createContainer(args);
        }
        if (command === 'container rm') {
            return this.options.containerRmStderr ? fail(this.options.containerRmStderr) : ok();
        }
        if (args[0] === 'run') {
            return this.run(args, dockerDefaultPlatform);
        }
        return fail(`fake docker: unsupported command ${argv.join(' ')}`);
    };

    private version(args: string[]): FakeCommandOutput {
        const engine = this.engine;
        const output = {
            Client: {
                Version: '29.8.2',
                ApiVersion: this.options.clientApiVersion ?? '1.56',
                DefaultAPIVersion: '1.56',
                Os: 'darwin',
                Arch: 'arm64',
                Context: 'desktop-linux',
            },
            Server:
                engine === 'unavailable'
                    ? null
                    : {
                          Platform: { Name: 'Docker Desktop 4.94.0 (241994)' },
                          Version: '29.8.2',
                          ApiVersion: engine.ApiVersion,
                          MinAPIVersion: '1.40',
                          Os: engine.Os,
                          Arch: engine.Arch,
                          KernelVersion: '7.0.14-linuxkit',
                      },
        };
        const format = takeFlag(args, '--format');
        if (format !== '{{json .}}') {
            return fail(`fake docker: unsupported version format ${String(format)}`);
        }
        const stdout = JSON.stringify(output);
        return engine === 'unavailable'
            ? fail(
                  'Cannot connect to the Docker daemon at unix:///var/run/docker.sock. Is the docker daemon running?',
                  stdout,
              )
            : ok(stdout);
    }

    private selectVariant(
        ref: string,
        requestedPlatform: string | undefined,
    ): FakeImage | FakeCommandOutput {
        const images = this.tags.get(ref);
        const [first] = images ?? [];
        if (!images || !first) {
            return fail(`Error response from daemon: No such image: ${ref}`);
        }
        if (this.store === 'classic') {
            if (
                !requestedPlatform ||
                fakeCanonical(first.platform) === fakeCanonical(requestedPlatform) ||
                this.options.classicPlatformInspect === 'tag-platform'
            ) {
                return first;
            }
            return fail(
                `Error response from daemon: image with reference ${ref} was found but its platform (${fakeCanonical(first.platform)}) does not match the specified platform (${requestedPlatform})`,
            );
        }
        const wanted = requestedPlatform ?? this.enginePlatform;
        const variant = images.find(
            ({ platform }) => fakeCanonical(platform) === fakeCanonical(wanted),
        );
        if (variant) {
            return variant;
        }
        if (this.options.containerdIndexRefs?.includes(ref)) {
            return { id: 'index-without-local-content', platform: { os: '', architecture: '' } };
        }
        if (!requestedPlatform) {
            return first;
        }
        return fail(
            `Error response from daemon: image with reference ${ref} was found but does not provide the specified platform (${requestedPlatform})`,
        );
    }

    private inspect(args: string[]): FakeCommandOutput {
        const ref = args[args.length - 1] ?? '';
        const format = takeFlag(args, '--format') ?? '';
        const selected = this.selectVariant(ref, takeFlag(args, '--platform'));
        return 'exitCode' in selected
            ? selected
            : ok(`${renderInspectFormat(format, selected.platform)}\n`);
    }

    private buildx(args: string[]): FakeCommandOutput {
        if (this.options.hasBuildx === false) {
            return fail(
                "docker: unknown command: docker buildx\n\nRun 'docker --help' for more information",
            );
        }
        if (args[1] === 'version') {
            return ok(
                'github.com/docker/buildx v0.37.2 2d379c0c3f22da0d2759d132a0ec81ca949098f0\n',
            );
        }
        const ref = args[args.length - 1] ?? '';
        const format = takeFlag(args, '--format');
        const entry = this.options.registry?.get(ref);
        if (!entry) {
            return fail(`ERROR: ${ref}: not found`);
        }
        if (entry.kind === 'error') {
            return fail(entry.stderr);
        }
        if (format === '{{json .Manifest}}') {
            return ok(
                JSON.stringify(
                    entry.kind === 'index'
                        ? {
                              schemaVersion: 2,
                              mediaType: 'application/vnd.oci.image.index.v1+json',
                              digest: entry.digest,
                              size: 9218,
                              manifests: entry.manifests.map(({ digest, platform }) => ({
                                  mediaType: 'application/vnd.oci.image.manifest.v1+json',
                                  digest,
                                  size: 1025,
                                  platform,
                              })),
                          }
                        : {
                              mediaType: 'application/vnd.oci.image.manifest.v1+json',
                              digest: entry.digest,
                              size: 1025,
                          },
                    null,
                    2,
                ),
            );
        }
        if (format === '{{json .Image}}') {
            return ok(
                JSON.stringify(
                    entry.kind === 'index'
                        ? Object.fromEntries(
                              entry.manifests
                                  .filter(({ platform }) => platform.os !== 'unknown')
                                  .map(({ platform }) => [
                                      fakeCanonical(platform),
                                      { ...platform, config: {} },
                                  ]),
                          )
                        : {
                              created: '2024-09-06T12:05:36Z',
                              ...entry.platform,
                              config: {},
                          },
                    null,
                    2,
                ),
            );
        }
        return fail(`fake docker: unsupported imagetools format ${format}`);
    }

    private storeImage(ref: string, image: FakeImage): void {
        const existing = this.tags.get(ref) ?? [];
        if (this.store === 'classic') {
            this.tags.set(ref, [image]);
            return;
        }
        this.tags.set(ref, [
            ...existing.filter(
                ({ platform }) => fakeCanonical(platform) !== fakeCanonical(image.platform),
            ),
            image,
        ]);
    }

    private pull(args: string[], dockerDefaultPlatform: string | undefined): FakeCommandOutput {
        if (this.options.pullStderr) {
            return fail(this.options.pullStderr);
        }
        const ref = args[args.length - 1] ?? '';
        const requested =
            takeFlag(args, '--platform') ?? dockerDefaultPlatform ?? this.enginePlatform;
        const [repository, digest] = ref.split('@');
        if (repository && digest) {
            const image = this.blobs.get(digest);
            if (!image) {
                return fail(`Error response from daemon: manifest for ${ref} not found`);
            }
            this.storeImage(ref, image);
            return ok(`Digest: ${digest}\n`);
        }
        const entry = this.options.registry?.get(ref);
        if (!entry) {
            return fail(`Error response from daemon: manifest for ${ref} not found`);
        }
        if (entry.kind === 'error') {
            return fail(entry.stderr);
        }
        const manifest =
            entry.kind === 'index'
                ? entry.manifests.find(
                      ({ platform }) => fakeCanonical(platform) === fakeCanonical(requested),
                  )
                : fakeCanonical(entry.platform) === fakeCanonical(requested)
                  ? { digest: entry.digest, platform: entry.platform }
                  : undefined;
        if (!manifest) {
            return fail(`no matching manifest for ${requested} in the manifest list entries`);
        }
        this.storeImage(ref, imageForDigest(manifest.digest, manifest.platform));
        return ok(`Digest: ${manifest.digest}\n`);
    }

    private removeTag(args: string[]): FakeCommandOutput {
        const ref = args[args.length - 1] ?? '';
        if (!this.tags.delete(ref)) {
            return fail(`Error response from daemon: No such image: ${ref}`);
        }
        return ok(`Untagged: ${ref}\n`);
    }

    private tag(args: string[]): FakeCommandOutput {
        const [, source = '', target = ''] = args;
        const images = this.tags.get(source);
        if (!images) {
            return fail(`Error response from daemon: No such image: ${source}`);
        }
        this.tags.set(target, [...images]);
        return ok();
    }

    private createContainer(args: string[]): FakeCommandOutput {
        if (this.options.containerCreateStderr) {
            return fail(this.options.containerCreateStderr);
        }
        const platform = takeFlag(args, '--platform');
        const ref = args[args.length - 2] ?? '';
        const selected = this.selectVariant(ref, platform);
        if ('exitCode' in selected) {
            return selected;
        }
        if (platform && fakeCanonical(selected.platform) !== fakeCanonical(platform)) {
            return fail(`fake docker: ${ref} has no ${platform} variant`);
        }
        return ok('fake-container-id\n');
    }

    private run(args: string[], dockerDefaultPlatform: string | undefined): FakeCommandOutput {
        const platformArg = takeFlag(args, '--platform');
        const ref = args.find((arg) => this.tags.has(arg));
        if (!ref) {
            return fail(`Unable to find image locally: ${args.join(' ')}`);
        }
        const images = this.tags.get(ref) ?? [];
        const wanted = platformArg ?? dockerDefaultPlatform ?? this.enginePlatform;
        const image =
            this.store === 'classic'
                ? images[0]
                : (images.find(
                      ({ platform }) => fakeCanonical(platform) === fakeCanonical(wanted),
                  ) ?? images[0]);
        this.runs.push({
            ref,
            platformArg,
            imagePlatform: image ? fakeCanonical(image.platform) : 'none',
            dockerDefaultPlatform,
        });
        return ok();
    }
}

const AMD64: FakePlatform = { os: 'linux', architecture: 'amd64' };
const ARM64: FakePlatform = { os: 'linux', architecture: 'arm64', variant: 'v8' };
const ATTESTATION: FakePlatform = { os: 'unknown', architecture: 'unknown' };
const AMD64_DIGEST = 'sha256:029a752048e32e843bd6defe3841186fb8d19a28dae8ec287f433bb9d6d1ad85';
const ARM64_DIGEST = 'sha256:ea3c5a9671f7b3f7eb47eab06f73bc6591df978b0d5955689a9e6f943aa368c0';
const INDEX_DIGEST = 'sha256:1e42bbe2508154c9126d48c2b8a75420c3544343bf86fd041fb7527e017a4b4a';

const multiPlatformIndex: FakeRegistryEntry = {
    kind: 'index',
    digest: INDEX_DIGEST,
    manifests: [
        { digest: AMD64_DIGEST, platform: AMD64 },
        {
            digest: 'sha256:5fea95373b9ec85974843f31446fa6a9df4492dddae4e1cb056193c34a20a5be',
            platform: ATTESTATION,
        },
        { digest: ARM64_DIGEST, platform: ARM64 },
        {
            digest: 'sha256:9ad5d5d3fd5a8e8a2a9e0a31e1a8a1e0b6c1d2e3f4a5b6c7d8e9f0a1b2c3d4e5',
            platform: ATTESTATION,
        },
    ],
};

const amd64Image = imageForDigest(AMD64_DIGEST, AMD64);
const arm64Image = imageForDigest(ARM64_DIGEST, ARM64);

const amd64OnlyIndex: FakeRegistryEntry = {
    kind: 'index',
    digest: INDEX_DIGEST,
    manifests: [
        { digest: AMD64_DIGEST, platform: AMD64 },
        {
            digest: 'sha256:5fea95373b9ec85974843f31446fa6a9df4492dddae4e1cb056193c34a20a5be',
            platform: ATTESTATION,
        },
    ],
};

const FORMAT = '{{.Os}}/{{.Architecture}}{{if .Variant}}/{{.Variant}}{{end}}';
const REPOSITORY = 'registry.example/layerzerolabs/fake-tooling';

const platformOf = (value: string): DockerPlatform => {
    const platform = resolveDockerPlatform(value);
    if (!platform) {
        throw new Error(`expected a platform for ${value}`);
    }
    return platform;
};

const LINUX_AMD64 = platformOf('linux/amd64');
const LINUX_ARM64 = platformOf('linux/arm64');

let registryRefCount = 0;
const newRegistryRef = (): string => {
    registryRefCount += 1;
    return `${REPOSITORY}:case-${registryRefCount}`;
};

const select = (
    fake: FakeDocker,
    imageUri: string,
    platform: DockerPlatform | undefined,
    pinnedPlatform: DockerPlatform | undefined,
    env: FakeProcessEnv = {},
): Promise<string> =>
    ensureDockerImage({ imageUri, platform, pinnedPlatform, docker: fake.runner(env) });

const hasSubcommand = (argvs: string[][], subcommand: string): boolean =>
    argvs.some((argv) => argv.slice(1).join(' ').startsWith(subcommand));

const writeProbeStamp = async (ref: string, platform: string): Promise<void> => {
    const stampPath = dockerPlatformProbeStampPath(ref, platform);
    await mkdir(path.dirname(stampPath), { recursive: true });
    await writeFile(stampPath, '');
};

afterAll(async () => {
    process.env.HOME = fakeShell.originalHome;
    await rm(fakeShell.home, { recursive: true, force: true });
});

describe('ensureDockerImage with a fake Docker interface', () => {
    const arm64RunOnAmd64Pin = async (fake: FakeDocker, ref: string, platform = LINUX_ARM64) =>
        select(fake, ref, platform, LINUX_AMD64);

    const classicAmd64Fake = (ref: string, store: 'classic' | 'containerd' = 'classic') =>
        new FakeDocker({
            store,
            local: new Map([[ref, [amd64Image]]]),
            registry: new Map([[ref, multiPlatformIndex]]),
        });

    it.for(['classic', 'containerd'] as const)(
        'a linux/arm64 run on a linux/amd64 pin creates the linux/arm64 platform tag from the digest and keeps the registry tag (%s store)',
        async (store, { expect }) => {
            const ref = newRegistryRef();
            const platformTag = `${ref}--linux-arm64`;
            const digestRef = `${REPOSITORY}@${ARM64_DIGEST}`;
            const fake = classicAmd64Fake(ref, store);
            const registryImageId = fake.imageId(ref);

            await expect(arm64RunOnAmd64Pin(fake, ref)).resolves.toBe(platformTag);

            expect(fake.argvs()).toEqual([
                ['docker', 'version', '--format', '{{json .}}'],
                [
                    'docker',
                    'image',
                    'inspect',
                    '--platform',
                    'linux/arm64',
                    '--format',
                    FORMAT,
                    platformTag,
                ],
                ['docker', 'image', 'inspect', '--format', FORMAT, platformTag],
                [
                    'docker',
                    'buildx',
                    'imagetools',
                    'inspect',
                    '--format',
                    '{{json .Manifest}}',
                    ref,
                ],
                ['docker', 'pull', '--platform', 'linux/arm64', digestRef],
                ['docker', 'tag', digestRef, platformTag],
                [
                    'docker',
                    'image',
                    'inspect',
                    '--platform',
                    'linux/arm64',
                    '--format',
                    FORMAT,
                    platformTag,
                ],
            ]);
            expect(fake.imageId(ref)).toBe(registryImageId);
            expect(fake.imagePlatforms(ref)).toEqual(['linux/amd64']);
            expect(fake.imagePlatforms(platformTag)).toEqual(['linux/arm64']);
        },
    );

    it.for(['classic', 'containerd'] as const)(
        'a default run after a linux/arm64 run on a linux/amd64 pin uses the amd64 registry tag without a pull (%s store)',
        async (store, { expect }) => {
            const ref = newRegistryRef();
            const fake = classicAmd64Fake(ref, store);
            const registryImageId = fake.imageId(ref);
            await arm64RunOnAmd64Pin(fake, ref);
            const defaultRunStart = fake.commands.length;

            await expect(select(fake, ref, LINUX_AMD64, LINUX_AMD64)).resolves.toBe(ref);

            expect(hasSubcommand(fake.argvs(defaultRunStart), 'pull')).toBe(false);
            expect(fake.imageId(ref)).toBe(registryImageId);
        },
    );

    it.for(['classic', 'containerd'] as const)(
        'a linux/arm64 run on a linux/amd64 pin after the default run uses the platform tag without a pull or registry read (%s store)',
        async (store, { expect }) => {
            const ref = newRegistryRef();
            const fake = classicAmd64Fake(ref, store);
            await arm64RunOnAmd64Pin(fake, ref);
            await select(fake, ref, LINUX_AMD64, LINUX_AMD64);
            const arm64RunStart = fake.commands.length;

            await expect(arm64RunOnAmd64Pin(fake, ref)).resolves.toBe(`${ref}--linux-arm64`);

            const argvs = fake.argvs(arm64RunStart);
            expect(hasSubcommand(argvs, 'pull')).toBe(false);
            expect(hasSubcommand(argvs, 'buildx')).toBe(false);
        },
    );

    it('an explicit linux/arm64/v8 run on a linux/amd64 pin uses the same platform tag as a linux/arm64 run on a linux/amd64 pin', async ({
        expect,
    }) => {
        const ref = newRegistryRef();
        const fake = classicAmd64Fake(ref);
        const registryImageId = fake.imageId(ref);
        const explicit = platformOf('linux/arm64/v8');

        await expect(arm64RunOnAmd64Pin(fake, ref, explicit)).resolves.toBe(`${ref}--linux-arm64`);
        const defaultRunStart = fake.commands.length;
        await expect(select(fake, ref, LINUX_AMD64, LINUX_AMD64)).resolves.toBe(ref);
        await expect(arm64RunOnAmd64Pin(fake, ref, explicit)).resolves.toBe(`${ref}--linux-arm64`);

        const argvs = fake.argvs(defaultRunStart);
        expect(hasSubcommand(argvs, 'pull')).toBe(false);
        expect(hasSubcommand(argvs, 'buildx')).toBe(false);
        expect(fake.imageId(ref)).toBe(registryImageId);
    });

    it('a run whose platform equals the pin uses the registry tag exactly as a default run', async ({
        expect,
    }) => {
        const amd64Engine = { Os: 'linux', Arch: 'amd64', ApiVersion: '1.56' };
        const explicitAmd64Ref = newRegistryRef();
        const defaultRef = newRegistryRef();
        const explicitAmd64Fake = new FakeDocker({
            engine: amd64Engine,
            local: new Map([[explicitAmd64Ref, [amd64Image]]]),
            registry: new Map([[explicitAmd64Ref, multiPlatformIndex]]),
        });
        const defaultFake = new FakeDocker({
            engine: amd64Engine,
            local: new Map([[defaultRef, [amd64Image]]]),
            registry: new Map([[defaultRef, multiPlatformIndex]]),
        });

        await expect(
            select(explicitAmd64Fake, explicitAmd64Ref, LINUX_AMD64, LINUX_AMD64),
        ).resolves.toBe(explicitAmd64Ref);
        await expect(select(defaultFake, defaultRef, LINUX_AMD64, LINUX_AMD64)).resolves.toBe(
            defaultRef,
        );

        const withRef = (argvs: string[][], ref: string) =>
            argvs.map((argv) => argv.map((arg) => (arg === ref ? '<ref>' : arg)));
        expect(withRef(explicitAmd64Fake.argvs(), explicitAmd64Ref)).toEqual(
            withRef(defaultFake.argvs(), defaultRef),
        );
        expect(hasSubcommand(explicitAmd64Fake.argvs(), 'tag')).toBe(false);
        expect(explicitAmd64Fake.hasRef(`${explicitAmd64Ref}--linux-amd64`)).toBe(false);
    });

    it('two runs that need the same missing platform tag both succeed', async ({ expect }) => {
        const ref = newRegistryRef();
        const platformTag = `${ref}--linux-arm64`;
        const fake = classicAmd64Fake(ref);

        await expect(
            Promise.all([arm64RunOnAmd64Pin(fake, ref), arm64RunOnAmd64Pin(fake, ref)]),
        ).resolves.toEqual([platformTag, platformTag]);

        expect(fake.imageId(platformTag)).toBe(arm64Image.id);
        expect(fake.imagePlatforms(platformTag)).toEqual(['linux/arm64']);
    });

    it('the digest pull passes --platform linux/arm64 when DOCKER_DEFAULT_PLATFORM=linux/amd64', async ({
        expect,
    }) => {
        const ref = newRegistryRef();
        const fake = classicAmd64Fake(ref);
        const registryImageId = fake.imageId(ref);

        await expect(
            select(fake, ref, LINUX_ARM64, LINUX_AMD64, {
                DOCKER_DEFAULT_PLATFORM: 'linux/amd64',
            }),
        ).resolves.toBe(`${ref}--linux-arm64`);

        expect(fake.dockerCommands('pull')).toEqual([
            ['docker', 'pull', '--platform', 'linux/arm64', `${REPOSITORY}@${ARM64_DIGEST}`],
        ]);
        expect(fake.imagePlatforms(`${ref}--linux-arm64`)).toEqual(['linux/arm64']);
        expect(fake.imageId(ref)).toBe(registryImageId);
    });

    it('a tool without a pin uses the platform tag when the registry tag holds another platform', async ({
        expect,
    }) => {
        const ref = newRegistryRef();
        const fake = classicAmd64Fake(ref);
        const registryImageId = fake.imageId(ref);

        await expect(select(fake, ref, LINUX_ARM64, undefined)).resolves.toBe(
            `${ref}--linux-arm64`,
        );

        expect(fake.imageId(ref)).toBe(registryImageId);
        expect(fake.imagePlatforms(`${ref}--linux-arm64`)).toEqual(['linux/arm64']);
    });

    it('a tool without a pin keeps the registry tag when it already holds the run platform', async ({
        expect,
    }) => {
        const ref = newRegistryRef();
        const fake = new FakeDocker({ local: new Map([[ref, [arm64Image]]]) });

        await expect(select(fake, ref, LINUX_ARM64, undefined)).resolves.toBe(ref);

        expect(hasSubcommand(fake.argvs(), 'pull')).toBe(false);
    });

    const noArm64Message = (ref: string) =>
        [
            'The registry has no Docker image for the run platform:',
            `  - Image: ${ref}`,
            '  - Run platform: linux/arm64',
            '  - Registry platforms: linux/amd64',
        ].join('\n');

    it('a linux/arm64 run on a linux/amd64 pin stops and lists only the real registry platforms when the index has no linux/arm64', async ({
        expect,
    }) => {
        const ref = newRegistryRef();
        const fake = new FakeDocker({
            local: new Map([[ref, [amd64Image]]]),
            registry: new Map([[ref, amd64OnlyIndex]]),
        });

        await expect(arm64RunOnAmd64Pin(fake, ref)).rejects.toHaveProperty(
            'message',
            noArm64Message(ref),
        );

        expect(hasSubcommand(fake.argvs(), 'pull')).toBe(false);
        expect(hasSubcommand(fake.argvs(), 'tag')).toBe(false);
    });

    it('a linux/arm64 run on a linux/amd64 pin stops with the no-image message when the registry tag is a single linux/amd64 manifest', async ({
        expect,
    }) => {
        const ref = newRegistryRef();
        const fake = new FakeDocker({
            local: new Map([[ref, [amd64Image]]]),
            registry: new Map([[ref, { kind: 'manifest', digest: AMD64_DIGEST, platform: AMD64 }]]),
        });

        await expect(arm64RunOnAmd64Pin(fake, ref)).rejects.toThrow(noArm64Message(ref));

        expect(fake.dockerCommands('buildx imagetools')).toEqual([
            ['docker', 'buildx', 'imagetools', 'inspect', '--format', '{{json .Manifest}}', ref],
            ['docker', 'buildx', 'imagetools', 'inspect', '--format', '{{json .Image}}', ref],
        ]);
    });

    it('a linux/arm64 run on a linux/amd64 pin names docker buildx as missing when the registry lookup cannot run', async ({
        expect,
    }) => {
        const ref = newRegistryRef();
        const fake = new FakeDocker({
            local: new Map([[ref, [amd64Image]]]),
            registry: new Map([[ref, multiPlatformIndex]]),
            hasBuildx: false,
        });

        await expect(arm64RunOnAmd64Pin(fake, ref)).rejects.toThrow(
            'Cannot read the registry image index: `docker buildx` is not available.',
        );
    });

    it('a linux/arm64 run on a linux/amd64 pin gives the pnpm localnet login hint when the registry lookup is not authorized', async ({
        expect,
    }) => {
        const ref = newRegistryRef();
        const fake = new FakeDocker({
            local: new Map([[ref, [amd64Image]]]),
            registry: new Map([
                [
                    ref,
                    {
                        kind: 'error',
                        stderr: `ERROR: unexpected status from HEAD request to https://${ref}: 403 Forbidden\ndenied: Your authorization token has expired. Reauthenticate and try again.`,
                    },
                ],
            ]),
        });

        await expect(arm64RunOnAmd64Pin(fake, ref)).rejects.toThrow(
            [
                'Docker image not available:',
                `  - Image: ${ref} (registry lookup failed)`,
                '  - ECR auth expired. Run: pnpm localnet login',
            ].join('\n'),
        );
    });

    it('a linux/arm64 run on a linux/amd64 pin gives the pnpm localnet login hint and the Docker error when the registry lookup returns 401 Unauthorized', async ({
        expect,
    }) => {
        const ref = newRegistryRef();
        const stderr = `ERROR: unexpected status from HEAD request to https://${ref}: 401 Unauthorized`;
        const fake = new FakeDocker({
            local: new Map([[ref, [amd64Image]]]),
            registry: new Map([[ref, { kind: 'error', stderr }]]),
        });

        await expect(arm64RunOnAmd64Pin(fake, ref)).rejects.toHaveProperty(
            'message',
            [
                'Docker image not available:',
                `  - Image: ${ref} (registry lookup failed)`,
                '  - ECR auth expired. Run: pnpm localnet login',
                `  - Error: ${stderr}`,
            ].join('\n'),
        );
    });

    it('a tool without a pin stops with the platform message and pulls nothing when nothing is cached and the registry has no image for the run platform', async ({
        expect,
    }) => {
        const ref = newRegistryRef();
        const fake = new FakeDocker({ registry: new Map([[ref, amd64OnlyIndex]]) });

        await expect(select(fake, ref, LINUX_ARM64, undefined)).rejects.toHaveProperty(
            'message',
            noArm64Message(ref),
        );

        expect(fake.argvs().map((argv) => argv.slice(1, 3).join(' '))).toEqual([
            'version --format',
            'image inspect',
            'image inspect',
            'image inspect',
            'image inspect',
            'buildx imagetools',
        ]);
    });

    it('a default run of a pinned tool stops with the platform message after the registry tag pull fails and the registry has no image for the pin', async ({
        expect,
    }) => {
        const ref = newRegistryRef();
        const fake = new FakeDocker({ registry: new Map([[ref, amd64OnlyIndex]]) });

        await expect(select(fake, ref, LINUX_ARM64, LINUX_ARM64)).rejects.toHaveProperty(
            'message',
            noArm64Message(ref),
        );

        expect(fake.argvs().map((argv) => argv.slice(1, 3).join(' '))).toEqual([
            'version --format',
            'image inspect',
            'image inspect',
            'pull --platform',
            'buildx imagetools',
        ]);
    });

    it('a failed registry tag pull with an authorization error gives the login hint and reads no index', async ({
        expect,
    }) => {
        const ref = newRegistryRef();
        const fake = new FakeDocker({
            registry: new Map([[ref, multiPlatformIndex]]),
            pullStderr:
                'Error response from daemon: Head "https://registry.example/v2/layerzerolabs/fake-tooling/manifests/case": denied: Your authorization token has expired. Reauthenticate and try again.',
        });

        await expect(select(fake, ref, LINUX_AMD64, LINUX_AMD64)).rejects.toThrow(
            [
                'Docker image not available:',
                `  - Image: ${ref} (pull failed)`,
                '  - ECR auth expired. Run: pnpm localnet login',
            ].join('\n'),
        );

        expect(hasSubcommand(fake.argvs(), 'buildx')).toBe(false);
    });

    it.for(['mismatch-error', 'tag-platform'] as const)(
        'a linux/arm64 run on a linux/amd64 pin stops before docker run when the chosen image is linux/amd64 (classic inspect %s)',
        async (classicPlatformInspect, { expect }) => {
            const ref = newRegistryRef();
            const platformTag = `${ref}--linux-arm64`;
            const fake = new FakeDocker({
                classicPlatformInspect,
                local: new Map([
                    [ref, [amd64Image]],
                    [platformTag, [amd64Image]],
                ]),
                registry: new Map([[ref, multiPlatformIndex]]),
            });

            await expect(arm64RunOnAmd64Pin(fake, ref)).rejects.toThrow(
                [
                    'Docker image platform does not match the run platform:',
                    `  - Image: ${platformTag}`,
                    '  - Run platform: linux/arm64',
                    '  - Image platform: linux/amd64',
                ].join('\n'),
            );
        },
    );

    const mismatchMessage = (platformTag: string) =>
        [
            'Docker image platform does not match the run platform:',
            `  - Image: ${platformTag}`,
            '  - Run platform: linux/arm64',
            '  - Image platform: linux/amd64',
        ].join('\n');

    it('a linux/arm64 run on a linux/amd64 pin removes the platform tag that it created when that tag fails the platform check', async ({
        expect,
    }) => {
        const ref = newRegistryRef();
        const platformTag = `${ref}--linux-arm64`;
        const fake = new FakeDocker({
            local: new Map([[ref, [amd64Image]]]),
            registry: new Map([[ref, multiPlatformIndex]]),
            blobs: new Map([[ARM64_DIGEST, amd64Image]]),
        });

        await expect(arm64RunOnAmd64Pin(fake, ref)).rejects.toHaveProperty(
            'message',
            mismatchMessage(platformTag),
        );

        expect(fake.dockerCommands('image rm')).toEqual([['docker', 'image', 'rm', platformTag]]);
        expect(fake.hasRef(platformTag)).toBe(false);
        expect(fake.imagePlatforms(ref)).toEqual(['linux/amd64']);

        const secondRunStart = fake.commands.length;
        await expect(arm64RunOnAmd64Pin(fake, ref)).rejects.toHaveProperty(
            'message',
            mismatchMessage(platformTag),
        );
        expect(hasSubcommand(fake.argvs(secondRunStart), 'buildx imagetools')).toBe(true);
    });

    it('a linux/arm64 run on a linux/amd64 pin names the command that removes a cached platform tag that fails the platform check', async ({
        expect,
    }) => {
        const ref = newRegistryRef();
        const platformTag = `${ref}--linux-arm64`;
        const fake = new FakeDocker({
            local: new Map([
                [ref, [amd64Image]],
                [platformTag, [amd64Image]],
            ]),
            registry: new Map([[ref, multiPlatformIndex]]),
        });

        await expect(arm64RunOnAmd64Pin(fake, ref)).rejects.toHaveProperty(
            'message',
            [
                mismatchMessage(platformTag),
                `  - Remove the platform tag, then run again: docker image rm ${platformTag}`,
            ].join('\n'),
        );

        expect(fake.dockerCommands('image rm')).toEqual([]);
        expect(fake.hasRef(platformTag)).toBe(true);
    });

    it('a default run of a pinned tool stops when the pulled registry tag does not hold the pinned platform', async ({
        expect,
    }) => {
        const ref = newRegistryRef();
        const fake = new FakeDocker({
            registry: new Map([[ref, { kind: 'manifest', digest: AMD64_DIGEST, platform: AMD64 }]]),
        });
        const pullWithoutPlatformMatch: DockerCommandRunner = async (args) =>
            args[0] === 'pull'
                ? fake.handle(['docker', 'pull', args[args.length - 1] ?? ''], {
                      DOCKER_DEFAULT_PLATFORM: 'linux/amd64',
                  })
                : fake.handle(['docker', ...args], {});

        await expect(
            ensureDockerImage({
                imageUri: ref,
                platform: LINUX_ARM64,
                pinnedPlatform: LINUX_ARM64,
                docker: pullWithoutPlatformMatch,
            }),
        ).rejects.toThrow(
            `Docker image platform does not match the run platform:\n  - Image: ${ref}\n  - Run platform: linux/arm64\n  - Image platform: linux/amd64`,
        );
    });

    it('a default run passes the platform check without a pull when the containerd registry tag holds both platforms', async ({
        expect,
    }) => {
        const ref = newRegistryRef();
        const fake = new FakeDocker({
            store: 'containerd',
            local: new Map([[ref, [amd64Image, arm64Image]]]),
            registry: new Map([[ref, multiPlatformIndex]]),
        });

        expect(
            fake.handle(['docker', 'image', 'inspect', '--format', '{{.Architecture}}', ref], {})
                .stdout,
        ).toBe('arm64\n');
        const selectionStart = fake.commands.length;

        await expect(select(fake, ref, LINUX_AMD64, LINUX_AMD64)).resolves.toBe(ref);

        expect(fake.argvs(selectionStart)).toEqual([
            ['docker', 'version', '--format', '{{json .}}'],
            ['docker', 'image', 'inspect', '--platform', 'linux/amd64', '--format', FORMAT, ref],
            ['docker', 'container', 'create', '--platform', 'linux/amd64', ref, 'true'],
            ['docker', 'container', 'rm', 'fake-container-id'],
        ]);
    });

    it('a tool without a pin uses the platform tag when the containerd registry tag has no local content for the run platform', async ({
        expect,
    }) => {
        const ref = newRegistryRef();
        const fake = new FakeDocker({
            store: 'containerd',
            containerdIndexRefs: [ref],
            local: new Map([[ref, [amd64Image]]]),
            registry: new Map([[ref, multiPlatformIndex]]),
        });

        expect(
            fake.handle(
                [
                    'docker',
                    'image',
                    'inspect',
                    '--platform',
                    'linux/arm64',
                    '--format',
                    FORMAT,
                    ref,
                ],
                {},
            ),
        ).toEqual({ exitCode: 0, stdout: '/\n', stderr: '' });

        await expect(select(fake, ref, LINUX_ARM64, undefined)).resolves.toBe(
            `${ref}--linux-arm64`,
        );
        expect(fake.imagePlatforms(ref)).toEqual(['linux/amd64']);
    });

    it('a default run pulls the pinned variant when the containerd registry tag has no local content for it', async ({
        expect,
    }) => {
        const ref = newRegistryRef();
        const fake = new FakeDocker({
            store: 'containerd',
            containerdIndexRefs: [ref],
            local: new Map([[ref, [arm64Image]]]),
            registry: new Map([[ref, multiPlatformIndex]]),
        });

        await expect(select(fake, ref, LINUX_AMD64, LINUX_AMD64)).resolves.toBe(ref);

        expect(fake.dockerCommands('pull')).toEqual([
            ['docker', 'pull', '--platform', 'linux/amd64', ref],
        ]);
        expect(fake.imagePlatforms(ref)).toEqual(['linux/arm64', 'linux/amd64']);
    });

    const oldApiEngine = { Os: 'linux', Arch: 'arm64', ApiVersion: '1.48' };

    const oldApiProbe = (platform: string, ref: string) => [
        'docker',
        'container',
        'create',
        '--pull',
        'never',
        '--platform',
        platform,
        ref,
        'true',
    ];

    it('on Docker API 1.48 the platform check probes container creation and names the tag platform on a mismatch', async ({
        expect,
    }) => {
        const ref = newRegistryRef();
        const platformTag = `${ref}--linux-arm64`;
        const fake = new FakeDocker({
            engine: oldApiEngine,
            local: new Map([
                [ref, [amd64Image]],
                [platformTag, [amd64Image]],
            ]),
            registry: new Map([[ref, multiPlatformIndex]]),
        });

        await expect(arm64RunOnAmd64Pin(fake, ref)).rejects.toHaveProperty(
            'message',
            [
                mismatchMessage(platformTag),
                `  - Remove the platform tag, then run again: docker image rm ${platformTag}`,
            ].join('\n'),
        );

        expect(fake.argvs()).toEqual([
            ['docker', 'version', '--format', '{{json .}}'],
            oldApiProbe('linux/arm64', platformTag),
            ['docker', 'image', 'inspect', '--format', FORMAT, platformTag],
        ]);
    });

    it('on Docker API 1.48 the platform check accepts a platform tag that container creation finds', async ({
        expect,
    }) => {
        const ref = newRegistryRef();
        const fake = new FakeDocker({
            engine: oldApiEngine,
            local: new Map([[ref, [amd64Image]]]),
            registry: new Map([[ref, multiPlatformIndex]]),
        });

        await expect(arm64RunOnAmd64Pin(fake, ref)).resolves.toBe(`${ref}--linux-arm64`);

        expect(
            fake.dockerCommands('image inspect').every((argv) => !argv.includes('--platform')),
        ).toBe(true);
        expect(fake.dockerCommands('container create')).toEqual([
            oldApiProbe('linux/arm64', `${ref}--linux-arm64`),
            oldApiProbe('linux/arm64', `${ref}--linux-arm64`),
        ]);
    });

    it.for<[string, string, string]>([
        ['1.48', '1.56', 'container create --pull never'],
        ['1.56', '1.48', 'container create --pull never'],
        ['1.49', '1.56', 'image inspect --platform'],
    ])(
        'with client API %s and server API %s the platform check of a default run uses docker %s',
        async ([clientApiVersion, serverApiVersion, platformCheck], { expect }) => {
            const ref = newRegistryRef();
            const fake = new FakeDocker({
                engine: { Os: 'linux', Arch: 'arm64', ApiVersion: serverApiVersion },
                clientApiVersion,
                local: new Map([[ref, [amd64Image]]]),
                registry: new Map([[ref, multiPlatformIndex]]),
            });

            await expect(select(fake, ref, LINUX_AMD64, LINUX_AMD64)).resolves.toBe(ref);

            expect(
                ['container create --pull never', 'image inspect --platform'].filter((check) =>
                    hasSubcommand(fake.argvs(), check),
                ),
            ).toEqual([platformCheck]);
        },
    );

    it('on Docker API 1.48 a linux/arm64 run on a linux/amd64 pin writes the probe stamp of a cached platform tag, so the next run creates no probe container', async ({
        expect,
    }) => {
        const ref = newRegistryRef();
        const platformTag = `${ref}--linux-arm64`;
        const fake = new FakeDocker({
            engine: oldApiEngine,
            local: new Map([
                [ref, [amd64Image]],
                [platformTag, [arm64Image]],
            ]),
            registry: new Map([[ref, multiPlatformIndex]]),
        });

        await expect(arm64RunOnAmd64Pin(fake, ref)).resolves.toBe(platformTag);

        expect(fake.dockerCommands('container create')).toEqual([
            oldApiProbe('linux/arm64', platformTag),
        ]);
        await expect(
            access(dockerPlatformProbeStampPath(platformTag, 'linux/arm64')),
        ).resolves.toBeUndefined();

        const secondRunStart = fake.commands.length;
        await expect(arm64RunOnAmd64Pin(fake, ref)).resolves.toBe(platformTag);

        expect(hasSubcommand(fake.argvs(secondRunStart), 'container create')).toBe(false);
    });

    it('on Docker API 1.48 a platform tag that the run creates is probed even when a probe stamp for it exists', async ({
        expect,
    }) => {
        const ref = newRegistryRef();
        const platformTag = `${ref}--linux-arm64`;
        const fake = new FakeDocker({
            engine: oldApiEngine,
            local: new Map([[ref, [amd64Image]]]),
            registry: new Map([[ref, multiPlatformIndex]]),
        });
        await writeProbeStamp(platformTag, 'linux/arm64');

        await expect(arm64RunOnAmd64Pin(fake, ref)).resolves.toBe(platformTag);

        const tagCommand = fake.argvs().findIndex((argv) => argv[1] === 'tag');
        expect(fake.argvs(tagCommand + 1)).toEqual([
            oldApiProbe('linux/arm64', platformTag),
            ['docker', 'container', 'rm', 'fake-container-id'],
        ]);
    });

    it('on Docker API 1.48 the first default run of a pinned tool creates one probe container and writes the probe stamp', async ({
        expect,
    }) => {
        const ref = newRegistryRef();
        const fake = new FakeDocker({
            engine: oldApiEngine,
            local: new Map([[ref, [amd64Image]]]),
            registry: new Map([[ref, multiPlatformIndex]]),
        });

        await expect(select(fake, ref, LINUX_AMD64, LINUX_AMD64)).resolves.toBe(ref);

        expect(fake.dockerCommands('container create')).toEqual([oldApiProbe('linux/amd64', ref)]);
        await expect(
            access(dockerPlatformProbeStampPath(ref, 'linux/amd64')),
        ).resolves.toBeUndefined();
    });

    it('on Docker API 1.48 a default run passes the platform check without a pull when the containerd registry tag holds both platforms', async ({
        expect,
    }) => {
        const ref = newRegistryRef();
        const fake = new FakeDocker({
            engine: oldApiEngine,
            store: 'containerd',
            local: new Map([[ref, [amd64Image, arm64Image]]]),
            registry: new Map([[ref, multiPlatformIndex]]),
        });

        expect(
            fake.handle(['docker', 'image', 'inspect', '--format', FORMAT, ref], {}).stdout,
        ).toBe('linux/arm64/v8\n');
        const selectionStart = fake.commands.length;

        await expect(select(fake, ref, LINUX_AMD64, LINUX_AMD64)).resolves.toBe(ref);

        expect(fake.argvs(selectionStart)).toEqual([
            ['docker', 'version', '--format', '{{json .}}'],
            oldApiProbe('linux/amd64', ref),
            ['docker', 'container', 'rm', 'fake-container-id'],
        ]);
        expect(fake.imagePlatforms(ref)).toEqual(['linux/amd64', 'linux/arm64']);
    });

    it.sequential(
        'on Docker API 1.48 a default run re-pulls the registry tag when container creation fails and the tag holds another platform',
        async ({ expect }) => {
            const ref = newRegistryRef();
            const fake = new FakeDocker({
                engine: oldApiEngine,
                local: new Map([[ref, [arm64Image]]]),
                registry: new Map([[ref, multiPlatformIndex]]),
            });
            const info = vi.spyOn(console, 'info');

            await expect(select(fake, ref, LINUX_AMD64, LINUX_AMD64)).resolves.toBe(ref);

            expect(fake.argvs()).toEqual([
                ['docker', 'version', '--format', '{{json .}}'],
                oldApiProbe('linux/amd64', ref),
                ['docker', 'image', 'inspect', '--format', FORMAT, ref],
                ['docker', 'pull', '--platform', 'linux/amd64', ref],
                oldApiProbe('linux/amd64', ref),
                ['docker', 'container', 'rm', 'fake-container-id'],
            ]);
            expect(info).toHaveBeenCalledWith(
                '🔄 Cached Docker image does not include the requested platform (linux/amd64); re-pulling.',
            );
            expect(fake.imagePlatforms(ref)).toEqual(['linux/amd64']);
            info.mockRestore();
        },
    );

    it('on Docker API 1.48 a default run pulls the registry tag when container creation fails and there is no local tag', async ({
        expect,
    }) => {
        const ref = newRegistryRef();
        const fake = new FakeDocker({
            engine: oldApiEngine,
            registry: new Map([[ref, multiPlatformIndex]]),
        });

        await expect(select(fake, ref, LINUX_AMD64, LINUX_AMD64)).resolves.toBe(ref);

        expect(fake.argvs()).toEqual([
            ['docker', 'version', '--format', '{{json .}}'],
            oldApiProbe('linux/amd64', ref),
            ['docker', 'image', 'inspect', '--format', FORMAT, ref],
            ['docker', 'pull', '--platform', 'linux/amd64', ref],
            oldApiProbe('linux/amd64', ref),
            ['docker', 'container', 'rm', 'fake-container-id'],
        ]);
    });

    it.sequential(
        'on Docker API 1.48 the platform check warns with the cleanup command when the probe container cannot be removed and still passes',
        async ({ expect }) => {
            const ref = newRegistryRef();
            const stderr =
                'Error response from daemon: removal of container fake-container-id is already in progress';
            const fake = new FakeDocker({
                engine: oldApiEngine,
                local: new Map([[ref, [amd64Image]]]),
                registry: new Map([[ref, multiPlatformIndex]]),
                containerRmStderr: `${stderr}\n`,
            });
            const warn = vi.spyOn(console, 'warn');

            await expect(select(fake, ref, LINUX_AMD64, LINUX_AMD64)).resolves.toBe(ref);

            expect(warn).toHaveBeenCalledWith(
                `⚠️  Failed to remove the Docker platform probe container fake-container-id: ${stderr}. Run: docker container rm fake-container-id`,
            );
            expect(hasSubcommand(fake.argvs(), 'pull')).toBe(false);
            warn.mockRestore();
        },
    );

    it('on Docker API 1.48 the platform check names the Docker error when container creation still fails after a pull of a tag that reports the run platform', async ({
        expect,
    }) => {
        const ref = newRegistryRef();
        const stderr =
            'Error response from daemon: image with reference sha256:abc was found but does not provide the specified platform (linux/amd64)';
        const fake = new FakeDocker({
            engine: oldApiEngine,
            local: new Map([[ref, [amd64Image]]]),
            registry: new Map([[ref, multiPlatformIndex]]),
            containerCreateStderr: `${stderr}\n`,
        });

        await expect(select(fake, ref, LINUX_AMD64, LINUX_AMD64)).rejects.toHaveProperty(
            'message',
            [
                'Docker image platform does not match the run platform:',
                `  - Image: ${ref}`,
                '  - Run platform: linux/amd64',
                '  - Image platform: no local image content',
                `  - Error: ${stderr}`,
            ].join('\n'),
        );

        expect(fake.dockerCommands('pull')).toEqual([
            ['docker', 'pull', '--platform', 'linux/amd64', ref],
        ]);
    });

    it('on Docker API 1.48 a default run with a probe stamp and no local tag pulls the registry tag and probes the pulled image', async ({
        expect,
    }) => {
        const ref = newRegistryRef();
        const fake = new FakeDocker({
            engine: oldApiEngine,
            registry: new Map([[ref, multiPlatformIndex]]),
        });
        await writeProbeStamp(ref, 'linux/amd64');

        await expect(select(fake, ref, LINUX_AMD64, LINUX_AMD64)).resolves.toBe(ref);

        expect(fake.argvs()).toEqual([
            ['docker', 'version', '--format', '{{json .}}'],
            ['docker', 'image', 'inspect', '--format', FORMAT, ref],
            ['docker', 'pull', '--platform', 'linux/amd64', ref],
            oldApiProbe('linux/amd64', ref),
            ['docker', 'container', 'rm', 'fake-container-id'],
        ]);
        await expect(
            access(dockerPlatformProbeStampPath(ref, 'linux/amd64')),
        ).resolves.toBeUndefined();
    });

    it('on Docker API 1.48 a default run with a probe stamp probes container creation when the containerd registry tag reports another platform', async ({
        expect,
    }) => {
        const ref = newRegistryRef();
        const fake = new FakeDocker({
            engine: oldApiEngine,
            store: 'containerd',
            local: new Map([[ref, [amd64Image, arm64Image]]]),
            registry: new Map([[ref, multiPlatformIndex]]),
        });
        await writeProbeStamp(ref, 'linux/amd64');

        await expect(select(fake, ref, LINUX_AMD64, LINUX_AMD64)).resolves.toBe(ref);

        expect(fake.argvs()).toEqual([
            ['docker', 'version', '--format', '{{json .}}'],
            ['docker', 'image', 'inspect', '--format', FORMAT, ref],
            oldApiProbe('linux/amd64', ref),
            ['docker', 'container', 'rm', 'fake-container-id'],
        ]);
    });

    it.sequential(
        'a default run warns with the cleanup command when the registry tag probe container cannot be removed and still proceeds',
        async ({ expect }) => {
            const ref = newRegistryRef();
            const stderr =
                'Error response from daemon: removal of container fake-container-id is already in progress';
            const fake = new FakeDocker({
                local: new Map([[ref, [amd64Image]]]),
                registry: new Map([[ref, multiPlatformIndex]]),
                containerRmStderr: `${stderr}\n`,
            });
            const warn = vi.spyOn(console, 'warn');

            await expect(select(fake, ref, LINUX_AMD64, LINUX_AMD64)).resolves.toBe(ref);

            expect(fake.dockerCommands('container rm')).toEqual([
                ['docker', 'container', 'rm', 'fake-container-id'],
            ]);
            expect(warn.mock.calls).toEqual([
                [
                    `⚠️  Failed to remove the Docker platform probe container fake-container-id: ${stderr}. Run: docker container rm fake-container-id`,
                ],
            ]);
            warn.mockRestore();
        },
    );

    it('a cached default run keeps the probe commands and adds only the platform check', async ({
        expect,
    }) => {
        const ref = newRegistryRef();
        const fake = classicAmd64Fake(ref);

        await expect(select(fake, ref, LINUX_AMD64, LINUX_AMD64)).resolves.toBe(ref);

        expect(fake.argvs()).toEqual([
            ['docker', 'version', '--format', '{{json .}}'],
            ['docker', 'image', 'inspect', '--platform', 'linux/amd64', '--format', FORMAT, ref],
            ['docker', 'container', 'create', '--platform', 'linux/amd64', ref, 'true'],
            ['docker', 'container', 'rm', 'fake-container-id'],
        ]);
    });

    it('an uncached default run keeps the pull and probe commands and adds only the platform check', async ({
        expect,
    }) => {
        const ref = newRegistryRef();
        const fake = new FakeDocker({ registry: new Map([[ref, multiPlatformIndex]]) });

        await expect(select(fake, ref, LINUX_AMD64, LINUX_AMD64)).resolves.toBe(ref);

        expect(fake.argvs()).toEqual([
            ['docker', 'version', '--format', '{{json .}}'],
            ['docker', 'image', 'inspect', '--platform', 'linux/amd64', '--format', FORMAT, ref],
            ['docker', 'image', 'inspect', '--format', FORMAT, ref],
            ['docker', 'pull', '--platform', 'linux/amd64', ref],
            ['docker', 'image', 'inspect', '--platform', 'linux/amd64', '--format', FORMAT, ref],
            ['docker', 'container', 'create', '--platform', 'linux/amd64', ref, 'true'],
            ['docker', 'container', 'rm', 'fake-container-id'],
        ]);
        expect(fake.imagePlatforms(ref)).toEqual(['linux/amd64']);
    });

    it('a default run of a pinned tool proceeds when docker version reports the API version but no server Os or Arch', async ({
        expect,
    }) => {
        const ref = newRegistryRef();
        const fake = new FakeDocker({
            engine: { ApiVersion: '1.56' },
            local: new Map([[ref, [amd64Image]]]),
            registry: new Map([[ref, multiPlatformIndex]]),
        });

        await expect(select(fake, ref, LINUX_AMD64, LINUX_AMD64)).resolves.toBe(ref);

        expect(fake.argvs()).toEqual([
            ['docker', 'version', '--format', '{{json .}}'],
            ['docker', 'image', 'inspect', '--platform', 'linux/amd64', '--format', FORMAT, ref],
            ['docker', 'container', 'create', '--platform', 'linux/amd64', ref, 'true'],
            ['docker', 'container', 'rm', 'fake-container-id'],
        ]);
    });

    it('a default run of a pinned tool stops with the Docker API version message before any pull when docker version fails', async ({
        expect,
    }) => {
        const ref = newRegistryRef();
        const fake = new FakeDocker({
            engine: 'unavailable',
            registry: new Map([[ref, multiPlatformIndex]]),
        });

        await expect(select(fake, ref, LINUX_AMD64, LINUX_AMD64)).rejects.toHaveProperty(
            'message',
            'Cannot read the Docker API version from `docker version`: Cannot connect to the Docker daemon at unix:///var/run/docker.sock. Is the docker daemon running?',
        );

        expect(fake.argvs()).toEqual([['docker', 'version', '--format', '{{json .}}']]);
    });

    it('the platform probe error of a default run gives the Docker error when container create fails', async ({
        expect,
    }) => {
        const ref = newRegistryRef();
        const stderr =
            'Error response from daemon: image with reference sha256:abc was found but does not provide the specified platform (linux/amd64)';
        const fake = new FakeDocker({
            local: new Map([[ref, [amd64Image]]]),
            registry: new Map([[ref, multiPlatformIndex]]),
            containerCreateStderr: `${stderr}\n`,
        });

        await expect(select(fake, ref, LINUX_AMD64, LINUX_AMD64)).rejects.toHaveProperty(
            'message',
            [
                'Failed to create Docker platform probe container:',
                `  - Image: ${ref}`,
                '  - Platform: linux/amd64',
                `  - Error: ${stderr}`,
            ].join('\n'),
        );
    });

    it('a run without a run platform accepts any local image and makes no platform check', async ({
        expect,
    }) => {
        const ref = newRegistryRef();
        const fake = classicAmd64Fake(ref);

        await expect(select(fake, ref, undefined, undefined)).resolves.toBe(ref);

        expect(fake.argvs()).toEqual([
            ['docker', 'image', 'inspect', '--format', '{{.Architecture}}', ref],
        ]);
    });

    it('a run without a run platform pulls without --platform when nothing is cached', async ({
        expect,
    }) => {
        const ref = newRegistryRef();
        const fake = new FakeDocker({ registry: new Map([[ref, multiPlatformIndex]]) });

        await expect(select(fake, ref, undefined, undefined)).resolves.toBe(ref);

        expect(fake.argvs()).toEqual([
            ['docker', 'image', 'inspect', '--format', '{{.Architecture}}', ref],
            ['docker', 'pull', ref],
        ]);
    });
});

const fakeImage: Image = {
    name: 'fake',
    versions: { pinned: '1.0.0', unpinned: '1.0.0', local: '1.0.0' },
};

const cacheVolume = {
    type: 'isolate',
    containerPath: '/cache',
    name: 'cache',
    shared: true,
} as const;

const fakeContext: ChainContext<'fake'> = {
    tools: [
        { name: 'pinned', dockerPlatform: 'linux/amd64', defaultVolumes: [cacheVolume] },
        { name: 'unpinned', defaultVolumes: [cacheVolume] },
        { name: 'local', getLocalVersion: async () => '1.0.0' },
    ],
    images: { fake: fakeImage },
    versionCombinations: [{ images: { pinned: 'fake', unpinned: 'fake', local: 'fake' } }],
};

describe.sequential('executeToolCommand with a fake Docker CLI', () => {
    const originalDockerDefaultPlatform = process.env.DOCKER_DEFAULT_PLATFORM;
    let registryRef: string;
    let platformTag: string;

    beforeAll(async () => {
        registryRef = await getImageUri(fakeImage);
        platformTag = `${registryRef}--linux-arm64`;
    });

    beforeEach(async () => {
        delete process.env.DOCKER_DEFAULT_PLATFORM;
        vi.restoreAllMocks();
        await rm(path.join(fakeShell.home, '.cache'), { recursive: true, force: true });
    });

    afterAll(() => {
        vi.restoreAllMocks();
        if (originalDockerDefaultPlatform === undefined) {
            delete process.env.DOCKER_DEFAULT_PLATFORM;
        } else {
            process.env.DOCKER_DEFAULT_PLATFORM = originalDockerDefaultPlatform;
        }
    });

    const runTool = async (
        fake: FakeDocker,
        toolName: string,
        options: { dockerPlatform?: 'native' | 'linux/amd64' | 'linux/arm64'; local?: boolean },
    ): Promise<void> => {
        fakeShell.state.handle = fake.handle;
        await executeToolCommand(fakeContext, toolName, [], {
            cwd: process.cwd(),
            volumes: [],
            env: [],
            ...options,
        });
    };

    const amd64RegistryFake = () =>
        new FakeDocker({
            local: new Map([[registryRef, [amd64Image]]]),
            registry: new Map([[registryRef, multiPlatformIndex]]),
        });

    const runArgv = (fake: FakeDocker): string[] => {
        const [argv, ...rest] = fake.dockerCommands('run');
        if (!argv || rest.length > 0) {
            throw new Error(`expected one docker run, got ${String(rest.length + (argv ? 1 : 0))}`);
        }
        return argv;
    };

    it('a native run on engine linux/arm64 never runs the cached amd64 registry image', async ({
        expect,
    }) => {
        const fake = amd64RegistryFake();

        await runTool(fake, 'pinned', { dockerPlatform: 'native' });

        expect(fake.runs.map(({ imagePlatform }) => imagePlatform)).toEqual(['linux/arm64']);
    });

    it('a native run starts no docker run when the chosen image has another platform', async ({
        expect,
    }) => {
        const fake = new FakeDocker({
            local: new Map([
                [registryRef, [amd64Image]],
                [platformTag, [amd64Image]],
            ]),
            registry: new Map([[registryRef, multiPlatformIndex]]),
        });

        await expect(runTool(fake, 'pinned', { dockerPlatform: 'native' })).rejects.toThrow(
            'Docker image platform does not match the run platform',
        );

        expect(fake.runs).toEqual([]);
    });

    it('a native run prints one line with the image and the run platform, then starts docker run', async ({
        expect,
    }) => {
        const fake = amd64RegistryFake();
        const info = vi.spyOn(console, 'info');

        await runTool(fake, 'pinned', { dockerPlatform: 'native' });

        const line = `✅ Using Docker image ${platformTag} (linux/arm64)`;
        expect(info.mock.calls.filter(([message]) => message === line)).toHaveLength(1);
        expect(fake.runs).toEqual([
            {
                ref: platformTag,
                platformArg: 'linux/arm64',
                imagePlatform: 'linux/arm64',
                dockerDefaultPlatform: undefined,
            },
        ]);
    });

    it('a native run prints one line naming the ignored DOCKER_DEFAULT_PLATFORM and the engine platform', async ({
        expect,
    }) => {
        process.env.DOCKER_DEFAULT_PLATFORM = 'linux/amd64';
        const fake = amd64RegistryFake();
        const warn = vi.spyOn(console, 'warn');

        await runTool(fake, 'pinned', { dockerPlatform: 'native' });

        expect(warn.mock.calls).toEqual([
            [
                '⚠️  Ignoring DOCKER_DEFAULT_PLATFORM=linux/amd64 for --docker-platform native; using the Docker engine platform linux/arm64',
            ],
        ]);
        expect(fake.runs.map(({ imagePlatform }) => imagePlatform)).toEqual(['linux/arm64']);
    });

    it('a native run prints no ignored-platform line when DOCKER_DEFAULT_PLATFORM is not set', async ({
        expect,
    }) => {
        const fake = amd64RegistryFake();
        const warn = vi.spyOn(console, 'warn');

        await runTool(fake, 'pinned', { dockerPlatform: 'native' });

        expect(
            warn.mock.calls.filter(([message]) =>
                String(message).includes('DOCKER_DEFAULT_PLATFORM'),
            ),
        ).toEqual([]);
    });

    it('a native run stops before any pull or docker run when the engine platform cannot be read', async ({
        expect,
    }) => {
        const fake = new FakeDocker({
            engine: 'unavailable',
            local: new Map([[registryRef, [amd64Image]]]),
            registry: new Map([[registryRef, multiPlatformIndex]]),
        });

        await expect(runTool(fake, 'pinned', { dockerPlatform: 'native' })).rejects.toThrow(
            'Cannot read the Docker engine platform from `docker version`',
        );

        expect(fake.argvs()).toEqual([['docker', 'version', '--format', '{{json .}}']]);
        expect(fake.runs).toEqual([]);
    });

    it('an explicit linux/arm64 run of a pinned tool runs linux/arm64 when docker version reports no server Os or Arch', async ({
        expect,
    }) => {
        const fake = new FakeDocker({
            engine: { ApiVersion: '1.56' },
            local: new Map([[registryRef, [amd64Image]]]),
            registry: new Map([[registryRef, multiPlatformIndex]]),
        });

        await runTool(fake, 'pinned', { dockerPlatform: 'linux/arm64' });

        expect(
            fake.runs.map(({ ref, platformArg, imagePlatform }) => [
                ref,
                platformArg,
                imagePlatform,
            ]),
        ).toEqual([[platformTag, 'linux/arm64', 'linux/arm64']]);
    });

    it('a native run gives docker run the engine platform as --platform and no DOCKER_DEFAULT_PLATFORM', async ({
        expect,
    }) => {
        process.env.DOCKER_DEFAULT_PLATFORM = 'linux/amd64';
        const fake = amd64RegistryFake();

        await runTool(fake, 'pinned', { dockerPlatform: 'native' });

        const argv = runArgv(fake);
        expect(argv.slice(0, 4)).toEqual(['docker', 'run', '--platform', 'linux/arm64']);
        expect(fake.runs.map(({ dockerDefaultPlatform }) => dockerDefaultPlatform)).toEqual([
            undefined,
        ]);
    });

    it('a --local native run runs no Docker command', async ({ expect }) => {
        const fake = new FakeDocker({ engine: 'unavailable' });

        await runTool(fake, 'local', { dockerPlatform: 'native', local: true });

        expect(fake.commands).toEqual([]);
        expect(fake.nonDockerCommands).toEqual([['local']]);
    });

    it('an explicit linux/arm64 with DOCKER_DEFAULT_PLATFORM=linux/amd64 runs linux/arm64 and keeps the registry tag', async ({
        expect,
    }) => {
        process.env.DOCKER_DEFAULT_PLATFORM = 'linux/amd64';
        const fake = amd64RegistryFake();
        const registryImageId = fake.imageId(registryRef);

        await runTool(fake, 'pinned', { dockerPlatform: 'linux/arm64' });

        expect(fake.dockerCommands('pull')).toEqual([
            ['docker', 'pull', '--platform', 'linux/arm64', `${REPOSITORY}@${ARM64_DIGEST}`],
        ]);
        expect(
            fake.runs.map(({ ref, platformArg, imagePlatform }) => [
                ref,
                platformArg,
                imagePlatform,
            ]),
        ).toEqual([[platformTag, 'linux/arm64', 'linux/arm64']]);
        expect(fake.imageId(registryRef)).toBe(registryImageId);
    });

    it('a tool without a pin and DOCKER_DEFAULT_PLATFORM=linux/arm64 runs the platform tag with linux-arm64 volumes', async ({
        expect,
    }) => {
        process.env.DOCKER_DEFAULT_PLATFORM = 'linux/arm64';
        const fake = amd64RegistryFake();
        const registryImageId = fake.imageId(registryRef);

        await runTool(fake, 'unpinned', {});

        const argv = runArgv(fake);
        expect(argv).toContain('lz-tooling-cache-cache-linux-arm64:/cache');
        expect(fake.runs.map(({ ref, imagePlatform }) => [ref, imagePlatform])).toEqual([
            [platformTag, 'linux/arm64'],
        ]);
        expect(fake.imageId(registryRef)).toBe(registryImageId);
    });

    it('on a cold host a native run of a tool without a pin uses a platform tag, so a pinned tool on the same image pulls the registry tag once and no later run pulls', async ({
        expect,
    }) => {
        const fake = new FakeDocker({ registry: new Map([[registryRef, multiPlatformIndex]]) });

        await runTool(fake, 'unpinned', { dockerPlatform: 'native' });
        await runTool(fake, 'pinned', {});
        await runTool(fake, 'unpinned', { dockerPlatform: 'native' });
        await runTool(fake, 'pinned', {});

        expect(fake.dockerCommands('pull')).toEqual([
            ['docker', 'pull', '--platform', 'linux/arm64', `${REPOSITORY}@${ARM64_DIGEST}`],
            ['docker', 'pull', '--platform', 'linux/amd64', registryRef],
        ]);
        expect(fake.imagePlatforms(registryRef)).toEqual(['linux/amd64']);
        expect(fake.runs.map(({ ref, imagePlatform }) => [ref, imagePlatform])).toEqual([
            [platformTag, 'linux/arm64'],
            [registryRef, 'linux/amd64'],
            [platformTag, 'linux/arm64'],
            [registryRef, 'linux/amd64'],
        ]);
    });

    it('a native run uses linux-arm64 cache volumes, apart from the default run', async ({
        expect,
    }) => {
        const fake = amd64RegistryFake();

        await runTool(fake, 'pinned', { dockerPlatform: 'native' });
        await runTool(fake, 'pinned', {});

        const [nativeRun, defaultRun] = fake.dockerCommands('run');
        expect(nativeRun).toContain('lz-tooling-cache-cache-linux-arm64:/cache');
        expect(defaultRun).toContain('lz-tooling-cache-cache-linux-amd64:/cache');
    });

    it('native on engine linux/amd64 for a tool pinned to linux/amd64 runs the registry tag like a default run', async ({
        expect,
    }) => {
        const fake = new FakeDocker({
            engine: { Os: 'linux', Arch: 'amd64', ApiVersion: '1.56' },
            registry: new Map([[registryRef, multiPlatformIndex]]),
        });
        const amd64PlatformTag = `${registryRef}--linux-amd64`;

        await runTool(fake, 'pinned', { dockerPlatform: 'native' });

        expect(fake.dockerCommands('pull')).toEqual([
            ['docker', 'pull', '--platform', 'linux/amd64', registryRef],
        ]);
        expect(fake.dockerCommands('buildx')).toEqual([]);
        expect(fake.dockerCommands('tag')).toEqual([]);
        expect(fake.hasRef(amd64PlatformTag)).toBe(false);
        expect(fake.hasRef(platformTag)).toBe(false);

        const secondRunStart = fake.commands.length;
        await runTool(fake, 'pinned', { dockerPlatform: 'native' });

        expect(hasSubcommand(fake.argvs(secondRunStart), 'pull')).toBe(false);
        expect(
            fake.runs.map(({ ref, platformArg, imagePlatform }) => [
                ref,
                platformArg,
                imagePlatform,
            ]),
        ).toEqual([
            [registryRef, 'linux/amd64', 'linux/amd64'],
            [registryRef, 'linux/amd64', 'linux/amd64'],
        ]);
    });

    it('a default run of a pinned tool runs the registry tag with --platform linux/amd64', async ({
        expect,
    }) => {
        const fake = amd64RegistryFake();

        await runTool(fake, 'pinned', {});

        const argv = runArgv(fake);
        expect(argv.slice(0, 6)).toEqual([
            'docker',
            'run',
            '--platform',
            'linux/amd64',
            '--rm',
            '--add-host=host.docker.internal:host-gateway',
        ]);
        expect(argv.slice(-2)).toEqual([registryRef, 'pinned']);
        expect(fake.dockerCommands('pull')).toEqual([]);
    });

    it('on Docker API 1.48 a default run of a pinned tool with a probe stamp creates no probe container and runs the registry tag', async ({
        expect,
    }) => {
        const fake = new FakeDocker({
            engine: { Os: 'linux', Arch: 'arm64', ApiVersion: '1.48' },
            local: new Map([[registryRef, [amd64Image]]]),
            registry: new Map([[registryRef, multiPlatformIndex]]),
        });
        await writeProbeStamp(registryRef, 'linux/amd64');

        await runTool(fake, 'pinned', {});

        expect(fake.dockerCommands('container create')).toEqual([]);
        expect(fake.runs).toEqual([
            {
                ref: registryRef,
                platformArg: 'linux/amd64',
                imagePlatform: 'linux/amd64',
                dockerDefaultPlatform: undefined,
            },
        ]);
    });

    it('a run without a run platform runs the cached registry tag without --platform', async ({
        expect,
    }) => {
        const fake = amd64RegistryFake();

        await runTool(fake, 'unpinned', {});

        const argv = runArgv(fake);
        expect(argv).not.toContain('--platform');
        expect(argv.slice(-2)).toEqual([registryRef, 'unpinned']);
        expect(fake.dockerCommands('version')).toEqual([]);
    });
});
