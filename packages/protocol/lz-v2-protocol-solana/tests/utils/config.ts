import { Options } from '@layerzerolabs/lz-v2-utilities';

import { dvnPDA } from './constants';

// common
export const maxUpdaterNum = 8;
export const maxAdminNum = 5;
export const maxOptionTypeNum = 8;
export const maxAllowListNum = 8;
export const maxDenyListNum = 8;
export const maxDstConfigsLen = 140;
export const options = Options.newOptions().addExecutorLzReceiveOption(2000000, 0);

// pricefeed
export const arbitrumCompressionPercent = 50;
export const priceRatioDenominator = BigInt(10) ** BigInt(20);
export const priceRatio = BigInt(1e11);
export const gasPriceInUnit = BigInt(1e9);
export const gasPerByte = 1;
export const maxPriceLen = maxDstConfigsLen;

// dvn
export const maxMsgLibNum = 10;
export const maxSignerNum = 7;

// executor
export const defaultMultiplierBps = 13000;
export const defaultCallDataSize = BigInt('1000');
export const maxOptionTypesLen = 10;
export const maxMsgLibsLen = 10;
export const maxExecutorsLen = 8;

// uln
export const confirmations = 1n;
export const requiredDvns = [dvnPDA.config()[0]];
export const requiredDvnCount = requiredDvns.length;
export const optionalDvns = [];
export const optionalDvnCount = optionalDvns.length;
export const optionalDvnThreshold = 0;
export const bpsDenominator = 10000;
export const defaultNativeFeeBps = 1000;
export const defaultTreasuryFee = 1000n;
// endpoint
export const maxPendingInboundNonce = BigInt(256);
