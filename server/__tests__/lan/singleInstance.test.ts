import Fastify from 'fastify';
import * as net from 'net';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { checkExisting } from '../../src/lan/office.js';
import { PixelAgentsServer } from '../../src/server.js';

async function freePort(): Promise<number> {
  const srv = net.createServer();
  await new Promise<void>((r) => srv.listen(0, '127.0.0.1', r));
  const { port } = srv.address() as net.AddressInfo;
  await new Promise((r) => srv.close(r));
  return port;
}

describe('checkExisting', () => {
  it('is true when /api/ping answers pixel-office', async () => {
    const app = Fastify();
    app.get('/api/ping', async () => ({ app: 'pixel-office' }));
    await app.listen({ host: '127.0.0.1', port: 0 });
    const { port } = app.server.address() as net.AddressInfo;
    expect(await checkExisting(port)).toBe(true);
    await app.close();
  });

  it('is false for another app on the port', async () => {
    const app = Fastify();
    app.get('/api/ping', async () => ({ app: 'other' }));
    await app.listen({ host: '127.0.0.1', port: 0 });
    const { port } = app.server.address() as net.AddressInfo;
    expect(await checkExisting(port)).toBe(false);
    await app.close();
  });

  it('is false for a closed port', async () => {
    expect(await checkExisting(await freePort())).toBe(false);
  });
});

describe('/api/ping and /api/quit', () => {
  const server = new PixelAgentsServer();
  afterEach(async () => {
    await server.stop();
  });

  it('ping answers anyone; quit only this PC', async () => {
    const onQuit = vi.fn();
    const { port } = await server.start({ logger: false, onQuit });
    const base = `http://127.0.0.1:${port.toString()}`;
    expect(await (await fetch(`${base}/api/ping`)).json()).toEqual({ app: 'pixel-office' });

    const remote = await fetch(`${base}/api/quit`, {
      method: 'POST',
      headers: { Origin: 'http://evil.example' },
    });
    expect(remote.status).toBe(403);
    expect(onQuit).not.toHaveBeenCalled();

    const local = await fetch(`${base}/api/quit`, { method: 'POST' });
    expect(local.status).toBe(200);
    expect(onQuit).toHaveBeenCalledOnce();
  });
});
