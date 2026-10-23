/**
 * "Server is off" panel: shown after a quit or when the first load never connects (after the
 * grace), never for a reconnect of a page that was connected; [시작] → starting → timeout hint.
 *
 * Run with: npm test
 */
import assert from 'node:assert/strict';

import { test } from 'vitest';

import { panelVisible, startPhase } from '../src/lan/serverPanel.js';

test('first load: only after the grace, and only while never connected', () => {
  assert.equal(panelVisible('connecting', false, false), false);
  assert.equal(panelVisible('reconnecting', false, false), false);
  assert.equal(panelVisible('reconnecting', false, true), true);
  assert.equal(panelVisible('connecting', false, true), true);
  assert.equal(panelVisible('connected', true, true), false);
});

test('a page that was connected never shows it for a reconnect (update restart)', () => {
  assert.equal(panelVisible('reconnecting', true, true), false);
});

test('quit (WS_CLOSE_APP_QUIT → disconnected) shows it at once', () => {
  assert.equal(panelVisible('disconnected', true, false), true);
  assert.equal(panelVisible('disconnected', false, false), true);
});

test('[시작]: starting until the timeout, then the manual hint', () => {
  assert.equal(startPhase(null, 5_000, 20_000), 'idle');
  assert.equal(startPhase(1_000, 5_000, 20_000), 'starting');
  assert.equal(startPhase(1_000, 21_000, 20_000), 'timeout');
});
