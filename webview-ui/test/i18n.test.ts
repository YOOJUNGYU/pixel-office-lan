/**
 * i18n: per-viewer Korean/English dictionary.
 *
 * Run with: npm test
 */

import assert from 'node:assert/strict';

import { afterEach, test } from 'vitest';

import { actText, areaName, DICT, setLang, t } from '../src/i18n.js';

afterEach(() => setLang('ko'));

test('act strings with interpolation in both languages', () => {
  setLang('ko');
  assert.equal(t('act.edit', { t: 'a.ts' }), 'a.ts 수정 중');
  assert.equal(t('act.web', { t: '' }), '웹 검색 중');
  assert.equal(t('act.web', { t: 'vitest' }), '웹 검색: vitest');
  setLang('en');
  assert.equal(t('act.edit', { t: 'a.ts' }), 'Editing a.ts');
  assert.equal(t('act.web', { t: '' }), 'Searching the web');
  assert.equal(t('act.web', { t: 'vitest' }), 'Web search: vitest');
});

test('room areas and activities follow the language; custom areas stay', () => {
  setLang('en');
  assert.equal(areaName('코딩실'), 'Coding Room');
  assert.equal(areaName('창고'), '창고');
  assert.equal(actText('run', 'npm test'), 'Running: npm test');
  setLang('ko');
  assert.equal(areaName('대기실'), '대기실');
  assert.equal(actText('idle', ''), '대기 중');
});

test('every key exists in both languages', () => {
  const ko = Object.keys(DICT.ko).sort();
  const en = Object.keys(DICT.en).sort();
  assert.deepEqual(en, ko);
  for (const k of ko) {
    assert.ok(DICT.ko[k as keyof typeof DICT.ko], `ko ${k}`);
    assert.ok(DICT.en[k as keyof typeof DICT.en], `en ${k}`);
  }
});

test('unknown key returns the key', () => {
  assert.equal(t('nope.missing' as never), 'nope.missing');
});

test('people panel strings in both languages', () => {
  setLang('ko');
  assert.equal(t('people.title', { n: '3' }), '접속 중 3명');
  assert.ok(t('tour.people.title') && t('tour.people.body'));
  setLang('en');
  assert.equal(t('people.title', { n: '3' }), '3 online');
  assert.equal(t('people.you'), '(you)');
});
