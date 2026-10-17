import type { Commitment, PublicKey, RpcInterface } from '@metaplex-foundation/umi';

import type { LzComposeParams } from './params';
import { getLzComposeParamsSerializer } from './params';
import { getPlannerAccounts, type PlanV3Options, resolvePlanV3, simulatePlanV3 } from './plan-v3';
import type { LzComposeTypesV3Accounts } from './types-v3';
import { getLzComposeTypesV3ResultSerializer } from './types-v3';

/** V3-only discovery: errors or unknown versions never downgrade to a legacy planner. */
export function getLzComposeTypesInfoV3(
    rpc: RpcInterface,
    payer: PublicKey,
    receiver: PublicKey,
    program: PublicKey,
    params: LzComposeParams,
    commitment: Commitment = 'confirmed',
): Promise<LzComposeTypesV3Accounts> {
    return getPlannerAccounts(
        rpc,
        payer,
        receiver,
        program,
        'compose',
        getLzComposeParamsSerializer().serialize(params),
        commitment,
    );
}

export async function buildLzComposeExecutionPlanV3(
    rpc: RpcInterface,
    executor: PublicKey,
    payer: PublicKey,
    receiver: PublicKey,
    program: PublicKey,
    params: LzComposeParams,
    inputs?: LzComposeTypesV3Accounts,
    commitment: Commitment = 'confirmed',
    options: PlanV3Options = {},
) {
    const bootstrap =
        inputs ??
        (await getLzComposeTypesInfoV3(rpc, payer, receiver, program, params, commitment));
    const data = getLzComposeParamsSerializer().serialize(params);
    const plan = await simulatePlanV3(
        rpc,
        payer,
        program,
        'compose',
        data,
        bootstrap.accounts,
        getLzComposeTypesV3ResultSerializer(),
        commitment,
        options,
    );
    return resolvePlanV3(plan, 'compose', program, executor, payer, data);
}
