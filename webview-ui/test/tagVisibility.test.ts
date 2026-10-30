import { afterEach, describe, expect, it, vi } from 'vitest';

import { TAGS_HIDDEN_KEY } from '../src/constants.js';
import { readTagsHidden, saveTagsHidden, tagVisible } from '../src/lan/tagVisibility.js';

afterEach(() => vi.unstubAllGlobals());

describe('tagVisible', () => {
  it('shown: every tag; hidden: only the hovered or selected one', () => {
    expect(tagVisible(false, 1, null, null)).toBe(true);
    expect(tagVisible(true, 1, null, null)).toBe(false);
    expect(tagVisible(true, 1, 1, null)).toBe(true);
    expect(tagVisible(true, 2, 1, 2)).toBe(true);
    expect(tagVisible(true, 3, 1, 2)).toBe(false);
  });
});

describe('tags hidden persistence', () => {
  it('round-trips, defaults to hidden, survives blocked storage', () => {
    const store = new Map<string, string>();
    vi.stubGlobal('localStorage', {
      getItem: (k: string) => store.get(k) ?? null,
      setItem: (k: string, v: string) => void store.set(k, v),
    });
    expect(readTagsHidden()).toBe(false); // default: shown
    saveTagsHidden(false);
    expect(store.get(TAGS_HIDDEN_KEY)).toBe('0');
    expect(readTagsHidden()).toBe(false);
    saveTagsHidden(true);
    expect(store.get(TAGS_HIDDEN_KEY)).toBe('1');
    expect(readTagsHidden()).toBe(true);
    vi.stubGlobal('localStorage', {
      getItem: () => {
        throw new Error('blocked');
      },
      setItem: () => {
        throw new Error('blocked');
      },
    });
    expect(readTagsHidden()).toBe(false); // storage blocked: shown
    expect(() => saveTagsHidden(true)).not.toThrow();
  });
});
