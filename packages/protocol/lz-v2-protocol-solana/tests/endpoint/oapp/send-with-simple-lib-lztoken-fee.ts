// import { AnchorProvider, Wallet, getProvider } from '@coral-xyz/anchor'
// import { PublicKey } from '@solana/web3.js'
// import { expect } from 'vitest'
// import { before } from 'vitest'

// import { EndpointProgram, SimpleMessageLibProgram, extractEventFromTransactionSignature } from '../../../src'
// import { accounts, instructions } from '../../../src/endpoint'
// import { options } from '../../utils'
// import { DST_EID, EOAPP, endpointPDA, eventAuthorityPDA, simpleMessageLibPDA } from '../../utils/constants'
// import { getLzTokenMint, setOAppOutBoundNonce } from '../../utils/state'
// import {
//     getAssociatedLzTokenAddress,
//     getLzTokenAssociatedAccount,
//     quoteBySimpleMessageLib,
//     sendAndConfirmTx,
// } from '../../utils/util'

// export const testSuite = (): void => {
//     const provider = getProvider() as AnchorProvider
//     const wallet = provider.wallet as Wallet
//     const oAppKp = EOAPP
//     // PDAs
//     const [endpoint] = endpointPDA.setting()
//     const [messageLibPda] = simpleMessageLibPDA.messageLib()
//     const [messageLibInfo] = endpointPDA.messageLibraryInfo(messageLibPda)
//     const [sendLibraryConfig] = endpointPDA.sendLibraryConfig(oAppKp.publicKey, DST_EID)
//     const [defaultSendLibraryConfig] = endpointPDA.defaultSendLibraryConfig(DST_EID)
//     const [noncePda] = endpointPDA.nonce(oAppKp.publicKey, DST_EID, oAppKp.publicKey.toBytes())
//     const [eventAuthorityPda] = eventAuthorityPDA.eventAuthority()

//     before(async function () {
//         // TODO - double check send library is simple message lib
//     })

//     // TODO: add negative test case

//     it('send with simple-lib success', async function () {
//         const lzTokenMint = getLzTokenMint()
//         const lzTokenSource = await getAssociatedLzTokenAddress(wallet.publicKey)
//         const messageLibPdaLzAccountAddr = await getAssociatedLzTokenAddress(messageLibPda)

//         const cpiIx = SimpleMessageLibProgram.instructions.createSendWithLzTokenInstructionAccounts(
//             {
//                 endpoint: PublicKey.default, // useless
//                 messageLib: messageLibPda,
//                 payer: wallet.publicKey,
//                 lzTokenSource: lzTokenSource,
//                 lzTokenMint: lzTokenMint,
//                 messageLibLzToken: messageLibPdaLzAccountAddr,
//             },
//             SimpleMessageLibProgram.PROGRAM_ID
//         )
//         const quoteFee = await quoteBySimpleMessageLib(
//             provider.connection,
//             wallet.publicKey,
//             oAppKp.publicKey,
//             oAppKp.publicKey,
//             DST_EID,
//             Uint8Array.from(Buffer.from('hello world')),
//             true,
//             options.toBytes()
//         )
//         expect(parseInt(quoteFee.lzTokenFee.toString())).to.be.gt(0)

//         const nonceBefore = await accounts.Nonce.fromAccountAddress(provider.connection, noncePda)
//         const lzTokenBalanceBefore = await getLzTokenAssociatedAccount(provider.connection, messageLibPda)

//         const ix = instructions.createSendInstruction(
//             {
//                 sender: oAppKp.publicKey,
//                 sendLibraryProgram: simpleMessageLibPDA.program,
//                 defaultSendLibraryConfig: defaultSendLibraryConfig,
//                 sendLibraryInfo: messageLibInfo,
//                 endpoint,
//                 nonce: noncePda,
//                 sendLibraryConfig: sendLibraryConfig,
//                 program: endpointPDA.program,
//                 eventAuthority: eventAuthorityPda,
//                 anchorRemainingAccounts: cpiIx.slice(1), // remove endpoint account
//             },
//             {
//                 params: {
//                     dstEid: DST_EID,
//                     receiver: Array.from(oAppKp.publicKey.toBytes()),
//                     message: Uint8Array.from(Buffer.from('hello world')),
//                     options: options.toBytes(),
//                     lzTokenFee: quoteFee.lzTokenFee,
//                     nativeFee: quoteFee.nativeFee,
//                 },
//             },
//             EndpointProgram.PROGRAM_ID
//         )
//         const resp = await sendAndConfirmTx(provider.connection, [wallet, oAppKp], [ix])

//         // check outbound
//         const nonceAfter = await accounts.Nonce.fromAccountAddress(provider.connection, noncePda)
//         expect(parseInt(nonceAfter.outboundNonce.toString())).to.be.eq(
//             parseInt(nonceBefore.outboundNonce.toString()) + 1
//         )
//         setOAppOutBoundNonce(parseInt(nonceAfter.outboundNonce.toString())) // save the nonce for the next test

//         // check lz token fee balance
//         const lzTokenBalanceAfter = await getLzTokenAssociatedAccount(provider.connection, messageLibPda)
//         expect(lzTokenBalanceAfter.amount.toString()).to.be.eq(
//             (parseInt(lzTokenBalanceBefore.amount.toString()) + parseInt(quoteFee.lzTokenFee.toString())).toString()
//         )

//         // check event
//         const event = await extractEventFromTransactionSignature<EndpointProgram.events.PacketSentEvent>(
//             provider.connection,
//             EndpointProgram.PROGRAM_ID,
//             resp.hash,
//             EndpointProgram.events.packetSentEventBeet,
//             { commitment: 'confirmed', maxSupportedTransactionVersion: 1 }
//         )
//         expect(event?.[0].sendLibrary.toBase58()).to.be.eq(messageLibPda.toBase58())
//         expect(event?.[0].options.toString()).to.be.eq(options.toBytes().toString())
//         expect(event?.[0].encodedPacket).to.not.null // TODO: check the encoded packet
//     })
// }
