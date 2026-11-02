import assert from 'node:assert/strict';
import test from 'node:test';
import vm from 'node:vm';
import {readFile} from 'node:fs/promises';
import ts from 'typescript';
import * as sessionDomain from './production-session.ts';
import * as imageDomain from './image-set.ts';
import {productionSetManifest} from './production-descriptor.ts';
import {productionDescriptorFixture} from './production-descriptor.test-support.mjs';
const work='11111111-1111-4111-8111-111111111111',sid='22222222-2222-4222-8222-222222222222',candidate='33333333-3333-4333-8333-333333333333';
const context={params:Promise.resolve({id:work})};
const request=(body,origin='https://unit.invalid')=>new Request(`https://unit.invalid/api/admin/content/${work}/mockup-session`,{method:'POST',headers:{'Content-Type':'application/json',Origin:origin},body:JSON.stringify(body)});
function fakeDb(handler){
 const calls=[];return {calls,from(table){const q={table,op:'read',filters:[]};const chain={};
  for(const name of ['select','eq','in','gte','order','limit','update','insert'])chain[name]=(...args)=>{q.filters.push([name,...args]);if(['update','insert'].includes(name)){q.op=name;q.value=args[0];}return chain;};
  const result=()=>{calls.push(q);return Promise.resolve(handler(q));};chain.maybeSingle=result;chain.single=result;chain.then=(ok,fail)=>result().then(ok,fail);return chain;},
  rpc:async(name,args)=>{calls.push({op:'rpc',name,args});return handler({op:'rpc',name,args});}};
}
async function route(db,options={}){
 const source=await readFile(new URL('../../app/api/admin/content/[id]/mockup-session/route.ts',import.meta.url),'utf8');
 const exports={};const modules={
  'next/server':{NextResponse:{json:(value,init={})=>new Response(JSON.stringify(value),{...init,headers:{'Content-Type':'application/json',...init.headers}})}},
  '@/lib/content-ops/data':{authenticatedAdmin:async()=>options.unauthorized?null:{id:'admin'},contentAdmin:()=>db},
  '@/lib/portfolio/production-session':sessionDomain,
  '@/lib/portfolio/production-session-server':{
   requestProductionMockup:options.create||(()=>{throw Error('UNEXPECTED_CREATE')}),
   readMockupSource:options.source||(()=>{throw Error('UNEXPECTED_SOURCE_READ')}),
   sameOriginMutation:r=>{if(r.headers.get('origin')!==new URL(r.url).origin||!r.headers.get('content-type')?.startsWith('application/json'))throw Error('MOCKUP_ORIGIN_INVALID');},
   publicMockupError:e=>/^(MOCKUP|IMAGE_SET|THUMBNAIL)_[A-Z0-9_]+$/.test(e.message)?e.message:'MOCKUP_OPERATION_FAILED'},
  '@/lib/portfolio/production-descriptor':{validateProductionDescriptor:options.descriptor||(()=>({})),productionSetManifest:options.manifest||(()=>{throw Error('UNEXPECTED_MANIFEST_BUILD')})},
  '@/lib/portfolio/production-storage':{verifyProductionObjects:options.verify||(()=>{throw Error('UNEXPECTED_STORAGE_READ')})},
  '@/lib/portfolio/image-set':imageDomain};
 const code=ts.transpileModule(source,{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText;
 vm.runInNewContext(code,{exports,require:name=>{if(!(name in modules))throw Error(`UNEXPECTED_IMPORT ${name}`);return modules[name];},Request,Response,URL,Buffer,structuredClone});return exports;
}
test('admin route rejects unauthenticated reads and writes before DB/storage/worker work',async()=>{
 const db=fakeDb(()=>{throw Error('DB_FORBIDDEN')}),api=await route(db,{unauthorized:true});
 assert.equal((await api.GET(new Request('https://unit.invalid/'),context)).status,401);
 assert.equal((await api.POST(request({action:'create'}),context)).status,401);assert.equal(db.calls.length,0);
});
test('cross-origin or extra browser fields cannot enqueue or supply a source path',async()=>{
 const db=fakeDb(()=>{throw Error('DB_FORBIDDEN')}),api=await route(db);
 const wrong=await api.POST(request({action:'create'},'https://attacker.invalid'),context);
 assert.equal((await wrong.json()).error,'MOCKUP_ORIGIN_INVALID');
 const extra=await api.POST(request({action:'create',sourcePath:'C:/private/source.pptx'}),context);
 assert.equal((await extra.json()).error,'MOCKUP_REQUEST_INVALID');assert.equal(db.calls.length,0);
});
test('explicit create forwards only authenticated actor and work ID to separate session queue',async()=>{
 let inputs;const db=fakeDb(()=>{throw Error('DB_FORBIDDEN')});const api=await route(db,{create:async(...args)=>{inputs=args;return{id:sid,status:'queued',reused:false};}});
 const response=await api.POST(request({action:'create'}),context);assert.equal(response.status,200);assert.deepEqual(inputs,[work,'admin']);assert.equal(db.calls.length,0);assert.match(response.headers.get('cache-control'),/no-store/);
});
test('cancel changes only the specific session with revision/status guards, never manuscript state',async()=>{
 const db=fakeDb(q=>({data:q.op==='update'?{id:sid}:{id:sid,work_item_id:work,status:'review',updated_at:'revision'},error:null})),api=await route(db);
 const response=await api.POST(request({action:'cancel',sessionId:sid}),context);assert.equal(response.status,200);
 const changes=db.calls.filter(q=>q.op!=='read');assert.equal(changes.length,1);assert.equal(changes[0].table,'portfolio_mockup_sessions');
 assert.ok(changes[0].filters.some(([name,key,value])=>name==='eq'&&key==='updated_at'&&value==='revision'));assert.equal(changes[0].value.local_review_url,null);
});
test('activation without explicit inspection cannot read storage or invoke atomic RPC',async()=>{
 const db=fakeDb(()=>({data:{id:sid,status:'staged',descriptor_hash:'a'.repeat(64)},error:null}));const api=await route(db);
 const response=await api.POST(request({action:'activate',sessionId:sid,snapshotHash:'a'.repeat(64),outputInspected:false}),context);
 assert.equal((await response.json()).error,'MOCKUP_EXPLICIT_REVIEW_REQUIRED');assert.equal(db.calls.filter(q=>q.op!=='read').length,0);
});
test('reopening requests a new one-use local connection without enqueuing conversion or changing images',async()=>{
 const db=fakeDb(q=>({data:q.op==='update'?{id:sid}:{id:sid,status:'review',updated_at:'revision'},error:null})),api=await route(db);
 const response=await api.POST(request({action:'reopen',sessionId:sid}),context);
 assert.deepEqual(await response.json(),{reopenRequested:true,sessionId:sid});
 const changes=db.calls.filter(q=>q.op!=='read');assert.equal(changes.length,1);assert.equal(changes[0].table,'portfolio_mockup_sessions');
 assert.equal(changes[0].value.local_review_url,null);assert.ok(changes[0].value.reopen_requested_at);assert.equal('status' in changes[0].value,false);
 assert.ok(changes[0].filters.some(([method,name,values])=>method==='in'&&name==='status'&&values.join(',')==='review,uploading'));
});
test('source changes after staging stop full-set activation without touching the old complete set',async()=>{
 const item={id:work,format:'portfolio',updated_at:'revision',metadata:{generated:{title:'원고',bodyHtml:'원래 본문',faq:['유지']}}};
 const staged={id:sid,work_item_id:work,candidate_id:candidate,status:'staged',descriptor_hash:'a'.repeat(64),binding:{expectedMetadataHash:sessionDomain.canonicalHash(item.metadata),expectedUpdatedAt:'revision',sourceBindingHash:'b'.repeat(64)}};
 const before=structuredClone(item),db=fakeDb(q=>({data:q.table==='content_work_items'?item:staged,error:null}));let checked=0;
 const api=await route(db,{verify:async()=>{checked++;},source:async()=>({binding:{candidateId:candidate,sourceBindingHash:'c'.repeat(64)}})});
 const response=await api.POST(request({action:'activate',sessionId:sid,snapshotHash:'a'.repeat(64),outputInspected:true}),context);
 assert.equal((await response.json()).error,'MOCKUP_SOURCE_OR_MANUSCRIPT_CHANGED');assert.equal(checked,1);assert.equal(db.calls.filter(q=>q.op!=='read').length,0);assert.deepEqual(item,before);
});

function stagedFixture(){
 const f=productionDescriptorFixture();
 f.initial.id=work;f.initial.metadata.candidateId=candidate;f.initial.published_url=null;
 f.session.id=sid;f.session.work_item_id=work;f.session.candidate_id=candidate;f.session.status='staged';
 f.session.binding={...sessionDomain.createMockupSessionBinding(f.initial,candidate,f.source),version:sessionDomain.MOCKUP_BRIDGE_VERSION};
 return f;
}
function stagedRoute(f,handler){
 const db=fakeDb(q=>q.op==='rpc'?handler(q):{data:q.table==='content_work_items'?f.initial:f.session,error:null});
 return route(db,{descriptor:()=>f.descriptor,manifest:productionSetManifest,verify:async()=>{},source:async()=>({binding:sessionDomain.createMockupSessionBinding(f.initial,candidate,f.source)})}).then(api=>({api,db}));
}
test('writing-only edits after staging rebind four images onto the current manuscript and keep current CAS',async()=>{
 const f=stagedFixture(),oldRevision=f.initial.updated_at;
 f.initial.updated_at='2026-09-07T13:00:00.000Z';f.initial.status='approved';
 f.initial.title='나중에 고친 제목';f.initial.metadata.generated.bodyHtml=f.initial.metadata.generated.bodyHtml.replaceAll('기존 설명 문단입니다.','다시 쓴 본문입니다.');
 f.initial.metadata.generated.faq=[{question:'현재 질문',answer:'현재 답변'}];
 const before=structuredClone(f.initial);let committed;
 const {api}=await stagedRoute(f,q=>{committed=q.args;return {data:{workItemId:work,activeSetId:sid,updatedAt:f.initial.updated_at},error:null};});
 const response=await api.POST(request({action:'activate',sessionId:sid,snapshotHash:f.session.descriptor_hash,outputInspected:true}),context);
 assert.equal(response.status,200);assert.notEqual(committed.p_expected_updated_at,oldRevision);assert.equal(committed.p_expected_updated_at,f.initial.updated_at);
 assert.deepEqual(committed.p_expected_metadata,before.metadata);assert.equal(committed.p_expected_active_set_id,null);
 assert.equal(sessionDomain.protectedManuscriptHash({...f.initial,metadata:committed.p_next_metadata}),sessionDomain.protectedManuscriptHash(before));
 for(const [index,asset] of committed.p_manifest.assets.slice(1).entries())assert.ok(committed.p_next_metadata.generated.bodyHtml.includes(asset.url.replaceAll('&','&amp;')),`BODY ${index+1}`);
 assert.equal(committed.p_next_metadata.generated.bodyHtml.includes('/legacy-'),false);assert.deepEqual(f.initial,before);
});
test('changed selection, changed redaction, replaced active set and published work never reach the activation RPC',async()=>{
 const cases=[
  [f=>f.initial.metadata.portfolioMockup={selectedSlideIndexes:[99]},'MOCKUP_IMAGE_INPUTS_CHANGED'],
  [f=>f.initial.metadata.redactionProof={verified:false},'MOCKUP_REDACTION_PROOF_REQUIRED'],
  [f=>{f.initial.metadata.portfolioAssets[1].url='/later-manual.png';f.initial.metadata.manualMockupOverride={approvedBy:'other-admin',approvedAt:f.now};},'MOCKUP_IMAGE_INPUTS_CHANGED'],
  [f=>f.initial.metadata.portfolioImageSet={activeSetId:'44444444-4444-4444-8444-444444444444'},'IMAGE_SET_REVISION_CONFLICT'],
  [f=>f.initial.status='published','MOCKUP_PUBLISHED_LOCKED'],
 ];
 for(const [mutate,error] of cases){
  const f=stagedFixture();mutate(f);const {api,db}=await stagedRoute(f,()=>{throw Error('RPC_FORBIDDEN');});
  const response=await api.POST(request({action:'activate',sessionId:sid,snapshotHash:f.session.descriptor_hash,outputInspected:true}),context);
  assert.equal((await response.json()).error,error);assert.equal(db.calls.some(q=>q.op==='rpc'),false);
 }
});
test('older sessions without image input evidence explain why an edited manuscript cannot be safely rebound',async()=>{
 const f=stagedFixture();delete f.session.binding.imageInputsHash;delete f.session.binding.expectedActiveSetId;
 f.initial.metadata.generated.bodyHtml+='<p>나중에 쓴 문장</p>';
 const {api,db}=await stagedRoute(f,()=>{throw Error('RPC_FORBIDDEN');});
 const response=await api.POST(request({action:'activate',sessionId:sid,snapshotHash:f.session.descriptor_hash,outputInspected:true}),context);
 assert.equal((await response.json()).error,'MOCKUP_IMAGE_INPUTS_UNVERIFIABLE');assert.equal(db.calls.some(q=>q.op==='rpc'),false);
});
