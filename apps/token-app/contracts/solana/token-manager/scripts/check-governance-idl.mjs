import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

// Public ABI checks run with build:check, after generating the production IDL.
const readIdl = (name) => JSON.parse(readFileSync(`target/idl/${name}.json`, 'utf8'));
const manager = readIdl('token_manager');
const fieldNames = (idl, name) =>
    idl.types.find((type) => type.name === name).type.fields.map((field) => field.name);
assert.deepEqual(
    fieldNames(manager, 'TokenManagerStore'),
    ['mint', 'current_default_admin', 'pending_default_admin', 'bootstrap'],
    'The one-root-per-mint store carries no policy state',
);
assert.deepEqual(
    manager.accounts.find((account) => account.name === 'TokenManagerStore').discriminator,
    [63, 143, 55, 45, 107, 228, 180, 214],
);
const instructions = new Set(manager.instructions.map((instruction) => instruction.name));
for (const name of [
    'begin_default_admin_transfer',
    'accept_default_admin_transfer',
    'grant_role',
    'revoke_role',
    'permissioned_burn',
    'accept_token_manager_admin',
    'set_pending_token_manager_admin',
    'set_native_authority',
    'pd_burn',
    'pd_recover',
]) {
    assert(instructions.has(name), `Missing supported governance instruction: ${name}`);
}
for (const name of ['set_blacklisted', 'set_whitelisted', 'set_mode']) {
    assert(!instructions.has(name), `Policy setters belong to the pubkey-policy program: ${name}`);
}
for (const [name, code] of [
    ['DefaultAccountStateNotFrozen', 7008],
    ['MissingBurnSourceSignature', 10002],
]) {
    assert.equal(manager.errors.find((error) => error.name === name).code, code);
}
assert(
    !instructions.has('renounce_burn_authority'),
    'The TokenManager never nulls a native authority; renounce by handing it off',
);
console.log('Single-admin governance IDL checks passed');
