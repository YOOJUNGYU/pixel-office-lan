/**
 * The installers' pixeloffice: URL scheme (the page's [시작] when the server is off) must run a
 * FIXED command: PixelOffice.exe forwards its arguments to cli.js, so a URL (%1) in the command would
 * let any website pass CLI flags.
 */
import { readFileSync } from 'node:fs';
import * as path from 'node:path';

import { describe, expect, it } from 'vitest';

const PKG = path.join(__dirname, '../../scripts/package');

/** [Registry] lines of windows.iss as {Subkey, ValueName, ValueData} with Inno "" unescaped. */
function registry(): Record<string, string>[] {
  const iss = readFileSync(path.join(PKG, 'windows.iss'), 'utf8');
  const section = /^\[Registry\]\r?\n([\s\S]*?)^\[/m.exec(iss)?.[1] ?? '';
  return section
    .split(/\r?\n/)
    .filter((l) => l.startsWith('Root:'))
    .map((l) =>
      Object.fromEntries(
        [...l.matchAll(/(\w+): ("(?:[^"]|"")*"|[^;]*)/g)].map(([, k, v]) => [
          k,
          v.startsWith('"') ? v.slice(1, -1).replace(/""/g, '"') : v.trim(),
        ]),
      ),
    );
}

describe('pixeloffice: URL scheme', () => {
  it('Windows: a URL Protocol key whose command ignores the URL', () => {
    const rows = registry();
    const key = 'Software\\Classes\\pixeloffice';
    expect(rows.some((r) => r.Subkey === key && r.ValueName === 'URL Protocol')).toBe(true);
    expect(rows.find((r) => r.Subkey === key)?.Flags).toBe('uninsdeletekey');
    const cmd = rows.filter((r) => r.Subkey === `${key}\\shell\\open\\command`);
    expect(cmd).toHaveLength(1);
    expect(cmd[0].ValueData).toBe('"{app}\\PixelOffice.exe"');
    for (const r of rows) expect(r.ValueData ?? '').not.toMatch(/%/);
  });

  it('Windows uninstall removes the install folder, never kills node.exe by name', () => {
    const iss = readFileSync(path.join(PKG, 'windows.iss'), 'utf8');
    expect(iss).toMatch(
      /^\[UninstallDelete\]\r?\n(?:;.*\r?\n)*Type: filesandordirs; Name: "\{app\}"/m,
    );
    expect(iss).toContain("'/F /IM PixelOfficeTray.exe'");
    expect(iss).not.toMatch(/\/IM node\.exe/i);
  });

  it('Windows: no wscript/VBS anywhere; the launcher exe starts only our node.exe', () => {
    const iss = readFileSync(path.join(PKG, 'windows.iss'), 'utf8');
    expect(iss).not.toMatch(/wscript/i);
    expect(iss).toContain('Type: files; Name: "{app}\\launch.vbs"'); // removed on upgrade
    const cs = readFileSync(path.join(PKG, 'launcher/PixelOffice.cs'), 'utf8');
    for (const bad of [
      'Registry',
      'System.Net',
      'cmd.exe',
      'powershell',
      'UseShellExecute = true',
    ]) {
      expect(cs).not.toContain(bad);
    }
    expect(cs.match(/Process\.Start\(/g)).toHaveLength(1);
    expect(cs).toContain('Path.Combine(dir, "node.exe")');
    expect(cs).toContain('psi.CreateNoWindow = true;');
  });

  it('macOS: the app declares the scheme and its launcher takes no URL', () => {
    const sh = readFileSync(path.join(PKG, 'macos.sh'), 'utf8');
    expect(sh).toMatch(
      /<key>CFBundleURLSchemes<\/key><array><string>pixeloffice<\/string><\/array>/,
    );
    expect(sh).toContain('exec "$RES/node" "$RES/app/cli.js" --open\n');
  });
});
