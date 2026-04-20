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

const syncedCwds = new Set<string>();

export async function syncToolchain(
    context: ChainContext<string>,
    options: ToolCommandExecutionOptions,
): Promise<void> {
    if (syncedCwds.has(options.cwd)) {
        return;
    }

    const filePath = path.join(options.cwd, 'rust-toolchain.toml');

    let installCmd: string;
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
    syncedCwds.add(options.cwd);

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
