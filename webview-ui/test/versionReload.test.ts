/**
 * After an update the open page reconnects to the new server and reloads into
 * its version — once, and never for a dev server or an old server.
 *
 * Run with: npm test
 */

import assert from 'node:assert/strict';

import { test } from 'vitest';

import { reloadTarget } from '../src/lan/versionReload.js';

test('reloads into another server version once', () => {
  assert.equal(reloadTarget('0.6.0', '0.5.0', null), '0.6.0');
  assert.equal(reloadTarget('0.6.0', '0.5.0', '0.6.0'), null); // already reloaded: no loop
  assert.equal(reloadTarget('0.7.0', '0.5.0', '0.6.0'), '0.7.0');
});

test('same version, dev server or no version: stays', () => {
  assert.equal(reloadTarget('0.5.0', '0.5.0', null), null);
  assert.equal(reloadTarget('0.0.0', '0.5.0', null), null);
  assert.equal(reloadTarget(undefined, '0.5.0', null), null);
  assert.equal(reloadTarget('', '0.5.0', null), null);
});
