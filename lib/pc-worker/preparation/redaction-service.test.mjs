import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,readFile,writeFile,rm} from 'node:fs/promises';
import vm from 'node:vm';
import {webcrypto} from 'node:crypto';
import path from 'node:path';
import os from 'node:os';
import sharp from 'sharp';
import {openPreparationWorkStore} from './work-store.ts';
import {initializeLocalRedactions,getLocalRedactionSlide,saveLocalRedactionSlide,renderLocalRedactionSlide,approveLocalRedactionSlide,readSafeRedactedSlide,uploadVerifiedRedactedSlide} from './redaction-service.ts';
import {redactionHash,decodeRedactionPng,OPAQUE_COLOR,renderRedactedPng,pixelRedactionRect,redactionManualEditFingerprint,redactionUncertaintyFingerprint,redactionHolds} from './redaction-renderer.ts';

async function fixture(t,ratio=[16,9]) {
  const root=await mkdtemp(path.join(os.tmpdir(),'woolim-redaction-'));
  t.after(()=>rm(root,{recursive:true,force:true}));
  const store=await openPreparationWorkStore({root});
  const sourceHash=redactionHash('SYNTHETIC ONLY');
  const opened=await store.beginOrResumeBuild({expectedWorkRevision:null,fingerprint:{source:{sha256:sourceHash,bytes:14},conversionSettingsFingerprint:'synthetic',fontFingerprint:'synthetic'}});
  let build=opened.build;const buildId=build.buildId;
  const width=Math.round(400*Math.min(1,ratio[0]/ratio[1])),height=Math.round(400*Math.min(1,ratio[1]/ratio[0]));
  const pixels=Buffer.alloc(width*height*3);for(let i=0;i<pixels.length;i++)pixels[i]=(i*13)%255;
  const png=await sharp(pixels,{raw:{width,height,channels:3}}).png().toBuffer();
  build=await store.completeStage({buildId,stage:'source_inspection',expectedRevision:build.revision,inputFingerprint:'inspection',data:{sourceHash,slides:[1,2].map(n=>({sourceSlideNumber:n,contentHash:redactionHash('slide'+n)}))}});
  build=await store.completeStage({buildId,stage:'preview_generation',expectedRevision:build.revision,inputFingerprint:'preview'});
  build=await store.recordSelection({buildId,expectedRevision:build.revision,expectedSelectionRevision:0,selectionFingerprint:'selection',data:{selected:[1,2],reserves:[],status:'ready_for_local_review'}});
  for(const n of [1,2]) {
    const relativePath=`highres/${n}.png`;await writeFile(await store.prepareArtifactPath(buildId,relativePath),png);
    build=await store.recordArtifact({buildId,key:`highres:${n}`,relativePath,expectedRevision:build.revision});
  }
  await store.completeStage({buildId,stage:'high_resolution_conversion',expectedRevision:build.revision,inputFingerprint:'highres',artifactKeys:['highres:1','highres:2']});
  await store.release();
  const detections=[1,2].map(n=>({sourceSlideNumber:n,sourceHash,slideContentHash:redactionHash('slide'+n),candidates:[{id:'email-1',rect:{x:.12,y:.2,width:.3,height:.08},category:'email',required:true,reason:'CONTACT_TEXT'}],warnings:['IMAGE_TEXT_REQUIRES_LOCAL_REVIEW']}));
  await initializeLocalRedactions({root,buildId,detections});
  return {root,buildId,sourceSlideNumber:1,png,width,height,detections};
}
async function review(f) {
  let s=await getLocalRedactionSlide(f);
  s=await saveLocalRedactionSlide({...f,expectedRevision:s.revision,regions:s.regions,exceptions:s.exceptions,review:{reviewer:'합성 검수자',originalInspected:true,layoutAcceptable:true}});
  return renderLocalRedactionSlide({...f,expectedRevision:s.revision});
}
async function approve(f) {
  const s=await review(f);
  return approveLocalRedactionSlide({...f,expectedRevision:s.revision,outputHash:s.output.sha256,reviewer:'합성 검수자',outputInspected:true});
}
test('local blur gate requires original review and a separate exact-output approval',async t=>{
  const f=await fixture(t),s=await getLocalRedactionSlide(f);
  await assert.rejects(renderLocalRedactionSlide({...f,expectedRevision:s.revision}),/ORIGINAL_REVIEW_REQUIRED/);
  let r=await review(f);assert.equal(r.status,'rendered');
  await assert.rejects(readSafeRedactedSlide(f),/NOT_APPROVED/);
  assert.ok((await readSafeRedactedSlide(f,{allowUnapproved:true})).length);
  await assert.rejects(approveLocalRedactionSlide({...f,expectedRevision:r.revision,outputHash:'wrong',reviewer:'tester',outputInspected:true}),/OUTPUT_REVIEW/);
  r=await approveLocalRedactionSlide({...f,expectedRevision:r.revision,outputHash:r.output.sha256,reviewer:'tester',outputInspected:true});
  assert.equal(r.status,'verified');assert.equal(redactionHash(await readSafeRedactedSlide(f)),r.output.sha256);
});
test('mandatory masks cannot be weakened or silently removed; public exceptions are explicit',async t=>{
  const f=await fixture(t),s=await getLocalRedactionSlide(f),input={...f,expectedRevision:s.revision,regions:s.regions,exceptions:[],review:{reviewer:'tester',originalInspected:true,layoutAcceptable:true}};
  await assert.rejects(saveLocalRedactionSlide({...input,regions:[{...s.regions[0],mode:'blur'}]}),/MUST_BE_OPAQUE/);
  let r=await saveLocalRedactionSlide({...input,regions:[]});
  await assert.rejects(renderLocalRedactionSlide({...f,expectedRevision:r.revision}),/CANDIDATE_UNRESOLVED/);
  await assert.rejects(saveLocalRedactionSlide({...input,expectedRevision:r.revision,regions:[],exceptions:[{candidateId:'email-1',actor:'',reason:'public'}]}),/ACTOR_AND_REASON/);
  r=await saveLocalRedactionSlide({...input,expectedRevision:r.revision,regions:[],exceptions:[{candidateId:'email-1',actor:'검수자',reason:'공개 허용된 가짜 자료'}]});
  assert.equal((await renderLocalRedactionSlide({...f,expectedRevision:r.revision})).status,'rendered');
});
test('shrunk required rectangle is unresolved and normalized out-of-bounds/zero rectangles reject',async t=>{
  const f=await fixture(t);let s=await getLocalRedactionSlide(f);
  for(const rect of [{x:-.1,y:0,width:.1,height:.1},{x:0,y:0,width:0,height:.1},{x:.9,y:0,width:.2,height:.1},{x:NaN,y:0,width:.1,height:.1}]) {
    await assert.rejects(saveLocalRedactionSlide({...f,expectedRevision:s.revision,regions:[{...s.regions[0],rect}],exceptions:[],review:s.review}),/INVALID_REDACTION_REGION/);
  }
  s=await saveLocalRedactionSlide({...f,expectedRevision:s.revision,regions:[{...s.regions[0],rect:{x:.13,y:.2,width:.1,height:.08}}],exceptions:[],review:{reviewer:'tester',originalInspected:true,layoutAcceptable:true}});
  await assert.rejects(renderLocalRedactionSlide({...f,expectedRevision:s.revision}),/CANDIDATE_UNRESOLVED/);
});
test('all three ratios mask exact pixels and preserve all pixels outside padded rectangles',async t=>{
  for(const ratio of [[16,9],[297,210],[210,297]]) {
    const f=await fixture(t,ratio),s=await review(f),out=await decodeRedactionPng(await readSafeRedactedSlide(f,{allowUnapproved:true})),src=await decodeRedactionPng(f.png);
    const b=pixelRedactionRect(s.regions[0].rect,f.width,f.height);
    for(let y=0;y<f.height;y++)for(let x=0;x<f.width;x++){
      const masked=x>=b.left&&x<b.left+b.width&&y>=b.top&&y<b.top+b.height,p=(y*f.width+x)*4;
      assert.deepEqual([...out.data.subarray(p,p+4)],masked?[...OPAQUE_COLOR]:[...src.data.subarray(p,p+4)]);
    }
    assert.equal(out.width,f.width);assert.equal(out.height,f.height);
  }
});
test('revision conflicts and changed edits invalidate only this slide; restart restores edits',async t=>{
  const f=await fixture(t),s=await approve(f),other=await approve({...f,sourceSlideNumber:2});
  const next=await saveLocalRedactionSlide({...f,expectedRevision:s.revision,regions:[...s.regions,{id:'manual-1',rect:{x:.7,y:.7,width:.1,height:.1},mode:'opaque'}],exceptions:s.exceptions,review:s.review});
  assert.equal(next.output,null);await assert.rejects(readSafeRedactedSlide(f),/NOT_APPROVED/);
  await assert.rejects(saveLocalRedactionSlide({...f,expectedRevision:s.revision,regions:s.regions,exceptions:s.exceptions,review:s.review}),/REVISION_CONFLICT/);
  assert.equal((await getLocalRedactionSlide(f)).regions.length,2);
  assert.equal((await getLocalRedactionSlide({...f,sourceSlideNumber:2})).output.sha256,other.output.sha256);
  assert.ok(await readSafeRedactedSlide({...f,sourceSlideNumber:2}));
  await initializeLocalRedactions({root:f.root,buildId:f.buildId,detections:f.detections});
  assert.equal((await getLocalRedactionSlide(f)).revision,next.revision);
});
test('stub upload receives only approved flattened PNG plus allowlisted IDs, never source or extracted text',async t=>{
  const f=await fixture(t);const oldFetch=globalThis.fetch;globalThis.fetch=()=>{throw new Error('NETWORK_FORBIDDEN');};t.after(()=>globalThis.fetch=oldFetch);
  let calls=0;const transport=async packet=>{calls++;assert.deepEqual(Object.keys(packet).sort(),['kind','workId','buildId','sourceSlideNumber','imageHash','ruleVersion','redactionFingerprint','png'].sort());assert.notDeepEqual(packet.png,f.png);assert.equal(packet.imageHash,redactionHash(packet.png));return{sha256:packet.imageHash};};
  await assert.rejects(uploadVerifiedRedactedSlide(f,transport),/NOT_APPROVED/);assert.equal(calls,0);
  await approve(f);assert.equal((await uploadVerifiedRedactedSlide(f,transport)).cached,false);
  assert.equal((await uploadVerifiedRedactedSlide(f,transport)).cached,true);assert.equal(calls,1);
});
test('upload failure does not retry and the next explicit attempt reuses approved output',async t=>{
  const f=await fixture(t);const s=await approve(f);let calls=0;
  await assert.rejects(uploadVerifiedRedactedSlide(f,async()=>{calls++;throw new Error('STUB_503');}),/STUB_503/);assert.equal(calls,1);
  assert.equal((await getLocalRedactionSlide(f)).output.sha256,s.output.sha256);
  await assert.rejects(uploadVerifiedRedactedSlide(f,async()=>({sha256:'wrong'})),/UPLOAD_HASH_MISMATCH/);
});
test('modified output/source and no-longer-selected slides cannot use old approvals',async t=>{
  const f=await fixture(t),s=await approve(f);const store=await openPreparationWorkStore({root:f.root});
  const b=await store.readBuild(f.buildId),artifact=b.artifacts[s.output.artifactKey];await store.release();
  await writeFile(path.join(f.root,'builds',f.buildId,'artifacts',artifact.relativePath),'CORRUPTED');
  await assert.rejects(readSafeRedactedSlide(f),/OUTPUT_CHANGED/);
  const repaired=await renderLocalRedactionSlide({...f,expectedRevision:s.revision});assert.equal(repaired.status,'rendered');
  const store2=await openPreparationWorkStore({root:f.root}),b2=await store2.readBuild(f.buildId);
  await store2.recordSelection({buildId:f.buildId,expectedRevision:b2.revision,expectedSelectionRevision:b2.selectionRevision,selectionFingerprint:'different',data:{selected:[2],reserves:[],status:'ready_for_local_review'}});await store2.release();
  await assert.rejects(getLocalRedactionSlide(f),/PREPARATION_INCOMPLETE|NOT_SELECTED/);
});
test('layout rejection holds rendering; new detection version/geometry invalidates old edits',async t=>{
  const f=await fixture(t);let s=await approve(f);
  s=await saveLocalRedactionSlide({...f,expectedRevision:s.revision,regions:s.regions,exceptions:[],review:{reviewer:'tester',originalInspected:true,layoutAcceptable:false}});
  assert.equal(s.status,'replacement_required');await assert.rejects(renderLocalRedactionSlide({...f,expectedRevision:s.revision}),/REPLACEMENT/);
  const detections=structuredClone(f.detections);detections[0].candidates[0].rect.width=.4;
  await initializeLocalRedactions({...f,detections});s=await getLocalRedactionSlide(f);assert.equal(s.output,null);assert.equal(s.review.originalInspected,false);
});
test('flat output removes source metadata; opaque mask wins when optional blur overlaps',async t=>{
  const f=await fixture(t);let s=await getLocalRedactionSlide(f);
  const source=await sharp(f.png).withMetadata({exif:{IFD0:{ImageDescription:'SYNTHETIC PRIVATE METADATA'}}}).png().toBuffer();
  s={...s,imageHash:redactionHash(source),review:{reviewer:'tester',originalInspected:true,layoutAcceptable:true},regions:[...s.regions,{id:'blur',rect:{x:.1,y:.1,width:.5,height:.5},mode:'blur'}]};
  const out=await renderRedactedPng(source,s),meta=await sharp(out.png).metadata();
  assert.equal(meta.exif,undefined);assert.equal(meta.icc,undefined);assert.equal(out.png.includes(Buffer.from('SYNTHETIC PRIVATE')),false);
  const alpha=await sharp({create:{width:30,height:30,channels:4,background:{r:1,g:2,b:3,alpha:.5}}}).png().toBuffer();
  await assert.rejects(decodeRedactionPng(alpha),/TRANSPARENT_SOURCE/);
});
test('detector policy cannot downgrade mandatory categories or persist text in diagnostic codes',async t=>{
  const f=await fixture(t);
  for(const mutate of [d=>d.candidates[0].required=false,d=>d.candidates[0].reason='raw private@example.invalid',d=>d.warnings.push('RAW sample 123')]) {
    const d=structuredClone(f.detections[0]);mutate(d);await assert.rejects(initializeLocalRedactions({...f,detections:[d]}),/INVALID_REDACTION/);
  }
  const d=structuredClone(f.detections[0]);d.candidates[0].id='a'.repeat(100);
  await initializeLocalRedactions({...f,detections:[d]});assert.ok((await getLocalRedactionSlide(f)).regions[0].id.length<100);
});
test('incomplete or unlocated extraction cannot be cleared with an arbitrary manual box',async t=>{
  const f=await fixture(t);const d=structuredClone(f.detections[0]);d.warnings.push('REQUIRED_CANDIDATE_GEOMETRY_UNRESOLVED_MANUAL_RECT_REQUIRED');
  await initializeLocalRedactions({...f,detections:[d]});let s=await getLocalRedactionSlide(f);
  s=await saveLocalRedactionSlide({...f,expectedRevision:s.revision,regions:[...s.regions,{id:'arbitrary',rect:{x:0,y:0,width:.1,height:.1},mode:'opaque'}],exceptions:[],review:{reviewer:'tester',originalInspected:true,layoutAcceptable:true}});
  await assert.rejects(renderLocalRedactionSlide({...f,expectedRevision:s.revision}),/INCOMPLETE_DETECTION/);
});
test('excessive mask workload is rejected before rendering',async t=>{
  const f=await fixture(t),s=await getLocalRedactionSlide(f);
  await assert.rejects(saveLocalRedactionSlide({...f,expectedRevision:s.revision,regions:Array.from({length:9},(_,i)=>({id:'huge'+i,rect:{x:0,y:0,width:1,height:1},mode:'opaque'})),exceptions:[],review:s.review}),/COMPLEXITY_LIMIT/);
});
test('hanging upload is bounded, aborts, releases lock and ignores late completion',async t=>{
  const f=await fixture(t);await approve(f);let signal,finish;
  await assert.rejects(uploadVerifiedRedactedSlide(f,async(_,s)=>{signal=s;return new Promise(resolve=>finish=resolve);},{timeoutMs:30}),/UPLOAD_TIMEOUT/);
  assert.equal(signal.aborted,true);const state=await getLocalRedactionSlide(f);assert.equal(state.status,'verified');
  finish({sha256:state.output.sha256});await new Promise(r=>setImmediate(r));
  let calls=0;await uploadVerifiedRedactedSlide(f,async p=>{calls++;return{sha256:p.imageHash};});assert.equal(calls,1);
});

