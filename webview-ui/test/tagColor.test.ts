/* eslint-disable pixel-agents/no-inline-colors -- test fixtures */
import { describe, expect, it } from 'vitest';

import { AVATAR_TAG_TEXT_DARK, AVATAR_TAG_TEXT_LIGHT } from '../src/constants.js';
import { dominantColor, textOn } from '../src/lan/tagColor.js';

describe('avatar tag colours', () => {
  it('dominantColor: most common vivid pixel, skin and faint pixels skipped', () => {
    const skin = new Set(['#E9A384']);
    const sprite = [
      ['', '#E9A384', '#E9A384', '#E9A384'],
      ['#3060C0', '#3060C0', '#202020', '#202020'],
      ['#202020', '#C03030', '#FF000040', '#FF000040'],
    ];
    expect(dominantColor(sprite, skin)).toBe('#3060C0');
    expect(dominantColor([['#202020', '#202020', '#808080']], skin)).toBe('#202020'); // all grey
    expect(dominantColor([['', '#E9A384']], skin)).toBeNull();
  });

  it('textOn: dark text on light colours, light text on dark ones', () => {
    expect(textOn('#FFE070')).toBe(AVATAR_TAG_TEXT_DARK);
    expect(textOn('#80E0FF')).toBe(AVATAR_TAG_TEXT_DARK);
    expect(textOn('#203080')).toBe(AVATAR_TAG_TEXT_LIGHT);
    expect(textOn('#802020')).toBe(AVATAR_TAG_TEXT_LIGHT);
  });
});
