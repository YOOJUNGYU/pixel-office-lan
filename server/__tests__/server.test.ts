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

  it('stops listening on stop()', async () => {
    const { port } = await server.start({ logger: false });
    await server.stop();
    await expect(fetch(`http://127.0.0.1:${port.toString()}/api/health`)).rejects.toThrow();
  });
});
