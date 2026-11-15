import { readFile, stat } from 'node:fs/promises';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { parse } from 'smol-toml';
import type { ModelImportSource } from '../shared/models';

export type ImportCandidate = ModelImportSource & { apiKey: string };
async function read(path: string, toml = false): Promise<any> {
  try {
    if ((await stat(path)).size > 1024 * 1024) return {};
    const text = await readFile(path, 'utf8');
    const value = toml ? parse(text) : JSON.parse(text);
    return value && typeof value === 'object' && !Array.isArray(value) ? value : {};
  } catch { return {}; }
}
const literal = (value: unknown): string => typeof value === 'string' && value.trim() && !/\$\{|\$\(|^\$[A-Za-z_]|^%[^%]+%$/.test(value) ? value.trim() : '';
export async function readModelImports(home = homedir(), env: NodeJS.ProcessEnv = process.env): Promise<ImportCandidate[]> {
  const candidates: ImportCandidate[] = [];
  const add = (value: Omit<ImportCandidate, 'id'>) => {
    if (!value.baseUrl || !value.apiKey) return;
    try { const url = new URL(value.baseUrl); if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password || url.search || url.hash) return; } catch { return; }
    if (value.apiKey.length > 10000) return;
    if (!candidates.some(item => item.baseUrl === value.baseUrl && item.apiKey === value.apiKey && item.model === value.model && item.apiType === value.apiType)) candidates.push({ ...value, id: randomUUID() });
  };
  const claude = await read(join(env.CLAUDE_CONFIG_DIR || join(home, '.claude'), 'settings.json'));
  const ce = claude.env || {};
  const claudeKey = literal(ce.ANTHROPIC_API_KEY) || literal(ce.ANTHROPIC_AUTH_TOKEN);
  add({ source: 'Claude Code', baseUrl: literal(ce.ANTHROPIC_BASE_URL), apiKey: claudeKey, apiType: 'messages', authType: literal(ce.ANTHROPIC_API_KEY) ? 'api-key' : 'bearer', model: literal(claude.model) || literal(ce.ANTHROPIC_MODEL) || undefined });
  const codexHome = env.CODEX_HOME || join(home, '.codex');
  const codex = await read(join(codexHome, 'config.toml'), true);
  const auth = await read(join(codexHome, 'auth.json'));
  // Read only explicit API credentials. OAuth token sets, commands, keychains,
  // shell configuration and project-specific configuration are not consulted.
  const configurations = [{ value: codex, label: 'Codex' }, ...Object.entries(codex.profiles || {}).map(([name, value]) => ({ value: { ...codex, ...(value as object) }, label: `Codex · ${name}` }))];
  for (const { value, label } of configurations) {
    const providerId = value.model_provider || 'openai';
    const provider = codex.model_providers?.[providerId] || {};
    const apiKey = literal(provider.experimental_bearer_token) || (provider.env_key ? literal(env[provider.env_key]) : providerId === 'openai' ? literal(env.OPENAI_API_KEY) : '') || (providerId === 'openai' || provider.requires_openai_auth ? literal(auth.OPENAI_API_KEY) : '');
    const wire = provider.wire_api || 'responses';
    if (!['responses', 'chat'].includes(wire) || provider.auth || provider.gateway_oauth || provider.aws || provider.env_http_headers || provider.http_headers && Object.keys(provider.http_headers).length) continue;
    add({ source: label, baseUrl: literal(provider.base_url) || literal(value.openai_base_url), apiKey, apiType: wire, authType: 'bearer', model: literal(value.model) || undefined });
  }
  return candidates;
}

export class ModelImportCache {
  private candidates = new Map<string, { value: ImportCandidate; expires: number }>();
  constructor(private scan = () => readModelImports()) {}
  async list(): Promise<ModelImportSource[]> {
    for (const [id, entry] of this.candidates) if (entry.expires < Date.now()) this.candidates.delete(id);
    const values = await this.scan();
    for (const value of values) this.candidates.set(value.id, { value, expires: Date.now() + 30 * 60_000 });
    return values.map(({ apiKey: _, ...value }) => value);
  }
  resolve(id: string, baseUrl: string, apiType: string, authType?: string) {
    const entry = this.candidates.get(id);
    if (!entry || entry.expires < Date.now()) throw new Error('导入配置已过期，请重新打开添加模型');
    if (entry.value.baseUrl !== baseUrl || entry.value.apiType !== apiType || entry.value.authType !== authType) throw new Error('导入连接已修改，请手动填写 API Key');
    return entry.value.apiKey;
  }
}
