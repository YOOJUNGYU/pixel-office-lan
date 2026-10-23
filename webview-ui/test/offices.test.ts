/**
 * Office switcher model and invite-code input normalisation.
 *
 * Run with: npm test
 */

import assert from 'node:assert/strict';

import { test } from 'vitest';

import { isPersonal, normalizeCodeInput, switcherItems } from '../src/lan/offices.js';

test('code input: upper-case, spaces dropped, dashes kept', () => {
  assert.equal(normalizeCodeInput(' po2-ab cd\tef\n'), 'PO2-ABCDEF');
  assert.equal(normalizeCodeInput(''), '');
});

test('no team: the public office (active, enabled) and personal mode', () => {
  assert.deepEqual(switcherItems({ offices: [], activeView: 'public' }), [
    { view: 'public', name: '', isPublic: true, isPersonal: false, active: true, disabled: false },
    {
      view: 'personal',
      name: '',
      isPublic: false,
      isPersonal: true,
      active: false,
      disabled: false,
    },
  ]);
});

test('personal mode: only the personal tab is active; teams stay listed and enabled', () => {
  const items = switcherItems({ offices: [{ tag: 'a', name: '팀' }], activeView: 'personal' });
  assert.deepEqual(
    items.map((i) => [i.view, i.active, i.disabled]),
    [
      ['public', false, true],
      ['a', false, false],
      ['personal', true, false],
    ],
  );
  assert.equal(isPersonal({ activeView: 'personal' }), true);
  assert.equal(isPersonal({ activeView: 'public' }), false);
  assert.equal(isPersonal(null), false);
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
      ['personal', false, false, false],
    ],
  );
  assert.equal(items[1].name, '개발팀');
});
