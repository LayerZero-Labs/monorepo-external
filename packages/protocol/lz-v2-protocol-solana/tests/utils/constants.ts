import {
    createSignerFromKeypair,
    defaultPublicKey,
    EddsaInterface,
    generateSigner,
} from '@metaplex-foundation/umi';
import { createWeb3JsEddsa } from '@metaplex-foundation/umi-eddsa-web3js';
import { createHash } from 'crypto';

import { DvnPDA, EndpointPDA, ExecutorPDA, MessageLibPDA, PriceFeedPDA, UlnPDA } from '../../src';
import { DVN_PROGRAM_ID } from '../../src/dvn';
import { ENDPOINT_PROGRAM_ID } from '../../src/endpoint';
import { EXECUTOR_PROGRAM_ID } from '../../src/executor';
import { BLOCKED_MESSAGELIB_PROGRAM_ID } from '../../src/generated/blocked_messagelib';
import { PRICEFEED_PROGRAM_ID } from '../../src/pricefeed';
import { SIMPLE_MESSAGELIB_PROGRAM_ID } from '../../src/simple-message-lib';
import { ULN_PROGRAM_ID } from '../../src/uln';

export const DefaultMessageLib = defaultPublicKey();
export const EMPTY_PAYLOAD_HASH = new Array(32).fill(0);
export const NIL_PAYLOAD_HASH = new Array(32).fill(0xff);

export const SRC_EID = 1;
export const DST_EID = 1;

export const eddsa: EddsaInterface = createWeb3JsEddsa();

export const EOAPP = generateSigner({ eddsa });
export const EOAPP_ULN = generateSigner({ eddsa });
export const EOAPP_MINT = generateSigner({ eddsa });
export const EOAPP_DELEGATE = generateSigner({ eddsa });
export const RECEIVER_OAPP = generateSigner({ eddsa });
export const RECEIVER_OAPP_DELEGATE = generateSigner({ eddsa });
export const LZ_TOKEN_ADMIN = createSignerFromKeypair(
    { eddsa },
    eddsa.createKeypairFromSeed(sha256(Buffer.from('lzToken admin', 'utf-8'))),
);
export const HACKER = createSignerFromKeypair(
    { eddsa },
    eddsa.createKeypairFromSeed(sha256(Buffer.from('hacker', 'utf-8'))),
);
export const TREASURER = createSignerFromKeypair(
    { eddsa },
    eddsa.createKeypairFromSeed(sha256(Buffer.from('treasurer', 'utf-8'))),
);
export const FAKE_SENDLIB_PROGRAM = createSignerFromKeypair(
    { eddsa },
    eddsa.createKeypairFromSeed(sha256(Buffer.from('fake sendlib', 'utf-8'))),
);
export const FAKE_RECEIVELIB_PROGRAM = createSignerFromKeypair(
    { eddsa },
    eddsa.createKeypairFromSeed(sha256(Buffer.from('fake receivelib', 'utf-8'))),
);
export const EXECUTOR = createSignerFromKeypair(
    { eddsa },
    eddsa.createKeypairFromSeed(sha256(Buffer.from('executor', 'utf-8'))),
);
export const FUNDING = createSignerFromKeypair(
    { eddsa },
    eddsa.createKeypairFromSeed(sha256(Buffer.from('funding', 'utf-8'))),
);

export const INIT_FUNDS = 10000000000000;

export const endpointPDA = new EndpointPDA(ENDPOINT_PROGRAM_ID);
export const blockedMessageLibPDA = new MessageLibPDA(BLOCKED_MESSAGELIB_PROGRAM_ID);
export const simpleMessageLibPDA = new MessageLibPDA(SIMPLE_MESSAGELIB_PROGRAM_ID);

export const fakeReceiveMessageLibPDA = new MessageLibPDA(FAKE_RECEIVELIB_PROGRAM.publicKey);
export const fakeSendMessageLibPDA = new MessageLibPDA(FAKE_SENDLIB_PROGRAM.publicKey);

export const ulnPDA = new UlnPDA(ULN_PROGRAM_ID);
export const dvnPDA = new DvnPDA(DVN_PROGRAM_ID);
export const executorPDA = new ExecutorPDA(EXECUTOR_PROGRAM_ID);
export const priceFeedPda = new PriceFeedPDA(PRICEFEED_PROGRAM_ID);

export const SIMPLE_CONFIG_TYPE_SEND = 1;
export const SIMPLE_CONFIG_TYPE_RECEIVE = 2;

export enum VerificationState {
    Verifying,
    Verifiable,
    Verified,
    NotInitializable,
    VerifiableButCapExceeded,
}

export function sha256(data: Buffer): Uint8Array {
    return createHash('sha256').update(data).digest();
}
