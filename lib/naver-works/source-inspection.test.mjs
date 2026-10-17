import assert from 'node:assert/strict';
import test from 'node:test';
import {readFileSync} from 'node:fs';
import {resolve,dirname} from 'node:path';
import vm from 'node:vm';
import ts from 'typescript';

// Real inventory, selection, cache policy and crawler; only persistence/transport/image parsing are stubbed.
function harness(names=['alpha','bravo']) {
  const tables={portfolio_candidates:[],naver_works_drive_files:[],portfolio_publication_ledger:[],portfolio_image_sets:[],content_jobs:[],content_work_items:[],
    portfolio_automation_control:[{id:true,first_run_approved:true,hash_threshold:4}],naver_works_drive_roots:[{id:'root',last_synced_at:'2026-07-01'}]};
  for(const name of names){
    tables.naver_works_drive_files.push({id:name,root_id:'root',external_file_id:name,file_name:`${name}.pptx`,file_path:`완성본_외부공유금지/PPT/${name}.pptx`,file_extension:'pptx',file_size:100,
      modified_at:'2026-10-01',last_seen_at:'2026-07-01',supported:true,naver_works_drive_roots:{external_drive_id:'drive'}});
    tables.portfolio_candidates.push({id:`candidate-${name}`,drive_file_id:name,project_name:name,project_key:name,status:'candidate',metadata:{},updated_at:'2026-10-01',quality_score:80});
  }
  const writes=[],downloads=[],failures=new Map(),noThumbnail=new Set(); let rejectWrite=false;
  const db={from(table){const filters=[];let patch,upserts,upsertOptions,range;
    const q={select(){return q;},eq(k,v){filters.push(r=>r[k]===v);return q;},in(k,v){filters.push(r=>v.includes(r[k]));return q;},lt(k,v){filters.push(r=>r[k]<v);return q;},is(k,v){return q.eq(k,v);},order(){return q;},limit(n){range=[0,n-1];return q;},range(a,b){range=[a,b];return q;},
      update(v){patch=v;return q;},upsert(rows,options){upserts=rows;upsertOptions=options;return q;},
      async single(){const r=await execute();return {...r,data:r.data?.[0]??null};},async maybeSingle(){return q.single();},then(yes,no){return execute().then(yes,no);}};
    async function execute(){
      let rows=tables[table].filter(r=>filters.every(f=>f(r)));
      if(patch){writes.push({table,patch:structuredClone(patch)});if(rejectWrite)return {data:null,error:{message:'DB unavailable'}};rows.forEach(r=>Object.assign(r,structuredClone(patch)));}
      if(upserts){rows=[];for(const input of upserts){let row=tables[table].find(r=>(upsertOptions.onConflict.split(',')).every(k=>r[k]===input[k]));if(!row){row={id:`new-${table}-${tables[table].length}`,...structuredClone(input)};tables[table].push(row);}else if(!upsertOptions.ignoreDuplicates)Object.assign(row,structuredClone(input));rows.push(row);}writes.push({table,upserts:upserts.length});}
      if(range)rows=rows.slice(range[0],range[1]+1);
      return {error:null,data:rows.map(row=>structuredClone(table==='portfolio_candidates'?{...row,naver_works_drive_files:tables.naver_works_drive_files.find(f=>f.id===row.drive_file_id)}:row))};
    }
    return q;
  }};
  class DownloadError extends Error {constructor(httpStatus,stage='download'){super('sensitive signed URL must never be saved');this.httpStatus=httpStatus;this.stage=stage;}}
  const client={DriveFileDownloadError:DownloadError,async accessToken(){},async downloadSharedDriveFile(_root,id){downloads.push(id);if(failures.has(id))throw failures.get(id);return new Response(id);}};
  const cache=new Map();
  function load(file){const path=resolve(file);if(cache.has(path))return cache.get(path);const exports={};cache.set(path,exports);
    const dependencies={'@/lib/content-ops/data':{contentAdmin:()=>db},'../naver-works/client':client,
      './client':client,jszip:{loadAsync:async data=>{const id=Buffer.from(data).toString();return {id,files:noThumbnail.has(id)?{}:{thumb:{name:'docProps/thumbnail.png',async:async()=>Buffer.from(id)}}};}},
      './source-fonts':{readPptxSourceFonts:async()=>['Arial']},'./image-fingerprint':{fingerprintPortfolioImage:async b=>({visualHash:b.toString()==='alpha'?'0f0f0f0f0f0f0f0f':'f0f0f0f0f0f0f0f0'})}};
    const code=ts.transpileModule(readFileSync(path,'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022,esModuleInterop:true}}).outputText;
    vm.runInNewContext(code,{exports,require(name){if(name in dependencies)return dependencies[name];const next=name.startsWith('@/')?resolve(name.slice(2)):resolve(dirname(path),name);return load(next.endsWith('.ts')?next:`${next}.ts`);},Buffer,Date,Error,Response,console:{warn(){},info(){}}});return exports;
  }
  const inventory=load('lib/portfolio/dedupe-inventory.ts'),sync=load('lib/naver-works/drive-sync.ts');
  client.driveFileFingerprint=file=>file.fileId;client.supportedPortfolioFile=load('lib/naver-works/source-file.ts').supportedPortfolioFile;
  return {tables,writes,downloads,failures,noThumbnail,DownloadError,inventory,sync,load,client,rejectWrite:()=>{rejectWrite=true;}};
}

test('one 404 excludes only that source, retains safe diagnostics, and selects the next source',async()=>{
  const h=harness();h.failures.set('alpha',new h.DownloadError(404));
  const result=await h.inventory.readPortfolioDedupeInventory(4);
  assert.deepEqual(Array.from(result.accepted,c=>c.id),['candidate-bravo']);
  const bad=h.tables.portfolio_candidates[0];assert.equal(bad.status,'excluded');assert.equal(bad.exclusion_reasons[0],'원본 확인 필요: HTTP 404');
  const failure=bad.metadata.sourceInspectionFailure;
  assert.equal(failure.candidateId,bad.id);assert.equal(failure.driveFileId,'alpha');assert.equal(failure.fileName,'alpha.pptx');assert.equal(failure.httpStatus,404);
  assert.ok(!JSON.stringify(failure).includes('sensitive'));assert.equal(h.tables.content_jobs.length,0);
  assert.equal(result.metrics.downloaded,2);assert.equal(result.metrics.failed,1);
});

test('all failed candidates persist exclusions and return an explicit selection failure without creating jobs',async()=>{
  const h=harness();for(const name of ['alpha','bravo'])h.failures.set(name,new h.DownloadError(404));
  const result=await h.load('lib/naver-works/portfolio-pipeline.ts').prepareNextPortfolioCandidate();
  assert.equal(result.prepared,false);assert.match(result.reason,/후보 2건을 모두 제외/);assert.equal(h.tables.content_jobs.length,0);assert.equal(h.tables.content_work_items.length,0);
});

test('unchanged file reuses fonts and hashes; either size or timestamp change invalidates the cache',async()=>{
  const h=harness(['alpha']);await h.inventory.readPortfolioDedupeInventory(4);
  let result=await h.inventory.readPortfolioDedupeInventory(4);assert.equal(result.metrics.cached,1);assert.equal(h.downloads.length,1);
  h.tables.naver_works_drive_files[0].file_size++;
  await h.inventory.readPortfolioDedupeInventory(4);assert.equal(h.downloads.length,2);
  h.tables.naver_works_drive_files[0].modified_at='2026-10-02';
  await h.inventory.readPortfolioDedupeInventory(4);assert.equal(h.downloads.length,3);
});

test('empty thumbnail result is cached, remains review-required, and never authorizes conversion',async()=>{
  const h=harness(['alpha']);h.noThumbnail.add('alpha');await h.inventory.readPortfolioDedupeInventory(4);
  const result=await h.inventory.readPortfolioDedupeInventory(4);
  assert.equal(h.downloads.length,1);assert.equal(result.accepted.length,0);assert.equal(result.needsImageReview.length,1);
});

test('preview isolates a 404 in memory without persisting failures or successful caches',async()=>{
  const h=harness();h.failures.set('alpha',new h.DownloadError(404));const before=JSON.stringify(h.tables);
  const result=await h.inventory.readPortfolioDedupeInventory(4,{readOnly:true});
  assert.equal(result.sourceFailures.length,1);assert.equal(result.accepted.length,1);assert.equal(h.writes.length,0);assert.equal(JSON.stringify(h.tables),before);
});

test('token failures and DB write errors stop selection instead of relabeling sources as missing',async()=>{
  const h=harness(['alpha']);h.failures.set('alpha',new Error('토큰 갱신 실패'));
  await assert.rejects(h.inventory.readPortfolioDedupeInventory(4),/토큰 갱신 실패/);assert.equal(h.writes.length,0);
  const other=harness(['alpha']);other.rejectWrite();await assert.rejects(other.inventory.readPortfolioDedupeInventory(4),/DB unavailable/);
});

test('complete listing refreshes seen timestamps and excludes absent candidates without touching published/manual exclusions',async()=>{
  const h=harness(['alpha','bravo','published','manual']);h.tables.portfolio_candidates[2].status='processed';h.tables.portfolio_candidates[3].status='excluded';h.tables.portfolio_candidates[3].exclusion_reasons=['이미 블로그에 있음'];
  const result=await h.sync.crawlRoot('root','완성본_외부공유금지/PPT',async()=>({files:[{fileId:'alpha',fileName:'alpha.pptx',fileType:'FILE',fileSize:100}]}),async()=>{throw Error('unexpected');});
  assert.equal(result.complete,true);assert.equal(result.missing.excludedCandidates,1);
  assert.equal(h.tables.portfolio_candidates[1].exclusion_reasons[0],'원본 없음');assert.equal(h.tables.portfolio_candidates[2].status,'processed');assert.equal(h.tables.portfolio_candidates[3].exclusion_reasons[0],'이미 블로그에 있음');
  assert.notEqual(h.tables.naver_works_drive_files[0].last_seen_at,'2026-07-01');assert.equal(h.tables.naver_works_drive_files.length,4);
});

test('truncated listing never records full success or infers missing files',async()=>{
  const h=harness();await assert.rejects(h.sync.crawlRoot('root','완성본_외부공유금지',async()=>({files:[],responseMetaData:{nextCursor:'more'}}),async()=>({files:[]}),5000,0),/DRIVE_SYNC_INCOMPLETE/);
  assert.equal(h.tables.naver_works_drive_roots[0].last_synced_at,'2026-07-01');assert.ok(h.tables.portfolio_candidates.every(c=>c.status==='candidate'));
});

test('crawler follows every page and allowed subfolder, but does not descend into references',async()=>{
  const h=harness([]),calls=[];
  await h.sync.crawlRoot('root','완성본_외부공유금지',async cursor=>{calls.push(cursor||'root');return cursor?{files:[]}:{files:[{fileId:'ppt',fileName:'PPT',fileType:'FOLDER'},{fileId:'ref',fileName:'레퍼런스',fileType:'FOLDER'}],responseMetaData:{nextCursor:'page2'}};},async(id)=>{calls.push(id);return {files:[]};});
  assert.deepEqual(calls,['root','page2','ppt']);
});

test('a failed child listing cannot mark absent files or advance last successful sync',async()=>{
  const h=harness();await assert.rejects(h.sync.crawlRoot('root','완성본_외부공유금지',async()=>({files:[{fileId:'ppt',fileName:'PPT',fileType:'FOLDER'}]}),async()=>{throw Error('HTTP 503');}),/HTTP 503/);
  assert.equal(h.tables.naver_works_drive_roots[0].last_synced_at,'2026-07-01');assert.ok(h.tables.portfolio_candidates.every(c=>c.status==='candidate'));
});

test('sync reads the approved shared drive first instead of spending its budget on unrelated drives',async()=>{
  const h=harness([]),calls=[];
  Object.assign(h.tables.naver_works_drive_roots[0],{connection_id:'primary',drive_type:'shared_drive',external_drive_id:'drive'});
  h.client.listSharedDrives=async()=>({sharedrives:[{name:'unrelated',sharedriveId:'other'},{name:'완성본_외부공유금지',sharedriveId:'drive'}]});
  h.client.listSharedDriveRoot=async id=>{calls.push(id);return {files:[]};};
  const result=await h.sync.syncNaverWorksDrive();assert.deepEqual(calls,['drive']);assert.match(result.note,/목록 전체 확인 완료/);
});
