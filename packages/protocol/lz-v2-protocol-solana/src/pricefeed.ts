import type {
    Cluster,
    ClusterFilter,
    Commitment,
    OptionOrNullable,
    Program,
    ProgramError,
    ProgramRepositoryInterface,
    PublicKey,
    RpcInterface,
    Signer,
    WrappedInstruction,
} from '@metaplex-foundation/umi';
import { createNullRpc } from '@metaplex-foundation/umi';
import { createDefaultProgramRepository } from '@metaplex-foundation/umi-program-repository';

import { PRICEFEED_PROGRAM_ID } from './generated/pricefeed';
import * as accounts from './generated/pricefeed/accounts';
import * as errors from './generated/pricefeed/errors';
import * as instructions from './generated/pricefeed/instructions';
import * as types from './generated/pricefeed/types';
import { PriceFeedPDA } from './pda';

export { PRICEFEED_PROGRAM_ID } from './generated/pricefeed';
export { accounts, errors, instructions, types };

/**
 * Class representing the PriceFeed.
 */
export class PriceFeed {
    public readonly pda: PriceFeedPDA;
    public readonly programRepo: ProgramRepositoryInterface;

    constructor(
        public readonly programId: PublicKey = PRICEFEED_PROGRAM_ID,
        rpc?: RpcInterface,
    ) {
        this.pda = new PriceFeedPDA(this.programId);
        if (rpc === undefined) {
            rpc = createNullRpc();
            rpc.getCluster = (): Cluster => 'custom';
        }
        this.programRepo = createDefaultProgramRepository({ rpc }, [
            {
                name: 'pricefeed',
                publicKey: programId,
                getErrorFromCode(code: number, cause?: Error): ProgramError | null {
                    return errors.getPricefeedErrorFromCode(code, this, cause);
                },
                getErrorFromName(name: string, cause?: Error): ProgramError | null {
                    return errors.getPricefeedErrorFromName(name, this, cause);
                },
                isOnCluster(): boolean {
                    return true;
                },
            } satisfies Program,
        ]);
    }

    getProgram(clusterFilter: ClusterFilter = 'custom'): Program {
        return this.programRepo.get('pricefeed', clusterFilter);
    }

    initPriceFeed(
        payer: Signer,
        param: instructions.InitPriceFeedInstructionDataArgs,
    ): WrappedInstruction {
        return instructions.initPriceFeed(
            { programs: this.programRepo, payer },
            {
                payer,
                priceFeed: this.pda.priceFeed(),
                ...param,
            },
        ).items[0];
    }

    setPriceFeed(
        admin: Signer,
        param: instructions.SetPriceFeedInstructionArgs,
    ): WrappedInstruction {
        return instructions.setPriceFeed(
            { programs: this.programRepo },
            {
                admin,
                priceFeed: this.pda.priceFeed(),
                ...param,
            },
        ).items[0];
    }

    setPrice(
        updater: Signer,
        param: { dstEid: number } & OptionOrNullable<types.PriceParamsArgs>,
    ): WrappedInstruction {
        const EID_MODULUS = 30000;
        const dstEid = param.dstEid % EID_MODULUS;
        const isParamsNull = !('priceRatio' in param);

        return instructions.setPrice(
            { programs: this.programRepo },
            {
                updater,
                priceFeed: this.pda.priceFeed(),
                dstEid,
                params: isParamsNull
                    ? null
                    : {
                          priceRatio: param.priceRatio,
                          gasPriceInUnit: param.gasPriceInUnit,
                          gasPerByte: param.gasPerByte,
                          modelType: param.modelType,
                      },
            },
        ).items[0];
    }

    setSolPrice(
        updater: Signer,
        nativeTokenPriceUsd: OptionOrNullable<number | bigint>,
    ): WrappedInstruction {
        return instructions.setSolPrice(
            { programs: this.programRepo },
            {
                updater,
                priceFeed: this.pda.priceFeed(),
                nativeTokenPriceUsd,
            },
        ).items[0];
    }

    transferAdmin(admin: Signer, newAdmin: PublicKey): WrappedInstruction {
        return instructions.transferAdmin(
            { programs: this.programRepo },
            {
                admin,
                priceFeed: this.pda.priceFeed(),
            },
            {
                admin: newAdmin,
            },
        ).items[0];
    }

    getFee(param: instructions.GetFeeInstructionArgs): WrappedInstruction {
        return instructions.getFee(
            { programs: this.programRepo },
            {
                priceFeed: this.pda.priceFeed(),
                ...param,
            },
        ).items[0];
    }

    /**
     * Retrieves the price feed account.
     *
     * @param {RpcInterface} rpc - The Solana connection object.
     * @param {Commitment} [commitment] - Optional commitment or configuration.
     *
     * @returns {Promise<accounts.PriceFeed | null>} The price feed account or null if not found.
     */
    async getPriceFeed(
        rpc: RpcInterface,
        commitment: Commitment = 'confirmed',
    ): Promise<accounts.PriceFeed | null> {
        const [priceFeed] = this.pda.priceFeed();
        return accounts.safeFetchPriceFeed({ rpc }, priceFeed, { commitment });
    }
}
