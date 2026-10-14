/**
 * Programs written onto each validator, on top of the base snapshot that already carries the
 * LayerZero protocol (Endpoint, ULN, DVN, Executor, pricefeed). Every requested `.so` must exist:
 * a missing build fails the file instead of silently skipping coverage.
 */

import fs from 'fs';

import type { ValidatorConfig } from '@layerzerolabs/test-utils-solana';

import { TOKEN_MANAGER_PROGRAM_ID } from '../../build/token_manager/programs';
import { COMPOSER_PROGRAM_ID, OFT_PROGRAM_ID } from '../constants';
import { PUBKEY_POLICY_HOOK_PROGRAM_ID, PUBKEY_POLICY_PROGRAM_ID } from './pubkey-policy';
import { TOKEN_ACL_PROGRAM_ID } from './token-manager';

type Programs = NonNullable<ValidatorConfig['programs']>;

/** `target/deploy` holds `pnpm build`'s programs; `target/test-deploy` holds the test fixtures. */
const program = (
    id: { toString(): string },
    name: string,
    dir = 'target/deploy',
): Programs[number] => {
    const soPath = `${dir}/${name}.so`;
    if (!fs.existsSync(soPath))
        throw new Error(`${soPath} is missing; build it before the validator suite`);
    return { id: id.toString(), soPath };
};

/** Console OFT, built by `pnpm build`. */
export const oftPrograms = (): Programs => [program(OFT_PROGRAM_ID, 'console_oft')];

/** The composer that `lz_compose` delivers to (tests/programs/example_composer). */
export const composerPrograms = (): Programs => [program(COMPOSER_PROGRAM_ID, 'example_composer')];

/**
 * Canonical Token ACL gated by `token_manager`, the pubkey-policy oracle both bind, and the
 * pubkey-policy transfer hook. Built by `pnpm build:test-fixtures`.
 */
export const aclPrograms = (): Programs => [
    program(TOKEN_MANAGER_PROGRAM_ID, 'token_manager', 'target/test-deploy'),
    program(TOKEN_ACL_PROGRAM_ID, 'token_acl_fixture', 'target/test-deploy'),
    program(PUBKEY_POLICY_PROGRAM_ID, 'pubkey_policy', 'target/test-deploy'),
    program(PUBKEY_POLICY_HOOK_PROGRAM_ID, 'pubkey_policy_hook', 'target/test-deploy'),
];
