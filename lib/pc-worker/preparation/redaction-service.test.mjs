import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,writeFile,rm} from 'node:fs/promises';
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
