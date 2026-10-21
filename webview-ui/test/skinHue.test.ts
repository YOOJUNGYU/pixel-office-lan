/* eslint-disable pixel-agents/no-inline-colors -- test fixtures */
import assert from 'node:assert/strict';

import { test } from 'vitest';

import { CHARACTER_SKIN_COLORS } from '../src/constants.js';
import { adjustSprite } from '../src/office/colorize.js';

test('hue shift leaves skin pixels alone and recolors clothing', () => {
  const sprite = [['#E9A384', '#e9a384', '#3794FF', '']];
  const out = adjustSprite(sprite, { h: 180, s: 0, b: 0, c: 0 }, CHARACTER_SKIN_COLORS);
  assert.equal(out[0][0], '#E9A384');
  assert.equal(out[0][1], '#e9a384');
  assert.notEqual(out[0][2], '#3794FF');
  assert.equal(out[0][3], '');
  // without skip the skin would change
  assert.notEqual(adjustSprite(sprite, { h: 180, s: 0, b: 0, c: 0 })[0][0], '#E9A384');
});
