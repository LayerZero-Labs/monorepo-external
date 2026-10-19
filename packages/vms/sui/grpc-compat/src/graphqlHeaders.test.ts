import { createServer, type IncomingHttpHeaders, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import { createSuiCompatClients } from './transport';

// A real GraphQL endpoint on localhost: the assertions are on the headers that arrive over HTTP.
let server: Server;
let uri: string;
let received: IncomingHttpHeaders[] = [];

beforeAll(async () => {
    server = createServer((req, res) => {
        received.push(req.headers);
        req.resume();
        req.on('end', () => {
            res.setHeader('Content-Type', 'application/json');
            res.end(JSON.stringify({ data: { chainIdentifier: '35834a8a' } }));
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

const queryChainIdentifier = async (graphqlHeaders?: Record<string, string>) => {
    const { graphql } = createSuiCompatClients({
        network: 'mainnet',
        grpcUrl: 'http://127.0.0.1:1',
        graphqlUrl: uri,
        ...(graphqlHeaders && { graphqlHeaders }),
    });
    await graphql!.query({ query: '{ chainIdentifier }' }).catch(() => undefined);
    expect(received.length).toBeGreaterThan(0);
};

describe('Sui GraphQL client headers', () => {
    it('sends the configured GraphQL headers', async () => {
        await queryChainIdentifier({ 'api-key': 'secret' });
        expect(received[0]).toMatchObject({ 'api-key': 'secret' });
    });

    it('sends no extra headers when none are configured', async () => {
        await queryChainIdentifier();
        expect(received[0]).not.toHaveProperty('api-key');
    });
});
