import { describe, expect, it } from 'vitest';

import { showInstallButton } from '../src/lan/updateBannerModel.js';

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
