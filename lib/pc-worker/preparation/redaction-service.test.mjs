import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,writeFile,rm} from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import sharp from 'sharp';
import {openPreparationWorkStore} from './work-store.ts';
import {initializeLocalRedactions,getLocalRedactionSlide,getPreviousSavedRedactionSlide,saveLocalRedactionSlide,renderLocalRedactionSlide,approveLocalRedactionSlide,readSafeRedactedSlide,uploadVerifiedRedactedSlide} from './redaction-service.ts';
import {redactionHash,decodeRedactionPng,OPAQUE_COLOR,renderRedactedPng,pixelRedactionRect,redactionManualEditFingerprint,redactionUncertaintyFingerprint,redactionHolds,redactionInputFingerprint} from './redaction-renderer.ts';

async function fixture(t,ratio=[16,9],slideNumbers=[1,2]) {
  const root=await mkdtemp(path.join(os.tmpdir(),'woolim-redaction-'));
  t.after(()=>rm(root,{recursive:true,force:true}));
  const store=await openPreparationWorkStore({root});
  const sourceHash=redactionHash('SYNTHETIC ONLY');
  const opened=await store.beginOrResumeBuild({expectedWorkRevision:null,fingerprint:{source:{sha256:sourceHash,bytes:14},conversionSettingsFingerprint:'synthetic',fontFingerprint:'synthetic'}});
  let build=opened.build;const buildId=build.buildId;
  const width=Math.round(400*Math.min(1,ratio[0]/ratio[1])),height=Math.round(400*Math.min(1,ratio[1]/ratio[0]));
  const pixels=Buffer.alloc(width*height*3);for(let i=0;i<pixels.length;i++)pixels[i]=(i*13)%255;
  const png=await sharp(pixels,{raw:{width,height,channels:3}}).png().toBuffer();
  build=await store.completeStage({buildId,stage:'source_inspection',expectedRevision:build.revision,inputFingerprint:'inspection',data:{sourceHash,slides:slideNumbers.map(n=>({sourceSlideNumber:n,contentHash:redactionHash('slide'+n)}))}});
  build=await store.completeStage({buildId,stage:'preview_generation',expectedRevision:build.revision,inputFingerprint:'preview'});
  build=await store.recordSelection({buildId,expectedRevision:build.revision,expectedSelectionRevision:0,selectionFingerprint:'selection',data:{selected:slideNumbers,reserves:[],status:'ready_for_local_review'}});
  for(const n of slideNumbers) {
    const relativePath=`highres/${n}.png`;await writeFile(await store.prepareArtifactPath(buildId,relativePath),png);
    build=await store.recordArtifact({buildId,key:`highres:${n}`,relativePath,expectedRevision:build.revision});
  }
  await store.completeStage({buildId,stage:'high_resolution_conversion',expectedRevision:build.revision,inputFingerprint:'highres',artifactKeys:slideNumbers.map(n=>`highres:${n}`)});
  await store.release();
  const detections=slideNumbers.map(n=>({sourceSlideNumber:n,sourceHash,slideContentHash:redactionHash('slide'+n),candidates:[{id:'email-1',rect:{x:.12,y:.2,width:.3,height:.08},category:'email',required:true,reason:'CONTACT_TEXT'}],warnings:['IMAGE_TEXT_REQUIRES_LOCAL_REVIEW']}));
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
test('local blur gate requires a reviewer and separate exact-output approval without an original inspection claim',async t=>{
  const f=await fixture(t),s=await getLocalRedactionSlide(f);
  await assert.rejects(renderLocalRedactionSlide({...f,expectedRevision:s.revision}),/ORIGINAL_REVIEW_REQUIRED/);
  for(const reviewer of ['', '   '])await assert.rejects(saveLocalRedactionSlide({...f,expectedRevision:s.revision,regions:s.regions,exceptions:[],review:{reviewer,layoutAcceptable:true}}),/REVIEWER_REQUIRED/);
  let r=await saveLocalRedactionSlide({...f,expectedRevision:s.revision,regions:[...s.regions,{id:'manual',rect:{x:.6,y:.6,width:.1,height:.1},mode:'blur'}],exceptions:[],review:{reviewer:'합성 검수자',layoutAcceptable:true}});
  assert.equal(r.review.originalInspected,false);assert.deepEqual(r.manualResolutions,[]);
  r=await renderLocalRedactionSlide({...f,expectedRevision:r.revision});assert.equal(r.status,'rendered');
  await assert.rejects(readSafeRedactedSlide(f),/NOT_APPROVED/);
  assert.ok((await readSafeRedactedSlide(f,{allowUnapproved:true})).length);
  await assert.rejects(approveLocalRedactionSlide({...f,expectedRevision:r.revision,outputHash:'wrong',reviewer:'tester',outputInspected:true}),/OUTPUT_REVIEW/);
  r=await approveLocalRedactionSlide({...f,expectedRevision:r.revision,outputHash:r.output.sha256,reviewer:'tester',outputInspected:true});
  assert.equal(r.status,'verified');assert.equal(redactionHash(await readSafeRedactedSlide(f)),r.output.sha256);
});
test('mandatory masks cannot be weakened, removed, unlinked or bypassed with public exceptions',async t=>{
  const f=await fixture(t),s=await getLocalRedactionSlide(f),input={...f,expectedRevision:s.revision,regions:s.regions,exceptions:[],review:{reviewer:'tester',originalInspected:true,layoutAcceptable:true}};
  await assert.rejects(saveLocalRedactionSlide({...input,regions:[{...s.regions[0],mode:'blur'}]}),/MUST_BE_OPAQUE/);
  await assert.rejects(saveLocalRedactionSlide({...input,regions:[]}),/REQUIRED_REGION_MUST_BE_OPAQUE/);
  await assert.rejects(saveLocalRedactionSlide({...input,regions:[{...s.regions[0],candidateId:undefined}]}),/REQUIRED_REGION_MUST_BE_OPAQUE/);
  await assert.rejects(saveLocalRedactionSlide({...input,regions:[],exceptions:[{candidateId:'email-1',actor:'검수자',reason:'공개 허용된 가짜 자료'}]}),/REQUIRED_REGION_MUST_BE_OPAQUE/);
  assert.deepEqual((await getLocalRedactionSlide(f)).regions,s.regions);
});
test('shrunk or moved required rectangles and normalized out-of-bounds/zero rectangles reject on save',async t=>{
  const f=await fixture(t);let s=await getLocalRedactionSlide(f);
  for(const rect of [{x:-.1,y:0,width:.1,height:.1},{x:0,y:0,width:0,height:.1},{x:.9,y:0,width:.2,height:.1},{x:NaN,y:0,width:.1,height:.1}]) {
    await assert.rejects(saveLocalRedactionSlide({...f,expectedRevision:s.revision,regions:[{...s.regions[0],rect}],exceptions:[],review:s.review}),/INVALID_REDACTION_REGION/);
  }
  for(const rect of [{x:.13,y:.2,width:.1,height:.08},{x:.6,y:.6,width:.3,height:.08}])await assert.rejects(saveLocalRedactionSlide({...f,expectedRevision:s.revision,regions:[{...s.regions[0],rect}],exceptions:[],review:{reviewer:'tester',layoutAcceptable:true}}),/REQUIRED_REGION_MUST_BE_OPAQUE/);
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
test('located geometry no longer requires per-item inspection before rendering and approving',async t=>{
  const {f,state}=await uncertainFixture(t,{multiple:true});
  assert.deepEqual(redactionHolds(state),[]);assert.deepEqual(state.manualResolutions,[]);
  const rendered=await renderLocalRedactionSlide({...f,expectedRevision:state.revision});
  assert.equal(rendered.status,'rendered');assert.equal(rendered.output.approvedAt,null);
  await assert.rejects(readSafeRedactedSlide(f),/NOT_APPROVED/);
  const approved=await approveLocalRedactionSlide({...f,expectedRevision:rendered.revision,outputHash:rendered.output.sha256,reviewer:state.review.reviewer,outputInspected:true});
  assert.equal(approved.status,'verified');assert.deepEqual(approved.manualResolutions,[]);
  assert.deepEqual(approved.output.checks,{outsidePreserved:true,requiredOpaque:true,metadataStripped:true});
});
test('optional candidates and optional unlocated geometry do not block a manual-only render',async t=>{
  const f=await fixture(t),detection=structuredClone(f.detections[0]);
  detection.candidates[0]={...detection.candidates[0],category:'name',required:false,reason:'OPTIONAL_NAME_REVIEW'};
  detection.warnings.push('REVIEW_CANDIDATE_GEOMETRY_UNRESOLVED_MANUAL_RECT_REQUIRED');
  detection.uncertainties=[{id:'optional-geometry',candidateId:'email-1',code:'TEXT_GEOMETRY_UNRESOLVED',rect:detection.candidates[0].rect}];
  await initializeLocalRedactions({...f,detections:[detection]});let current=await getLocalRedactionSlide(f);
  assert.deepEqual(current.regions,[]);
  current=await saveLocalRedactionSlide({...f,expectedRevision:current.revision,regions:[{id:'manual-only',rect:{x:.6,y:.6,width:.1,height:.1},mode:'blur'}],exceptions:[],review:{reviewer:'synthetic reviewer',layoutAcceptable:true}});
  assert.deepEqual(current.manualResolutions,[]);assert.deepEqual(redactionHolds(current),[]);
  current=await renderLocalRedactionSlide({...f,expectedRevision:current.revision});
  assert.equal(current.status,'rendered');assert.equal(current.review.originalInspected,false);
});

async function storeHistoricalState(f,state) {
  const store=await openPreparationWorkStore({root:f.root});
  try {
    const build=await store.readBuild(f.buildId),relativePath=`redaction/${state.sourceSlideNumber}/historical-${build.revision}.json`;
    await writeFile(await store.prepareArtifactPath(f.buildId,relativePath),JSON.stringify(state));
    await store.recordArtifact({buildId:f.buildId,key:`redaction-state:${state.sourceSlideNumber}`,relativePath,expectedRevision:build.revision});
  } finally { await store.release(); }
}
test('save cannot create a new manual inspection record',async t=>{
  const {f,state}=await uncertainFixture(t);
  await assert.rejects(saveLocalRedactionSlide({...f,expectedRevision:state.revision,regions:state.regions,exceptions:[],review:state.review,
    manualResolutions:[manualResolution(state)]}),/MANUAL_REDACTION_REVIEW_NO_LONGER_ACCEPTED/);
  const current=await getLocalRedactionSlide(f);assert.deepEqual(current.manualResolutions,[]);assert.equal(current.revision,state.revision);
});
test('historical exceptions and inspection records remain readable and exact approved output survives reopening and unchanged save',async t=>{
  const {f,state,detection}=await uncertainFixture(t);
  const historical={...state,exceptions:[{candidateId:'email-1',actor:'historical reviewer',reason:'historical public exception'}]};
  delete historical.savedAt;
  historical.manualResolutions=[manualResolution(historical)];
  await storeHistoricalState(f,historical);
  let current=await getLocalRedactionSlide(f);
  assert.deepEqual(current.exceptions,historical.exceptions);assert.deepEqual(current.manualResolutions,historical.manualResolutions);
  current=await renderLocalRedactionSlide({...f,expectedRevision:current.revision});
  current=await approveLocalRedactionSlide({...f,expectedRevision:current.revision,outputHash:current.output.sha256,reviewer:current.review.reviewer,outputInspected:true});
  const output=structuredClone(current.output),revision=current.revision;
  await initializeLocalRedactions({...f,detections:[detection]});
  current=await getLocalRedactionSlide(f);assert.equal(current.status,'verified');assert.deepEqual(current.output,output);assert.equal(current.revision,revision);
  const fingerprint=redactionInputFingerprint(current);
  current=await saveLocalRedactionSlide({...f,expectedRevision:current.revision,regions:current.regions,exceptions:current.exceptions,
    review:{reviewer:current.review.reviewer,layoutAcceptable:true}});
  assert.equal(current.status,'verified');assert.deepEqual(current.output,output);assert.equal(current.review.originalInspected,true);
  assert.equal(redactionInputFingerprint(current),fingerprint);assert.deepEqual(current.manualResolutions,historical.manualResolutions);
  assert.equal(redactionHash(await readSafeRedactedSlide(f)),output.sha256);
  current=await saveLocalRedactionSlide({...f,expectedRevision:current.revision,regions:[...current.regions,{id:'new-manual',rect:{x:.7,y:.7,width:.1,height:.1},mode:'opaque'}],
    exceptions:current.exceptions,review:{reviewer:current.review.reviewer,layoutAcceptable:true}});
  assert.deepEqual(current.manualResolutions,[]);assert.deepEqual(current.exceptions,historical.exceptions);assert.equal(current.output,null);
});
test('historical manual records still reject a mismatched source or draft while loading',async t=>{
  const {f,state}=await uncertainFixture(t);
  for(const change of [{imageHash:redactionHash('other image')},{editHash:redactionHash('other edits')},{inspectedAtActualSize:false}]) {
    await storeHistoricalState(f,{...state,manualResolutions:[{...manualResolution(state),...change}]});
    await assert.rejects(getLocalRedactionSlide(f),/MANUAL_REDACTION_REVIEW_STALE_OR_INVALID/);
  }
});
test('true incomplete extraction remains blocked without requiring located-item inspection',async t=>{
  for(const warning of ['TEXT_EXTRACTION_INCOMPLETE','SOURCE_SCAN_TRUNCATED','UNSUPPORTED_SOURCE_OBJECT','REQUIRED_CANDIDATE_GEOMETRY_UNRESOLVED_MANUAL_RECT_REQUIRED']) {
    const {f,state}=await uncertainFixture(t,{warnings:[warning]});
    await assert.rejects(renderLocalRedactionSlide({...f,expectedRevision:state.revision}),/INCOMPLETE_DETECTION/);
  }
});
test('previous saved slide uses explicit save order, projects manual masks and excludes initial states',async t=>{
  const f=await fixture(t,[16,9],[1,2,3]),third={...f,sourceSlideNumber:3};
  assert.equal(await getPreviousSavedRedactionSlide(third),null);
  const manual={id:'drawn-2',rect:{x:.6,y:.5,width:.14,height:.12},mode:'blur'};
  let second=await getLocalRedactionSlide({...f,sourceSlideNumber:2});
  second=await saveLocalRedactionSlide({...f,sourceSlideNumber:2,expectedRevision:second.revision,regions:[...second.regions,manual],exceptions:[],review:{reviewer:'second reviewer',layoutAcceptable:true}});
  assert.deepEqual(await getPreviousSavedRedactionSlide(third),{sourceSlideNumber:2,regions:[manual],reviewer:'second reviewer'});
  const first=await review(f);
  assert.deepEqual(await getPreviousSavedRedactionSlide(third),{sourceSlideNumber:1,regions:[],reviewer:first.review.reviewer});
  second=await renderLocalRedactionSlide({...f,sourceSlideNumber:2,expectedRevision:second.revision});
  second=await approveLocalRedactionSlide({...f,sourceSlideNumber:2,expectedRevision:second.revision,outputHash:second.output.sha256,reviewer:second.review.reviewer,outputInspected:true});
  assert.equal((await getPreviousSavedRedactionSlide(third)).sourceSlideNumber,1);
  const oldFingerprint=redactionInputFingerprint(second),oldOutput=structuredClone(second.output);
  second=await saveLocalRedactionSlide({...f,sourceSlideNumber:2,expectedRevision:second.revision,regions:second.regions,exceptions:[],review:{reviewer:second.review.reviewer,layoutAcceptable:true}});
  assert.equal(redactionInputFingerprint(second),oldFingerprint);assert.deepEqual(second.output,oldOutput);
  assert.deepEqual(await getPreviousSavedRedactionSlide(third),{sourceSlideNumber:2,regions:[manual],reviewer:'second reviewer'});
  second.regions[1].unexpectedMetadata='must not leave storage';
  await storeHistoricalState(f,second);
  assert.deepEqual(await getPreviousSavedRedactionSlide(third),{sourceSlideNumber:2,regions:[manual],reviewer:'second reviewer'});
});
test('legacy saved slides without savedAt can prefill the previous reviewer and manual rectangles',async t=>{
  const f=await fixture(t);let current=await getLocalRedactionSlide(f);
  const manual={id:'historical-drawn',rect:{x:.6,y:.6,width:.1,height:.1},mode:'opaque'};
  current=await saveLocalRedactionSlide({...f,expectedRevision:current.revision,regions:[...current.regions,manual],exceptions:[],review:{reviewer:'historical reviewer',layoutAcceptable:true}});
  delete current.savedAt;await storeHistoricalState(f,current);
  assert.deepEqual(await getPreviousSavedRedactionSlide({...f,sourceSlideNumber:2}),{sourceSlideNumber:1,regions:[manual],reviewer:'historical reviewer'});
});
