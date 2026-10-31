import { build } from 'esbuild';
import { copyFile, mkdir } from 'node:fs/promises';
await mkdir('dist-electron', {recursive:true});
await build({entryPoints:['electron/main.ts'],outdir:'dist-electron',bundle:true,platform:'node',target:'node24',format:'esm',packages:'external'});
await copyFile('server/schema.sql','dist-electron/schema.sql');
