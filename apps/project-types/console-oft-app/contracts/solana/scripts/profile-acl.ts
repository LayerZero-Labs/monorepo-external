/** Build SBF fixtures first. Add --include-send to profile both directions. */
import { createNoopSigner, type Instruction, publicKey } from '@metaplex-foundation/umi';
import {
    blockhash,
    getCompiledTransactionMessageDecoder,
    getTransactionEncoder,
} from '@solana/kit';
import { spawnSync } from 'node:child_process';

import { ExecutorProgram } from '@layerzerolabs/lz-v2-protocol-solana';
import { compileTransactionV1 } from '@layerzerolabs/lz-v2-protocol-solana/v3';

const includeSend = process.argv.includes('--include-send');
const filter = includeSend ? 'resource_profile' : 'inline_acl_resource_profile';
const run = spawnSync(
    'pnpm',
    [
        'exec',
        'lz-tool',
        '--script',
        `RUST_LOG=off cargo test -p console-oft-integration-tests --locked --test integration ${filter} -- --nocapture`,
        'anchor',
    ],
    { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], maxBuffer: 64 * 1024 * 1024 },
);
process.stderr.write(run.stderr);
if (run.status !== 0) throw new Error(`Resource profile run exited with ${run.status}`);
// lz-tool forwards the container's output on stderr.
const rows = `${run.stdout}\n${run.stderr}`
    .split('\n')
    .filter((line) => /^(ACL|SEND)_PROFILE /.test(line));
if (rows.length !== (includeSend ? 14 : 7)) throw new Error('Incomplete SBF resource profiles');
for (const line of rows) {
    const send = line.startsWith('SEND_PROFILE ');
    const {
        instructions: raw,
        payer: payerKey,
        ...profile
    } = JSON.parse(line.slice(line.indexOf(' ') + 1));
    const payer = createNoopSigner(publicKey(payerKey));
    const executor = new ExecutorProgram.Executor(publicKey(new Uint8Array(32).fill(0xed)));
    const body: Instruction[] = raw.map(
        (ix: { programId: string; data: number[]; keys: Instruction['keys'] }) => ({
            programId: publicKey(ix.programId),
            keys: ix.keys,
            data: Uint8Array.from(ix.data),
        }),
    );
    const instructions = send
        ? body
        : [
              executor.preExecute(payer, 1, 10_000_000n).instruction,
              ...body,
              executor.postExecute(payer, 1).instruction,
          ];
    const transaction = compileTransactionV1(
        payer.publicKey,
        instructions,
        {
            blockhash: blockhash(publicKey(new Uint8Array(32).fill(0xbb))),
            lastValidBlockHeight: 100n,
        },
        {
            computeUnitLimit: 1_400_000,
            loadedAccountsDataSizeLimit: 64 * 1024 * 1024,
            heapSize: 256 * 1024,
        },
    );
    const message = getCompiledTransactionMessageDecoder().decode(transaction.messageBytes);
    if (message.version !== 1 || message.numInstructions !== (send ? 1 : 3))
        throw new Error('Unexpected V1 envelope');
    // Compilation enforces 64 addresses and 4096 bytes; no synthetic ComputeBudget instructions.
    console.log(
        JSON.stringify({
            ...profile,
            direction: send ? 'send' : 'receive',
            deliveryMetas: body[0].keys.length,
            envelopeKeys: message.staticAccounts.length,
            envelopeBytes: getTransactionEncoder().encode(transaction).length,
            envelopeSignatures: Object.keys(transaction.signatures).length,
        }),
    );
}
