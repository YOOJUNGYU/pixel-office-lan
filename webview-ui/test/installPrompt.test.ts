import { describe, expect, it } from 'vitest';

import { INSTALL_SNOOZE_MS } from '../src/constants.js';
import type { InstallInputs } from '../src/lan/installMode.js';
import { installMode } from '../src/lan/installMode.js';

const NOW = 1_800_000_000_000;
const SAFARI =
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 14_0) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Safari/605.1.15';
const FIREFOX = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:130.0) Gecko/20100101 Firefox/130.0';
const tab: InstallInputs = {
  standalone: false,
  readOnly: false,
  secure: true,
  installed: false,
  canPrompt: true,
  chromium: true,
  userAgent: '',
  dismissedAt: null,
  now: NOW,
};

describe('installMode', () => {
  it('offers the install button when Chromium fired beforeinstallprompt', () => {
    expect(installMode(tab)).toBe('prompt');
  });
  it('is hidden in the app, after install, for remote viewers and on plain http', () => {
    expect(installMode({ ...tab, standalone: true })).toBe('hidden');
    expect(installMode({ ...tab, installed: true })).toBe('hidden');
    expect(installMode({ ...tab, readOnly: true })).toBe('hidden');
    expect(installMode({ ...tab, secure: false })).toBe('hidden');
  });
  it('stays hidden for 7 days after [Later]', () => {
    expect(installMode({ ...tab, dismissedAt: NOW - INSTALL_SNOOZE_MS + 1 })).toBe('hidden');
    expect(installMode({ ...tab, dismissedAt: NOW - INSTALL_SNOOZE_MS })).toBe('prompt');
  });
  it('Chromium without the event (already installed / not installable) shows nothing', () => {
    expect(installMode({ ...tab, canPrompt: false })).toBe('hidden');
  });
  it('gives manual steps where beforeinstallprompt does not exist', () => {
    const manual = { ...tab, canPrompt: false, chromium: false };
    expect(installMode({ ...manual, userAgent: SAFARI })).toBe('safari');
    expect(installMode({ ...manual, userAgent: FIREFOX })).toBe('other');
  });
});
