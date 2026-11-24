import { createServer, type IncomingHttpHeaders, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import { createEvmProvider } from './provider';

// A real JSON-RPC endpoint on localhost: the assertions are on the headers that arrive over HTTP.
type JsonRpcRequest = { id: number; method: string };
// eth_chainId answers 31337 (0x7a69), the chain id the chain-id-only form expects.
const RESULTS: Record<string, unknown> = {
    eth_blockNumber: '0x5',
    eth_getLogs: [],
    eth_chainId: '0x7a69',
};

let server: Server;
let uri: string;
let received: IncomingHttpHeaders[] = [];

beforeAll(async () => {
    server = createServer((req, res) => {
        received.push(req.headers);
        let body = '';
        req.on('data', (chunk) => (body += chunk));
        req.on('end', () => {
            const answer = ({ id, method }: JsonRpcRequest) => ({
                jsonrpc: '2.0',
                id,
                result: RESULTS[method] ?? null,
            });
            const parsed = JSON.parse(body) as JsonRpcRequest | JsonRpcRequest[];
            res.setHeader('Content-Type', 'application/json');
            res.end(JSON.stringify(Array.isArray(parsed) ? parsed.map(answer) : answer(parsed)));
        });
    });
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
    uri = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});

afterAll(async () => {
    await new Promise((resolve) => server.close(resolve));
});

beforeEach(() => {
    received = [];
});

describe('createEvmProvider', () => {
    it('sends configured headers with viem RPC requests', async () => {
        const provider = createEvmProvider(uri, { headers: { 'api-key': 'secret' } });

        await expect(provider.viem.getBlockNumber()).resolves.toBe(5n);
        expect(received[0]).toMatchObject({ 'api-key': 'secret' });
    });

    it('sends configured headers with batchQueryFilter requests', async () => {
        const provider = createEvmProvider(uri, { headers: { 'api-key': 'secret' } });

        await expect(provider.batchQueryFilter([], 1, 2)).resolves.toEqual({
            events: [],
            blockNumber: 5,
        });
        expect(received.length).toBeGreaterThan(0);
        for (const headers of received) {
            expect(headers).toMatchObject({ 'api-key': 'secret' });
        }
    });

    it('sends no extra headers when none are configured, including the chain-id-only form', async () => {
        await createEvmProvider(uri).viem.getBlockNumber();
        // the published (uri, expectedChainId) signature still works
        await createEvmProvider(uri, 31337).viem.getBlockNumber();

        expect(received.length).toBeGreaterThanOrEqual(2);
        for (const headers of received) {
            expect(headers).not.toHaveProperty('api-key');
        }
    });
});
