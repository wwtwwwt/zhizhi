export const releaseVersion = typeof __ZHIZHI_VERSION__ === 'string' ? __ZHIZHI_VERSION__ : '';
export const releasesUrl = 'https://github.com/wwtwwwt/zhizhi/releases';
export type Release = { tag: string; name: string; url: string; publishedAt: string; notes: string };
export type UpdateStatus = { currentVersion: string; checkedAt?: number; release?: Release; available: boolean; error?: string };
const versionPattern = /^v?(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-([0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*))?(?:\+[0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*)?$/;
function parseVersion(tag: string) {
  const match = versionPattern.exec(tag);
  if (!match) return null;
  const pre = match[4]?.split('.');
  if (pre?.some(v => /^\d+$/.test(v) && v.length > 1 && v.startsWith('0'))) return null;
  return { core: match.slice(1,4).map(BigInt), pre };
}
// Return null for a non-version tag; never infer ordering from tag strings.
export function compareVersions(a: string, b: string): number | null {
  const left = parseVersion(a), right = parseVersion(b);
  if (!left || !right) return null;
  for (let i = 0; i < 3; i++) if (left.core[i] !== right.core[i]) return left.core[i] > right.core[i] ? 1 : -1;
  if (!left.pre || !right.pre) return left.pre === right.pre ? 0 : left.pre ? -1 : 1;
  for (let i = 0; i < Math.max(left.pre.length, right.pre.length); i++) {
    const x = left.pre[i], y = right.pre[i];
    if (x === undefined || y === undefined) return x === undefined ? -1 : 1;
    if (x === y) continue;
    const xn = /^\d+$/.test(x), yn = /^\d+$/.test(y);
    if (xn && yn) return BigInt(x) > BigInt(y) ? 1 : -1;
    return xn !== yn ? xn ? -1 : 1 : x > y ? 1 : -1;
  }
  return 0;
}
