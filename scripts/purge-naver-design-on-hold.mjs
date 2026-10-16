import { readFile,writeFile,mkdir,readdir } from 'node:fs/promises';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { createClient } from '@supabase/supabase-js';
import { PURGE_TABLES,planPortfolioPurge,storageReferences } from '../lib/portfolio/purge-plan.mjs';
const args=process.argv.slice(2),option=name=>{const i=args.indexOf(name);return i<0?null:args[i+1];};
const execute=args.includes('--execute');
for(let i=0;i<args.length;i++){if(['--snapshot','--env-file','--approval'].includes(args[i]))i++;else if(!['--execute','--dry-run'].includes(args[i]))throw new Error(`Unknown option ${args[i]}`);}
if(execute&&args.includes('--dry-run'))throw new Error('Choose one mode');
if(execute&&option('--snapshot'))throw new Error('스냅샷 모드에서는 삭제할 수 없습니다.');
if(option('--env-file'))process.loadEnvFile(option('--env-file'));
let db;
async function liveSnapshot(){
 if(!process.env.NEXT_PUBLIC_SUPABASE_URL||!process.env.SUPABASE_SERVICE_ROLE_KEY)throw new Error('읽기용 서버 접속 설정이 없습니다. --snapshot으로 저장된 조회 결과를 검토할 수 있습니다.');
 db=createClient(process.env.NEXT_PUBLIC_SUPABASE_URL,process.env.SUPABASE_SERVICE_ROLE_KEY,{auth:{persistSession:false,autoRefreshToken:false}});
 const snapshot={};
 for(const table of PURGE_TABLES){snapshot[table]=[];for(let offset=0;;offset+=500){const {data,error}=await db.from(table).select('*').order('id').range(offset,offset+499);if(error)throw error;snapshot[table].push(...data);if(data.length<500)break;}}
 // Enumerate the rendered bucket, including unfinished mockup uploads.
 snapshot.storage_objects=[];
 async function list(prefix=''){for(let offset=0;;offset+=100){const {data,error}=await db.storage.from('portfolio-rendered').list(prefix,{limit:100,offset,sortBy:{column:'name',order:'asc'}});if(error)throw error;for(const item of data){const name=prefix?`${prefix}/${item.name}`:item.name;if(item.id)snapshot.storage_objects.push({bucket_id:'portfolio-rendered',name});else await list(name);}if(data.length<100)break;}}
 await list();return snapshot;
}
let snapshot;
if(option('--snapshot')){snapshot={};for(const file of await readdir(option('--snapshot')))if(file.endsWith('.json'))snapshot[file.slice(0,-5)]=JSON.parse(await readFile(path.join(option('--snapshot'),file),'utf8'));}
else snapshot=await liveSnapshot();
const plan=planPortfolioPurge(snapshot);
const stamp=new Date().toISOString().replaceAll(':','-');
const backupDir=path.resolve('.codex-tmp',`purge-backup-${stamp}`);
await mkdir(backupDir,{recursive:true});
const raw=JSON.stringify(plan.backup,null,2),hash=createHash('sha256').update(raw).digest('hex');
await writeFile(path.join(backupDir,'rows.json'),raw,{flag:'wx'});
const cell=value=>'"'+String(typeof value==='object'?JSON.stringify(value):value??'').replace(/^[=+@-]/,"'$&").replaceAll('"','""')+'"';
const columns=['id','title','status','reason','missing_fonts','last_errors','storage_paths'];
await writeFile(path.join(backupDir,'summary.csv'),'\ufeff'+[columns.join(','),...plan.summary.map(row=>columns.map(key=>cell(row[key])).join(','))].join('\r\n'),{flag:'wx'});
await writeFile(path.join(backupDir,'plan.json'),JSON.stringify({...plan,backup:undefined,backupSha256:hash},null,2),{flag:'wx'});
if(createHash('sha256').update(await readFile(path.join(backupDir,'rows.json'))).digest('hex')!==hash)throw new Error('백업 검증 실패');
console.log(JSON.stringify({mode:execute?'execute':'dry-run',count:plan.workIds.length,items:plan.summary.map(({id,title,status})=>({id,title,status})),storageFiles:plan.storageFiles.length,retainedSets:plan.retainedSetIds,backupDir},null,2));
if(execute){
 if(!option('--approval'))throw new Error('검토한 dry-run과 배포 확인 후 작성한 --approval 파일이 필요합니다.');
 const approval=JSON.parse(await readFile(option('--approval'),'utf8'));
 if(approval.productionUrl!=='https://www.woolimcompany.kr')throw new Error('운영 사이트 URL이 일치하지 않습니다.');
 if(approval.backupSha256!==hash)throw new Error('승인한 백업과 최신 대상 행이 다릅니다. 최신 dry-run을 다시 검토해 주세요.');
 if(approval.approved!==true||!Array.isArray(approval.workIds)||JSON.stringify([...approval.workIds].sort())!==JSON.stringify([...plan.workIds].sort()))throw new Error('승인 대상과 최신 정리 대상이 다릅니다.');
 const remote=execFileSync('git',['ls-remote','origin','refs/heads/main'],{encoding:'utf8'}).split(/\s/)[0];
 if(remote!==approval.mainCommit)throw new Error('승인한 main 커밋과 현재 원격 main이 다릅니다.');
 const release=await fetch(new URL('/api/portfolio-automation-version',approval.productionUrl),{signal:AbortSignal.timeout(10000)});
 const version=await release.json();
 if(!release.ok||version.version!=='project-dedupe-v1'||version.environment!=='production'||version.commit!==remote)throw new Error('작업 1~5의 main 운영 배포를 확인하지 못했습니다.');
 const {data,error}=await db.rpc('purge_naver_design_on_hold',{p_snapshot:plan.backup,p_retained_set_ids:plan.retainedSetIds});
 if(error)throw error;
 await writeFile(path.join(backupDir,'db-receipt.json'),JSON.stringify(data,null,2),{flag:'wx'});
 const remainingReferences=storageReferences(await liveSnapshot());
 if(plan.storageFiles.some(file=>remainingReferences.has(`${file.bucket}/${file.path}`)))throw new Error('삭제 예정 파일에 새 참조가 생겨 저장소 삭제를 중단했습니다.');
 // Only exact pre-audited paths; never remove a whole bucket or a source file.
 const failures=[];
 for(let index=0;index<plan.storageFiles.length;index+=100){const files=plan.storageFiles.slice(index,index+100);const {error}=await db.storage.from('portfolio-rendered').remove(files.map(file=>file.path));if(error)failures.push({paths:files,message:error.message});}
 await writeFile(path.join(backupDir,'storage-receipt.json'),JSON.stringify({failures},null,2),{flag:'wx'});
 if(failures.length)throw new Error('DB 정리는 완료됐지만 저장소 삭제 일부가 실패했습니다. storage-receipt.json을 확인하세요.');
 const {count,error:verifyError}=await db.from('content_work_items').select('id',{count:'exact',head:true}).eq('channel','naver_design').eq('status','on_hold');
 if(verifyError||count!==0)throw new Error('정리 후 보류 0건을 확인하지 못했습니다.');
 console.log('보류 0건 확인. 제작은 시작하지 않았습니다.');
}
