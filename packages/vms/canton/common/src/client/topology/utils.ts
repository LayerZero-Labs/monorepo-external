import { BaseQuery, Empty, StoreId } from '@canton-network/core-ledger-proto';
import { ChannelCredentials } from '@grpc/grpc-js';

import { bytesToHex } from '@layerzerolabs/common-encoding-utils';

import { CantonError } from '../../errors';
import { cantonMultihash } from '../utils';

/** Canton hash purpose for decentralized namespace derivation. */
const HASH_PURPOSE_DECENTRALIZED_NAMESPACE = 37;

/** Canton hash purpose for multi-transaction topology signing. */
const HASH_PURPOSE_MULTI_TRANSACTION = 55;

/**
 * Computes the decentralized namespace fingerprint from owner key fingerprints.
 *
 * Owners are sorted lexicographically, then hashed as
 * `1220` + SHA256(purpose=37 || for each owner: len(utf8) || utf8).
 */
export function computeDecentralizedNamespace(owners: string[]): string {
    const sorted = [...owners].sort();
    const parts: Buffer[] = [];
    for (const owner of sorted) {
        const ownerBytes = Buffer.from(owner, 'utf-8');
        const lengthPrefix = Buffer.alloc(4);
        lengthPrefix.writeUInt32BE(ownerBytes.length);
        parts.push(lengthPrefix, ownerBytes);
    }
    return bytesToHex(cantonMultihash(HASH_PURPOSE_DECENTRALIZED_NAMESPACE, Buffer.concat(parts)));
}

/**
 * Combines topology transaction hashes into the digest Canton expects signed.
 *
 * Hashes are sorted lexicographically, count-prefixed, each length-prefixed, then
 * hashed with purpose 55. Pass a single hash when signing one transaction —
 * Canton always uses this multi-transaction format for `AddTransactions`.
 */
export function computeMultiTransactionHash(hashes: Uint8Array[]): Uint8Array {
    const sorted = [...hashes].sort((left, right) =>
        Buffer.compare(Buffer.from(left), Buffer.from(right)),
    );
    const parts: Buffer[] = [];
    const countBuffer = Buffer.alloc(4);
    countBuffer.writeUInt32BE(sorted.length);
    parts.push(countBuffer);
    for (const hash of sorted) {
        const lengthBuffer = Buffer.alloc(4);
        lengthBuffer.writeUInt32BE(hash.length);
        parts.push(lengthBuffer, Buffer.from(hash));
    }
    return cantonMultihash(HASH_PURPOSE_MULTI_TRANSACTION, Buffer.concat(parts));
}

/**
 * Builds a topology `StoreId` scoped to a synchronizer.
 *
 * Used as the `store` field on topology read/write RPC requests.
 */
export function synchronizerStore(synchronizerId: string): StoreId {
    return StoreId.create({
        store: { oneofKind: 'synchronizer', synchronizer: { id: synchronizerId } },
    });
}

/**
 * Builds a topology `BaseQuery` at synchronizer head state.
 *
 * Used as the `baseQuery` field on topology list RPC requests.
 */
export function headStateBaseQuery(synchronizerId: string, proposals = false): BaseQuery {
    return BaseQuery.create({
        store: synchronizerStore(synchronizerId),
        timeQuery: { oneofKind: 'headState', headState: Empty.create({}) },
        proposals,
    });
}

const LOOPBACK_HOSTNAMES = new Set(['localhost', '::1']);
const LOOPBACK_IPV4 = /^127(\.\d{1,3}){3}$/;

/**
 * Whether a `host:port` target addresses the local machine.
 */
export const isLoopbackHost = (host: string): boolean => {
    const hostname = host
        .replace(/:\d+$/, '')
        .replace(/^\[(.*)\]$/, '$1')
        .toLowerCase();
    return LOOPBACK_HOSTNAMES.has(hostname) || LOOPBACK_IPV4.test(hostname);
};

/**
 * Builds gRPC channel credentials for the Canton admin API.
 *
 * Encrypted whatever the port, because every admin call carries a reusable bearer token.
 *
 * @throws {CantonError} If an unencrypted channel is asked for on a remote host.
 */
export const buildChannelCredentials = (
    host: string,
    insecureTransport = false,
): ChannelCredentials => {
    if (!insecureTransport) {
        return ChannelCredentials.createSsl();
    } else if (!isLoopbackHost(host)) {
        throw new CantonError(
            `Canton admin API requires an encrypted channel for a remote host: ${host}`,
        );
    }

    return ChannelCredentials.createInsecure();
};
