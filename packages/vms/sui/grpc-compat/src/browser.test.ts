import { build } from 'esbuild';
import { fileURLToPath } from 'node:url';
import { expect, it } from 'vitest';

it('bundles the public entry point for browsers without native gRPC dependencies', async () => {
    const result = await build({
        entryPoints: [fileURLToPath(new URL('./index.ts', import.meta.url))],
        bundle: true,
        platform: 'browser',
        format: 'esm',
        write: false,
        metafile: true,
        logLevel: 'silent',
    });

    expect(result.outputFiles[0].contents.length).toBeGreaterThan(0);
    expect(
        Object.keys(result.metafile.inputs).filter(
            (path) =>
                path.includes('@grpc/grpc-js') || path.includes('@protobuf-ts/grpc-transport'),
        ),
    ).toEqual([]);
});
