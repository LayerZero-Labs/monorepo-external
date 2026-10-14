import { Option } from '@metaplex-foundation/umi';
import { option, Serializer, struct, u128 } from '@metaplex-foundation/umi/serializers';

interface PriceFeedFee {
    fee: bigint;
    priceRatio: bigint;
    priceRatioDenominator: bigint;
    nativeTokenPriceUsd: Option<bigint>;
}

export function getPriceFeedFeeSerializer(): Serializer<PriceFeedFee, PriceFeedFee> {
    return struct<PriceFeedFee>(
        [
            ['fee', u128()],
            ['priceRatio', u128()],
            ['priceRatioDenominator', u128()],
            ['nativeTokenPriceUsd', option(u128())],
        ],
        { description: 'PriceFeedFee' },
    );
}
