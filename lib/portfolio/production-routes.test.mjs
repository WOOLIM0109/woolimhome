import assert from 'node:assert/strict';
import test from 'node:test';
import vm from 'node:vm';
import {readFile} from 'node:fs/promises';
import ts from 'typescript';
import * as sessionDomain from './production-session.ts';
import * as imageDomain from './image-set.ts';
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
  '@/lib/portfolio/production-descriptor':{validateProductionDescriptor:options.descriptor||(()=>({})),productionSetManifest:()=>{throw Error('UNEXPECTED_MANIFEST_BUILD')}},
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
