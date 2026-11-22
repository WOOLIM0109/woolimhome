import assert from 'node:assert/strict';
import test from 'node:test';
import vm from 'node:vm';
import {readFile} from 'node:fs/promises';
import ts from 'typescript';
import * as domain from './production-session.ts';
import {LOCAL_REDACTION_MANIFEST_METHOD} from './redaction-proof.ts';

const id='11111111-1111-4111-8111-111111111111',candidate='22222222-2222-4222-8222-222222222222';
function fixture(){
 const item={id,format:'portfolio',status:'review_required',updated_at:'2026-09-07T12:00:00.000Z',metadata:{candidateId:candidate,generated:{bodyHtml:'<p>기존 원고</p>'},portfolioMockup:{selectedSlideIndexes:[0]}}};
 const source={originalFileName:'source.pptx',bucket:'portfolio-sources',storagePath:'private/source.pptx'};
 return {item,source,session:{id:'33333333-3333-4333-8333-333333333333',work_item_id:id,candidate_id:candidate,binding:domain.createMockupSessionBinding(item,candidate,source)}};
}
async function server(f,options={}){
 const signed=[],calls=[],sessions=options.sessions||[];
 const jobs=options.jobs??[{id:'download',candidate_id:f.item.metadata.candidateId,job_type:'download',status:'completed',result:f.source}];
 const db={from(table){const query={table,op:'read',filters:[]},chain={};
  for(const key of ['select','eq','in','order','limit','update','insert'])chain[key]=(...args)=>{query.filters.push([key,...args]);if(['update','insert'].includes(key)){query.op=key;query.value=args[0];}return chain;};
  const result=(single=false)=>{
   calls.push(query);const override=options.query?.(query);if(override)return Promise.resolve(override);
   let rows=table==='content_work_items'?[f.item]:table==='content_jobs'?jobs:sessions;
   for(const [method,key,value] of query.filters){if(method==='eq')rows=rows.filter(row=>row[key]===value);if(method==='in')rows=rows.filter(row=>value.includes(row[key]));if(method==='limit')rows=rows.slice(0,key);}
   if(query.op==='update'){
    if(table!=='content_work_items')throw Error('UNEXPECTED_UPDATE');
    if(rows.length){f.item={...f.item,...query.value};rows=[f.item];}
   }
   if(query.op==='insert'){if(table!=='portfolio_mockup_sessions')throw Error('UNEXPECTED_INSERT');sessions.push(query.value);rows=[];}
   return Promise.resolve({data:single?rows[0]??null:rows,error:null});
  };
  chain.maybeSingle=()=>result(true);chain.then=(ok,fail)=>result().then(ok,fail);return chain;},
  storage:{from(bucket){return {createSignedUrl:async(path)=>{signed.push({bucket,path});return {data:{signedUrl:'https://storage.invalid/signed'},error:null};}};}}};
 const source=await readFile(new URL('./production-session-server.ts',import.meta.url),'utf8'),exports={};
 const modules={'server-only':{},'node:crypto':{randomUUID:()=>f.session.id},'@/lib/content-ops/data':{contentAdmin:()=>db},'@/lib/naver-works/client':{sharedDriveDownloadAuthorization:()=>{throw Error('NO_DRIVE')}},'./production-session':domain};
 const code=ts.transpileModule(source,{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText;
 vm.runInNewContext(code,{exports,require:name=>{if(!(name in modules))throw Error(`UNEXPECTED_IMPORT ${name}`);return modules[name];},URL});
 return {api:exports,signed,calls,sessions};
}

const selected=(query,columns)=>query.filters.some(([method,value])=>method==='select'&&value===columns);
const json=value=>JSON.parse(JSON.stringify(value));

test('usable metadata candidate IDs take precedence without looking up linked jobs',async()=>{
 const f=fixture(),other='44444444-4444-4444-8444-444444444444';
 const {api,calls}=await server(f,{jobs:[{candidate_id:other,work_item_id:id},{candidate_id:candidate,job_type:'download',status:'completed',result:f.source}]});
 assert.equal((await api.readMockupSource(id)).binding.candidateId,candidate);
 assert.equal(calls.some(query=>selected(query,'candidate_id')),false);
});

test('missing and malformed candidate IDs recover one distinct valid candidate from this work item',async()=>{
 for(const missing of [undefined,null,'not-a-uuid',42]){
  const f=fixture();f.item.metadata.candidateId=missing;
  const jobs=[{candidate_id:candidate,work_item_id:id},{candidate_id:candidate,work_item_id:id},{candidate_id:null,work_item_id:id},{candidate_id:'44444444-4444-4444-8444-444444444444',work_item_id:'another-work-item'},{candidate_id:candidate,job_type:'download',status:'completed',result:f.source}];
  const {api,calls}=await server(f,{jobs});
  assert.equal((await api.readMockupSource(id)).binding.candidateId,candidate);
  const lookup=calls.find(query=>selected(query,'candidate_id'));
  assert.ok(lookup.filters.some(([method,key,value])=>method==='eq'&&key==='work_item_id'&&value===id));
  assert.equal(calls.some(query=>query.op!=='read'),false);
 }
});

test('ambiguous, absent and unreadable job links fail before looking for a download',async()=>{
 const cases=[
  {jobs:[]},
  {jobs:[{candidate_id:null,work_item_id:id}]},
  {jobs:[{candidate_id:candidate,work_item_id:id},{candidate_id:'44444444-4444-4444-8444-444444444444',work_item_id:id}]},
  {query:query=>selected(query,'candidate_id')?{data:null,error:{message:'unavailable'}}:null},
 ];
 for(const options of cases){
  const f=fixture();delete f.item.metadata.candidateId;const {api,calls}=await server(f,options);
  await assert.rejects(api.readMockupSource(id),/MOCKUP_SOURCE_NOT_CONNECTED/);
  assert.equal(calls.some(query=>selected(query,'result')),false);
 }
});

test('recovered candidates still require a completed download',async()=>{
 const f=fixture();delete f.item.metadata.candidateId;
 const {api,calls}=await server(f,{jobs:[{candidate_id:candidate,work_item_id:id,job_type:'download',status:'running',result:f.source}]});
 await assert.rejects(api.readMockupSource(id),/MOCKUP_SOURCE_NOT_CONNECTED/);
 const download=calls.find(query=>selected(query,'result'));
 for(const [key,value] of [['candidate_id',candidate],['job_type','download'],['status','completed']])assert.ok(download.filters.some(([method,column,expected])=>method==='eq'&&column===key&&expected===value));
 assert.equal(calls.some(query=>query.op!=='read'),false);
});

test('request repairs only the recovered metadata link and binds the queued session to the saved revision',async()=>{
 const f=fixture();delete f.item.metadata.candidateId;f.item.metadata.statusHistory=[{status:'on_hold',reason:'그대로 보존'}];f.item.metadata.holdCleared={by:'admin'};
 const before=structuredClone(f.item),{api,calls,sessions}=await server(f,{jobs:[{candidate_id:candidate,work_item_id:id,job_type:'download',status:'completed',result:f.source}]});
 const result=await api.requestProductionMockup(id,'admin');
 assert.equal(result.reused,false);assert.equal(result.expectedUpdatedAt,f.item.updated_at);
 assert.deepEqual(json(f.item.metadata),{...before.metadata,candidateId:candidate});assert.equal(f.item.status,before.status);
 const writes=calls.filter(query=>query.op!=='read');assert.equal(writes.length,2);assert.equal(writes[0].table,'content_work_items');assert.equal(writes[1].table,'portfolio_mockup_sessions');
 assert.ok(writes[0].filters.some(([method,key,value])=>method==='eq'&&key==='updated_at'&&value===before.updated_at));
 assert.deepEqual(Object.keys(writes[0].value).sort(),['metadata','updated_at']);
 assert.equal(sessions[0].candidate_id,candidate);assert.equal(sessions[0].binding.expectedMetadataHash,domain.canonicalHash(f.item.metadata));assert.equal(sessions[0].binding.expectedUpdatedAt,f.item.updated_at);
 assert.equal(sessions[0].binding.imageInputsHash,domain.mockupImageInputsHash(before.metadata));
 calls.length=0;await api.readMockupSource(id);assert.equal(calls.some(query=>selected(query,'candidate_id')),false);
});

test('request repairs recovered links even when reusing an open session',async()=>{
 const f=fixture();delete f.item.metadata.candidateId;
 const {api,calls}=await server(f,{jobs:[{candidate_id:candidate,work_item_id:id,job_type:'download',status:'completed',result:f.source}],sessions:[{id:f.session.id,work_item_id:id,status:'review'}]});
 const result=await api.requestProductionMockup(id,'admin');
 assert.equal(result.reused,true);assert.equal(result.id,f.session.id);assert.equal(f.item.metadata.candidateId,candidate);
 assert.equal(calls.filter(query=>query.op==='update').length,1);assert.equal(calls.some(query=>query.op==='insert'),false);
});

test('request with an existing metadata link never writes the work item',async()=>{
 const f=fixture(),{api,calls}=await server(f);await api.requestProductionMockup(id,'admin');
 assert.equal(calls.some(query=>query.op==='update'),false);assert.equal(calls.filter(query=>query.op==='insert').length,1);
});

test('repair failures and concurrent edits stop session creation without replacing metadata',async()=>{
 for(const failure of [{data:null,error:{message:'write failed'}},{data:null,error:null}]){
  const f=fixture();delete f.item.metadata.candidateId;const before=structuredClone(f.item);
  const {api,calls}=await server(f,{jobs:[{candidate_id:candidate,work_item_id:id,job_type:'download',status:'completed',result:f.source}],query:query=>query.op==='update'?failure:null});
  await assert.rejects(api.requestProductionMockup(id,'admin'),/MOCKUP_WORK_ITEM_REVISION_CONFLICT/);
  assert.deepEqual(f.item,before);assert.equal(calls.some(query=>query.op==='insert'),false);
 }
});

test('published work and running jobs block candidate repair and new sessions',async()=>{
 for(const published of [true,false]){
  const f=fixture();delete f.item.metadata.candidateId;if(published)f.item.status='published';
  const jobs=[{candidate_id:candidate,work_item_id:id,job_type:'download',status:'completed',result:f.source},...published?[]:[{candidate_id:candidate,work_item_id:id,job_type:'convert',status:'pc_running'}]];
  const {api,calls}=await server(f,{jobs});
  await assert.rejects(api.requestProductionMockup(id,'admin'),new RegExp(published?'MOCKUP_PUBLISHED_LOCKED':'MOCKUP_EXISTING_JOB_RUNNING'));
  assert.equal(calls.some(query=>query.op!=='read'),false);
 }
});
test('source authorization keeps prepared images usable after writing, timestamp and queue status edits',async()=>{
 const f=fixture();f.item.metadata.generated.bodyHtml='<p>다시 쓴 원고</p>';f.item.updated_at='2026-09-07T13:00:00.000Z';f.item.status='approved';
 const {api,signed}=await server(f),result=await api.authorizeSessionSource(f.session);
 assert.equal(result.sourceUrl,'https://storage.invalid/signed');assert.equal(result.sourceBindingHash,f.session.binding.sourceBindingHash);assert.equal(signed.length,1);
});
test('source authorization blocks source, selection, redaction, active set and publication changes before download access',async()=>{
 const cases=[
  [f=>f.source.storagePath='private/changed.pptx','MOCKUP_SOURCE_OR_MANUSCRIPT_CHANGED'],
  [f=>f.item.metadata.candidateId='44444444-4444-4444-8444-444444444444','MOCKUP_SOURCE_OR_MANUSCRIPT_CHANGED'],
  [f=>f.item.metadata.portfolioMockup.selectedSlideIndexes=[1],'MOCKUP_IMAGE_INPUTS_CHANGED'],
  [f=>f.item.metadata.redactionProof={verified:false},'MOCKUP_REDACTION_PROOF_REQUIRED'],
  [f=>{f.item.metadata.portfolioAssets=[{kind:'body_image',url:'/later-manual.png',slideIndexes:[0]}];f.item.metadata.manualMockupOverride={approvedBy:'another-admin'};},'MOCKUP_IMAGE_INPUTS_CHANGED'],
  [f=>f.item.metadata.portfolioImageSet={activeSetId:'44444444-4444-4444-8444-444444444444'},'IMAGE_SET_REVISION_CONFLICT'],
  [f=>f.item.status='published','MOCKUP_PUBLISHED_LOCKED'],
 ];
 for(const [mutate,error] of cases){const f=fixture();mutate(f);const {api,signed}=await server(f);await assert.rejects(api.authorizeSessionSource(f.session),new RegExp(error));assert.equal(signed.length,0);}
});
test('even unchanged session inputs cannot certify an invalid current redaction proof',async()=>{
 const f=fixture();f.item.metadata.portfolioSourceFingerprint='a'.repeat(64);f.item.metadata.redactionProof={verified:false};
 f.session.binding=domain.createMockupSessionBinding(f.item,candidate,f.source);
 const {api,signed}=await server(f);await assert.rejects(api.authorizeSessionSource(f.session),/MOCKUP_REDACTION_PROOF_REQUIRED/);assert.equal(signed.length,0);
});
test('current redaction proof covers the thumbnail and all body slides even when body selection omits the thumbnail slide',async()=>{
 const f=fixture();f.item.metadata.portfolioAssets=[{kind:'thumbnail',url:'/thumb.png',slideIndexes:[0]},{kind:'body_image',url:'/body.png',slideIndexes:[1]}];
 f.item.metadata.portfolioMockup.selectedSlideIndexes=[1];f.item.metadata.portfolioSourceFingerprint='a'.repeat(64);
 f.item.metadata.redactionProof={version:2,method:LOCAL_REDACTION_MANIFEST_METHOD,verified:true,sourceFingerprint:'a'.repeat(64),manifestHash:'b'.repeat(64),slides:[0,1].map(slideIndex=>({slideIndex,sourceHash:'c'.repeat(64),redactedHash:'c'.repeat(64),regionCount:0,changedPixelRatio:0}))};
 f.session.binding=domain.createMockupSessionBinding(f.item,candidate,f.source);f.item.metadata.generated.bodyHtml='<p>고친 원고</p>';
 const {api}=await server(f);assert.equal((await api.authorizeSessionSource(f.session)).workItemId,id);
});
test('older unchanged sessions work while edited sessions without retained image input evidence fail closed',async()=>{
 const f=fixture();delete f.session.binding.imageInputsHash;delete f.session.binding.expectedActiveSetId;
 const {api}=await server(f);assert.equal((await api.authorizeSessionSource(f.session)).workItemId,id);
 f.item.metadata.generated.bodyHtml='<p>수정 원고</p>';await assert.rejects(api.authorizeSessionSource(f.session),/MOCKUP_IMAGE_INPUTS_UNVERIFIABLE/);
});
