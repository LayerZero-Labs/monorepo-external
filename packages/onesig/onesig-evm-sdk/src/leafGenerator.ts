import type { BigNumber } from 'ethers';
import { ethers } from 'ethers';

import { hexToBytes, hexZeroPad } from '@layerzerolabs/common-encoding-utils';
import type { GenerateLeafsResult } from '@layerzerolabs/onesig-core';
import { type BaseLeafData } from '@layerzerolabs/onesig-core';

interface ETHTransactionCallData {
    to: string;
    value: BigNumber;
    data: string;
}
export type ETHLeafData = BaseLeafData<string, ETHTransactionCallData>;

export function evmLeafGenerator(leafs: ETHLeafData[]): GenerateLeafsResult<ETHLeafData> {
    return {
        leafs,
        encodeAddress(address) {
            return Buffer.from(hexToBytes(hexZeroPad(address, 32)));
        },
        encodeCalls(calls: ETHTransactionCallData[]) {
            const hexString = ethers.utils.defaultAbiCoder.encode(
                ['tuple(address to, uint256 value, bytes data)[]'],
                [calls],
            );

            return Buffer.from(hexToBytes(hexString));
        },
    };
}
