import { randomUUID } from 'node:crypto';
import { AppError, type Store } from './store';
import { fakeModel, validateParameters, type ModelConfig } from '../shared/models';

export class ModelRegistry {
  constructor(private store: Store) {}
  list(): ModelConfig[] { return [fakeModel(this.store.settings().fakeDelay), ...this.store.all('SELECT * FROM models ORDER BY rowid').map(r => ({ ...JSON.parse(r.config_json), hasApiKey: !!this.key(r.id) }))]; }
  get(id?: string): ModelConfig { const selected = id || 'fake'; const model = this.list().find(m => m.id === selected); if (!model) throw new AppError(404, 'MODEL_NOT_FOUND', '模型不存在，请重新选择'); return model; }
  key(id: string) { return this.store.secrets.read().modelKeys?.[id] || ''; }
  setKey(id: string, key?: string, clear?: boolean) {
    if (!key && !clear) return;
    const secrets = this.store.secrets.read();
    const modelKeys = secrets.modelKeys || {};
    if (clear) delete modelKeys[id]; else modelKeys[id] = key!;
    this.store.secrets.write({modelKeys});
  }
  save(value: Omit<ModelConfig, 'id'> & { id?: string; apiKey?: string; clearApiKey?: boolean }) {
    if (value.id === 'fake' || value.provider === 'fake') throw new AppError(400, 'FIXED_MODEL', '模拟模式是固定模型');
    const error = validateParameters(value.parameters); if (error) throw new AppError(400, 'INVALID_PARAMETERS', error);
    const id = value.id || randomUUID(); const { apiKey, clearApiKey, hasApiKey: _, fixed: __, ...publicConfig } = value;
    const config = { ...publicConfig, id, provider: 'openai' as const, baseUrl: value.baseUrl.replace(/\/+$/, '') };
    this.setKey(id, apiKey, clearApiKey);
    this.store.run('INSERT INTO models VALUES(?,?) ON CONFLICT(id) DO UPDATE SET config_json=excluded.config_json', id, JSON.stringify(config));
    return this.get(id);
  }
  delete(id: string) { if (id === 'fake') throw new AppError(400, 'FIXED_MODEL', '模拟模式不可删除'); this.get(id); if (this.get().id === id) this.store.saveSettings({...this.store.settings()}); this.store.run('DELETE FROM models WHERE id=?', id); this.setKey(id, undefined, true); }
}
