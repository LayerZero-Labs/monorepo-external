import { writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { join } from 'node:path';

type Upstream = {
    toBigIntLE: (buf: Buffer) => bigint;
    toBigIntBE: (buf: Buffer) => bigint;
    toBufferLE: (num: bigint, width: number) => Buffer;
    toBufferBE: (num: bigint, width: number) => Buffer;
};

const [upstreamDir, outPath] = process.argv.slice(2);
if (!upstreamDir || !outPath) {
    console.error(
        'Usage: node generate-upstream-fixture.ts <bigint-buffer package dir> <output json>',
    );
    process.exit(1);
}

const require = createRequire(import.meta.url);
const upstream: Upstream = require(join(upstreamDir, 'dist', 'node.js'));
const { version } = require(join(upstreamDir, 'package.json')) as { version: string };
const seed = 0x5eed1155;

const mulberry32 = (state: number) => () => {
    state = (state + 0x6d2b79f5) | 0;
    let t = Math.imul(state ^ (state >>> 15), 1 | state);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
};
const rand = mulberry32(seed);
const randomBytes = (len: number) =>
    Buffer.from(Array.from({ length: len }, () => Math.floor(rand() * 256)));

const toBigInt: { hex: string; le: string; be: string }[] = [];
const toBuffer: { num: string; width: number; le: string; be: string }[] = [];
for (let i = 0; i < 256; i++) {
    const bytes = randomBytes(i % 65);
    if (i % 7 === 0 && bytes.length > 0) bytes[0] = 0;
    toBigInt.push({
        hex: bytes.toString('hex'),
        le: upstream.toBigIntLE(bytes).toString(16),
        be: upstream.toBigIntBE(bytes).toString(16),
    });
    const width = Math.floor(rand() * 65);
    const num =
        width === 0
            ? 0n
            : BigInt(
                  '0x' +
                      randomBytes(Math.floor(rand() * (width + 1)))
                          .toString('hex')
                          .padStart(2, '0'),
              );
    toBuffer.push({
        num: num.toString(16),
        width,
        le: upstream.toBufferLE(num, width).toString('hex'),
        be: upstream.toBufferBE(num, width).toString('hex'),
    });
}

writeFileSync(
    outPath,
    JSON.stringify(
        { source: `bigint-buffer@${version} pure-JS path`, seed, toBigInt, toBuffer },
        null,
        4,
    ) + '\n',
);
