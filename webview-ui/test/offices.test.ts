/**
 * Office switcher model and invite-code input normalisation.
 *
 * Run with: npm test
 */

import assert from 'node:assert/strict';

import { test } from 'vitest';

import { normalizeCodeInput, switcherItems } from '../src/lan/offices.js';

test('code input: upper-case, spaces dropped, dashes kept', () => {
  assert.equal(normalizeCodeInput(' po2-ab cd\tef\n'), 'PO2-ABCDEF');
  assert.equal(normalizeCodeInput(''), '');
});

test('no team: only the public office, active and enabled', () => {
  assert.deepEqual(switcherItems({ offices: [], activeView: 'public' }), [
    { view: 'public', name: '', isPublic: true, active: true, disabled: false },
  ]);
});

test('in a team: public disabled, teams in join order, active follows activeView', () => {
  const items = switcherItems({
    offices: [
      { tag: 'a', name: '개발팀' },
      { tag: 'b', name: '' },
    ],
    activeView: 'b',
  });
  assert.deepEqual(
    items.map((i) => [i.view, i.isPublic, i.active, i.disabled]),
    [
      ['public', true, false, true],
      ['a', false, false, false],
      ['b', false, true, false],
    ],
  );
  assert.equal(items[1].name, '개발팀');
});