async function uncertainFixture(t, {warnings=[], multiple=false}={}) {
  const f=await fixture(t), detection=structuredClone(f.detections[0]);
  detection.warnings.push(...warnings);
  detection.uncertainties=[{id:'uncertainty-1',candidateId:'email-1',code:'TEXT_RENDER_BOUNDS_UNRESOLVED',rect:structuredClone(detection.candidates[0].rect)}];
  if(multiple)detection.uncertainties.push({...detection.uncertainties[0],id:'uncertainty-2',code:'TEXT_GEOMETRY_UNRESOLVED'});
  await initializeLocalRedactions({...f,detections:[detection]});
  let state=await getLocalRedactionSlide(f);
  state=await saveLocalRedactionSlide({...f,expectedRevision:state.revision,regions:state.regions,exceptions:[],review:{reviewer:'합성 개별 검수자',originalInspected:true,layoutAcceptable:true}});
  return {f,state,detection};
}
function manualResolution(state, uncertainty=state.uncertainties[0], decision='opaque_confirmed') {
  return {uncertaintyId:uncertainty.id,decision,actor:state.review.reviewer,reason:'합성 원본을 실제 크기로 확인하고 해당 영역 전체 범위를 기록함',
    inspectedAtActualSize:true,reviewedRevision:state.revision,sourceHash:state.sourceHash,slideContentHash:state.slideContentHash,imageHash:state.imageHash,
    uncertaintyHash:redactionUncertaintyFingerprint(uncertainty),editHash:redactionManualEditFingerprint(state),
    ...(decision==='opaque_confirmed'?{regionId:state.regions.find(r=>r.candidateId===uncertainty.candidateId).id}:{})};
}
function saveManual(f,state,resolutions) {
  return saveLocalRedactionSlide({...f,expectedRevision:state.revision,regions:state.regions,exceptions:state.exceptions,review:state.review,manualResolutions:resolutions});
}
test('located geometry requires per-item actual-size evidence, not a global checkbox or public exception',async t=>{
  const {f,state}=await uncertainFixture(t,{multiple:true});
  assert.equal(redactionHolds(state).filter(x=>x.startsWith('MANUAL_GEOMETRY')).length,2);
  await assert.rejects(renderLocalRedactionSlide({...f,expectedRevision:state.revision}),/MANUAL_GEOMETRY/);
  const withException={...state,exceptions:[{candidateId:'email-1',actor:'합성 개별 검수자',reason:'기존 공개 예외만으로 위치 검수를 대체할 수 없음'}]};
  assert.equal(redactionHolds(withException).filter(x=>x.startsWith('MANUAL_GEOMETRY')).length,2);
  let current=await saveManual(f,state,[manualResolution(state)]);
  assert.equal(redactionHolds(current).filter(x=>x.startsWith('MANUAL_GEOMETRY')).length,1);
  current=await saveManual(f,current,[...current.manualResolutions,manualResolution(current,current.uncertainties[1])]);
  current=await renderLocalRedactionSlide({...f,expectedRevision:current.revision});
  assert.equal(current.status,'rendered');
  assert.equal(current.output.approvedAt,null);
  await assert.rejects(readSafeRedactedSlide(f),/NOT_APPROVED/);
  assert.deepEqual(current.output.checks,{outsidePreserved:true,requiredOpaque:true,metadataStripped:true});
});
test('manual evidence is bound to source, slide, image, item geometry, exact edits, reviewer and revision',async t=>{
  const {f,state}=await uncertainFixture(t), good=manualResolution(state);
  for(const change of [
    {sourceHash:redactionHash('other source')},{slideContentHash:redactionHash('other slide')},{imageHash:redactionHash('other image')},
    {uncertaintyHash:redactionHash('other geometry')},{editHash:redactionHash('other edit')},{reviewedRevision:state.revision+1},
    {actor:'다른 검수자'},{reason:'짧음'},{inspectedAtActualSize:false},{uncertaintyId:'not-a-real-item'},
  ]) await assert.rejects(saveManual(f,state,[{...good,...change}]),/MANUAL_REDACTION_REVIEW/);
  let current=await saveManual(f,state,[good]);
  const unchanged=await saveManual(f,current,current.manualResolutions);
  assert.equal(unchanged.revision,current.revision);
  current=await saveLocalRedactionSlide({...f,expectedRevision:current.revision,regions:[...current.regions,{id:'new-mask',rect:{x:.7,y:.7,width:.1,height:.1},mode:'opaque'}],exceptions:current.exceptions,review:current.review});
  assert.deepEqual(current.manualResolutions,[]);
  assert.ok(redactionHolds(current).some(x=>x.startsWith('MANUAL_GEOMETRY')));
  await assert.rejects(saveManual(f,current,[good]),/MANUAL_REDACTION_REVIEW/);
  const staleRevision={...manualResolution(current),reviewedRevision:current.revision-1};
  await assert.rejects(saveManual(f,current,[staleRevision]),/MANUAL_REDACTION_REVIEW_REVISION_CONFLICT/);
});
test('manual opaque confirmation requires a linked opaque mask covering the located item',async t=>{
  const {f,state}=await uncertainFixture(t),good=manualResolution(state);
  await assert.rejects(saveManual(f,state,[{...good,regionId:'missing'}]),/MANUAL_REDACTION_REVIEW/);
  const shrunk={...state,regions:[{...state.regions[0],rect:{x:.13,y:.21,width:.1,height:.03}}]};
  await assert.rejects(saveManual(f,shrunk,[manualResolution(shrunk)]),/MANUAL_REDACTION_REVIEW/);
  const unlinked={...state,regions:[{...state.regions[0],candidateId:undefined}]};
  await assert.rejects(saveManual(f,unlinked,[{...good,editHash:redactionManualEditFingerprint(unlinked)}]),/MANUAL_REDACTION_REVIEW/);
});
test('a false positive can be explicitly resolved as non-sensitive, without a broad public exception',async t=>{
  const {f,state}=await uncertainFixture(t);
  const noMask={...state,regions:[],exceptions:[]};
  let current=await saveManual(f,noMask,[manualResolution(noMask,noMask.uncertainties[0],'non_sensitive_confirmed')]);
  assert.deepEqual(current.exceptions,[]);
  assert.deepEqual(redactionHolds(current),[]);
  current=await renderLocalRedactionSlide({...f,expectedRevision:current.revision});
  assert.equal(current.status,'rendered');
  const source=await decodeRedactionPng(f.png),out=await decodeRedactionPng(await readSafeRedactedSlide(f,{allowUnapproved:true}));
  assert.deepEqual(out.data,source.data);
});
test('missing, truncated, unsupported and unlocated detections stay fatal even after a valid located review',async t=>{
  for(const warning of ['TEXT_EXTRACTION_INCOMPLETE','SOURCE_SCAN_TRUNCATED','UNSUPPORTED_SOURCE_OBJECT','REQUIRED_CANDIDATE_GEOMETRY_UNRESOLVED_MANUAL_RECT_REQUIRED']) {
    const {f,state}=await uncertainFixture(t,{warnings:[warning]});
    const current=await saveManual(f,state,[manualResolution(state)]);
    await assert.rejects(renderLocalRedactionSlide({...f,expectedRevision:current.revision}),/INCOMPLETE_DETECTION/);
  }
});
test('item remapping clears old manual evidence and unknown uncertainty policies are rejected',async t=>{
  const {f,state,detection}=await uncertainFixture(t);
  await saveManual(f,state,[manualResolution(state)]);
  for(const mutate of [d=>d.uncertainties[0].code='SOURCE_SCAN_TRUNCATED',d=>d.uncertainties[0].candidateId='missing',d=>d.uncertainties[0].rect.width=.01]) {
    const bad=structuredClone(detection);mutate(bad);
    await assert.rejects(initializeLocalRedactions({...f,detections:[bad]}),/INVALID_REDACTION_UNCERTAINTY/);
  }
  detection.uncertainties[0].id='new-uncertainty';
  await initializeLocalRedactions({...f,detections:[detection]});
  const current=await getLocalRedactionSlide(f);
  assert.deepEqual(current.manualResolutions,[]);
  assert.equal(current.review.originalInspected,false);
  assert.equal(current.output,null);
});

