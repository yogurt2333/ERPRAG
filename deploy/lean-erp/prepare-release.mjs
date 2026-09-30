// Assemble on the workstation: no package installation or build on the small server.
import { cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
const ops=dirname(fileURLToPath(import.meta.url)), repo=resolve(ops,'../..');
const artifacts=join(repo,'artifacts');mkdirSync(artifacts,{recursive:true});
const stage=mkdtempSync(join(artifacts,'lean-erp-release-'));
cpSync(join(repo,'src/erp'),join(stage,'src/erp'),{recursive:true,filter:path=>!path.endsWith('demo.ts')});
cpSync(join(ops,'package.json'),join(stage,'package.json'));
cpSync(join(ops,'package-lock.json'),join(stage,'package-lock.json'));
const lock=JSON.parse(readFileSync(join(stage,'package-lock.json'),'utf8'));
for(const [relative,entry] of Object.entries(lock.packages)) {
  if(!relative)continue;
  if(!relative.startsWith('node_modules/') || relative.includes('..'))throw new Error('Unexpected lock path');
  const source=join(repo,relative);
  if(!existsSync(source))throw new Error(`Run npm ci locally first: missing ${relative}`);
  const pkg=JSON.parse(readFileSync(join(source,'package.json'),'utf8'));
  if(pkg.version!==entry.version)throw new Error(`Runtime lock and local package differ: ${relative}`);
  cpSync(source,join(stage,relative),{recursive:true});
}
function checkPortable(directory) {
  for(const entry of readdirSync(directory,{withFileTypes:true})) {
    const path=join(directory,entry.name);
    if(entry.isDirectory())checkPortable(path);
    else if(/\.(node|exe|dll|so)$/i.test(entry.name))throw new Error(`Native dependency requires a Linux build: ${path}`);
  }
}
checkPortable(join(stage,'node_modules'));
mkdirSync(join(stage,'ops'));
for(const entry of readdirSync(ops)) {
  if(/\.(sh|service|timer|conf)$/.test(entry))cpSync(join(ops,entry),join(stage,'ops',entry));
}
const archive=stage+'.tar.gz';
execFileSync('tar',['-czf',archive,'-C',stage,'.']);
console.log(JSON.stringify({archive,sha256:createHash('sha256').update(readFileSync(archive)).digest('hex'),dependencies:Object.keys(lock.packages).length-1},null,2));
