import { describe, expect, it } from 'vitest';

import { showInstallButton, updatedNoticeDue } from '../src/lan/updateBannerModel.js';

describe('showInstallButton', () => {
  it('hides in downloading, installing and upToDate; shows otherwise', () => {
    expect(showInstallButton(true, 'installing')).toBe(false);
    expect(showInstallButton(true, 'downloading')).toBe(false);
    expect(showInstallButton(true, 'upToDate')).toBe(false);
    expect(showInstallButton(false, undefined)).toBe(false);
    expect(showInstallButton(true, undefined)).toBe(true);
    expect(showInstallButton(true, 'error')).toBe(true);
  });
});

describe('updatedNoticeDue', () => {
  it('only when this viewer last ran an older version (never on a first run)', () => {
    expect(updatedNoticeDue(null, '1.0.2')).toBe(false);
    expect(updatedNoticeDue('1.0.1', '1.0.2')).toBe(true);
    expect(updatedNoticeDue('1.0.9', '1.0.10')).toBe(true);
    expect(updatedNoticeDue('1.0.2', '1.0.2')).toBe(false);
    expect(updatedNoticeDue('1.0.3', '1.0.2')).toBe(false);
  });
});
