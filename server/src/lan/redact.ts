import type { AgentView } from '../../../core/src/lan.js';

/** File -> basename; home dir -> "~" (username); other directory (trailing separator) -> placeholder. */
const base = (p: string): string => {
  if (/(?:^|[\\/])(?:home|Users)[\\/][^\\/]+[\\/]?$/.test(p)) return '~';
  if (/[\\/]$/.test(p)) return '[경로]';
  return (
    p
      .split(/[\\/]+/)
      .filter(Boolean)
      .pop() ?? p
  );
};
const SEG = String.raw`[^\s\\/"'<>|]`;

/** Applied in order. Paths collapse to basename, URLs to host, IPs and tokens to placeholders. */
const RULES: Array<[RegExp, string | ((m: string, ...g: string[]) => string)]> = [
  // URL (any scheme) -> host only; userinfo, port, path, query dropped
  [/\b[a-z][a-z0-9+.-]*:\/\/(?:[^\s/@]*@)?([^\s/:?#'"<>)]+)(?::\d+)?[^\s'"<>)]*/gi, '$1'],
  // scheme-less URL (localhost / dotted host with TLD / IPv4, optional port, then "/") -> host only
  [
    /(?<![\w.@/-])(localhost|(?:[a-z0-9-]+\.)+[a-z]{2,}|\d{1,3}(?:\.\d{1,3}){3})(?::\d+)?\/[^\s'"<>)]*/gi,
    '$1',
  ],
  // quoted Windows/UNC path (may contain spaces)
  [/(["'])(?:[A-Za-z]:|\\\\)[^"'\n]*\1/g, (m) => base(m.slice(1, -1))],
  // UNC, drive, ~ (unquoted)
  // segments may contain spaces if followed by a separator; last segment is space-free
  [/\\\\(?:[^\\/\n"'<>|:]*[\\/])*[^\s\\/"'<>|]*/g, base],
  [/\b[A-Za-z]:[\\/](?:[^\\/\n"'<>|:]*[\\/])*[^\s\\/"'<>|]*/g, base],
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
  return { ...v, target: redactText(v.target), reason: redactText(v.reason) };
}
