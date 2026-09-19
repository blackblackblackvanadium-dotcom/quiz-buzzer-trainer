import { createHash } from 'node:crypto';
import { mkdir, readFile, stat, writeFile } from 'node:fs/promises';
import { resolve, join } from 'node:path';

const mode=process.argv[2];
const app=resolve(process.argv[3]??'app');
const evidence=resolve(process.argv[4]??'evidence');
const target=process.argv[5]??'';
const runId=process.env.GITHUB_RUN_ID??'local';

async function sha256(path){const b=await readFile(path);return createHash('sha256').update(b).digest('hex');}
async function writeJson(path,value){await mkdir(resolve(path,'..'),{recursive:true});await writeFile(path,JSON.stringify(value,null,2)+'\n');}
function match(text,re,label){const m=text.match(re);if(!m)throw new Error(`Unable to resolve ${label}`);return m[1];}

if(mode==='ac20'){
  const pkg=JSON.parse(await readFile(join(app,'package.json'),'utf8'));
  const dbSrc=await readFile(join(app,'src/data/db.ts'),'utf8');
  const backupSrc=await readFile(join(app,'src/backup/backup.ts'),'utf8');
  const lockSha=await sha256(join(app,'package-lock.json'));
  const dbSchemaVersion=Number(match(dbSrc,/DB_SCHEMA_VERSION\s*=\s*(\d+)/u,'DB_SCHEMA_VERSION'));
  const appVersion=match(backupSrc,/APP_VERSION\s*=\s*'([^']+)'/u,'APP_VERSION');
  const questionDataVersion=match(backupSrc,/QUESTION_DATA_VERSION\s*=\s*'([^']+)'/u,'QUESTION_DATA_VERSION');
  const identity={targetCommit:target,appVersion,packageVersion:pkg.version,dbSchemaVersion,questionDataVersion,packageLockSha256:lockSha,githubActionsRunId:runId};
  const build={...identity,node:process.version,builtAt:new Date().toISOString(),installMode:'npm ci',source:'exact production checkout'};
  const release={...identity,migrationStatus:'PENDING_AC11',rollbackCompatibility:'PENDING_AC18',knownIssues:[],productionSrcModified:false};
  await writeJson(join(evidence,'AC-20/release-identity.json'),identity);
  await writeJson(join(evidence,'AC-20/build-metadata.json'),build);
  await writeJson(join(evidence,'AC-20/release-metadata.json'),release);
  await writeJson(join(evidence,'AC-20/ac20-report.json'),{ac:'AC-20',pass:target.length===40&&lockSha.length===64&&appVersion===pkg.version&&Number.isInteger(dbSchemaVersion)&&questionDataVersion.length>0,identity});
}
else if(mode==='ac19'){
  const manifestPath=join(app,'dist/manifest.webmanifest');
  const manifest=JSON.parse(await readFile(manifestPath,'utf8'));
  const required=['name','short_name','start_url','scope','display','theme_color','background_color','icons'];
  const missing=required.filter(k=>manifest[k]===undefined);
  const iconResults=[];
  for(const icon of manifest.icons??[]){
    const rel=String(icon.src??'').replace(/^\//u,'');
    const p=join(app,'dist',rel);
    let ok=true,size=0;try{size=(await stat(p)).size;}catch{ok=false;}
    iconResults.push({src:icon.src,sizes:icon.sizes,type:icon.type,purpose:icon.purpose,exists:ok,size});
  }
  const pass=missing.length===0&&manifest.name==='Quiz Buzzer Trainer'&&manifest.short_name==='QBT'&&manifest.start_url==='/'&&manifest.scope==='/'&&manifest.display==='standalone'&&typeof manifest.theme_color==='string'&&typeof manifest.background_color==='string'&&iconResults.length>0&&iconResults.every(x=>x.exists&&x.size>0);
  await writeJson(join(evidence,'AC-19/ac19-manifest.json'),manifest);
  await writeJson(join(evidence,'AC-19/ac19-manifest-validation.json'),{ac:'AC-19',pass,missing,iconResults,navigation:{startUrl:manifest.start_url,scope:manifest.scope,withinScope:manifest.start_url.startsWith(manifest.scope)}});
  if(!pass)process.exitCode=1;
}
else{throw new Error(`Unknown mode: ${mode}`);}
