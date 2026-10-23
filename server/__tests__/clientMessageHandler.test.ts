import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { ROOM_DEFAULT_COLORS } from '../../core/src/lan.js';
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
/** A minimal valid 2×1 layout. */
const GRID = { version: 1, cols: 2, rows: 1, tiles: [1, 1], furniture: [] };
/** The bundled default's room colors. */
const DEFAULT_ROOMS = {
  areas: [
    { label: '코딩실', color: '#48dbfb' },
    { label: '자료실', color: '#1dd1a1' },
    { label: '서버실', color: '#ff6b6b' },
    { label: '대기실', color: '#feca57' },
  ],
};
const OTHER = '#123456';
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
    it('sends access, assets, settings, then the layout last', () => {
      send({ type: 'webviewReady' }, ctx(true, FULL_CACHE));
      expect(sent.map((m) => m.type)).toEqual([
        'officeAccess',
        'floorTilesLoaded',
        'wallTilesLoaded',
        'carpetTilesLoaded',
        'settingsLoaded',
        'layoutLoaded',
      ]);
      expect(sent[0]).toEqual({ type: 'officeAccess', readOnly: false, version: '0.0.0' });
      expect(sent.at(-1)).toEqual({
        type: 'layoutLoaded',
        layout: { version: 1, marker: 'default' },
      });
    });

    it('tells a read-only client so FIRST, and still loads the office for it', () => {
      send({ type: 'webviewReady' }, ctx(false));
      expect(sent[0]).toEqual({ type: 'officeAccess', readOnly: true, version: '0.0.0' });
      expect(sent.map((m) => m.type)).toContain('layoutLoaded');
    });

    it('prefers the saved layout over the bundled default', () => {
      send({ type: 'saveLayout', layout: { ...GRID, marker: 'saved' } }, ctx(true));
      send({ type: 'webviewReady' }, ctx(true, FULL_CACHE));
      expect(sent.at(-1)).toMatchObject({
        type: 'layoutLoaded',
        layout: { ...GRID, marker: 'saved' },
      });
    });
  });

  describe('saveLayout', () => {
    const saved = () =>
      JSON.parse(
        fs.readFileSync(path.join(tempHome, '.pixel-office', 'layout.json'), 'utf-8'),
      ) as Record<string, unknown>;

    it('keeps exactly the four rooms, drops unknown areas and pets', () => {
      const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
      send(
        {
          type: 'saveLayout',
          layout: {
            ...GRID,
            areas: [
              { label: 'Lab', color: OTHER },
              { label: '서버실', color: OTHER },
            ],
            areaTiles: ['Lab', '서버실'],
            pets: [{ id: 'p', petType: 0 }],
          },
        },
        { ...ctx(true), cache: { ...FULL_CACHE, defaultLayout: DEFAULT_ROOMS } },
      );
      warn.mockRestore();
      const layout = saved();
      const [coding, library, , lounge] = DEFAULT_ROOMS.areas;
      expect(layout.areas).toEqual([coding, library, { label: '서버실', color: OTHER }, lounge]);
      expect(layout.areaTiles).toEqual([null, '서버실']);
      expect('pets' in layout).toBe(false);
    });

    it('refuses odd input without throwing or writing, and tells the browser', () => {
      const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
      for (const layout of [
        null,
        'x',
        [],
        { version: 1 },
        { ...GRID, cols: 129, tiles: new Array(129).fill(1) },
        { ...GRID, tiles: [1] },
        { ...GRID, furniture: 'no' },
        { ...GRID, areas: 'no', areaTiles: { 0: 'x' } },
      ]) {
        expect(() => send({ type: 'saveLayout', layout }, ctx(true))).not.toThrow();
      }
      warn.mockRestore();
      // Every one but the last (a valid grid with odd areas) was refused.
      expect(sent.filter((m) => m.type === 'layoutSaveRejected')).toHaveLength(7);
      expect(sent.filter((m) => m.type === 'layoutSaved')).toHaveLength(1);
      // Odd areas just become the four rooms, with their default colors.
      expect((saved().areas as Array<{ color: string }>).map((a) => a.color)).toEqual(
        Object.values(ROOM_DEFAULT_COLORS),
      );
      expect(saved().areaTiles).toEqual([null, null]);
    });

    it('accepts a 128×128 office', () => {
      const n = 128 * 128;
      send(
        {
          type: 'saveLayout',
          layout: { ...GRID, cols: 128, rows: 128, tiles: new Array(n).fill(1) },
        },
        ctx(true),
      );
      expect(saved().cols).toBe(128);
      expect(sent.at(-1)).toEqual({ type: 'layoutSaved' });
    });
  });

  describe('privileged writes', () => {
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
        { type: 'setAlwaysShowLabels', enabled: true },
        { type: 'addExternalAssetDirectory', path: '/x' },
        { type: 'removeExternalAssetDirectory', path: '/x' },
        { type: 'setShowAreas', enabled: true },
      ]) {
        send(msg, readOnly);
      }
      warn.mockRestore();

      expect(snapshotHome()).toEqual(before);
      // Only truth-restoring replies come back.
      expect([...new Set(sent.map((m) => m.type))].sort()).toEqual([
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
      warn.mockRestore();
    });

    it('quitApp quits for this PC only (and never through the updater)', () => {
      const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
      const onQuitApp = vi.fn();
      send({ type: 'quitApp' }, { ...ctx(false), onQuitApp });
      expect(onQuitApp).not.toHaveBeenCalled();
      send({ type: 'quitApp' }, { ...ctx(true), onQuitApp });
      expect(onQuitApp).toHaveBeenCalledOnce();
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

  describe('start at login', () => {
    function fakeAutostart() {
      const state = { enabled: true, supported: true };
      const set = vi.fn(async (enabled: boolean) => {
        state.enabled = enabled;
        return { ...state };
      });
      return { autostart: { get: () => ({ ...state }), set }, set };
    }

    it('handshake reports it to this PC only', () => {
      const { autostart } = fakeAutostart();
      send({ type: 'webviewReady' }, { ...ctx(true), autostart });
      expect(sent).toContainEqual({ type: 'autostartState', enabled: true, supported: true });
      sent = [];
      send({ type: 'webviewReady' }, { ...ctx(false), autostart });
      expect(sent.map((m) => m.type)).not.toContain('autostartState');
    });

    it('setAutostart applies for this PC and answers; a read-only client is refused', async () => {
      const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
      const { autostart, set } = fakeAutostart();
      send({ type: 'setAutostart', enabled: false }, { ...ctx(false), autostart });
      expect(set).not.toHaveBeenCalled();
      send({ type: 'setAutostart', enabled: 'yes' }, { ...ctx(true), autostart });
      expect(set).not.toHaveBeenCalled();
      send({ type: 'setAutostart', enabled: false }, { ...ctx(true), autostart });
      expect(set).toHaveBeenCalledWith(false);
      await vi.waitFor(() =>
        expect(sent.at(-1)).toEqual({ type: 'autostartState', enabled: false, supported: true }),
      );
      warn.mockRestore();
    });
  });

  describe('local paths never reach a read-only client', () => {
    function seedPaths(): void {
      const cfg = readConfig();
      cfg.externalAssetDirectories = ['/home/kim/assets'];
      writeConfig(cfg);
    }
    const pick = (type: string) => sent.find((m) => m.type === type);

    it('handshake: read-only gets empty dirs, privileged gets the real ones', () => {
      seedPaths();
      send({ type: 'webviewReady' }, ctx(false));
      expect(pick('settingsLoaded')).toMatchObject({ externalAssetDirectories: [] });

      sent = [];
      send({ type: 'webviewReady' }, ctx(true));
      expect(pick('settingsLoaded')).toMatchObject({
        externalAssetDirectories: ['/home/kim/assets'],
      });
    });

    it('refusal replies carry no paths either', () => {
      seedPaths();
      const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
      send({ type: 'setShowAreas', enabled: true }, ctx(false));
      send({ type: 'addExternalAssetDirectory', path: '/x' }, ctx(false));
      warn.mockRestore();
      expect(pick('settingsLoaded')).toMatchObject({ externalAssetDirectories: [] });
      expect(pick('externalAssetDirectoriesUpdated')).toEqual({
        type: 'externalAssetDirectoriesUpdated',
        dirs: [],
      });
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
