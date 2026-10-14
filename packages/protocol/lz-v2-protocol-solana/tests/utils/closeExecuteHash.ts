import { Signer, Umi } from '@metaplex-foundation/umi';

import { DVN, DVN_PROGRAM_ID } from '../../src/dvn';
import { sendAndConfirm } from './util';

export async function closeExecuteHash(umi: Umi, admin: Signer, digestHash: Buffer): Promise<void> {
    const wallet = umi.payer;
    const dvnSDK = new DVN(DVN_PROGRAM_ID);
    const ix = dvnSDK.closeExecute(admin, digestHash);
    await sendAndConfirm(umi, [ix], wallet);
}
