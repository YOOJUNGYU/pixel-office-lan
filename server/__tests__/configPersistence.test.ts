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
    it('returns defaults (alwaysShowLabels=false) when no config file exists', () => {
      const cfg = readConfig();
      expect(cfg.standalone.alwaysShowLabels).toBe(false);
    });

    it('round-trips alwaysShowLabels', () => {
      const cfg = readConfig();
      cfg.standalone.alwaysShowLabels = true;
      writeConfig(cfg);
      expect(readConfig().standalone.alwaysShowLabels).toBe(true);
    });

    it('coerces a hand-edited config.json into defaults and drops the old areaMappings', () => {
      const configDir = path.join(tempHome, '.pixel-office');
      fs.mkdirSync(configDir, { recursive: true });
      fs.writeFileSync(
        path.join(configDir, 'config.json'),
        JSON.stringify({
          standalone: { alwaysShowLabels: 'yes please', showAreas: true, areaMappings: 'x' },
        }),
      );
      const cfg = readConfig();
      expect(cfg.standalone.alwaysShowLabels).toBe(false);
      expect('showAreas' in cfg.standalone).toBe(false); // removed setting is dropped
      expect('areaMappings' in cfg.standalone).toBe(false);
    });

    it('writes under ~/.pixel-office/config.json', () => {
      writeConfig(readConfig());
      expect(fs.existsSync(path.join(tempHome, '.pixel-office', 'config.json'))).toBe(true);
    });
  });
});
