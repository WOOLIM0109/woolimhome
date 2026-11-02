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
async function server(f){
 const signed=[];
 const db={from(table){const chain={};for(const key of ['select','eq','order','limit'])chain[key]=()=>chain;
  const result=()=>Promise.resolve({data:table==='content_work_items'?f.item:[{result:f.source}],error:null});
  chain.maybeSingle=result;chain.then=(ok,fail)=>result().then(ok,fail);return chain;},
  storage:{from(bucket){return {createSignedUrl:async(path)=>{signed.push({bucket,path});return {data:{signedUrl:'https://storage.invalid/signed'},error:null};}};}}};
 const source=await readFile(new URL('./production-session-server.ts',import.meta.url),'utf8'),exports={};
 const modules={'server-only':{},'node:crypto':{randomUUID:()=>{throw Error('NO_INSERT')}},'@/lib/content-ops/data':{contentAdmin:()=>db},'@/lib/naver-works/client':{sharedDriveDownloadAuthorization:()=>{throw Error('NO_DRIVE')}},'./production-session':domain};
 const code=ts.transpileModule(source,{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText;
 vm.runInNewContext(code,{exports,require:name=>{if(!(name in modules))throw Error(`UNEXPECTED_IMPORT ${name}`);return modules[name];},URL});
 return {api:exports,signed};
}
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
