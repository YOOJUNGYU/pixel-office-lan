import type { AgentView } from '../../../core/src/lan.js';

const base = (p: string): string =>
  p
    .split(/[\\/]+/)
    .filter(Boolean)
    .pop() ?? p;
const SEG = String.raw`[^\s\\/"'<>|]`;

/** Applied in order. Paths collapse to basename, URLs to host, IPs and tokens to placeholders. */
const RULES: Array<[RegExp, string | ((m: string, ...g: string[]) => string)]> = [
  // URL (any scheme) -> host only; userinfo, port, path, query dropped
  [/\b[a-z][a-z0-9+.-]*:\/\/(?:[^\s/@]*@)?([^\s/:?#'"<>)]+)(?::\d+)?[^\s'"<>)]*/gi, '$1'],
  // quoted Windows/UNC path (may contain spaces)
  [/(["'])(?:[A-Za-z]:|\\\\)[^"'\n]*\1/g, (m) => base(m.slice(1, -1))],
  // UNC, drive, ~ (unquoted)
  [/\\\\[^\s"'<>|]+/g, base],
  [/\b[A-Za-z]:[\\/][^\s"'<>|]*/g, base],
  [/(?<![\w.~])~[\\/][^\s"'<>|]*/g, base],
  // absolute posix, >=2 segments (a lone "/clear" is left alone)
  [new RegExp(String.raw`(?<![\w.:/\\-])(?:/${SEG}+){2,}/?`, 'g'), base],
  // relative multi-segment ending in a file with extension
  [new RegExp(String.raw`(?<![\w.:/\\-])(?:${SEG}+/)+[\w@+-][\w.@+-]*\.\w+`, 'g'), base],
  // IPv4 with optional port (ponytail: no IPv6)
  [/\b(?:\d{1,3}\.){3}\d{1,3}(?::\d{1,5})?\b/g, '[IP]'],
  // secrets
  [/\bBearer\s+[\w.~+/=-]{16,}/gi, 'Bearer [비밀]'],
  [/\bsk-[\w-]{10,}/g, '[비밀]'],
  [/\bgh[pousr]_[A-Za-z0-9]{20,}/g, '[비밀]'],
  [/\bxox[abprs]-[\w-]{10,}/g, '[비밀]'],
  [/\bAKIA[0-9A-Z]{16}\b/g, '[비밀]'],
  // 32+ char base64/hex blob; must contain a digit so long snake_case names survive
  [/(?<![\w+/=-])(?=[A-Za-z+/_-]*\d)[A-Za-z0-9+/_-]{32,}={0,2}/g, '[비밀]'],
];

export function redactText(s: string): string {
  let out = s;
  for (const [re, rep] of RULES) out = out.replace(re, rep as string);
  return out;
}

export function redactView(v: AgentView): AgentView {
  return { ...v, summary: redactText(v.summary), reason: redactText(v.reason) };
}
