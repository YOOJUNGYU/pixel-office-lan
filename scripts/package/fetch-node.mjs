// Downloads the official Node.js binary pinned in node-version.txt, verifies it
// against the release's SHASUMS256.txt and extracts node (+ its LICENSE) into <outDir>.
//
//   node scripts/package/fetch-node.mjs <win-x64|darwin-arm64|darwin-x64> <outDir>
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { cpSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const [target, outDir] = process.argv.slice(2);
if (!['win-x64', 'darwin-arm64', 'darwin-x64'].includes(target) || !outDir) {
  console.error('usage: fetch-node.mjs <win-x64|darwin-arm64|darwin-x64> <outDir>');
  process.exit(1);
}

const version = readFileSync(
  join(dirname(fileURLToPath(import.meta.url)), 'node-version.txt'),
  'utf8',
).trim();
const base = `https://nodejs.org/dist/${version}`;
const name = `node-${version}-${target}`;
const archive = `${name}.${target.startsWith('win') ? 'zip' : 'tar.gz'}`;

async function get(url) {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`${url}: HTTP ${res.status}`);
  return Buffer.from(await res.arrayBuffer());
}

const sums = (await get(`${base}/SHASUMS256.txt`)).toString('utf8');
const expected = sums
  .split('\n')
  .find((l) => l.endsWith(`  ${archive}`))
  ?.split(' ')[0];
if (!expected) throw new Error(`${archive} not listed in SHASUMS256.txt`);
const data = await get(`${base}/${archive}`);
const actual = createHash('sha256').update(data).digest('hex');
if (actual !== expected) throw new Error(`${archive}: sha256 ${actual} != ${expected}`);
console.log(`✓ ${archive} sha256 ok`);

const tmp = mkdtempSync(join(tmpdir(), 'fetch-node-'));
writeFileSync(join(tmp, archive), data);
// Windows' own bsdtar (System32) reads .zip; Git's GNU tar on PATH would not.
const tar =
  process.platform === 'win32'
    ? join(process.env.SystemRoot ?? 'C:\\Windows', 'System32', 'tar.exe')
    : 'tar';
const r = spawnSync(tar, ['-xf', archive], { cwd: tmp, stdio: 'inherit' });
if (r.status !== 0) throw new Error(`tar failed (${r.status})`);

mkdirSync(outDir, { recursive: true });
const exe = target.startsWith('win') ? 'node.exe' : 'node';
cpSync(join(tmp, name, target.startsWith('win') ? exe : join('bin', exe)), join(outDir, exe));
cpSync(join(tmp, name, 'LICENSE'), join(outDir, 'LICENSE-node.txt'));
rmSync(tmp, { recursive: true, force: true });
console.log(`✓ ${version} ${target} → ${join(outDir, exe)}`);
