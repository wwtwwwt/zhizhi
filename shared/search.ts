export type SearchProvider = 'deepseek' | 'tavily' | 'exa';
export const searchProviderNames: Record<SearchProvider,string> = {deepseek:'DeepSeek Search',tavily:'Tavily',exa:'Exa MCP'};
export type SearchSettings = { provider: SearchProvider; configured: boolean; configuredProviders: Record<SearchProvider,boolean> };
export type SearchSource = { id: number; title: string; url: string };
export type SearchActivity = { id: number; tool: string; input: string; status: 'running' | 'complete' | 'error'; message?: string; resultCount?: number };
export type SearchProgress = { activities: SearchActivity[]; sources: SearchSource[] };
