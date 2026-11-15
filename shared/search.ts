export type SearchSettings = { provider: 'deepseek'; configured: boolean };
export type SearchSource = { id: number; title: string; url: string };
export type SearchActivity = { id: number; tool: string; input: string; status: 'running' | 'complete' | 'error'; message?: string };
export type SearchProgress = { activities: SearchActivity[]; sources: SearchSource[] };
