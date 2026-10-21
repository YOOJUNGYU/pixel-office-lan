import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
  type AssetCache,
  type ClientMessageContext,
  handleClientMessage,
  reportedRefusals,
} from '../src/clientMessageHandler.js';
import { readConfig, writeConfig } from '../src/configPersistence.js';
import { FileStateAdapter } from '../src/fileStateAdapter.js';
import { Updater } from '../src/lan/updater.js';

// Hex placeholders are test fixtures, not UI tokens.
/* eslint-disable pixel-agents/no-inline-colors */
const FULL_CACHE: AssetCache = {
  characters: null,
  pets: null,
  floorTiles: [[['#000000']]],
  wallTiles: [[[['#aabbcc']]]],
  carpetTiles: [[[['#112233']]]],
  furniture: null,
  defaultLayout: { version: 1, marker: 'default' },
};
/* eslint-enable pixel-agents/no-inline-colors */

/**
 * Each test redirects $HOME to a fresh temp dir, so config.json and
 * layout.json land under <tmp>/.pixel-office/.
 */
describe('clientMessageHandler', () => {
  let tempHome: string;
  let originalHome: string | undefined;
  let sent: Array<Record<string, unknown>>;

  function ctx(privileged: boolean, cache: AssetCache | null = null): ClientMessageContext {
    return { adapter: new FileStateAdapter(), cache, privileged };
  }
  function send(msg: Record<string, unknown>, c: ClientMessageContext): void {
    handleClientMessage(msg, (m) => sent.push(m), c);
  }

  beforeEach(() => {
    tempHome = fs.mkdtempSync(path.join(os.tmpdir(), 'pxl-cmh-test-'));
    originalHome = process.env.HOME;
    process.env.HOME = tempHome;
    sent = [];
  });

  afterEach(() => {
    if (originalHome === undefined) delete process.env.HOME;
    else process.env.HOME = originalHome;
    fs.rmSync(tempHome, { recursive: true, force: true });
  });

  /** Everything under the temp HOME, as path -> contents. */
  function snapshotHome(): Record<string, string> {
    const out: Record<string, string> = {};
    const walk = (dir: string): void => {
      for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
        const full = path.join(dir, entry.name);
        if (entry.isDirectory()) walk(full);
        else out[full] = fs.readFileSync(full, 'utf-8');
      }
    };
    walk(tempHome);
    return out;
  }

  describe('webviewReady', () => {
    it('sends access, assets, settings, area mappings, then the layout last', () => {
      send({ type: 'webviewReady' }, ctx(true, FULL_CACHE));
      expect(sent.map((m) => m.type)).toEqual([
        'officeAccess',
        'floorTilesLoaded',
        'wallTilesLoaded',
        'carpetTilesLoaded',
        'settingsLoaded',
        'areaMappingsLoaded',
        'layoutLoaded',
      ]);
      expect(sent[0]).toEqual({ type: 'officeAccess', readOnly: false });
      expect(sent.at(-1)).toEqual({
        type: 'layoutLoaded',
        layout: { version: 1, marker: 'default' },
      });
    });

    it('tells a read-only client so FIRST, and still loads the office for it', () => {
      send({ type: 'webviewReady' }, ctx(false));
      expect(sent[0]).toEqual({ type: 'officeAccess', readOnly: true });
      expect(sent.map((m) => m.type)).toContain('layoutLoaded');
    });

    it('prefers the saved layout over the bundled default', () => {
      send({ type: 'saveLayout', layout: { version: 1, marker: 'saved' } }, ctx(true));
      send({ type: 'webviewReady' }, ctx(true, FULL_CACHE));
      expect(sent.at(-1)).toEqual({
        type: 'layoutLoaded',
        layout: { version: 1, marker: 'saved' },
      });
    });
  });

  describe('privileged writes', () => {
    it('saveAreaMappings persists a valid payload and ignores a malformed one', () => {
      send({ type: 'saveAreaMappings', mappings: { frontend: ['Lab'] } }, ctx(true));
      expect(readConfig().standalone.areaMappings).toEqual({ frontend: ['Lab'] });
      send({ type: 'saveAreaMappings', mappings: 'nope' }, ctx(true));
      expect(readConfig().standalone.areaMappings).toEqual({ frontend: ['Lab'] });
    });

    it('setShowAreas persists via the adapter', () => {
      send({ type: 'setShowAreas', enabled: true }, ctx(true));
      expect(readConfig().standalone.showAreas).toBe(true);
    });

    it('applies external asset directory changes and reloads assets', () => {
      const onReloadAssets = vi.fn();
      const c = { ...ctx(true), onReloadAssets };
      send({ type: 'addExternalAssetDirectory', path: '/assets/extra' }, c);
      expect(readConfig().externalAssetDirectories).toEqual(['/assets/extra']);
      send({ type: 'removeExternalAssetDirectory', path: '/assets/extra' }, c);
      expect(readConfig().externalAssetDirectories).toEqual([]);
      expect(onReloadAssets).toHaveBeenCalledTimes(2);
    });
  });

  describe('read-only clients', () => {
    it('refuses every mutating message and changes nothing', () => {
      const before = snapshotHome();
      const readOnly: ClientMessageContext = {
        ...ctx(false),
        onReloadAssets: () => {
          throw new Error('side effect must not run');
        },
      };
      const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
      for (const msg of [
        { type: 'saveLayout', layout: { version: 1, cols: 1, rows: 1, tiles: [0], furniture: [] } },
        { type: 'setSoundEnabled', enabled: false },
        { type: 'setAlwaysShowLabels', enabled: true },
        { type: 'addExternalAssetDirectory', path: '/x' },
        { type: 'removeExternalAssetDirectory', path: '/x' },
        { type: 'saveAreaMappings', mappings: { Lab: ['project'] } },
        { type: 'setShowAreas', enabled: true },
      ]) {
        send(msg, readOnly);
      }
      warn.mockRestore();

      expect(snapshotHome()).toEqual(before);
      // Only truth-restoring replies come back.
      expect([...new Set(sent.map((m) => m.type))].sort()).toEqual([
        'areaMappingsLoaded',
        'externalAssetDirectoriesUpdated',
        'settingsLoaded',
      ]);
    });

    it('answers a refused toggle with the real state so the control snaps back', () => {
      const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
      send({ type: 'setShowAreas', enabled: true }, ctx(false));
      expect(sent).toContainEqual(
        expect.objectContaining({ type: 'settingsLoaded', showAreas: false }),
      );
      sent = [];
      send({ type: 'saveAreaMappings', mappings: { Lab: ['x'] } }, ctx(false));
      expect(sent).toEqual([{ type: 'areaMappingsLoaded', mappings: {} }]);
      warn.mockRestore();
    });
  });

  describe('updates', () => {
    function fakeUpdater() {
      const updater = new Updater('0.1.0', {
        check: async () => null,
        install: async () => {},
      });
      updater.info = {
        version: '0.2.0',
        assetUrl: 'https://github.com/YOOJUNGYU/pixel-office-lan/releases/download/v0.2.0/x.exe',
        assetName: 'PixelOffice-Setup-0.2.0.exe',
        assetSize: 1,
        notesUrl: 'https://github.com/YOOJUNGYU/pixel-office-lan/releases/tag/v0.2.0',
      };
      const install = vi.spyOn(updater, 'install');
      return { updater, install };
    }

    it('announces a known update in the handshake to this PC only', () => {
      const { updater } = fakeUpdater();
      send({ type: 'webviewReady' }, { ...ctx(true), updater });
      expect(sent.at(-1)).toEqual({
        type: 'updateAvailable',
        version: '0.2.0',
        notesUrl: 'https://github.com/YOOJUNGYU/pixel-office-lan/releases/tag/v0.2.0',
      });
      sent = [];
      send({ type: 'webviewReady' }, { ...ctx(false), updater });
      expect(sent.map((m) => m.type)).not.toContain('updateAvailable');
    });

    it('installUpdate runs for this PC and is refused for a read-only client', () => {
      const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
      const { updater, install } = fakeUpdater();
      send({ type: 'installUpdate' }, { ...ctx(false), updater });
      expect(install).not.toHaveBeenCalled();
      send({ type: 'installUpdate' }, { ...ctx(true), updater });
      expect(install).toHaveBeenCalledTimes(1);
      warn.mockRestore();
    });
  });

  describe('local paths never reach a read-only client', () => {
    function seedPaths(): void {
      const cfg = readConfig();
      cfg.externalAssetDirectories = ['/home/kim/assets'];
      cfg.standalone.areaMappings = { 'kim-project': ['Lab'] };
      writeConfig(cfg);
    }
    const pick = (type: string) => sent.find((m) => m.type === type);

    it('handshake: read-only gets empty dirs and mappings, privileged gets the real ones', () => {
      seedPaths();
      send({ type: 'webviewReady' }, ctx(false));
      expect(pick('settingsLoaded')).toMatchObject({ externalAssetDirectories: [] });
      expect(pick('areaMappingsLoaded')).toEqual({ type: 'areaMappingsLoaded', mappings: {} });

      sent = [];
      send({ type: 'webviewReady' }, ctx(true));
      expect(pick('settingsLoaded')).toMatchObject({
        externalAssetDirectories: ['/home/kim/assets'],
      });
      expect(pick('areaMappingsLoaded')).toEqual({
        type: 'areaMappingsLoaded',
        mappings: { 'kim-project': ['Lab'] },
      });
    });

    it('refusal replies carry no paths either', () => {
      seedPaths();
      const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
      send({ type: 'setShowAreas', enabled: true }, ctx(false));
      send({ type: 'addExternalAssetDirectory', path: '/x' }, ctx(false));
      send({ type: 'saveAreaMappings', mappings: {} }, ctx(false));
      warn.mockRestore();
      expect(pick('settingsLoaded')).toMatchObject({ externalAssetDirectories: [] });
      expect(pick('externalAssetDirectoriesUpdated')).toEqual({
        type: 'externalAssetDirectoriesUpdated',
        dirs: [],
      });
      expect(pick('areaMappingsLoaded')).toEqual({ type: 'areaMappingsLoaded', mappings: {} });
      expect(JSON.stringify(sent)).not.toContain('kim');
    });
  });

  it('refusal logging stays bounded under endless garbage message types', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    for (let i = 0; i < 1000; i++) {
      send({ type: `garbage-${i.toString()}-${'x'.repeat(1000)}` }, ctx(false));
    }
    send({ type: 42 }, ctx(false));
    expect(reportedRefusals.size).toBeLessThanOrEqual(9 + 1);
    for (const [line] of warn.mock.calls) expect(String(line)).not.toContain('garbage');
    warn.mockRestore();
  });
});
