import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// Mock os.homedir() so the adapter resolves to an isolated temp dir on every
// platform (os.homedir() reads USERPROFILE on Windows, not HOME).
let tempHome: string;
vi.mock('os', async () => {
  const actual = await vi.importActual<typeof import('os')>('os');
  return { ...actual, homedir: () => tempHome };
});

// Must import AFTER mock setup.
const { FileStateAdapter } = await import('../src/fileStateAdapter.js');

describe('FileStateAdapter', () => {
  const configPath = (): string => path.join(tempHome, '.pixel-office', 'config.json');

  beforeEach(() => {
    tempHome = fs.mkdtempSync(path.join(os.tmpdir(), 'pxl-adapter-test-'));
  });

  afterEach(() => {
    fs.rmSync(tempHome, { recursive: true, force: true });
  });

  it('returns defaults when config file does not exist', () => {
    const adapter = new FileStateAdapter();
    expect(adapter.getSetting('pixel-agents.soundEnabled', false)).toBe(true);
  });

  it('round-trips each setting key', () => {
    const adapter = new FileStateAdapter();
    adapter.setSetting('pixel-agents.soundEnabled', false);
    adapter.setSetting('pixel-agents.alwaysShowLabels', true);
    adapter.setSetting('pixel-agents.showAreas', true);

    expect(adapter.getSetting('pixel-agents.soundEnabled', true)).toBe(false);
    expect(adapter.getSetting('pixel-agents.alwaysShowLabels', false)).toBe(true);
    expect(adapter.getSetting('pixel-agents.showAreas', false)).toBe(true);
  });

  it('ignores unknown setting keys (returns default, does not write)', () => {
    const adapter = new FileStateAdapter();
    expect(adapter.getSetting('pixel-agents.watchAllSessions', 'fallback')).toBe('fallback');
    adapter.setSetting('pixel-agents.watchAllSessions', true);
    expect(fs.existsSync(configPath())).toBe(false);
  });

  it('accepts setting keys with or without the pixel-agents. prefix', () => {
    const adapter = new FileStateAdapter();
    adapter.setSetting('pixel-agents.soundEnabled', false);
    expect(adapter.getSetting('soundEnabled', true)).toBe(false);
    adapter.setSetting('showAreas', true);
    expect(adapter.getSetting('pixel-agents.showAreas', false)).toBe(true);
  });

  it('persists settings under ~/.pixel-office/config.json with clean field names', () => {
    new FileStateAdapter().setSetting('pixel-agents.soundEnabled', false);
    const parsed = JSON.parse(fs.readFileSync(configPath(), 'utf-8')) as Record<
      string,
      Record<string, unknown>
    >;
    expect(parsed.standalone.soundEnabled).toBe(false);
    expect(parsed.standalone['pixel-agents.soundEnabled']).toBeUndefined();
  });
});
