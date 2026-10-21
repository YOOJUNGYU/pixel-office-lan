import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';

import { CONFIG_FILE_NAME, LAYOUT_FILE_DIR } from './constants.js';

export interface AdapterSettings {
  soundEnabled: boolean;
  alwaysShowLabels: boolean;
  showAreas: boolean;
  areaMappings: Record<string, string[]>;
}

/** All keys in AdapterSettings. Used by FileStateAdapter to map `pixel-agents.foo` → `foo`. */
export const ADAPTER_SETTING_KEYS = [
  'soundEnabled',
  'alwaysShowLabels',
  'showAreas',
  'areaMappings',
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
  areaMappings: {},
};

function getConfigFilePath(): string {
  return path.join(os.homedir(), LAYOUT_FILE_DIR, CONFIG_FILE_NAME);
}

/**
 * Coerce a loose object into `Record<string, string[]>`, dropping any entries
 * whose value is not an array of strings. Returns `{}` if the input isn't an
 * object. Used to defensively load Directory→area mappings from config.json,
 * which may have been hand-edited or written by an older build.
 */
export function parseAreaMappings(raw: unknown): Record<string, string[]> {
  if (!raw || typeof raw !== 'object') {
    return {};
  }
  const out: Record<string, string[]> = {};
  for (const [directory, labels] of Object.entries(raw as Record<string, unknown>)) {
    if (typeof directory !== 'string') {
      continue;
    }
    if (!Array.isArray(labels)) {
      continue;
    }
    const filtered = labels.filter((l): l is string => typeof l === 'string');
    out[directory] = filtered;
  }
  return out;
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
    areaMappings: parseAreaMappings(obj.areaMappings),
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
