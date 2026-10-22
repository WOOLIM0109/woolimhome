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
  const writes=[],downloads=[],storageDownloads=[],failures=new Map(),noThumbnail=new Set(),hashes=new Map(); let rejectWrite=false,refreshes=0,afterDownload;
  const db={storage:{from(bucket){return {async download(path){storageDownloads.push({bucket,path});return {data:new Blob([path]),error:null};}};}},from(table){const filters=[];let patch,upserts,upsertOptions,range;
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
  const client={DriveFileDownloadError:DownloadError,async accessToken(){refreshes++;},async downloadSharedDriveFile(_root,id){downloads.push(id);await afterDownload?.(id);if(failures.has(id))throw failures.get(id);return new Response(id);}};
  const cache=new Map();
  function load(file){const path=resolve(file);if(cache.has(path))return cache.get(path);const exports={};cache.set(path,exports);
    const dependencies={'@/lib/content-ops/data':{contentAdmin:()=>db},'../naver-works/client':client,
      './client':client,jszip:{loadAsync:async data=>{const id=Buffer.from(data).toString();return {id,files:noThumbnail.has(id)?{}:{thumb:{name:'docProps/thumbnail.png',async:async()=>Buffer.from(id)}}};}},
      './source-fonts':{readPptxSourceFonts:async()=>['Arial']},'./image-fingerprint':{fingerprintPortfolioImage:async b=>({visualHash:hashes.get(b.toString())||(b.toString()==='alpha'?'0f0f0f0f0f0f0f0f':'f0f0f0f0f0f0f0f0')})}};
    const code=ts.transpileModule(readFileSync(path,'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022,esModuleInterop:true}}).outputText;
    vm.runInNewContext(code,{exports,require(name){if(name in dependencies)return dependencies[name];const next=name.startsWith('@/')?resolve(name.slice(2)):resolve(dirname(path),name);return load(next.endsWith('.ts')?next:`${next}.ts`);},Buffer,Date,Error,Response,console:{warn(){},info(){}}});return exports;
  }
  const inventory=load('lib/portfolio/dedupe-inventory.ts'),sync=load('lib/naver-works/drive-sync.ts');
  client.driveFileFingerprint=file=>file.fileId;client.supportedPortfolioFile=load('lib/naver-works/source-file.ts').supportedPortfolioFile;
  return {tables,writes,downloads,storageDownloads,failures,noThumbnail,hashes,DownloadError,inventory,sync,load,client,get refreshes(){return refreshes;},afterDownload(fn){afterDownload=fn;},rejectWrite:()=>{rejectWrite=true;}};
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

test('preview does not download uninspected sources, refresh OAuth, or write',async()=>{
  const h=harness();h.failures.set('alpha',new h.DownloadError(404));const before=JSON.stringify(h.tables);
  const result=await h.inventory.readPortfolioDedupeInventory(4,{readOnly:true});
  assert.equal(result.sourceFailures.length,0);assert.equal(result.accepted.length,0);assert.equal(h.downloads.length,0);assert.equal(h.refreshes,0);
  assert.equal(result.metrics.remaining,2);assert.ok(result.candidates.every(row=>row.metadata.inspectionState==='pending'));
  assert.equal(h.writes.length,0);assert.equal(JSON.stringify(h.tables),before);
});

test('an expired deadline starts no sources, but still reuses every saved inspection',async()=>{
  const h=harness();await h.inventory.readPortfolioDedupeInventory(4,{candidateId:'candidate-alpha'});
  const result=await h.inventory.readPortfolioDedupeInventory(4,{deadlineAt:Date.now()-1});
  assert.deepEqual(h.downloads,['alpha']);assert.equal(h.refreshes,1);assert.equal(result.metrics.cached,1);
  assert.equal(result.metrics.total,2);assert.equal(result.metrics.inspected,1);assert.equal(result.metrics.remaining,1);
  assert.equal(result.metrics.deadlineReached,true);assert.equal(result.accepted.length,1);
  assert.equal(result.accepted[0].metadata.inspectionState,'passed');
});

test('in-flight sources finish after the deadline and the next call resumes without redownload',async()=>{
  const h=harness(['alpha','bravo','charlie']);let deadline=Date.now()+10000;
  h.afterDownload(()=>{deadline=Date.now()-1;});
  // A shared options getter lets the transport stub advance only the deadline, without real sleeps.
  const options={get deadlineAt(){return deadline;}};
  const first=await h.inventory.readPortfolioDedupeInventory(0,options);
  assert.equal(h.downloads.length,2);assert.equal(first.metrics.remaining,1);assert.equal(first.metrics.deadlineReached,true);
  h.afterDownload(undefined);const second=await h.inventory.readPortfolioDedupeInventory(0);
  assert.equal(h.downloads.length,3);assert.equal(second.metrics.cached,2);assert.equal(second.metrics.remaining,0);
});

test('inspection follows descending project rank and stops at eight accepted sources',async()=>{
  const names=Array.from({length:12},(_,i)=>`project${String(i).padStart(2,'0')}`),h=harness(names);
  const hashes=['6996699669966996','a55aa55aa55aa55a','f0f00f0ff0f00f0f','55aa55aa55aa55aa','cccc3333cccc3333','9696696996966969','33cc33cc33cc33cc','0ff00ff00ff00ff0','c3c33c3cc3c33c3c','ff0000ffff0000ff','6666999966669999','5a5aa5a55a5aa5a5'];
  names.forEach((name,i)=>{h.hashes.set(name,hashes[i]);h.tables.portfolio_candidates[i].quality_score=i*10;});
  const result=await h.inventory.readPortfolioDedupeInventory(0);
  assert.equal(result.accepted.length,h.inventory.PORTFOLIO_INSPECTION_TARGET_ACCEPTED);
  assert.equal(h.downloads.length,8);assert.deepEqual(h.downloads,names.slice(4).reverse());
  assert.equal(result.metrics.remaining,4);
});

test('eight cached sources outside approved folders do not prevent inspecting a selectable pending source',async()=>{
  const names=['alpha','bravo','charlie','delta','echo','foxtrot','golf','hotel','india'],h=harness(names);
  const hashes=['6996699669966996','a55aa55aa55aa55a','f0f00f0ff0f00f0f','55aa55aa55aa55aa','cccc3333cccc3333','9696696996966969','33cc33cc33cc33cc','0ff00ff00ff00ff0','c3c33c3cc3c33c3c'];
  names.forEach((name,i)=>h.hashes.set(name,hashes[i]));
  await h.inventory.readPortfolioDedupeInventory(0);
  assert.equal(h.downloads.length,8);
  for(const file of h.tables.naver_works_drive_files.filter(file=>file.id!=='india'))file.file_path=`레퍼런스/${file.file_name}`;
  const result=await h.inventory.readPortfolioDedupeInventory(0);
  assert.deepEqual(h.downloads,names);assert.equal(result.metrics.cached,8);
  // The inspection scheduling gate changes; the existing duplicate evidence and
  // final acceptance output still contain all nine nonduplicate sources.
  assert.equal(result.accepted.length,9);
  const selected=h.load('lib/naver-works/portfolio-selection.ts').selectPortfolioCandidate(result.accepted);
  assert.equal(selected.selected.candidate.id,'candidate-india');
});

test('pending, no preview, large and failed sources have distinct inspection states',async()=>{
  const h=harness(['alpha','bravo','charlie','delta']);h.noThumbnail.add('alpha');
  h.tables.naver_works_drive_files[1].file_size=101*1024*1024;h.failures.set('charlie',new h.DownloadError(404));
  await h.inventory.readPortfolioDedupeInventory(4,{candidateId:'candidate-alpha'});
  const result=await h.inventory.readPortfolioDedupeInventory(4,{candidateId:'candidate-charlie'});
  const states=Object.fromEntries(result.candidates.map(row=>[row.id,row.metadata.inspectionState]));
  assert.deepEqual(states,{'candidate-alpha':'no_preview','candidate-bravo':'too_large','candidate-charlie':'failed','candidate-delta':'pending'});
  assert.equal(result.metrics.skippedLarge,1);assert.equal(result.metrics.failed,1);assert.equal(result.metrics.remaining,1);
  assert.ok(h.downloads.every(name=>name!=='bravo'&&name!=='delta'));
});

test('preview reuses saved inspections without writing or refreshing and targeted inspection keeps all duplicate evidence',async()=>{
  const h=harness();await h.inventory.readPortfolioDedupeInventory(4,{candidateId:'candidate-alpha'});
  const before=JSON.stringify(h.tables),writes=h.writes.length,refreshes=h.refreshes;
  const preview=await h.inventory.readPortfolioDedupeInventory(4,{readOnly:true});
  assert.equal(preview.metrics.cached,1);assert.equal(preview.accepted.length,1);assert.equal(h.refreshes,refreshes);
  assert.equal(h.writes.length,writes);assert.equal(JSON.stringify(h.tables),before);assert.deepEqual(h.downloads,['alpha']);
  h.tables.portfolio_publication_ledger.push({id:'published',title:'published',normalized_project_name:'bravo',representative_hashes:[]});
  const targeted=await h.inventory.readPortfolioDedupeInventory(4,{candidateId:'candidate-bravo'});
  assert.deepEqual(h.downloads,['alpha','bravo']);assert.ok(!targeted.accepted.some(row=>row.id==='candidate-bravo'));
  assert.match(targeted.decisions.find(row=>row.candidate.id==='candidate-bravo').reason,/중복/);
});

test('cached inspection preserves the same name, publication, visual and font decisions as the complete evidence input',async()=>{
  const h=harness(['alpha','bravo','charlie','delta','echo','foxtrot']);
  const values=['6996699669966996','a55aa55aa55aa55a','f0f00f0ff0f00f0f','55aa55aa55aa55aa','cccc3333cccc3333','9696696996966969'];
  h.tables.portfolio_candidates.forEach((row,i)=>h.hashes.set(row.drive_file_id,values[i]));
  await h.inventory.readPortfolioDedupeInventory(0);
  const rows=h.tables.portfolio_candidates;
  rows[1].project_name='alpha';rows[3].status='processed';
  rows[4].metadata.representativeHashes=[values[3]];rows[4].metadata.sourceInspection.representativeHashes=[values[3]];
  rows[5].metadata.sourceFonts=['Söhne'];rows[5].metadata.sourceInspection.sourceFonts=['Söhne'];
  h.tables.portfolio_publication_ledger.push({id:'publication',title:'published charlie',normalized_project_name:'charlie',representative_hashes:[]});
  const complete=rows.map(row=>({...structuredClone(row),naver_works_drive_files:structuredClone(h.tables.naver_works_drive_files.find(file=>file.id===row.drive_file_id))}));
  const expected=h.load('lib/portfolio/project-dedupe.ts').inspectPortfolioDuplicates(complete,[{id:'publication',title:'published charlie',normalizedName:'charlie',url:'undefined',hashes:[]}],0);
  const actual=await h.inventory.readPortfolioDedupeInventory(0,{readOnly:true,deadlineAt:Date.now()-1});
  const decision=check=>({id:check.candidate.id,name:check.normalizedName,score:check.duplicateScore,match:check.match?.id,distance:check.distance,reason:check.reason});
  assert.equal(JSON.stringify(actual.decisions.map(decision)),JSON.stringify(expected.decisions.map(decision)));
  assert.equal(JSON.stringify(actual.accepted.map(row=>row.id)),JSON.stringify(expected.accepted.map(row=>row.id)));
  assert.equal(h.downloads.length,6);
});

test('a targeted inspection retains completed conversion images as active-project duplicate evidence',async()=>{
  const h=harness();h.tables.portfolio_candidates[0].status='processed';h.hashes.set('bravo','0f0f0f0f0f0f0f0f');
  h.tables.content_jobs.push({id:'conversion',candidate_id:'candidate-alpha',job_type:'convert',status:'completed',updated_at:'2026-10-01',result:{bucket:'portfolio-rendered',slidePaths:['alpha']}});
  const result=await h.inventory.readPortfolioDedupeInventory(0,{candidateId:'candidate-bravo'});
  assert.deepEqual(h.downloads,['bravo']);assert.deepEqual(h.storageDownloads,[{bucket:'portfolio-rendered',path:'alpha'}]);
  assert.equal(result.accepted.length,0);assert.match(result.decisions[0].reason,/중복: alpha/);
});

test('inspection state rejects blank hashes and does not carry a source failure across file revisions',async()=>{
  const h=harness(['alpha']);await h.inventory.readPortfolioDedupeInventory(4);
  const candidate={...h.tables.portfolio_candidates[0],naver_works_drive_files:h.tables.naver_works_drive_files[0]};
  const source=h.load('lib/portfolio/source-inspection.ts');
  candidate.metadata.sourceInspection.representativeHashes=['0000000000000000'];
  assert.equal(source.sourceInspectionState(candidate),'no_preview');
  candidate.metadata.sourceInspection=null;candidate.metadata.sourceInspectionFailure=source.sourceInspectionFailure(candidate.id,candidate.naver_works_drive_files,404,'download');
  assert.equal(source.sourceInspectionState(candidate),'failed');
  candidate.naver_works_drive_files.modified_at='2026-10-03';assert.equal(source.sourceInspectionState(candidate),'pending');
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
