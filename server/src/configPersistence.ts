import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';

import { CONFIG_FILE_NAME, LAYOUT_FILE_DIR } from './constants.js';

export interface AdapterSettings {
  soundEnabled: boolean;
  alwaysShowLabels: boolean;
  showAreas: boolean;
  /** Silent app updates (Settings → 자동 업데이트). */
  autoUpdate: boolean;
  /** OS notification on join/leave of the public office (lan/notify.ts). */
  notifyPresence: boolean;
  /** OS notification when one of this PC's agents waits for an answer or finishes. */
  notifyAgents: boolean;
}

/** All keys in AdapterSettings. Used by FileStateAdapter to map `pixel-agents.foo` → `foo`. */
export const ADAPTER_SETTING_KEYS = [
  'soundEnabled',
  'alwaysShowLabels',
  'showAreas',
  'autoUpdate',
  'notifyPresence',
  'notifyAgents',
] as const;

export type AdapterSettingKey = (typeof ADAPTER_SETTING_KEYS)[number];

export interface PixelAgentsConfig {
  standalone: AdapterSettings;
  externalAssetDirectories: string[];
}

const DEFAULT_ADAPTER_SETTINGS: AdapterSettings = {
  soundEnabled: true,
  alwaysShowLabels: false,
  showAreas: false,
  autoUpdate: true,
  notifyPresence: true,
  notifyAgents: true,
};

function getConfigFilePath(): string {
  return path.join(os.homedir(), LAYOUT_FILE_DIR, CONFIG_FILE_NAME);
}

/** Coerce a loose object into a valid AdapterSettings with defaults for missing/wrong-typed fields. */
function parseAdapterSettings(raw: unknown): AdapterSettings {
  const obj = (raw && typeof raw === 'object' ? raw : {}) as Partial<AdapterSettings>;
  return {
    soundEnabled:
      typeof obj.soundEnabled === 'boolean'
        ? obj.soundEnabled
        : DEFAULT_ADAPTER_SETTINGS.soundEnabled,
    alwaysShowLabels:
      typeof obj.alwaysShowLabels === 'boolean'
        ? obj.alwaysShowLabels
        : DEFAULT_ADAPTER_SETTINGS.alwaysShowLabels,
    showAreas:
      typeof obj.showAreas === 'boolean' ? obj.showAreas : DEFAULT_ADAPTER_SETTINGS.showAreas,
    autoUpdate:
      typeof obj.autoUpdate === 'boolean' ? obj.autoUpdate : DEFAULT_ADAPTER_SETTINGS.autoUpdate,
    notifyPresence:
      typeof obj.notifyPresence === 'boolean'
        ? obj.notifyPresence
        : DEFAULT_ADAPTER_SETTINGS.notifyPresence,
    notifyAgents:
      typeof obj.notifyAgents === 'boolean'
        ? obj.notifyAgents
        : DEFAULT_ADAPTER_SETTINGS.notifyAgents,
  };
}

function emptyConfig(): PixelAgentsConfig {
  return {
    standalone: { ...DEFAULT_ADAPTER_SETTINGS },
    externalAssetDirectories: [],
  };
}

export function readConfig(): PixelAgentsConfig {
  const filePath = getConfigFilePath();
  try {
    if (!fs.existsSync(filePath)) {
      return emptyConfig();
    }
    const raw = fs.readFileSync(filePath, 'utf-8');
    const parsed = JSON.parse(raw) as Partial<PixelAgentsConfig>;
    return {
      standalone: parseAdapterSettings(parsed.standalone),
      externalAssetDirectories: Array.isArray(parsed.externalAssetDirectories)
        ? parsed.externalAssetDirectories.filter((d): d is string => typeof d === 'string')
        : [],
    };
  } catch (err) {
    console.error('[Pixel Office] Failed to read config file:', err);
    return emptyConfig();
  }
}

/**
 * Atomically write the shared config. Never throws (most callers are
 * fire-and-forget settings writes that degrade to a console error); returns
 * whether the write landed.
 */
export function writeConfig(config: PixelAgentsConfig): boolean {
  const filePath = getConfigFilePath();
  const dir = path.dirname(filePath);
  try {
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }
    const json = JSON.stringify(config, null, 2);
    const tmpPath = filePath + '.tmp';
    fs.writeFileSync(tmpPath, json, 'utf-8');
    fs.renameSync(tmpPath, filePath);
    return true;
  } catch (err) {
    console.error('[Pixel Office] Failed to write config file:', err);
    return false;
  }
}
