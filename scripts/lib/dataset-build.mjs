import { createHash } from 'node:crypto';
import { readdirSync,readFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import path from 'node:path';
import { ROOT } from './paths.mjs';
export function datasetBuildIdentity(){
  const hash=createHash('sha256');
  function walk(dir){for(const entry of readdirSync(dir,{withFileTypes:true}).sort((a,b)=>a.name.localeCompare(b.name))){const file=path.join(dir,entry.name);if(entry.isDirectory())walk(file);else if(file.endsWith('.ts')){hash.update(path.relative(ROOT,file).replaceAll('\\','/'));hash.update(readFileSync(file));}}}
  walk(path.join(ROOT,'src/main/services/dataset'));walk(path.join(ROOT,'src/shared'));
  for(const file of ['src/main/services/providers/transport.ts','src/main/services/providers/probe.ts','src/main/services/canonical.ts'])hash.update(readFileSync(path.join(ROOT,file)));
  let commit='unknown';try{commit=execFileSync('git',['rev-parse','HEAD'],{cwd:ROOT,encoding:'utf8'}).trim();if(execFileSync('git',['status','--porcelain','--','src','scripts'],{cwd:ROOT,encoding:'utf8'}).trim())commit+='+dirty';}catch{/* Source hash remains usable for source ZIP builds without Git. */}
  return {sourceHash:hash.digest('hex'),commit};
}
