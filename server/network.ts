import { AsyncLocalStorage } from 'node:async_hooks';
import { EnvHttpProxyAgent, fetch as undiciFetch } from 'undici';
export type ProxyMode = 'system' | 'direct';
const requests = new AsyncLocalStorage<typeof fetch>();
export const withNetwork = <T>(request: typeof fetch, run: () => T) => requests.run(request, run);
export const networkFetch: typeof fetch = (input, init) => (requests.getStore() || globalThis.fetch)(input, init);
export function localAddress(input: Parameters<typeof fetch>[0]) {
  const host = new URL(typeof input === 'string' || input instanceof URL ? input : input.url).hostname;
  return host === 'localhost' || host === '[::1]' || /^127\./.test(host);
}
export function nodeNetwork(mode: () => ProxyMode): typeof fetch {
  const proxy = new EnvHttpProxyAgent();
  return async (input, init) => {
    if (mode() === 'direct' || localAddress(input)) return globalThis.fetch(input, init);
    return undiciFetch(input as Parameters<typeof undiciFetch>[0], { ...init, dispatcher: proxy } as Parameters<typeof undiciFetch>[1]) as unknown as Promise<Response>;
  };
}
