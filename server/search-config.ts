import type { Secrets } from './secrets';
import type { SearchProvider, SearchSettings } from '../shared/search';
export function searchConfig(secrets: Secrets) {
  const value = secrets.read(), provider = value.searchProvider || 'deepseek';
  const keys = { ...value.searchKeys, deepseek: value.searchKey };
  const configuredProviders = { deepseek: !!keys.deepseek, tavily: !!keys.tavily, exa: !!keys.exa };
  return { provider, key: keys[provider] || '', configured: provider === 'exa' || configuredProviders[provider], configuredProviders };
}
export function publicSearchConfig(secrets: Secrets): SearchSettings {
  const { provider, configured, configuredProviders } = searchConfig(secrets);
  return { provider, configured, configuredProviders };
}
export function saveSearchConfig(secrets: Secrets, data: {provider?: SearchProvider; apiKey?: string; clear?: boolean}) {
  const value=secrets.read(), provider=data.provider || value.searchProvider || 'deepseek';
  value.searchKeys={...value.searchKeys};
  if(data.clear){delete value.searchKeys[provider];if(provider==='deepseek')delete value.searchKey;}
  else if(data.apiKey){if(provider==='deepseek')value.searchKey=data.apiKey;else value.searchKeys[provider]=data.apiKey;}
  value.searchProvider=provider;secrets.write(value);
  return publicSearchConfig(secrets);
}
