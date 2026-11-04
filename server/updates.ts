import { z } from 'zod';
import type { Store } from './store';
import { compareVersions, releaseVersion, releasesUrl, type Release, type UpdateStatus } from '../shared/updates';

const interval = 12 * 60 * 60 * 1000;
const key = 'release-check';
type Cache = { checkedAt?: number; release?: Release; error?: string };
export class UpdateChecker {
  private pending?: Promise<UpdateStatus>;
  constructor(private store: Store, private currentVersion = releaseVersion, private request: typeof fetch = fetch, private clock = Date.now) {}
  private cache(): Cache { return JSON.parse(this.store.one('SELECT value_json FROM settings WHERE key=?', key)?.value_json || '{}'); }
  private save(value: Cache) { this.store.run('INSERT INTO settings VALUES(?,?) ON CONFLICT(key) DO UPDATE SET value_json=excluded.value_json', key, JSON.stringify(value)); }
  status(): UpdateStatus {
    const cache = this.cache();
    return { ...cache, currentVersion: this.currentVersion, available: !!this.currentVersion && !!cache.release && compareVersions(cache.release.tag, this.currentVersion) === 1 };
  }
  async check(manual = false): Promise<UpdateStatus> {
    if (!this.currentVersion || compareVersions(this.currentVersion, this.currentVersion) === null) return this.status();
    if (!manual && !this.store.settings().updateNotifications) return this.status();
    if (this.pending) return this.pending;
    const cached = this.cache(), now = this.clock();
    if (!manual && cached.checkedAt !== undefined && now - cached.checkedAt <= interval) return this.status();
    // Persist attempts as well as successes so repeated restarts while offline do not poll.
    this.save({ ...cached, checkedAt: now, error: undefined });
    this.pending = this.fetchRelease(now).finally(() => { this.pending = undefined; });
    return this.pending;
  }
  private async fetchRelease(checkedAt: number) {
    try {
      const response = await this.request('https://api.github.com/repos/wwtwwwt/zhizhi/releases/latest', { headers: { Accept: 'application/vnd.github+json', 'User-Agent': 'zhizhi-update-check', 'X-GitHub-Api-Version': '2022-11-28' }, signal: AbortSignal.timeout(12000) });
      if (!response.ok) throw new Error(response.status === 404 ? '尚无可用的正式版本' : response.status === 403 || response.status === 429 ? 'GitHub 检查更新受限，请稍后再试' : `检查更新失败（${response.status}）`);
      const value = z.object({ tag_name:z.string().max(200), name:z.string().nullable(), body:z.string().nullable(), published_at:z.string().nullable(), draft:z.boolean(), prerelease:z.boolean() }).parse(await response.json());
      if (value.draft || value.prerelease || compareVersions(value.tag_name, this.currentVersion) === null) throw new Error('GitHub 返回的正式版本信息无效');
      // Derive a trusted destination instead of opening a URL supplied by the response.
      const release: Release = { tag: value.tag_name, name: value.name || value.tag_name, notes: (value.body || '').slice(0,20000), publishedAt: value.published_at || '', url: `${releasesUrl}/tag/${encodeURIComponent(value.tag_name)}` };
      if (this.cache().checkedAt === checkedAt) this.save({ checkedAt, release });
    } catch (error) {
      if (this.cache().checkedAt === checkedAt) this.save({ ...this.cache(), checkedAt, error: error instanceof Error && !(error instanceof z.ZodError) && error.name === 'Error' ? error.message : '无法检查更新，请检查网络后重试' });
    }
    return this.status();
  }
}
