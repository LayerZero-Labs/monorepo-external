import { access, readFile } from 'node:fs/promises';
import path from 'node:path';
import { parse } from 'toml';

import type { ChainContext, ToolCommandExecutionOptions } from '@layerzerolabs/vm-tooling';
import { executeToolCommand } from '@layerzerolabs/vm-tooling';

interface RustToolchainToml {
    toolchain?: {
        channel?: string;
        targets?: string[];
        components?: string[];
    };
}

const syncedInstalls = new Set<string>();
const RUSTUP_TOOLCHAIN_ENV = 'RUSTUP_TOOLCHAIN';

export async function syncToolchain(
    context: ChainContext<string>,
    options: ToolCommandExecutionOptions,
): Promise<void> {
    const envVariable = options.env.find(({ name }) => name === RUSTUP_TOOLCHAIN_ENV);
    const envToolchain = envVariable?.value.trim();
    if (envVariable && !envToolchain) {
        throw new Error(`${RUSTUP_TOOLCHAIN_ENV} must not be empty`);
    }

    if (envToolchain && !/^[A-Za-z0-9._-]+$/.test(envToolchain)) {
        throw new Error(`${RUSTUP_TOOLCHAIN_ENV} is not a valid toolchain: ${envToolchain}`);
    }

    const filePath = path.join(options.cwd, 'rust-toolchain.toml');

    let installCmd: string;
    if (envToolchain) {
        installCmd = `rustup toolchain install ${envToolchain} --no-self-update`;
    } else {
        const hasToolchainFile = await access(filePath).then(
            () => true,
            () => false,
        );

        if (hasToolchainFile) {
            const parsed: RustToolchainToml = parse(await readFile(filePath, 'utf-8'));

            const channel = parsed.toolchain?.channel;
            if (typeof channel !== 'string') {
                throw new Error(`Missing 'toolchain.channel' in ${filePath}`);
            }

            const targets: string[] = parsed.toolchain?.targets ?? [];
            const components: string[] = parsed.toolchain?.components ?? [];

            // --no-self-update: rustup's self-update downloads a new binary to
            // $CARGO_HOME/bin/rustup-init and chmod's it. Inside Docker the
            // download can fail, leaving no file for chmod → "failed to set
            // permissions: No such file or directory". The rustup version is
            // pinned by the Docker image so self-update is unnecessary.
            const installArgs = [`rustup toolchain install ${channel} --no-self-update`];
            for (const target of targets) {
                installArgs.push(`--target ${target}`);
            }
            for (const component of components) {
                installArgs.push(`--component ${component}`);
            }

            installCmd = installArgs.join(' ');
        } else {
            // No rust-toolchain.toml found — install stable as the default so that
            // cargo (a rustup proxy) can resolve a toolchain from the empty RUSTUP_HOME volume.
            installCmd = 'rustup default stable';
        }
    }

    // The resolved install command captures every toolchain input that affects the
    // installation. In particular, changes to channel, targets, or components in
    // rust-toolchain.toml produce a new key, while irrelevant formatting changes do not.
    const cacheKey = JSON.stringify([options.cwd, installCmd]);
    if (syncedInstalls.has(cacheKey)) {
        return;
    }

    // rustup expects to find itself at $CARGO_HOME/bin/rustup to manage proxy
    // binaries there. At runtime CARGO_HOME points to /cache/cargo (volume),
    // so we symlink the image-installed rustup binary into the volume.
    const script = [
        'mkdir -p $CARGO_HOME/bin',
        'ln -sf /usr/local/cargo/bin/rustup $CARGO_HOME/bin/rustup',
        installCmd,
    ].join(' && ');
    console.info(`🔧 Syncing Rust toolchain: ${installCmd}`);

    // Mark as synced before executeToolCommand to prevent recursive preExecute calls
    syncedInstalls.add(cacheKey);

    await executeToolCommand(context, 'stellar', [], {
        ...options,
        script,
        volumes: [
            ...options.volumes,
            {
                type: 'isolate',
                containerPath: '/cache/rustup',
                name: 'stellar-rustup',
                shared: true,
                locked: true,
            },
        ],
    });
}
