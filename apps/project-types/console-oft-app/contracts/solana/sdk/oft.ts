/**
 * Console OFT SDK: PDA helpers plus the Codama-generated client, re-exported from `build/`
 * (`pnpm build:sdk`). Importing this module requires the generated client to exist.
 */

export * as accounts from '../build/console_oft/accounts';
export * as errors from '../build/console_oft/errors';
export * as instructions from '../build/console_oft/instructions';
export * as types from '../build/console_oft/types';

import type { Pda, PublicKey, Umi } from '@metaplex-foundation/umi';
import { publicKeyBytes } from '@metaplex-foundation/umi';
import { Endian, u16, u32, u128 } from '@metaplex-foundation/umi/serializers';
import { createWeb3JsEddsa } from '@metaplex-foundation/umi-eddsa-web3js';

import { UMI } from '@layerzerolabs/lz-solana-sdk-v2';

import { CONSOLE_OFT_PROGRAM_ID } from '../build/console_oft/programs';

const eddsa = createWeb3JsEddsa();

export class OftPda extends UMI.OmniAppPDA {
    static readonly OFT_SEED = Uint8Array.from(Buffer.from('OFT', 'utf8'));
    static readonly ESCROW_SEED = Uint8Array.from(Buffer.from('Escrow', 'utf8'));
    static readonly RATE_LIMIT_SEED = Uint8Array.from(Buffer.from('RateLimit', 'utf8'));
    static readonly RATE_LIMIT_EXEMPTION_SEED = Uint8Array.from(
        Buffer.from('RateLimitExemption', 'utf8'),
    );
    static readonly PAUSE_SEED = Uint8Array.from(Buffer.from('Pause', 'utf8'));
    static readonly FEE_SEED = Uint8Array.from(Buffer.from('Fee', 'utf8'));
    static readonly LZ_RECEIVE_TYPES_SEED_BYTES = Uint8Array.from(
        Buffer.from('LzReceiveTypes', 'utf8'),
    );
    static readonly ROLE_MEMBER_SEED = Uint8Array.from(Buffer.from('RoleMember', 'utf8'));
    static readonly ENFORCED_OPTIONS_SEED = Uint8Array.from(Buffer.from('EnforcedOptions', 'utf8'));
    static readonly OAPP_INFO_SEED = Uint8Array.from(Buffer.from('OAppInfo', 'utf8'));

    private readonly event: UMI.EventPDA;
    private readonly initializer?: PublicKey;

    constructor(
        public readonly programId: PublicKey = CONSOLE_OFT_PROGRAM_ID,
        initializer?: PublicKey,
    ) {
        super(programId);
        this.event = new UMI.EventPDA(programId);
        this.initializer = initializer;
    }

    oapp(): Pda {
        if (!this.initializer) {
            throw new Error(
                'OftPda.oapp() requires initializer; construct OftPda(programId, initializer) instead.',
            );
        }
        return this.oftStore(this.initializer);
    }

    peer(oftStore: PublicKey, dstChainId: number): Pda {
        return eddsa.findPda(this.programId, [
            Uint8Array.from(Buffer.from(OftPda.PEER_SEED, 'utf8')),
            publicKeyBytes(oftStore),
            u32({ endian: Endian.Big }).serialize(dstChainId),
        ]);
    }

    oftStore(initializer?: PublicKey): Pda {
        const d = initializer ?? this.initializer;
        if (!d) {
            throw new Error(
                'OftPda.oftStore() requires initializer; pass it as an argument or in the constructor.',
            );
        }
        return eddsa.findPda(this.programId, [OftPda.OFT_SEED, publicKeyBytes(d)]);
    }

    oftEscrow(oftStore: PublicKey): Pda {
        return eddsa.findPda(this.programId, [OftPda.ESCROW_SEED, publicKeyBytes(oftStore)]);
    }

    rateLimit(oftStore: PublicKey, dstEid: number): Pda {
        return eddsa.findPda(this.programId, [
            OftPda.RATE_LIMIT_SEED,
            publicKeyBytes(oftStore),
            u128({ endian: Endian.Big }).serialize(dstEid),
        ]);
    }

    pauseConfig(oftStore: PublicKey, dstEid: number): Pda {
        return eddsa.findPda(this.programId, [
            OftPda.PAUSE_SEED,
            publicKeyBytes(oftStore),
            u128({ endian: Endian.Big }).serialize(dstEid),
        ]);
    }

    feeConfig(oftStore: PublicKey, dstEid: number): Pda {
        return eddsa.findPda(this.programId, [
            OftPda.FEE_SEED,
            publicKeyBytes(oftStore),
            u128({ endian: Endian.Big }).serialize(dstEid),
        ]);
    }

    enforcedOptions(oftStore: PublicKey, dstEid: number, msgType: number): Pda {
        return eddsa.findPda(this.programId, [
            OftPda.ENFORCED_OPTIONS_SEED,
            publicKeyBytes(oftStore),
            u32({ endian: Endian.Big }).serialize(dstEid),
            u16({ endian: Endian.Big }).serialize(msgType),
        ]);
    }

    rateLimitAddressExemption(oftStore: PublicKey, user: PublicKey): Pda {
        return eddsa.findPda(this.programId, [
            OftPda.RATE_LIMIT_EXEMPTION_SEED,
            publicKeyBytes(oftStore),
            publicKeyBytes(user),
        ]);
    }

    lzReceiveTypesAccounts(oftStore: PublicKey): Pda {
        return eddsa.findPda(this.programId, [
            OftPda.LZ_RECEIVE_TYPES_SEED_BYTES,
            publicKeyBytes(oftStore),
        ]);
    }

    roleMember(oftStore: PublicKey, role: number, member: PublicKey): Pda {
        return eddsa.findPda(this.programId, [
            OftPda.ROLE_MEMBER_SEED,
            publicKeyBytes(oftStore),
            Uint8Array.from([role]),
            publicKeyBytes(member),
        ]);
    }

    eventAuthority(): Pda {
        return this.event.eventAuthority();
    }

    oappInfo(): Pda {
        return eddsa.findPda(this.programId, [OftPda.OAPP_INFO_SEED]);
    }

    async isRateLimitAddressExempt(
        umi: Umi,
        oftStore: PublicKey,
        user: PublicKey,
    ): Promise<boolean> {
        const exemptionPda = this.rateLimitAddressExemption(oftStore, user);
        const account = await umi.rpc.getAccount(exemptionPda[0]);
        return account.exists;
    }
}
