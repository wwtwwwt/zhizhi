import { readFile, realpath, stat } from 'node:fs/promises';
import { basename, dirname, relative, resolve, isAbsolute } from 'node:path';
import { imageNodes, resourcePath, type DocumentImport } from '../shared/documents';

// Only the document selected through the native picker can be read. Image
// symlinks and ../ references may not escape its containing directory.
export async function readLocalDocument(path: string): Promise<DocumentImport> {
  const root = await realpath(dirname(path));
  if ((await stat(path)).size > 2 * 1024 * 1024) throw new Error('Markdown 文件最多 2 MiB');
  const markdown = new TextDecoder('utf-8', {fatal:true}).decode(await readFile(path));
  const resources: DocumentImport['resources'] = []; let total = 0;
  const refs = new Set(imageNodes(markdown).map(node => node.url || '').filter(url => !/^https?:|^data:/i.test(url)));
  for (const ref of refs) {
    const local = resourcePath(ref); if (!local) continue;
    let target: string;
    try {
      target = await realpath(resolve(root, decodeURIComponent(ref.split(/[?#]/)[0])));
      const within = relative(root, target);
      if (within.startsWith('..') || isAbsolute(within)) continue;
      const info = await stat(target); if (!info.isFile()) continue;
      if (info.size > 5 * 1024 * 1024 || total + info.size > 12 * 1024 * 1024) throw new Error('单张图片最多 5 MiB，总计最多 12 MiB');
      total += info.size;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code || error instanceof URIError) continue;
      throw error;
    }
    resources.push({path:local,data:(await readFile(target)).toString('base64')});
  }
  return {name:basename(path),markdown,resources};
}
