import type { JsActiveContract } from '../open-api/models';

const DAML_DECIMAL_SCALE = 10n ** 10n;
// Splice AmuletRules `transferConfig.maxNumInputs`: DSO-governed, bootstrapped at 100 and unchanged
// on DevNet/TestNet/MainNet (CIP-0107). Exceeding it fails with `maximum-inputs-exceeded`.
export const MAX_TRANSFER_INPUTS = 100;

export const parseDamlDecimal = (value: unknown, label: string): bigint => {
    if (typeof value !== 'string') {
        throw new Error(`${label} must be a DAML Decimal string`);
    }
    const match = /^([+-]?)(\d+)(?:\.(\d{0,10}))?$/.exec(value);
    if (!match) {
        throw new Error(`${label} is not a valid DAML Decimal: ${value}`);
    }
    const sign = match[1] === '-' ? -1n : 1n;
    const whole = BigInt(match[2]!);
    const fraction = BigInt((match[3] ?? '').padEnd(10, '0'));
    return sign * (whole * DAML_DECIMAL_SCALE + fraction);
};

const sortByAmountDesc = (
    contracts: JsActiveContract[],
    amountOf: (contract: JsActiveContract) => bigint,
): Array<{ contract: JsActiveContract; amount: bigint }> =>
    contracts
        .map((contract) => ({ contract, amount: amountOf(contract) }))
        .sort((left, right) =>
            left.amount === right.amount
                ? left.contract.createdEvent.contractId.localeCompare(
                      right.contract.createdEvent.contractId,
                  )
                : left.amount > right.amount
                  ? -1
                  : 1,
        );

/** The largest `limit` contracts, for transfers whose required amount is only known on-ledger. */
export const selectLargestContracts = (
    contracts: JsActiveContract[],
    amountOf: (contract: JsActiveContract) => bigint,
    limit = MAX_TRANSFER_INPUTS,
): JsActiveContract[] =>
    sortByAmountDesc(contracts, amountOf)
        .slice(0, limit)
        .map(({ contract }) => contract);

export const selectContractAmounts = (
    contracts: JsActiveContract[],
    field: string,
    requestedValue: string,
    amountOf: (contract: JsActiveContract) => bigint,
): JsActiveContract[] => {
    const requested = parseDamlDecimal(requestedValue, 'Requested contract value');
    if (requested <= 0n) {
        throw new Error('Requested contract value must be positive');
    }

    const candidates = sortByAmountDesc(contracts, amountOf).filter(({ amount }) => amount > 0n);

    const selected: JsActiveContract[] = [];
    let total = 0n;
    for (const candidate of candidates) {
        selected.push(candidate.contract);
        total += candidate.amount;
        if (total >= requested) break;
    }

    if (total < requested) {
        throw new Error(
            `Insufficient contract value in field ${field}: requested ${requestedValue}, found ${total.toString()} base units`,
        );
    }
    if (selected.length > MAX_TRANSFER_INPUTS) {
        throw new Error(
            `Selection needs ${selected.length} contracts, exceeding the ${MAX_TRANSFER_INPUTS} input limit`,
        );
    }
    return selected;
};