const editorScript=await readFile(new URL('./redaction-editor-client.mjs',import.meta.url),'utf8');
const plain=value=>JSON.parse(JSON.stringify(value));
const settleEditor=async()=>{for(let n=0;n<8;n++)await new Promise(resolve=>setImmediate(resolve));};

async function editorFixture(initial,service=null) {
  const focusState={node:null};
  class Node {
    constructor(tag='div') {this.tagName=tag;this.children=[];this.listeners=new Map();this.dataset={};this.style={};this.value='';this._checked=false;this.disabled=false;this.hidden=false;this.className='';this._text='';this.complete=true;this.naturalWidth=initial.width;this.clientWidth=initial.width;this.scrollLeft=0;this.scrollTop=0;}
    get textContent(){return this._text+this.children.map(node=>node.textContent).join('');}
    set textContent(value){this._text=value;this.children=[];}
    get checked(){return this._checked;}
    set checked(value){this._checked=value;if(value&&this.radioGroup)for(const node of nodes.values())if(node!==this&&node.radioGroup===this.radioGroup)node._checked=false;}
    get childElementCount(){return this.children.length;}
    append(...children){for(const node of children){node.parentElement=this;this.children.push(node);if(this.tagName==='select'&&this.children.length===1)this.value=node.value;}}
    replaceChildren(...children){this.children=[];this._text='';this.append(...children);}
    before(node){const parent=this.parentElement;node.parentElement=parent;parent.children.splice(parent.children.indexOf(this),0,node);}
    after(node){const parent=this.parentElement;node.parentElement=parent;parent.children.splice(parent.children.indexOf(this)+1,0,node);}
    setAttribute(key,value){this[key]=value;}
    addEventListener(kind,callback){const list=this.listeners.get(kind)??[];list.push(callback);this.listeners.set(kind,list);}
    emit(kind,details={}){return Promise.all((this.listeners.get(kind)??[]).map(callback=>callback({target:this,currentTarget:this,relatedTarget:null,preventDefault(){},...details})));}
    get classList(){return{contains:value=>this.className.split(/\s+/).includes(value),toggle:(value,force)=>{const values=new Set(this.className.split(/\s+/).filter(Boolean));const add=force??!values.has(value);if(add)values.add(value);else values.delete(value);this.className=[...values].join(' ');return add;}};}
    contains(node){return this===node||this.children.some(child=>child.contains(node));}
    emitBubbling(kind,details){this.emit(kind,details);this.parentElement?.emitBubbling(kind,details);}
    focus(){const previous=focusState.node;if(previous===this)return;focusState.node=this;if(previous){previous.emit('blur',{relatedTarget:this});previous.emitBubbling('focusout',{target:previous,relatedTarget:this});}this.emit('focus',{relatedTarget:previous});this.emitBubbling('focusin',{target:this,relatedTarget:previous});}
    blur(){if(focusState.node!==this)return;focusState.node=null;this.emit('blur');this.emitBubbling('focusout',{target:this});}
    querySelectorAll(selector){const matches=node=>selector.startsWith('[data-')?Boolean(node.dataset[selector.slice(6,-1).replace(/-([a-z])/g,(_,letter)=>letter.toUpperCase())]):selector.startsWith('.')?node.className.split(' ').includes(selector.slice(1)):selector.startsWith('#')?node.id===selector.slice(1):node.tagName===selector;return this.children.flatMap(node=>[...(matches(node)?[node]:[]),...node.querySelectorAll(selector)]);}
    querySelector(selector){return this.querySelectorAll(selector)[0]??null;}
    getBoundingClientRect(){return{left:0,top:0,width:initial.width,height:initial.height};}
    scrollIntoView(options){this.scrollIntoViewCalls??=[];this.scrollIntoViewCalls.push(options);}
    showModal(){this.open=true;}
    close(){this.open=false;this.emit('close');}
    remove(){if(this.parentElement)this.parentElement.children=this.parentElement.children.filter(node=>node!==this);}
  }
  const nodes=new Map([...editorScript.matchAll(/document\.querySelector\("([#.][^"]+)"\)/g)].map(match=>[match[1],new Node()]));
  const body=new Node('body');body.dataset.sourceSlideNumber='1';
  for(const [selector,node]of nodes){if(selector.startsWith('#'))node.id=selector.slice(1);else node.className=selector.slice(1);body.append(node);}
  for(const name of ['#compare-before','#compare-after'])nodes.get(name).radioGroup='comparison';
  nodes.get('#mask-mode').value='blur';nodes.get('#zoom').value='100';
  const decisions=['keep','replace'].map(value=>{const node=new Node('input');node.value=value;node.radioGroup='layout';return node;});
  const checks=[new Node('input'),new Node('input'),new Node('input')];checks.forEach(node=>node.checked=true);
  const requests=[];let serverState=plain(initial);
  const context=vm.createContext({
    document:{body,querySelector:selector=>selector.includes('layout-decision')?decisions.find(node=>node.checked):nodes.get(selector)??body.querySelector(selector),querySelectorAll:selector=>selector.includes('layout-decision')?decisions:selector==='[data-manual-check]'?checks:body.querySelectorAll(selector),createElement:tag=>new Node(tag),createTextNode:text=>{const node=new Node('#text');node.textContent=text;return node;}},
    crypto:webcrypto,TextEncoder,getComputedStyle:()=>({paddingLeft:'0',paddingRight:'0'}),requestAnimationFrame:callback=>callback(),
    fetch:async(url,options)=>{
      const payload=options.body?JSON.parse(options.body):undefined;requests.push({url,method:options.method,payload});
      if(service&&options.method==='POST'){
        if(url.endsWith('/save'))serverState=await saveLocalRedactionSlide({...service,...payload});
        else if(url.endsWith('/render'))serverState=await renderLocalRedactionSlide({...service,...payload});
      }
      return{ok:true,headers:{get:()=> 'application/json'},json:async()=>({csrfToken:'c'.repeat(64),state:plain(serverState)})};
    },
  });
  vm.runInContext(editorScript,context);await settleEditor();
  const run=expression=>vm.runInContext(expression,context);
  const click=async node=>{assert.ok(node,'button is present');await node.emit('click');await settleEditor();};
  return{nodes,body,context,run,requests,click,node:selector=>nodes.get(selector),button:(label,root=body)=>root.querySelectorAll('button').find(node=>node.textContent===label),read:expression=>plain(run(expression)),get state(){return serverState;}};
}

test('editor bulk cover links only unresolved candidates, is one undo step, and passes the render gate',async t=>{
  const f=await fixture(t),detection=structuredClone(f.detections[0]);
  for(let n=1;n<=3;n++)detection.candidates.push({id:`optional-${n}`,category:'name',required:false,reason:'OPTIONAL_NAME_REVIEW',rect:{x:.1*n,y:.6,width:.08,height:.05}});
  detection.candidates.push({id:'required-pending',category:'email',required:true,reason:'CONTACT_TEXT',rect:{x:.7,y:.1,width:.1,height:.1}});
  await initializeLocalRedactions({...f,detections:[detection]});
  let s=await getLocalRedactionSlide(f);
  s=await saveLocalRedactionSlide({...f,expectedRevision:s.revision,regions:[...s.regions.filter(region=>region.candidateId==='email-1'),{id:'partial',candidateId:'optional-2',mode:'blur',rect:{x:.2,y:.6,width:.02,height:.05}}],exceptions:[{candidateId:'optional-1',actor:'합성 검수자',reason:'공개 허용된 합성 이름'}],review:{reviewer:'합성 검수자',originalInspected:true,layoutAcceptable:true}});
  const editor=await editorFixture(s,f),before=editor.read('({regions,exceptions})');
  await editor.click(editor.button('이 장표 후보 3개 전부 가리기'));
  assert.equal(editor.run('state.candidates.every(candidateResolved)'),true);
  assert.equal(editor.run('undoStack.length'),1);
  assert.deepEqual(editor.read('regions.filter(r=>r.candidateId==="email-1")'),before.regions.filter(r=>r.candidateId==='email-1'));
  assert.deepEqual(editor.read('exceptions'),before.exceptions);
  for(const candidateId of ['optional-2','optional-3'])assert.equal(editor.run(`regions.filter(r=>r.candidateId==="${candidateId}").length`),1);
  assert.equal(editor.run('regions.find(r=>r.candidateId==="required-pending").mode'),'opaque');
  assert.equal(editor.run('regions.find(r=>r.candidateId==="optional-3").mode'),'blur');
  assert.equal(editor.run('manualResolutions.length'),0);
  assert.equal(editor.body.querySelectorAll('button').find(node=>node.textContent.includes('전부 가리기')).hidden,true);
  await editor.click(editor.node('#undo'));
  assert.deepEqual(editor.read('({regions,exceptions})'),before);
  await editor.click(editor.node('#redo'));
  await editor.click(editor.node('#save-redaction'));
  await editor.click(editor.node('#render-redaction'));
  assert.equal(editor.state.status,'rendered');
  assert.equal(editor.requests.filter(request=>request.url.endsWith('/render')).length,1);
});

test('editor bulk cover skips manually resolved candidates and never creates actual-size evidence',async t=>{
  const {state}=await uncertainFixture(t);
  const initial={...state,regions:[],manualResolutions:[manualResolution({...state,regions:[]},state.uncertainties[0],'non_sensitive_confirmed')],candidates:[...state.candidates,{id:'pending',category:'name',required:false,reason:'OPTIONAL_NAME_REVIEW',rect:{x:.7,y:.7,width:.1,height:.1}}]};
  const editor=await editorFixture(initial);
  await editor.click(editor.button('이 장표 후보 1개 전부 가리기'));
  assert.deepEqual(editor.read('regions.map(r=>r.candidateId)'),['pending']);
  assert.equal(editor.run('manualResolutions.length'),0);
  assert.equal(editor.run('inspectedUncertaintyId'),null);
  await editor.click(editor.node('#undo'));
  assert.deepEqual(editor.read('regions'),initial.regions);
  assert.deepEqual(editor.read('manualResolutions'),initial.manualResolutions);
  assert.equal(editor.run('inspectedUncertaintyId'),null);
  await editor.click(editor.node('#redo'));
  editor.node('#reviewer').value='다른 합성 검수자';await editor.node('#reviewer').emit('input');
  await editor.click(editor.node('#undo'));
  assert.deepEqual(editor.read('regions'),initial.regions);
  assert.deepEqual(editor.read('manualResolutions'),[]);
});

const editorCandidate=(id,{required=false,x=.7,y=.7}={})=>({id,category:'사진 속 정보',required,reason:'SYNTHETIC_IMAGE_REVIEW',rect:{x,y,width:.1,height:.1}});
const locatorNode=(root,kind,id)=>root.querySelectorAll('[data-locator-id]').find(node=>node.dataset.locatorKind===kind&&node.dataset.locatorId===id);
const openBulkException=async editor=>{
  const button=editor.body.querySelectorAll('button').find(node=>node.textContent.includes('전부 공개 예외'));
  await editor.click(button);
  const dialog=editor.body.querySelectorAll('.bulk-exception-dialog').find(node=>node.open);
  assert.ok(dialog,'one shared public-exception dialog is open');
  return{dialog,actor:dialog.querySelector('input'),reason:dialog.querySelector('textarea'),confirm:editor.button('전부 공개 예외 기록',dialog)};
};

test('editor numbers each candidate and region consistently across its list and slide boxes',async t=>{
  const {state}=await uncertainFixture(t);
  const pending=[editorCandidate('pending-a'),editorCandidate('pending-b',{x:.8,y:.8})];
  const editor=await editorFixture({...state,candidates:[...state.candidates,editorCandidate('excepted'),...pending],
    exceptions:[{candidateId:'excepted',actor:'합성 검수자',reason:'공개 허용된 합성 그림'}],
    regions:[{id:'manual-first',mode:'blur',rect:{x:.6,y:.6,width:.1,height:.1}},...state.regions]});
  assert.deepEqual(editor.node('#candidate-list').querySelectorAll('.locator-button').map(node=>node.textContent),['1. email','2. 사진 속 정보','3. 사진 속 정보','4. 사진 속 정보']);
  assert.deepEqual(editor.node('#region-list').querySelectorAll('.region-name').map(node=>node.textContent),['1. 수동 영역','2. email']);
  assert.deepEqual(editor.node('#redaction-overlay').querySelectorAll('.candidate-box-label').map(node=>node.textContent),['후보 3','후보 4']);
  assert.deepEqual(editor.node('#redaction-overlay').querySelectorAll('.region-box-label').map(node=>node.textContent),['1 흐림','2 불투명']);
});

test('editor pointer and keyboard focus highlight both partners and retain focus when the pointer leaves',async t=>{
  const {state}=await uncertainFixture(t);
  const editor=await editorFixture({...state,candidates:[...state.candidates,editorCandidate('pending')]});
  for(const [kind,id,list]of [['candidate','pending','#candidate-list'],['region',state.regions[0].id,'#region-list']]){
    const row=locatorNode(editor.node(list),kind,id),box=locatorNode(editor.node('#redaction-overlay'),kind,id);
    const active=()=>[row,box].map(node=>node.classList.contains('locator-active'));
    assert.deepEqual(active(),[false,false]);
    await row.emit('pointerenter');assert.deepEqual(active(),[true,true]);
    await row.emit('pointerleave');assert.deepEqual(active(),[false,false]);
    await box.emit('pointerenter');assert.deepEqual(active(),[true,true]);
    await box.emit('pointerleave');assert.deepEqual(active(),[false,false]);
    const title=row.querySelector('.locator-button');title.focus();assert.deepEqual(active(),[true,true]);
    await row.emit('pointerenter');await row.emit('pointerleave');assert.deepEqual(active(),[true,true]);
    const another=row.querySelectorAll('button').find(node=>node!==title)??row.querySelector('select');
    another.focus();assert.deepEqual(active(),[true,true]);another.blur();assert.deepEqual(active(),[false,false]);
  }
  const linkedCandidate=locatorNode(editor.node('#candidate-list'),'candidate',state.candidates[0].id);
  const linkedRegion=locatorNode(editor.node('#redaction-overlay'),'region',state.regions[0].id);
  await linkedCandidate.emit('pointerenter');assert.equal(linkedRegion.classList.contains('locator-active'),true);
  await linkedCandidate.emit('pointerleave');await linkedRegion.emit('pointerenter');assert.equal(linkedCandidate.classList.contains('locator-active'),true);
  await linkedRegion.emit('pointerleave');assert.equal(linkedCandidate.classList.contains('locator-active'),false);
});

test('editor title navigation scrolls without changing zoom, masks, review or per-item inspection evidence',async t=>{
  const {state}=await uncertainFixture(t);
  const initial={...state,candidates:[...state.candidates,editorCandidate('pending',{x:.8,y:.8}),editorCandidate('already-excepted')],
    regions:[...state.regions,{id:'manual-locator',mode:'blur',rect:{x:.65,y:.7,width:.1,height:.1}}],
    exceptions:[{candidateId:'already-excepted',actor:'합성 검수자',reason:'기존 공개 사유 기록'}],
    output:{sha256:'a'.repeat(64)}};
  initial.manualResolutions=[manualResolution(initial)];
  const editor=await editorFixture(initial);
  await editor.click(editor.button('원본 영역 100% 확대'));
  editor.node('#zoom').value='175';await editor.node('#zoom').emit('input');
  editor.node('#compare-after').checked=true;await editor.node('#compare-after').emit('change');
  const snapshot='({state,regions,exceptions,manualResolutions,review:selectedReview(),checks:[...document.querySelectorAll("[data-manual-check]")].map(input=>input.checked),dirty,undoStack,redoStack,inspectedUncertaintyId,inspectionReturnView,zoom:zoomInput.value,width:imageStage.style.width,before:beforeCompareInput.checked,after:afterCompareInput.checked,src:sourceImage.src,hidden:overlay.hidden})';
  const before=editor.read(snapshot),requests=editor.requests.length;
  editor.run('beginMutation=()=>{throw new Error("VIEW_NAVIGATION_CALLED_BEGIN_MUTATION")};finishMutation=()=>{throw new Error("VIEW_NAVIGATION_CALLED_FINISH_MUTATION")}');
  for(const [kind,id,list]of [['candidate','pending','#candidate-list'],['region','manual-locator','#region-list']]){
    const scroller=editor.node('.image-scroller');scroller.scrollLeft=0;scroller.scrollTop=0;
    const calls=scroller.scrollIntoViewCalls?.length??0;
    await editor.click(locatorNode(editor.node(list),kind,id).querySelector('.locator-button'));
    assert.equal(scroller.scrollIntoViewCalls.length,calls+1);
    assert.deepEqual(plain(scroller.scrollIntoViewCalls.at(-1)),{block:'nearest',inline:'nearest'});
    const target=kind==='candidate'?initial.candidates.find(candidate=>candidate.id===id):initial.regions.find(region=>region.id===id);
    assert.equal(scroller.scrollLeft+initial.width/2,(target.rect.x+target.rect.width/2)*initial.width);
    assert.equal(scroller.scrollTop+initial.height/2,(target.rect.y+target.rect.height/2)*initial.height);
    assert.deepEqual(editor.read(snapshot),before);
    assert.equal(editor.requests.length,requests);
  }
});

test('editor bulk public exception shares one actor and reason, skips required candidates and supports one-step undo',async t=>{
  const {state}=await uncertainFixture(t);
  const pending=['pending-a','pending-b','pending-c'].map(id=>editorCandidate(id));
  const required=editorCandidate('required-pending',{required:true}),covered=editorCandidate('already-covered'),excepted=editorCandidate('already-excepted');
  const partial={id:'partial-optional',candidateId:'pending-a',mode:'blur',rect:{x:.7,y:.7,width:.02,height:.1}};
  const requiredPartial={id:'partial-required',candidateId:required.id,mode:'opaque',rect:{x:.7,y:.7,width:.02,height:.1}};
  const initial={...state,candidates:[...state.candidates,...pending,required,covered,excepted],
    regions:[...state.regions,partial,requiredPartial,{id:'covered-region',candidateId:covered.id,mode:'blur',rect:covered.rect}],
    exceptions:[{candidateId:excepted.id,actor:'기존 허용자',reason:'기존 공개 사유를 유지함'}]};
  initial.manualResolutions=[manualResolution(initial)];
  const editor=await editorFixture(initial),before=editor.read('({regions,exceptions,manualResolutions})');
  assert.ok(editor.button('이 장표 후보 4개 전부 공개 예외'));
  const {dialog,actor,reason,confirm}=await openBulkException(editor);
  assert.equal(actor.value,state.review.reviewer);assert.equal(editor.run('undoStack.length'),0);
  actor.value='  공개 허용 담당자  ';reason.value='  협력사 로고와 일반 아이콘은 공개가 허용됨  ';
  await editor.click(confirm);
  assert.equal(dialog.open,false);assert.equal(editor.run('undoStack.length'),1);
  assert.deepEqual(editor.read('exceptions'),[...initial.exceptions,...pending.map(candidate=>({candidateId:candidate.id,actor:'공개 허용 담당자',reason:'협력사 로고와 일반 아이콘은 공개가 허용됨'}))]);
  assert.deepEqual(editor.read('regions'),initial.regions.filter(region=>region.id!==partial.id));
  assert.deepEqual(editor.read('manualResolutions'),[]);assert.equal(editor.run('inspectedUncertaintyId'),null);
  assert.match(editor.node('#editor-status').textContent,/후보 3개를 공개 예외로 기록했습니다\./);
  assert.match(editor.node('#editor-status').textContent,/필수 후보 1개는 불투명 가림이 필요해 제외했습니다\./);
  assert.match(editor.node('#editor-status').textContent,/기존 항목별 확대 확인은 다시 해야 합니다/);
  assert.equal(editor.requests.filter(request=>request.method==='POST').length,0);
  await editor.click(editor.node('#undo'));assert.deepEqual(editor.read('({regions,exceptions,manualResolutions})'),before);
  await editor.click(editor.node('#redo'));assert.equal(editor.run('exceptions.length'),4);
  await editor.click(editor.node('#save-redaction'));
  const saved=editor.requests.find(request=>request.url.endsWith('/save')).payload;
  assert.deepEqual(saved.exceptions,[...initial.exceptions,...pending.map(candidate=>({candidateId:candidate.id,actor:'공개 허용 담당자',reason:'협력사 로고와 일반 아이콘은 공개가 허용됨'}))]);
  assert.deepEqual(saved.regions,initial.regions.filter(region=>region.id!==partial.id));
});

test('editor bulk public exception skips manually resolved candidates before clearing existing inspection evidence',async t=>{
  const {state}=await uncertainFixture(t);
  const resolved={...state,regions:[]};
  const initial={...resolved,candidates:[...resolved.candidates,editorCandidate('pending')],manualResolutions:[manualResolution(resolved,resolved.uncertainties[0],'non_sensitive_confirmed')]};
  const editor=await editorFixture(initial),{actor,reason,confirm}=await openBulkException(editor);
  actor.value='합성 허용자';reason.value='일반 아이콘의 공개를 허용함';await editor.click(confirm);
  assert.deepEqual(editor.read('exceptions.map(entry=>entry.candidateId)'),['pending']);
  assert.deepEqual(editor.read('regions'),[]);assert.deepEqual(editor.read('manualResolutions'),[]);
  assert.match(editor.node('#editor-status').textContent,/기존 항목별 확대 확인은 다시 해야 합니다/);
});

test('editor bulk public exception leaves a required-only selection and its inspection evidence unchanged',async t=>{
  const {state}=await uncertainFixture(t);
  const initial={...state,candidates:[...state.candidates,editorCandidate('required-pending',{required:true})],manualResolutions:[manualResolution(state)]};
  const editor=await editorFixture(initial),before=editor.read('({regions,exceptions,manualResolutions,dirty,undoStack,redoStack})');
  const {reason,confirm}=await openBulkException(editor);reason.value='필수 정보는 공개 예외에서 제외함';await editor.click(confirm);
  assert.deepEqual(editor.read('({regions,exceptions,manualResolutions,dirty,undoStack,redoStack})'),before);
  assert.match(editor.node('#editor-status').textContent,/후보 0개를 공개 예외로 기록했습니다\./);
  assert.match(editor.node('#editor-status').textContent,/필수 후보 1개는 불투명 가림이 필요해 제외했습니다\./);
});

test('editor hides both bulk buttons for an empty or fully resolved candidate list and after bulk exceptions',async t=>{
  const {state}=await uncertainFixture(t);
  for(const initial of [{...state,candidates:[],regions:[]},state]){
    const editor=await editorFixture(initial);
    const buttons=editor.body.querySelectorAll('button').filter(node=>/전부 가리기|전부 공개 예외/.test(node.textContent));
    assert.equal(buttons.length,2);assert.ok(buttons.every(node=>node.hidden));
  }
  const editor=await editorFixture({...state,candidates:[...state.candidates,editorCandidate('pending')]});
  const {reason,confirm}=await openBulkException(editor);reason.value='일반 그림의 공개를 허용함';await editor.click(confirm);
  const buttons=editor.body.querySelectorAll('button').filter(node=>/전부 가리기|전부 공개 예외/.test(node.textContent));
  assert.equal(buttons.length,2);assert.ok(buttons.every(node=>node.hidden));
});

test('editor bulk public exception requires an actor and at least three trimmed reason characters',async t=>{
  const {state}=await uncertainFixture(t);
  const editor=await editorFixture({...state,candidates:[...state.candidates,editorCandidate('pending')]});
  const before=editor.read('({regions,exceptions,manualResolutions,dirty,undoStack,redoStack})');
  const {dialog,actor,reason,confirm}=await openBulkException(editor);
  for(const [person,why]of [['','공개 허용 사유'],['   ','공개 허용 사유'],['검수자',''],['검수자','   '],['검수자','한'],['검수자','  두자  ']]){
    actor.value=person;reason.value=why;await editor.click(confirm);
    assert.equal(dialog.open,true);assert.deepEqual(editor.read('({regions,exceptions,manualResolutions,dirty,undoStack,redoStack})'),before);
    assert.equal(editor.node('#editor-status').dataset.kind,'error');
  }
  actor.value='  검수자  ';reason.value='  세글자  ';await editor.click(confirm);
  assert.equal(dialog.open,false);assert.deepEqual(editor.read('exceptions'),[{candidateId:'pending',actor:'검수자',reason:'세글자'}]);
});

test('editor cancelling the bulk public exception dialog records no changes',async t=>{
  const {state}=await uncertainFixture(t);
  const editor=await editorFixture({...state,candidates:[...state.candidates,editorCandidate('pending')]});
  const before=editor.read('({regions,exceptions,manualResolutions,dirty,undoStack,redoStack})');
  const {dialog,actor,reason}=await openBulkException(editor);actor.value='취소할 허용자';reason.value='취소할 공개 예외 사유';
  await editor.click(editor.button('취소',dialog));
  assert.equal(dialog.open,false);assert.deepEqual(editor.read('({regions,exceptions,manualResolutions,dirty,undoStack,redoStack})'),before);
});

test('editor opaque confirmation needs no typed reason and saves with unchanged server validation',async t=>{
  const {f,state}=await uncertainFixture(t),editor=await editorFixture(state,f);
  await editor.click(editor.button('원본 영역 100% 확대'));
  await editor.click(editor.button('확대 확인 후 이 항목 기록'));
  const dialog=editor.body.querySelectorAll('dialog').find(node=>node.open),reason=dialog.querySelector('textarea');
  assert.equal(reason.value,'');assert.equal(reason.parentElement.hidden,true);
  await editor.click(editor.button('이 항목 확인 기록',dialog));
  assert.equal(editor.run('manualResolutions.length'),0);
  dialog.querySelector('input').checked=true;
  await editor.click(editor.button('이 항목 확인 기록',dialog));
  assert.equal(editor.run('manualResolutions.length'),1);
  const record=editor.read('manualResolutions[0]');
  assert.equal(record.decision,'opaque_confirmed');assert.equal(record.inspectedAtActualSize,true);assert.ok(record.reason.length>=10);
  await editor.click(editor.node('#save-redaction'));
  assert.equal(editor.state.manualResolutions.length,1);
  assert.deepEqual(editor.state.manualResolutions[0].reason,record.reason);
});

test('editor non-sensitive confirmation still requires a specific typed reason',async t=>{
  const {state}=await uncertainFixture(t),editor=await editorFixture(state);
  await editor.click(editor.button('원본 영역 100% 확대'));
  await editor.click(editor.button('확대 확인 후 이 항목 기록'));
  const dialog=editor.body.querySelectorAll('dialog').find(node=>node.open),decision=dialog.querySelector('select'),reason=dialog.querySelector('textarea');
  decision.value='non_sensitive_confirmed';decision.emit('change');
  assert.equal(reason.parentElement.hidden,false);
  dialog.querySelector('input').checked=true;
  for(const value of ['', '너무 짧은 사유']){reason.value=value;await editor.click(editor.button('이 항목 확인 기록',dialog));assert.equal(editor.run('manualResolutions.length'),0);}
  reason.value='직접 확인한 합성 이름이며 비민감 문구임';
  await editor.click(editor.button('이 항목 확인 기록',dialog));
  assert.equal(editor.run('manualResolutions[0].decision'),'non_sensitive_confirmed');
  assert.equal(editor.run('manualResolutions[0].reason'),reason.value);
});

test('editor actual-size guards explain each failed condition and update beside the record action',async t=>{
  const {state}=await uncertainFixture(t),messages=[];
  for(const [change,expected,recoverable]of [
    ['inspectedUncertaintyId="other"',/이 항목의.*원본 영역 100% 확대/,true],
    ['zoomInput.value="42"',/지금 확대가 42%.*100% 이상/,true],
    ['beforeCompareInput.checked=false',/비교를.*적용 전/,true],
    ['sourceImage.complete=false',/고해상도 원본을 아직 불러오는 중/,false],
  ]){
    const editor=await editorFixture(state);
    await editor.click(editor.button('원본 영역 100% 확대'));editor.run(change);
    editor.run('renderInspectionStatuses()');
    const rowMessage=editor.node('#candidate-list').querySelector('[data-uncertainty-id]').textContent;
    assert.match(rowMessage,expected);messages.push(rowMessage);
    await editor.click(editor.button('확대 확인 후 이 항목 기록'));
    const message=editor.node('#editor-status').textContent;
    if(recoverable)assert.equal(message,'이 항목 자리로 100% 확대해 되돌렸습니다. 직접 확인하신 뒤 한 번 더 누르면 기록합니다.');
    else assert.match(message,expected);
    assert.equal(editor.body.querySelectorAll('dialog').some(node=>node.open),false);
  }
  assert.equal(new Set(messages).size,4);
  const editor=await editorFixture({...state,output:{sha256:'a'.repeat(64)}});
  await editor.click(editor.button('원본 영역 100% 확대'));
  editor.node('#zoom').value='42';editor.node('#zoom').emit('input');
  assert.match(editor.node('#candidate-list').textContent,/확대 42%.*적용 전/);
  editor.node('#compare-after').checked=true;editor.node('#compare-after').emit('change');
  assert.match(editor.node('#candidate-list').textContent,/확대 42%.*적용 후.*100% 이상/);
});

for(const condition of ['50 percent zoom','rendered comparison','another inspected item']){
  test(`editor record action from ${condition} returns to the original and opens only on the second click`,async t=>{
    const {state}=await uncertainFixture(t,{multiple:true});
    const editor=await editorFixture({...state,output:{sha256:'a'.repeat(64)}});
    await editor.click(editor.button('원본 영역 100% 확대'));
    if(condition==='50 percent zoom'){
      editor.node('#zoom').value='50';await editor.node('#zoom').emit('input');
    }else if(condition==='rendered comparison'){
      editor.node('#compare-after').checked=true;await editor.node('#compare-after').emit('change');
      assert.equal(editor.node('#compare-before').checked,false);
    }else{
      const buttons=editor.node('#candidate-list').querySelectorAll('button').filter(node=>node.textContent==='원본 영역 100% 확대');
      await editor.click(buttons[1]);
      assert.equal(editor.run('inspectedUncertaintyId'),state.uncertainties[1].id);
    }
    const scroller=editor.node('.image-scroller');scroller.scrollLeft=0;scroller.scrollTop=0;
    await editor.click(editor.button('확대 확인 후 이 항목 기록'));
    assert.equal(editor.body.querySelectorAll('dialog').filter(node=>node.open).length,0);
    assert.equal(editor.run('manualResolutions.length'),0);
    assert.ok(Number(editor.node('#zoom').value)>=100);
    assert.equal(editor.node('#compare-before').checked,true);
    assert.equal(editor.node('#compare-after').checked,false);
    assert.equal(editor.node('#source-image').src,'/artifact/highres%3A1');
    assert.equal(editor.run('inspectedUncertaintyId'),state.uncertainties[0].id);
    assert.ok(scroller.scrollLeft!==0||scroller.scrollTop!==0);
    assert.equal(editor.node('#editor-status').textContent,'이 항목 자리로 100% 확대해 되돌렸습니다. 직접 확인하신 뒤 한 번 더 누르면 기록합니다.');
    await editor.click(editor.button('확대 확인 후 이 항목 기록'));
    assert.equal(editor.body.querySelectorAll('dialog').filter(node=>node.open).length,1);
    assert.equal(editor.run('manualResolutions.length'),0);
  });
}

test('editor loading original keeps the view and only explains the wait',async t=>{
  const {state}=await uncertainFixture(t);
  for(const change of ['sourceImage.complete=false','sourceImage.naturalWidth=state.width-1']){
    const editor=await editorFixture(state);
    await editor.click(editor.button('원본 영역 100% 확대'));
    editor.run(change);await editor.node('#source-image').emit('load');
    const view='({zoom:zoomInput.value,before:beforeCompareInput.checked,after:afterCompareInput.checked,id:inspectedUncertaintyId,left:imageScroller.scrollLeft,top:imageScroller.scrollTop,src:sourceImage.src,returnView:inspectionReturnView})';
    const before=editor.read(view);
    await editor.click(editor.button('확대 확인 후 이 항목 기록'));
    assert.deepEqual(editor.read(view),before);
    assert.match(editor.node('#editor-status').textContent,/고해상도 원본을 아직 불러오는 중/);
    assert.equal(editor.body.querySelectorAll('dialog').some(node=>node.open),false);
    assert.equal(editor.run('manualResolutions.length'),0);
  }
});

test('editor successful recording restores zoom and comparison after either inspection entry action',async t=>{
  const {state}=await uncertainFixture(t);
  for(const direct of [false,true])for(const [zoom,after]of [[50,false],[50,true],[175,true]]){
    const editor=await editorFixture({...state,output:{sha256:'a'.repeat(64)}});
    editor.node('#zoom').value=String(zoom);await editor.node('#zoom').emit('input');
    if(after){editor.node('#compare-after').checked=true;await editor.node('#compare-after').emit('change');}
    const view='({zoom:zoomInput.value,before:beforeCompareInput.checked,after:afterCompareInput.checked,src:sourceImage.src,alt:sourceImage.alt,hidden:overlay.hidden})';
    const before=editor.read(view);
    await editor.click(editor.button(direct?'원본 영역 100% 확대':'확대 확인 후 이 항목 기록'));
    assert.equal(editor.body.querySelectorAll('dialog').some(node=>node.open),false);
    if(direct)await editor.click(editor.button('원본 영역 100% 확대'));
    await editor.click(editor.button('확대 확인 후 이 항목 기록'));
    const dialog=editor.body.querySelectorAll('dialog').find(node=>node.open);
    assert.ok(dialog);dialog.querySelector('input').checked=true;
    await editor.click(editor.button('이 항목 확인 기록',dialog));
    assert.equal(editor.run('manualResolutions.length'),1);
    assert.equal(editor.run('manualResolutions[0].inspectedAtActualSize'),true);
    assert.equal(dialog.open,false);
    assert.deepEqual(editor.read(view),before);
    assert.equal(editor.run('inspectionReturnView'),null);
  }
});

test('editor cancel or missing acknowledgement keeps the enlarged original until a successful retry',async t=>{
  const {state}=await uncertainFixture(t);
  for(const direct of [false,true])for(const cancel of [false,true]){
    const editor=await editorFixture({...state,output:{sha256:'a'.repeat(64)}});
    editor.node('#zoom').value='50';await editor.node('#zoom').emit('input');
    editor.node('#compare-after').checked=true;await editor.node('#compare-after').emit('change');
    await editor.click(editor.button(direct?'원본 영역 100% 확대':'확대 확인 후 이 항목 기록'));
    await editor.click(editor.button('확대 확인 후 이 항목 기록'));
    let dialog=editor.body.querySelectorAll('dialog').find(node=>node.open);
    assert.ok(dialog);
    if(cancel)await editor.click(editor.button('취소',dialog));
    else await editor.click(editor.button('이 항목 확인 기록',dialog));
    assert.equal(dialog.open,!cancel);
    assert.equal(editor.run('manualResolutions.length'),0);
    assert.equal(editor.node('#zoom').value,'100');
    assert.equal(editor.node('#compare-before').checked,true);
    assert.equal(editor.node('#compare-after').checked,false);
    assert.equal(editor.node('#source-image').src,'/artifact/highres%3A1');
    assert.ok(editor.run('inspectionReturnView'));
    if(cancel){
      await editor.click(editor.button('확대 확인 후 이 항목 기록'));
      dialog=editor.body.querySelectorAll('dialog').find(node=>node.open);
    }
    dialog.querySelector('input').checked=true;
    await editor.click(editor.button('이 항목 확인 기록',dialog));
    assert.equal(editor.run('manualResolutions.length'),1);
    assert.equal(editor.node('#zoom').value,'50');
    assert.equal(editor.node('#compare-after').checked,true);
  }
});

test('editor confirmation rechecks every original view condition before and after hashing',async t=>{
  const {state}=await uncertainFixture(t);
  for(const duringHash of [false,true])for(const change of ['inspectedUncertaintyId="other"','zoomInput.value="50"','beforeCompareInput.checked=false','sourceImage.complete=false']){
    const editor=await editorFixture(state);
    await editor.click(editor.button('원본 영역 100% 확대'));
    await editor.click(editor.button('확대 확인 후 이 항목 기록'));
    const dialog=editor.body.querySelectorAll('dialog').find(node=>node.open);
    dialog.querySelector('input').checked=true;
    if(duringHash)editor.run(`const actualHashRecord=hashRecord;let hashCalls=0;hashRecord=async value=>{const result=await actualHashRecord(value);if(++hashCalls===2){${change}}return result;}`);
    else editor.run(change);
    await editor.click(editor.button('이 항목 확인 기록',dialog));
    assert.equal(editor.run('manualResolutions.length'),0);
    assert.equal(dialog.open,true);
    assert.ok(editor.run('inspectionReturnView'));
    assert.equal(editor.node('#editor-status').dataset.kind,'error');
  }
});

test('editor approval shows distinct verified, changed and missing-output explanations',async t=>{
  const {state}=await uncertainFixture(t),messages=[];
  for(const [status,output,dirty,expected]of [
    ['verified',{sha256:'a'.repeat(64)},false,'이 장표는 승인됨'],
    ['rendered',{sha256:'a'.repeat(64)},true,'영역이 바뀌었습니다. 저장하고 블러본을 다시 만들어 주세요'],
    ['editing',null,false,'블러본을 먼저 만들어 주세요'],
  ]){
    const editor=await editorFixture({...state,status,output});
    if(dirty)editor.run('dirty=true;renderControls()');
    assert.equal(editor.node('#approve-redaction').disabled,true);
    assert.ok(editor.body.textContent.includes(expected));messages.push(expected);
  }
  assert.equal(new Set(messages).size,3);
});
