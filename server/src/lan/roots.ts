// Where Claude/Codex transcripts live on this PC (incl. WSL distros from Windows).
import { execFile } from 'node:child_process';
import { readdir } from 'node:fs/promises';
import { homedir } from 'node:os';
import * as path from 'node:path';

import { WSL_LIST_TIMEOUT_MS } from '../constants.js';

/** claude: …/.claude/projects, codex: …/.codex/sessions */
export interface Roots {
  claude: string[];
  codex: string[];
}

export function parseWslList(out: Buffer): string[] {
  return out
    .toString('utf16le')
    .replace(/[\0\uFEFF]/g, '')
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter(Boolean);
}

function listWslDistros(): Promise<string[]> {
  return new Promise((resolve) => {
    execFile(
      'wsl.exe',
      ['-l', '-q'],
      { encoding: 'buffer', timeout: WSL_LIST_TIMEOUT_MS, windowsHide: true },
      (err, stdout) => resolve(err ? [] : parseWslList(stdout)),
    );
  });
}

interface WslDeps {
  listDistros: () => Promise<string[]>;
  readdir: (p: string) => Promise<string[]>;
}

export async function discoverRoots(
  env: NodeJS.ProcessEnv = process.env,
  platform: NodeJS.Platform = process.platform,
  home: string = homedir(),
  wsl: WslDeps = { listDistros: listWslDistros, readdir: (p) => readdir(p) },
): Promise<Roots> {
  const p = platform === 'win32' ? path.win32 : path.posix;
  const roots: Roots = {
    claude: [p.join(env.CLAUDE_CONFIG_DIR ?? p.join(home, '.claude'), 'projects')],
    codex: [p.join(env.CODEX_HOME ?? p.join(home, '.codex'), 'sessions')],
  };
  if (platform !== 'win32') return roots;
  const exists = (d: string) =>
    wsl.readdir(d).then(
      () => true,
      () => false,
    );
  for (const distro of await wsl.listDistros().catch(() => [])) {
    const base = `\\\\wsl.localhost\\${distro}`;
    const users = await wsl.readdir(p.join(base, 'home')).catch(() => []);
    for (const h of [...users.map((u) => p.join(base, 'home', u)), p.join(base, 'root')]) {
      const claude = p.join(h, '.claude', 'projects');
      const codex = p.join(h, '.codex', 'sessions');
      if (await exists(claude)) roots.claude.push(claude);
      if (await exists(codex)) roots.codex.push(codex);
    }
  }
  return roots;
}
