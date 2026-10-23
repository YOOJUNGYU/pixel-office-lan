import { afterEach, describe, expect, it } from 'vitest';

import { PixelAgentsServer } from '../src/server.js';

describe('PixelAgentsServer', () => {
  const server = new PixelAgentsServer();

  afterEach(async () => {
    await server.stop();
  });

  it('starts on an ephemeral port and answers the health check', async () => {
    const { port } = await server.start({ logger: false });
    expect(port).toBeGreaterThan(0);
    const res = await fetch(`http://127.0.0.1:${port.toString()}/api/health`);
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ status: 'ok', pid: process.pid });
  });

  it('reports a "server is off" page polling /api/health?waiting (cli.ts skips --open)', async () => {
    let waiting = 0;
    const { port } = await server.start({ logger: false, onWaitingPage: () => waiting++ });
    await fetch(`http://127.0.0.1:${port.toString()}/api/health`);
    expect(waiting).toBe(0);
    expect((await fetch(`http://127.0.0.1:${port.toString()}/api/health?waiting=1`)).ok).toBe(true);
    expect(waiting).toBe(1);
  });

  it('stops listening on stop()', async () => {
    const { port } = await server.start({ logger: false });
    await server.stop();
    await expect(fetch(`http://127.0.0.1:${port.toString()}/api/health`)).rejects.toThrow();
  });
});
