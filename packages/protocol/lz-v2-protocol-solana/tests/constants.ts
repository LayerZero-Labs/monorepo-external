import { EddsaInterface, publicKey } from '@metaplex-foundation/umi';
import { createWeb3JsEddsa } from '@metaplex-foundation/umi-eddsa-web3js';

import { EndpointProgram, PriceFeedProgram, UlnProgram } from '../src';
import { Executor, EXECUTOR_PROGRAM_ID } from '../src/executor';
import { getECDSAPrivateKey, VERIFIER_SIGNER1, VERIFIER_SIGNER2 } from './utils';

export const SRC_EID = 1;
export const DST_EID = 1;

export const OFT302_PROGRAM_ID = publicKey('9UovNrJD8pQyBLheeHNayuG1wJSEAoxkmM14vw5gcsTT');
export const OFT202_PROGRAM_ID = publicKey('3ThC8DDzimnnrt4mvJSKFpWQA3UvnbzKM3mT6SHoNQKu');
export const OFT_FEE_BPS = 1000n; // 10%
export const TRANSFER_FEE_BPS = 200n; // 2%
export const DVN_SIGNERS = [
    getECDSAPrivateKey(VERIFIER_SIGNER1),
    getECDSAPrivateKey(VERIFIER_SIGNER2),
];

export const endpoint: EndpointProgram.Endpoint = new EndpointProgram.Endpoint(
    EndpointProgram.ENDPOINT_PROGRAM_ID,
);
export const uln: UlnProgram.Uln = new UlnProgram.Uln(UlnProgram.ULN_PROGRAM_ID);
export const executor: Executor = new Executor(EXECUTOR_PROGRAM_ID);
export const priceFeed: PriceFeedProgram.PriceFeed = new PriceFeedProgram.PriceFeed(
    PriceFeedProgram.PRICEFEED_PROGRAM_ID,
);

export const eddsa: EddsaInterface = createWeb3JsEddsa();

export const dvns = [publicKey('HtEYV4xB4wvsj5fgTkcfuChYpvGYzgzwvNhgDZQNh7wW')];

export const extendedDvns = [
    ...dvns,
    publicKey('D5mVdHmD21yPS3p4utgp54wTUPqt7d7qCXt4oqCYsaBo'),
    publicKey('4Z436PCb83Ft9dMRtwZ2mK7ZQtqVhbFEC3BYna9qB7B9'),
    publicKey('4fs6aL12L18K5giDy9Dgxgrb3aNRYiuRV2a7JPPj3e7F'),
];
