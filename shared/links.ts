/** Only public HTTP(S) pages may enter the isolated reader. */
export function readerUrl(value: string): string | null {
  try {
    const url = new URL(value), host = url.hostname.toLowerCase();
    if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password || !host.includes('.') || host.endsWith('.local') || host.endsWith('.localhost')) return null;
    if (/^\d+\.\d+\.\d+\.\d+$/.test(host)) {
      const [a,b] = host.split('.').map(Number);
      if (a===0 || a===10 || a===127 || a>=224 || a===169 && b===254 || a===172 && b>=16 && b<=31 || a===192 && b===168 || a===100 && b>=64 && b<=127) return null;
    }
    return url.href;
  } catch { return null; }
}
