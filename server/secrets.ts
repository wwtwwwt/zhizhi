import { chmodSync, existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

export type SecretCodec = { encode: (text: string) => string; decode: (text: string) => string };
export class Secrets {
  readonly path: string;
  constructor(dir: string, private codec?: SecretCodec) { this.path = join(dir, 'secrets.json'); }
  read(): { modelKeys?: Record<string, string> } {
    if (!existsSync(this.path)) return {};
    const text = readFileSync(this.path, 'utf8');
    return JSON.parse(this.codec ? this.codec.decode(text) : text);
  }
  write(value: { modelKeys?: Record<string, string> }) {
    const text = JSON.stringify(value);
    writeFileSync(this.path, this.codec ? this.codec.encode(text) : text, { mode: 0o600 });
    chmodSync(this.path, 0o600);
  }
}
