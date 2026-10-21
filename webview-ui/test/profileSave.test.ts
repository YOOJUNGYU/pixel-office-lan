/**
 * Profile form: the manual-peer rule shared with the server.
 *
 * Run with: npm test
 */

import assert from 'node:assert/strict';

import { test } from 'vitest';

import { isValidManualPeer } from '../../core/src/lan.js';

test('manual peers: plain IPv4 or hostname only (same rule as the server)', () => {
  for (const ok of ['10.0.0.5', 'dev-pc', 'pc.corp.local'])
    assert.equal(isValidManualPeer(ok), true);
  for (const bad of ['10.0.0.5:47801', 'http://10.0.0.5', 'fe80::1', 'my_pc', '300.1.1.1']) {
    assert.equal(isValidManualPeer(bad), false, bad);
  }
});
