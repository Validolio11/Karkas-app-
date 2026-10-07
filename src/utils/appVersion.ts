type Version = { parts: number[]; pre?: string[] };

function parse(value: unknown): Version | null {
  if (typeof value !== 'string') return null;
  const match = value.trim().match(/^v?(\d+)(?:\.(\d+))?(?:\.(\d+))?(?:-([\da-zA-Z-]+(?:\.[\da-zA-Z-]+)*))?(?:\+[\da-zA-Z-]+(?:\.[\da-zA-Z-]+)*)?$/);
  if (!match) return null;
  if ([match[1], match[2], match[3]].some(part => part !== undefined && !/^(0|[1-9]\d*)$/.test(part))) return null;
  const parts = [match[1], match[2] ?? '0', match[3] ?? '0'].map(Number);
  if (parts.some(part => !Number.isSafeInteger(part))) return null;
  const pre = match[4]?.split('.');
  if (pre?.some(part => /^\d+$/.test(part) && (!/^(0|[1-9]\d*)$/.test(part) || !Number.isSafeInteger(Number(part))))) return null;
  return { parts, pre };
}

export function isValidAppVersion(value: unknown): boolean { return parse(value) !== null; }

/** Unknown versions are never treated as an upgrade; build metadata is ignored. */
export function compareAppVersions(a: string, b: string): number | null {
  const left = parse(a), right = parse(b);
  if (!left || !right) return null;
  for (let i = 0; i < 3; i++) {
    if (left.parts[i] !== right.parts[i]) return Math.sign(left.parts[i] - right.parts[i]);
  }
  if (!left.pre || !right.pre) return left.pre ? -1 : right.pre ? 1 : 0;
  for (let i = 0; i < Math.max(left.pre.length, right.pre.length); i++) {
    const l = left.pre[i], r = right.pre[i];
    if (l === r) continue;
    if (l === undefined) return -1;
    if (r === undefined) return 1;
    const ln = /^\d+$/.test(l), rn = /^\d+$/.test(r);
    if (ln && rn) return Math.sign(Number(l) - Number(r));
    if (ln !== rn) return ln ? -1 : 1;
    return l < r ? -1 : 1;
  }
  return 0;
}

export function isNewerAppVersion(release: string, current: string): boolean {
  return compareAppVersions(release, current) === 1;
}
