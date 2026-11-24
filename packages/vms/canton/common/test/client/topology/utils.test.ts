import { describe, expect, it } from 'vitest';

import { buildChannelCredentials } from '../../../src/client/topology/utils';

describe('admin API channel credentials', () => {
    it('encrypts a conventional admin port', () => {
        expect(buildChannelCredentials('participant.example.com:5002')._isSecure()).toBe(true);
    });

    it('encrypts the HTTPS port', () => {
        expect(buildChannelCredentials('participant.example.com:443')._isSecure()).toBe(true);
    });

    it('encrypts a loopback host by default', () => {
        expect(buildChannelCredentials('localhost:2902')._isSecure()).toBe(true);
    });

    it('drops encryption for a loopback name', () => {
        expect(buildChannelCredentials('localhost:2902', true)._isSecure()).toBe(false);
    });

    it('drops encryption for a loopback address', () => {
        expect(buildChannelCredentials('127.0.0.1:2902', true)._isSecure()).toBe(false);
    });

    it('drops encryption for a bracketed IPv6 loopback address', () => {
        expect(buildChannelCredentials('[::1]:2902', true)._isSecure()).toBe(false);
    });

    it('rejects an unencrypted channel to a remote host', () => {
        expect(() => buildChannelCredentials('participant.example.com:5002', true)).toThrow(
            /requires an encrypted channel/,
        );
    });

    it('rejects an unencrypted channel to a host merely named after loopback', () => {
        expect(() => buildChannelCredentials('localhost.example.com:5002', true)).toThrow(
            /requires an encrypted channel/,
        );
    });

    it('rejects an unencrypted channel to a public address in the loopback range shape', () => {
        expect(() => buildChannelCredentials('128.0.0.1:2902', true)).toThrow(
            /requires an encrypted channel/,
        );
    });
});
