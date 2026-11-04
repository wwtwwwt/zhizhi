import { build } from 'esbuild';
import { copyFile, mkdir } from 'node:fs/promises';
await mkdir('dist-electron', {recursive:true});
await build({entryPoints:['electron/main.ts'],outdir:'dist-electron',bundle:true,platform:'node',target:'node24',format:'esm',packages:'external',define:{__ZHIZHI_VERSION__:JSON.stringify(process.env.ZHIZHI_RELEASE_TAG || '')}});
await copyFile('server/schema.sql','dist-electron/schema.sql');
