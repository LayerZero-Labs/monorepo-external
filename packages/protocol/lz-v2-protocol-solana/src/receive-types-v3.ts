import type { Commitment, PublicKey, RpcInterface } from '@metaplex-foundation/umi';

import { getPlannerAccounts, type PlanV3Options, resolvePlanV3, simulatePlanV3 } from './plan-v3';
import type { LzReceiveParams } from './types';
import { getLzReceiveParamsSerializer } from './types';
import type { LzReceiveTypesV3Accounts } from './types-v3';
import { getLzReceiveTypesV3ResultSerializer } from './types-v3';

/** V3-only discovery: errors or unknown versions never downgrade to a legacy planner. */
export function getLzReceiveTypesInfoV3(
    rpc: RpcInterface,
    payer: PublicKey,
    receiver: PublicKey,
    program: PublicKey,
    params: LzReceiveParams,
    commitment: Commitment = 'confirmed',
): Promise<LzReceiveTypesV3Accounts> {
    return getPlannerAccounts(
        rpc,
        payer,
        receiver,
        program,
        'receive',
        getLzReceiveParamsSerializer().serialize(params),
        commitment,
    );
}

export async function buildLzReceiveExecutionPlanV3(
    rpc: RpcInterface,
    executor: PublicKey,
    payer: PublicKey,
    receiver: PublicKey,
    program: PublicKey,
    params: LzReceiveParams,
    inputs?: LzReceiveTypesV3Accounts,
    commitment: Commitment = 'confirmed',
    options: PlanV3Options = {},
) {
    const bootstrap =
        inputs ??
        (await getLzReceiveTypesInfoV3(rpc, payer, receiver, program, params, commitment));
    const data = getLzReceiveParamsSerializer().serialize(params);
    const plan = await simulatePlanV3(
        rpc,
        payer,
        program,
        'receive',
        data,
        bootstrap.accounts,
        getLzReceiveTypesV3ResultSerializer(),
        commitment,
        options,
    );
    return resolvePlanV3(plan, 'receive', program, executor, payer, data);
}
