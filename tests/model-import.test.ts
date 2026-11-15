import { expect, test } from 'vitest';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { readModelImports, ModelImportCache } from '../server/model-import';

test('imports explicit Claude/Codex credentials and profiles, keeps secrets off the UI, binds keys to source connection',async()=>{
  const home=mkdtempSync(join(tmpdir(),'zhizhi-import-'));
  mkdirSync(join(home,'.claude'));mkdirSync(join(home,'.codex'));
  try{
    writeFileSync(join(home,'.claude','settings.json'),JSON.stringify({env:{ANTHROPIC_BASE_URL:'https://claude.example',ANTHROPIC_AUTH_TOKEN:'claude-test'},model:'claude-test-model',apiKeyHelper:'must-never-execute'}));
    writeFileSync(join(home,'.codex','config.toml'),'model = "gpt-test"\nmodel_provider = "proxy"\n[model_providers.proxy]\nbase_url = "https://codex.example/v1"\nwire_api = "responses"\nrequires_openai_auth = true\n[profiles.fast]\nmodel = "gpt-fast"\n');
    writeFileSync(join(home,'.codex','auth.json'),JSON.stringify({OPENAI_API_KEY:'codex-test',tokens:{access_token:'never-import-oauth'}}));
    const candidates=await readModelImports(home,{});
    expect(candidates).toHaveLength(3);expect(candidates[0]).toMatchObject({source:'Claude Code',authType:'bearer',apiType:'messages',apiKey:'claude-test'});
    expect(candidates[2]).toMatchObject({source:'Codex · fast',model:'gpt-fast',apiType:'responses',apiKey:'codex-test'});
    const cache=new ModelImportCache(()=>Promise.resolve(candidates)),publicSources=await cache.list();
    expect(JSON.stringify(publicSources)).not.toContain('claude-test"');expect(JSON.stringify(publicSources)).not.toContain('codex-test"');expect(JSON.stringify(publicSources)).not.toContain('never-import-oauth');
    expect(cache.resolve(publicSources[0].id,publicSources[0].baseUrl,'messages','bearer')).toBe('claude-test');
    expect(()=>cache.resolve(publicSources[0].id,'https://wrong.example','messages','bearer')).toThrow('已修改');
    expect(()=>cache.resolve('missing',publicSources[0].baseUrl,'messages','bearer')).toThrow('已过期');
    writeFileSync(join(home,'.claude','settings.json'),JSON.stringify({env:{ANTHROPIC_BASE_URL:'https://claude.example',ANTHROPIC_AUTH_TOKEN:'${MISSING}'}}));
    writeFileSync(join(home,'.codex','auth.json'),JSON.stringify({tokens:{access_token:'never-import-oauth'}}));
    expect(await readModelImports(home,{})).toEqual([]);
    writeFileSync(join(home,'.codex','config.toml'),'model = "local"\nmodel_provider="proxy"\n[model_providers.proxy]\nbase_url="https://proxy.example/v1"\nenv_key="TEST_SECRET"\nwire_api="chat"');
    expect((await readModelImports(home,{TEST_SECRET:'env-test'}))[0]).toMatchObject({apiKey:'env-test',apiType:'chat'});
    writeFileSync(join(home,'.claude','settings.json'),'null');
    writeFileSync(join(home,'.codex','config.toml'),'malformed = [');
    writeFileSync(join(home,'.codex','auth.json'),'[]');
    expect(await readModelImports(home,{})).toEqual([]);
  }finally{rmSync(home,{recursive:true,force:true});}
});
