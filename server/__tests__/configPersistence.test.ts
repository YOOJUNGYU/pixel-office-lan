import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { readConfig, writeConfig } from '../src/configPersistence.js';

describe('configPersistence: areas', () => {
  let tempHome: string;
  let originalHome: string | undefined;

  beforeEach(() => {
    tempHome = fs.mkdtempSync(path.join(os.tmpdir(), 'pxl-config-test-'));
    originalHome = process.env.HOME;
    process.env.HOME = tempHome;
  });

  afterEach(() => {
    if (originalHome === undefined) {
      delete process.env.HOME;
    } else {
      process.env.HOME = originalHome;
    }
    fs.rmSync(tempHome, { recursive: true, force: true });
  });

  describe('readConfig + writeConfig round-trip for area settings', () => {
    it('returns defaults (showAreas=false) when no config file exists', () => {
      const cfg = readConfig();
      expect(cfg.standalone.showAreas).toBe(false);
    });

    it('round-trips showAreas', () => {
      const cfg = readConfig();
      cfg.standalone.showAreas = true;
      writeConfig(cfg);
      expect(readConfig().standalone.showAreas).toBe(true);
    });

    it('coerces a hand-edited config.json into defaults and drops the old areaMappings', () => {
      const configDir = path.join(tempHome, '.pixel-office');
      fs.mkdirSync(configDir, { recursive: true });
      fs.writeFileSync(
        path.join(configDir, 'config.json'),
        JSON.stringify({ standalone: { showAreas: 'yes please', areaMappings: 'not-an-object' } }),
      );
      const cfg = readConfig();
      expect(cfg.standalone.showAreas).toBe(false);
      expect('areaMappings' in cfg.standalone).toBe(false);
    });

    it('writes under ~/.pixel-office/config.json', () => {
      writeConfig(readConfig());
      expect(fs.existsSync(path.join(tempHome, '.pixel-office', 'config.json'))).toBe(true);
    });
  });
});
