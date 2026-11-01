import {test,expect} from 'vitest';
import {mkdtemp, mkdir, writeFile, symlink, rm} from 'node:fs/promises';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {readLocalDocument} from '../server/local-document';

test('native document picker reads only referenced images within the selected document folder',async()=>{
  const dir=await mkdtemp(join(tmpdir(),'zhizhi-local-'));
  try{
    const root=join(dir,'paper');await mkdir(join(root,'assets'),{recursive:true});
    await writeFile(join(root,'assets','图 1.png'),Buffer.from([1,2,3]));await writeFile(join(dir,'outside.png'),'private');
    await symlink(join(dir,'outside.png'),join(root,'escape.png'));
    const markdown='# 论文\n\n![图](assets/图%201.png)\n\n![重复](assets/图%201.png)\n\n![外部](../outside.png)\n\n![链接逃逸](escape.png)\n\n![缺图](missing.png)\n\n![远程](https://example.com/remote.png)';
    await writeFile(join(root,'paper.md'),markdown);
    const doc=await readLocalDocument(join(root,'paper.md'));
    expect(doc).toEqual({name:'paper.md',markdown,resources:[{path:'assets/图 1.png',data:'AQID'}]});
    await writeFile(join(root,'large.md'),Buffer.alloc(2*1024*1024+1));
    await expect(readLocalDocument(join(root,'large.md'))).rejects.toThrow('2 MiB');
  }finally{await rm(dir,{recursive:true,force:true});}
});
