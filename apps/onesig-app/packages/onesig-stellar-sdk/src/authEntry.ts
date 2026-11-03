import { Address, xdr } from '@stellar/stellar-sdk';

const fail = (path: string, reason: string): never => {
    throw new Error(`Invalid Stellar subInvocation at ${path}: ${reason}`);
};

const asVec = (value: xdr.ScVal, path: string): xdr.ScVal[] => {
    if (value.switch().value !== xdr.ScValType.scvVec().value) {
        return fail(path, `expected a vec, got ${value.switch().name}`);
    }
    return value.vec() ?? fail(path, 'expected a vec, got an empty value');
};

const asSymbol = (value: xdr.ScVal, path: string): string => {
    if (value.switch().value !== xdr.ScValType.scvSymbol().value) {
        return fail(path, `expected a symbol, got ${value.switch().name}`);
    }
    return value.sym().toString();
};

export const assertContractAddress = (value: xdr.ScVal, path: string) => {
    if (value.switch().value !== xdr.ScValType.scvAddress().value) {
        fail(path, `expected an address, got ${value.switch().name}`);
    }
    if (value.address().switch().value !== xdr.ScAddressType.scAddressTypeContract().value) {
        fail(path, `expected a contract address, got ${value.address().switch().name}`);
    }
    try {
        Address.fromScAddress(value.address());
    } catch (error) {
        fail(path, `expected an address: ${error instanceof Error ? error.message : error}`);
    }
};

const assertBytes32 = (value: xdr.ScVal, path: string) => {
    if (value.switch().value !== xdr.ScValType.scvBytes().value || value.bytes().length !== 32) {
        fail(path, 'expected 32 bytes');
    }
};

const asStruct = <Field extends string>(
    value: xdr.ScVal,
    path: string,
    fields: readonly Field[],
): Record<Field, xdr.ScVal> => {
    if (value.switch().value !== xdr.ScValType.scvMap().value) {
        return fail(path, `expected a map, got ${value.switch().name}`);
    }
    const entries = value.map() ?? [];
    const keys = entries.map((entry, index) => asSymbol(entry.key(), `${path} key ${index}`));
    if (keys.join(',') !== fields.join(',')) {
        return fail(path, `expected fields [${fields.join(', ')}], got [${keys.join(', ')}]`);
    }
    return Object.fromEntries(
        entries.map((entry, index) => [fields[index], entry.val()]),
    ) as Record<Field, xdr.ScVal>;
};

const assertExecutable = (value: xdr.ScVal, path: string) => {
    const variant = asVec(value, path);
    if (variant.length !== 2 || asSymbol(variant[0], `${path}[0]`) !== 'Wasm') {
        fail(path, 'expected [Wasm, hash]');
    }
    assertBytes32(variant[1], `${path}[1]`);
};

export const assertInvokerContractAuthEntry = (entry: xdr.ScVal, path = 'subInvocations') => {
    const variant = asVec(entry, path);
    if (variant.length !== 2) {
        fail(path, `expected [variant, value], got ${variant.length} items`);
    }
    const [tag, body] = variant;
    const name = asSymbol(tag, `${path}[0]`);

    if (name === 'Contract') {
        const invocation = asStruct(body, path, ['context', 'sub_invocations'] as const);
        const context = asStruct(invocation.context, `${path}.context`, [
            'args',
            'contract',
            'fn_name',
        ] as const);
        asVec(context.args, `${path}.context.args`);
        assertContractAddress(context.contract, `${path}.context.contract`);
        asSymbol(context.fn_name, `${path}.context.fn_name`);
        asVec(invocation.sub_invocations, `${path}.sub_invocations`).forEach((child, index) =>
            assertInvokerContractAuthEntry(child, `${path}.sub_invocations[${index}]`),
        );
        return;
    }

    if (name === 'CreateContractHostFn') {
        const context = asStruct(body, path, ['executable', 'salt'] as const);
        assertExecutable(context.executable, `${path}.executable`);
        assertBytes32(context.salt, `${path}.salt`);
        return;
    }

    if (name === 'CreateContractWithCtorHostFn') {
        const context = asStruct(body, path, ['constructor_args', 'executable', 'salt'] as const);
        asVec(context.constructor_args, `${path}.constructor_args`);
        assertExecutable(context.executable, `${path}.executable`);
        assertBytes32(context.salt, `${path}.salt`);
        return;
    }

    fail(path, `unknown InvokerContractAuthEntry variant ${name}`);
};

export const assertExecuteTransactionArgs = (args: xdr.ScVal[], path = 'args') => {
    if (args.length !== 1) {
        fail(path, `expected one Vec<Call> argument, got ${args.length}`);
    }
    asVec(args[0], `${path}[0]`).forEach((call, callIndex) => {
        const callPath = `${path}[0][${callIndex}]`;
        const fields = asStruct(call, callPath, ['args', 'func', 'sub_invocations', 'to'] as const);
        asVec(fields.args, `${callPath}.args`);
        asSymbol(fields.func, `${callPath}.func`);
        assertContractAddress(fields.to, `${callPath}.to`);
        asVec(fields.sub_invocations, `${callPath}.sub_invocations`).forEach((entry, entryIndex) =>
            assertInvokerContractAuthEntry(entry, `${callPath}.sub_invocations[${entryIndex}]`),
        );
    });
};

export const assertContractTarget = (address: string, path: string) => {
    let value: xdr.ScVal;
    try {
        value = Address.fromString(address).toScVal();
    } catch (error) {
        return fail(path, `expected an address: ${error instanceof Error ? error.message : error}`);
    }
    assertContractAddress(value, path);
};
