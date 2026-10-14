import { generateSigner, signerPayer, sol } from '@metaplex-foundation/umi';
import { toWeb3JsKeypair } from '@metaplex-foundation/umi-web3js-adapters';
import * as process from 'process';
import { afterAll, beforeAll, describe } from 'vitest';

// dvn
import { testSuite as changeDvnAdminSuite } from './dvn/admin/change_admin';
import { testSuite as invokeSuite } from './dvn/admin/invoke';
import { testSuite as removeDvnDstConfig } from './dvn/admin/remove_dst_config';
import { testSuite as setDvnDefaultMultiplierBpsSuite } from './dvn/admin/set_default_multiplier_bps';
import { testSuite as setDvnDstConfig } from './dvn/admin/set_dst_config';
import { testSuite as setDvnPriceFeedSuite } from './dvn/admin/set_pricefeed';
import { testSuite as withdrawFeeSuite } from './dvn/admin/withdraw_fee';
import { testSuite as initDvnSuite } from './dvn/init-dvn';
import { testSuite as dvnQuoteSuite } from './dvn/quote';
import { testSuite as preCheckSuite } from './dvn/this/pre-check';
import { testSuite as setDvnAdminSuite } from './dvn/this/set-admin';
import { testSuite as setDvnAllowListSuite } from './dvn/this/set-allow-list';
import { testSuite as setDvnDenyListSuite } from './dvn/this/set-deny-list';
import { testSuite as setDvnMsglibsSuite } from './dvn/this/set-msglibs';
import { testSuite as setDvnPauseSuite } from './dvn/this/set-pause';
import { testSuite as setDvnQuorumSuite } from './dvn/this/set-quorum';
import { testSuite as setSignersSuite } from './dvn/this/set-signers';
import { testSuite as dvnVerifiableSuite } from './dvn/verifiable';
// endpoint-admin
import { testSuite as initDefaultReceiveLibrarySuite } from './endpoint/admin/init-default-receive-library';
import { testSuite as initDefaultSendLibrarySuite } from './endpoint/admin/init-default-send-library';
import { testSuite as initEndpointTestSuite } from './endpoint/admin/init-endpoint';
import { testSuite as registerMessageLibrarySuite } from './endpoint/admin/register-messagelib';
import { testSuite as setDefaultReceiveLibrarySuite } from './endpoint/admin/set-default-receive-library';
import { testSuite as setDefaultReceiveLibraryTimeoutSuite } from './endpoint/admin/set-default-receive-library-timeout';
import { testSuite as setDefaultSendLibrarySuite } from './endpoint/admin/set-default-send-library';
import { testSuite as setLzTokenSuite } from './endpoint/admin/set-lz-token';
import { testSuite as transferAdminSuite } from './endpoint/admin/transfer-admin';
import { testSuite as withdrawRentSuite } from './endpoint/admin/withdraw-rent';
// endpoint-oapp
import { testSuite as burnSuite } from './endpoint/oapp/burn';
import { testSuite as clearSuite } from './endpoint/oapp/clear';
import { testSuite as composeSuite } from './endpoint/oapp/compose';
import { testSuite as initConfigSuite } from './endpoint/oapp/init-config-simple-lib';
import { testSuite as initOApp2ConfigSuite } from './endpoint/oapp/init-config-uln';
import { testSuite as initNonceSuite } from './endpoint/oapp/init-nonce';
import { testSuite as initNonceOApp2Suite } from './endpoint/oapp/init-nonce-oapp2';
import { testSuite as initReceiveLibrarySuite } from './endpoint/oapp/init-receive-library';
import { testSuite as initReceiveLibraryOApp2Suite } from './endpoint/oapp/init-receive-library-oapp2';
import { testSuite as initSendLibrarySuite } from './endpoint/oapp/init-send-library';
import { testSuite as initSendLibraryOApp2Suite } from './endpoint/oapp/init-send-library-oapp2';
import { testSuite as nilifySuite } from './endpoint/oapp/nilify';
import { testSuite as quoteWithSimpleLibrarySuite } from './endpoint/oapp/quote-with-simple-lib';
import { testSuite as quoteWithUlnSuite } from './endpoint/oapp/quote-with-uln';
import { testSuite as registerOAppSuite } from './endpoint/oapp/register-oapp';
import { testSuite as registerOApp2Suite } from './endpoint/oapp/register-oapp2';
import { testSuite as sendWithSimpleLibrarySuite } from './endpoint/oapp/send-with-simple-lib';
import { testSuite as sendWithUlnSuite } from './endpoint/oapp/send-with-uln';
import { testSuite as setConfigSuite } from './endpoint/oapp/set-config';
import { testSuite as setConfigUlnSuite } from './endpoint/oapp/set-config-uln';
import { testSuite as setDelegateSuite } from './endpoint/oapp/set-delegate';
import { testSuite as setReceiveLibrarySuite } from './endpoint/oapp/set-receive-library';
import { testSuite as setReceiveLibraryTimeoutSuite } from './endpoint/oapp/set-receive-library-timeout';
import { testSuite as setReceiveLibraryUlnSuite } from './endpoint/oapp/set-receive-library-uln';
import { testSuite as setSendLibrarySuite } from './endpoint/oapp/set-send-library';
import { testSuite as setSendLibraryUlnSuite } from './endpoint/oapp/set-send-library-uln';
import { testSuite as skipSuite } from './endpoint/oapp/skip';
import { testSuite as verifySuite } from './endpoint/oapp/verify-by-simple-lib';
import { testSuite as verifySuiteByUln } from './endpoint/oapp/verify-by-uln';
// executor
import { testSuite as nativeDropSuite } from './executor/admin/native-drop';
import { testSuite as setDefaultMultiplierBpsSuite } from './executor/admin/set-default-multiplier-bps';
import { testSuite as setDstConfig } from './executor/admin/set-dst-config';
import { testSuite as setExecutorPriceFeedSuite } from './executor/admin/set-pricefeed';
import { testSuite as initExecutorSuite } from './executor/owner/init-executor';
import { testSuite as setAdmins } from './executor/owner/set-admin';
import { testSuite as setAllowListSuite } from './executor/owner/set-allowlist';
import { testSuite as setDenyListSuite } from './executor/owner/set-denylist';
import { testSuite as setExecutorSuite } from './executor/owner/set-executors';
import { testSuite as setMsglibsSuite } from './executor/owner/set-msglibs';
import { testSuite as setOwnerSuite } from './executor/owner/set-owner';
import { testSuite as setPausedSuite } from './executor/owner/set-paused';
import { testSuite as executorQuoteSuite } from './executor/quote';
// priceFeed
import { testSuite as initPriceFeedSuite } from './pricefeed/admin/init-price-feed';
import { testSuite as setPriceFeedSuite } from './pricefeed/admin/set-price-feed';
import { testSuite as transferPriceFeedAdminSuite } from './pricefeed/admin/transfer-admin';
import { testSuite as setPriceSuite } from './pricefeed/updater/set-price';
import { testSuite as setSolPriceSuite } from './pricefeed/updater/set-sol-price';
import { allocatePorts, SolanaTestValidator } from './setup';
// simple-lib
import { testSuite as initMessageLibSuite } from './simple-messagelib/admin/init-message-lib';
import { testSuite as setWlCallerSuite } from './simple-messagelib/admin/set-wl-caller';
// uln
import { testSuite as initDefaultConfigSuite } from './uln/admin/init-default-config';
import { testSuite as initUlnSuite } from './uln/admin/init-uln';
import { testSuite as setDefaultConfigSuite } from './uln/admin/set-default-config';
import { testSuite as setTreasurySuite } from './uln/admin/set-treasury';
import { testSuite as transferUlnAdminSuite } from './uln/admin/transfer-admin';
import {
    createFakeLzToke,
    createLzToke,
    EOAPP_DELEGATE,
    EXECUTOR,
    HACKER,
    TREASURER,
} from './utils';

