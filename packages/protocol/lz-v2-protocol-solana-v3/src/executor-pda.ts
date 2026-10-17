import type { Pda, PublicKey } from '@metaplex-foundation/umi';
import { publicKeyBytes } from '@metaplex-foundation/umi';
import { u8 } from '@metaplex-foundation/umi/serializers';
import { createWeb3JsEddsa } from '@metaplex-foundation/umi-eddsa-web3js';

export const EDDSA = createWeb3JsEddsa();

export class ExecutorPDA {
    static EXECUTOR_CONFIG_SEED = 'ExecutorConfig';
    static EXECUTION_CONTEXT_SEED = 'ExecutionContext';

    constructor(public program: PublicKey) {}

    config(): Pda {
        return EDDSA.findPda(this.program, [Buffer.from(ExecutorPDA.EXECUTOR_CONFIG_SEED, 'utf8')]);
    }

    context(executor: PublicKey, version: number): Pda {
        return EDDSA.findPda(this.program, [
            Buffer.from(ExecutorPDA.EXECUTION_CONTEXT_SEED, 'utf8'),
            publicKeyBytes(executor),
            u8().serialize(version),
        ]);
    }
}