const { rpcPort } = await allocatePorts();

describe('test suites', () => {
    const validator = new SolanaTestValidator(rpcPort.toString());

    const wallet = generateSigner(validator.umi);
    validator.umi.use(signerPayer(wallet));

    const testScopes = (process.env.TEST_SCOPES ?? 'all').split(',');
    const isAllScope = testScopes.length === 1 && testScopes[0] === 'all';

    beforeAll(async function () {
        console.log('🚀 Setting up test environment...');

        await validator.start();

        // airdrop
        await Promise.all([
            validator.umi.rpc.airdrop(validator.umi.payer.publicKey, sol(10000)),
            validator.umi.rpc.airdrop(HACKER.publicKey, sol(10000)),
            validator.umi.rpc.airdrop(EOAPP_DELEGATE.publicKey, sol(10000)),
            validator.umi.rpc.airdrop(TREASURER.publicKey, sol(10000)),
            validator.umi.rpc.airdrop(EXECUTOR.publicKey, sol(10000)),
        ]);

        await Promise.all([
            createLzToke(validator.connection, toWeb3JsKeypair(wallet)),
            createFakeLzToke(validator.connection, toWeb3JsKeypair(wallet)),
        ]);
    });

    /// endpoint base test, all test scopes depend on this
    describe('init endpoint', () => initEndpointTestSuite(validator));
    describe('register message library', () => registerMessageLibrarySuite(validator)); // registered blocked, simple, uln, fakeSend, fakeReceive after test
    describe('init default send library', () => initDefaultSendLibrarySuite(validator));
    describe('init default receive library', () => initDefaultReceiveLibrarySuite(validator));
    describe('set default send library', () => setDefaultSendLibrarySuite(validator)); // set blocked as default after test
    describe('set default receive library', () => setDefaultReceiveLibrarySuite(validator)); // set blocked as default after test
    describe('set lz token suite', () => setLzTokenSuite(validator)); // set lzToken after test

    if (testScopes.includes('endpoint') || isAllScope) {
        // endpoint - admin
        describe('set default receive library timeout', () =>
            setDefaultReceiveLibraryTimeoutSuite(validator));
        describe('transfer admin suite', () => transferAdminSuite(validator));
        describe('withdraw rent suite', () => withdrawRentSuite(validator));

        // simple-lib
        describe('simple-lib init message lib', () => initMessageLibSuite(validator));
        describe('simple-lib set whitelist caller', () => setWlCallerSuite(validator));

        // endpoint - oApp
        describe('oapp register', () => registerOAppSuite(validator));
        describe('oapp set delegate', () => setDelegateSuite(validator));
        describe('oapp init simple-lib config', () => initConfigSuite(validator));
        describe('oapp set simple-lib config', () => setConfigSuite(validator));
        describe('oapp init send library', () => initSendLibrarySuite(validator));
        describe('oapp init receive library', () => initReceiveLibrarySuite(validator));
        describe('oapp set send library', () => setSendLibrarySuite(validator));
        describe('oapp set receive library', () => setReceiveLibrarySuite(validator));
        describe('oapp set receive timeout library', () =>
            setReceiveLibraryTimeoutSuite(validator));

        // endpo.skipint - channel
        describe('oapp init nonce', () => initNonceSuite(validator));
        describe('oapp simple-lib quote', () => quoteWithSimpleLibrarySuite(validator));
        describe('oapp simple-lib send', () => sendWithSimpleLibrarySuite(validator));
        describe('oapp simple-lib verify', () => verifySuite(validator));
        describe('oapp clear', () => clearSuite(validator));
        describe('oapp compose', () => composeSuite(validator));
        describe('oapp skip', () => skipSuite(validator));
        describe('oapp nilify', () => nilifySuite(validator));
        describe('oapp burn', () => burnSuite(validator));
    }

    if (testScopes.includes('uln') || isAllScope) {
        // pricefeed - admin
        describe('pricefeed init pricefeed', () => initPriceFeedSuite(validator));
        describe('pricefeed set pricefeed', () => setPriceFeedSuite(validator));
        describe('pricefeed transfer admin', () => transferPriceFeedAdminSuite(validator));
        // pricefeed - updater
        describe('pricefeed set price', () => setPriceSuite(validator));
        describe('pricefeed set sol price', () => setSolPriceSuite(validator));
        // executor - owner
        describe('executor init executor', () => initExecutorSuite(validator));
        describe('executor set msglibs', () => setMsglibsSuite(validator));
        describe('executor set owner', () => setOwnerSuite(validator));
        describe('executor set paused', () => setPausedSuite(validator));
        describe('executor set allowlist', () => setAllowListSuite(validator));
        describe('executor set denylist', () => setDenyListSuite(validator));
        describe('executor set admin', () => setAdmins(validator));
        describe('executor set executors', () => setExecutorSuite(validator));
        // executor - admin
        describe('executor native drop', () => nativeDropSuite(validator));
        describe('executor set pricefeed', () => setExecutorPriceFeedSuite(validator));
        describe('executor set default multiplier bps', () =>
            setDefaultMultiplierBpsSuite(validator));
        describe('executor set dst config', () => setDstConfig(validator));
        describe('executor quote', () => executorQuoteSuite(validator));
        // dvn - admin
        describe('dvn init dvn', () => initDvnSuite(validator));
        describe('dvn change admin', () => changeDvnAdminSuite(validator));
        describe('dvn set default multiplier bps', () =>
            setDvnDefaultMultiplierBpsSuite(validator));
        describe('dvn set pricefeed', () => setDvnPriceFeedSuite(validator));
        describe('dvn remove dst config', () => removeDvnDstConfig(validator));
        describe('dvn set dst config', () => setDvnDstConfig(validator));
        describe('dvn withdraw fee', () => withdrawFeeSuite(validator));
        describe('dvn invoke', () => invokeSuite(validator));
        // dvn - this
        describe('dvn pre check', () => preCheckSuite(validator));
        describe('dvn set signers by signer', () => setSignersSuite(validator));
        describe('dvn set admin by signer', () => setDvnAdminSuite(validator));
        describe('dvn set quorum by signer', () => setDvnQuorumSuite(validator));
        describe('dvn set pause by signer', () => setDvnPauseSuite(validator));
        describe('dvn set msglibs by signer', () => setDvnMsglibsSuite(validator));
        describe('dvn set allowlist by signer', () => setDvnAllowListSuite(validator));
        describe('dvn set denylist by signer', () => setDvnDenyListSuite(validator));
        describe('dvn quote', () => dvnQuoteSuite(validator));
        // uln
        describe('uln init uln', () => initUlnSuite(validator));
        describe('uln init default config', () => initDefaultConfigSuite(validator));
        describe('uln set default config', () => setDefaultConfigSuite(validator));
        describe('uln set treasury', () => setTreasurySuite(validator));
        describe('uln transfer admin', () => transferUlnAdminSuite(validator));
        // TODO test withdraw rent

        // register oapp2 and set msg-lib(uln) config
        describe('oapp2 register', () => registerOApp2Suite(validator));
        describe('oapp2 init config', () => initOApp2ConfigSuite(validator));
        describe('oapp2 set uln config', () => setConfigUlnSuite(validator));
        describe('oapp2 init send library', () => initSendLibraryOApp2Suite(validator));
        describe('oapp2 init receive library', () => initReceiveLibraryOApp2Suite(validator));
        describe('oapp2 set send library', () => setSendLibraryUlnSuite(validator));
        describe('oapp2 set receive library', () => setReceiveLibraryUlnSuite(validator));

        // oapp2.skip channel (quote & send & verify & receive)
        describe('oapp2 init nonce', () => initNonceOApp2Suite(validator));
        describe('oapp2 uln quote', () => quoteWithUlnSuite(validator));
        describe('oapp2 uln send', () => sendWithUlnSuite(validator));
        describe('oapp2 uln verify', () => verifySuiteByUln(validator));

        // dvn
        describe('dvn verifiable', () => dvnVerifiableSuite(validator));
    }

    afterAll(async function () {
        await validator.stop();
    });
});
