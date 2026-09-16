import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,writeFile,readFile,mkdir,rm} from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import sharp from 'sharp';
import {pptxFixture} from './fixtures.test-support.mjs';
import {prepareLocalPptx} from './pipeline.ts';
import {sha256} from './pptx-inspection.ts';
import {openPreparationWorkStore} from './work-store.ts';
import {initializeLocalMockups,requestLocalMockupSlide,getLocalMockupReview} from './mockup-service.ts';
import {getLocalRedactionSlide} from './redaction-service.ts';
import {preparePendingLocalMockupRequests} from './mockup-request-preparation.ts';

const converterFingerprint=sha256('synthetic-request-converter-v1');
const runtime=(font='request-font-v1')=>({available:true,powerPointVersion:'mock-only',registeredClass:'stub',
  fontInventory:{families:[{english:'Arial',korean:null}],fingerprint:sha256(font)}});

function exporter({failAfter=Infinity}={}) {
  const calls=[];let completed=0;
  return {calls,run:async(input,{onSlide})=>{
    calls.push({edge:input.longEdge,numbers:[...input.slideNumbers]});
    const ratio=input.expectedSlideWidth/input.expectedSlideHeight;
    const width=Math.round(input.longEdge*Math.min(1,ratio)),height=Math.round(input.longEdge*Math.min(1,1/ratio));
    await mkdir(input.outputDirectory,{recursive:true});
    const slides=[];
    for(const n of input.slideNumbers) {
      if(completed++>=failAfter)throw new Error('SIMULATED_REQUEST_INTERRUPTION');
      const file=path.join(input.outputDirectory,`request-slide-${n}.png`);
      const png=await sharp(Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}"><rect width="100%" height="100%" fill="white"/><rect x="${20+n}" y="20" width="${100+n}" height="120" fill="#345678"/><text x="40" y="190" font-size="24">slide ${n}</text></svg>`)).png().toBuffer();
      await writeFile(file,png);
      const slide={sourceSlideNumber:n,path:file,width,height};slides.push(slide);await onSlide(slide);
    }
    return {sourceHash:input.sourceHash,slides,slideWidth:input.expectedSlideWidth,slideHeight:input.expectedSlideHeight};
  }};
}

async function setup(t,{hidden=[],customPortrait=false}={}) {
  const sandbox=await mkdtemp(path.join(os.tmpdir(),'woolim-request-preparation-'));
  t.after(()=>rm(sandbox,{recursive:true,force:true}));
  const sourcePath=path.join(sandbox,'input','source.pptx'),workRoot=path.join(sandbox,'private-work');
  await mkdir(path.dirname(sourcePath));
  await writeFile(sourcePath,await pptxFixture({count:20,hidden,...(customPortrait?{ratio:[612.25,858.8750393700788]}:{})}));
  const sourceFormatChoice=customPortrait?{kind:'custom_portrait_to_a4',aspectClass:'a4_portrait',sourceHash:sha256(await readFile(sourcePath)),reviewedBy:'synthetic reviewer',reason:'Explicit portrait source review'}:undefined;
  const initialExporter=exporter();
  const prepared=await prepareLocalPptx({sourcePath,workRoot,sourceFormatChoice},{runtime:async()=>runtime(),
    converterFingerprint:async()=>converterFingerprint,exportSlides:initialExporter.run});
  assert.equal(prepared.status,'ready_for_local_review');
  let review=await initializeLocalMockups({root:workRoot,buildId:prepared.buildId,title:'합성 요청 연결 검사'});
  assert.ok(review.state);
  return {sandbox,sourcePath,workRoot,prepared,review,initialExporter};
}

function dependencies(exportSlides,runtimeValue=runtime()) {
  return {runtime:async()=>runtimeValue,converterFingerprint:async()=>converterFingerprint,exportSlides};
}

async function requestSlides(f,numbers) {
  let review=f.review;
  for(const sourceSlideNumber of numbers) {
    review=await requestLocalMockupSlide({root:f.workRoot,buildId:f.prepared.buildId,
      expectedRevision:review.revision,sourceSlideNumber,reason:`${sourceSlideNumber}번 새 후보를 준비해 주세요`});
  }
  f.review=review;
  return review.requests.filter(request=>numbers.includes(request.sourceSlideNumber));
}

async function ledger(root,buildId) {
  const store=await openPreparationWorkStore({root});
  try {
    const work=await store.readWork(),build=await store.readBuild(buildId);
    const state=await store.getReusableArtifact(buildId,'mockup-state');
    return {work,build,stateBytes:state?await readFile(state.absolutePath):null};
  } finally {await store.release();}
}

test('an explicit pending request adds only that candidate, creates highres and opens manual redaction without approval',async t=>{
  const f=await setup(t);const oldFetch=globalThis.fetch;globalThis.fetch=()=>{throw new Error('NETWORK_FORBIDDEN');};t.after(()=>globalThis.fetch=oldFetch);
  const requested=f.prepared.selection.slides.find(row=>row.disposition==='candidate').sourceSlideNumber;
  const [request]=await requestSlides(f,[requested]);
  const store=await openPreparationWorkStore({root:f.workRoot});
  const work=await store.readWork();await store.setActiveSetRef({expectedRevision:work.revision,activeSetRef:{setId:'existing-active-set',buildId:null}});await store.release();
  const before=await ledger(f.workRoot,f.prepared.buildId),conversion=exporter();
  const result=await preparePendingLocalMockupRequests({sourcePath:f.sourcePath,workRoot:f.workRoot,
    buildId:f.prepared.buildId,requestIds:[request.id]},dependencies(conversion.run));
  assert.equal(result.status,'ready_for_manual_redaction');assert.equal(result.prepared.length,1);
  assert.deepEqual(conversion.calls,[{edge:2400,numbers:[requested]}]);
  assert.equal(result.prepared[0].highResolution,'created');assert.notEqual(result.prepared[0].redactionStatus,'verified');
  const redaction=await getLocalRedactionSlide({root:f.workRoot,buildId:f.prepared.buildId,sourceSlideNumber:requested});
  assert.equal(redaction.output,null);assert.equal(redaction.review.originalInspected,false);
  const after=await ledger(f.workRoot,f.prepared.buildId),selection=after.build.stages.slide_selection.data;
  assert.deepEqual(selection.selected,before.build.stages.slide_selection.data.selected);
  assert.deepEqual(selection.reserves,[...before.build.stages.slide_selection.data.reserves,requested]);
  assert.deepEqual(after.stateBytes,before.stateBytes);assert.deepEqual(after.work.activeSetRef,{setId:'existing-active-set',buildId:null});
  const review=await getLocalMockupReview({root:f.workRoot,buildId:f.prepared.buildId});
  assert.equal(review.requests.find(item=>item.id===request.id).status,'pending');
  assert.equal(review.candidates.find(item=>item.sourceSlideNumber===requested).status,'needs_redaction');
});

test('custom portrait follow-up preparation preserves the exact source format choice and never auto-approves',async t=>{
  const f=await setup(t,{customPortrait:true});
  assert.equal(f.prepared.inspection.aspect,'unknown');
  assert.equal(f.review.aspectClass,'a4_portrait');
  const requested=f.prepared.selection.slides.find(row=>row.disposition==='candidate').sourceSlideNumber;
  await requestSlides(f,[requested]);
  const before=await ledger(f.workRoot,f.prepared.buildId),conversion=exporter();
  const result=await preparePendingLocalMockupRequests({sourcePath:f.sourcePath,workRoot:f.workRoot,buildId:f.prepared.buildId},dependencies(conversion.run));
  assert.equal(result.status,'ready_for_manual_redaction');assert.equal(result.prepared[0].sourceSlideNumber,requested);
  const after=await ledger(f.workRoot,f.prepared.buildId);
  assert.deepEqual(after.build.artifacts['source-format-choice'],before.build.artifacts['source-format-choice']);
  assert.deepEqual(after.stateBytes,before.stateBytes);
  assert.notEqual(result.prepared[0].redactionStatus,'verified');
});

test('a conversion interruption leaves the prior selection and mockup usable, then restart reuses the completed page',async t=>{
  const f=await setup(t),candidates=f.prepared.selection.slides.filter(row=>row.disposition==='candidate').slice(0,2).map(row=>row.sourceSlideNumber);
  await requestSlides(f,candidates);const before=await ledger(f.workRoot,f.prepared.buildId),interrupted=exporter({failAfter:1});
  await assert.rejects(preparePendingLocalMockupRequests({sourcePath:f.sourcePath,workRoot:f.workRoot,
    buildId:f.prepared.buildId},dependencies(interrupted.run)),/SIMULATED_REQUEST_INTERRUPTION/);
  const failed=await ledger(f.workRoot,f.prepared.buildId);
  assert.equal(failed.build.selectionFingerprint,before.build.selectionFingerprint);
  assert.deepEqual(failed.build.stages.slide_selection.data,before.build.stages.slide_selection.data);
  assert.deepEqual(failed.build.stages.high_resolution_conversion,before.build.stages.high_resolution_conversion);
  assert.deepEqual(failed.stateBytes,before.stateBytes);
  assert.ok((await getLocalMockupReview({root:f.workRoot,buildId:f.prepared.buildId})).state);
  const resumed=exporter(),result=await preparePendingLocalMockupRequests({sourcePath:f.sourcePath,workRoot:f.workRoot,
    buildId:f.prepared.buildId},dependencies(resumed.run));
  assert.deepEqual(resumed.calls,[{edge:2400,numbers:[candidates[1]]}]);
  assert.deepEqual(result.prepared.map(item=>item.highResolution),['reused','created']);
  assert.ok(result.prepared.every(item=>item.redactionStatus!=='verified'));
});

test('an excluded requested slide remains held without changing selection, artifacts, approvals or active output',async t=>{
  const f=await setup(t,{hidden:[20]});const [request]=await requestSlides(f,[20]);const before=await ledger(f.workRoot,f.prepared.buildId),conversion=exporter();
  const result=await preparePendingLocalMockupRequests({sourcePath:f.sourcePath,workRoot:f.workRoot,
    buildId:f.prepared.buildId,requestIds:[request.id]},dependencies(conversion.run));
  assert.equal(result.status,'held');assert.equal(result.prepared.length,0);assert.equal(result.holds[0].sourceSlideNumber,20);
  assert.equal(result.holds[0].code,'SLIDE_NOT_ELIGIBLE');assert.equal(conversion.calls.length,0);
  const after=await ledger(f.workRoot,f.prepared.buildId);
  assert.equal(after.build.selectionFingerprint,before.build.selectionFingerprint);
  assert.deepEqual(after.build.stages.high_resolution_conversion,before.build.stages.high_resolution_conversion);
  assert.deepEqual(after.stateBytes,before.stateBytes);
  await assert.rejects(getLocalRedactionSlide({root:f.workRoot,buildId:f.prepared.buildId,sourceSlideNumber:20}),/SLIDE_NOT_SELECTED/);
});

test('a request for an already converted slide initializes redaction only and does not rewrite the selection',async t=>{
  const f=await setup(t),requested=f.prepared.selection.selected[0];const [request]=await requestSlides(f,[requested]);
  const before=await ledger(f.workRoot,f.prepared.buildId),conversion=exporter();
  const result=await preparePendingLocalMockupRequests({sourcePath:f.sourcePath,workRoot:f.workRoot,
    buildId:f.prepared.buildId,requestIds:[request.id]},dependencies(conversion.run));
  assert.equal(result.prepared[0].highResolution,'reused');assert.equal(conversion.calls.length,0);
  const after=await ledger(f.workRoot,f.prepared.buildId);
  assert.equal(after.build.selectionRevision,before.build.selectionRevision);
  assert.equal(after.build.selectionFingerprint,before.build.selectionFingerprint);
  assert.equal((await getLocalRedactionSlide({root:f.workRoot,buildId:f.prepared.buildId,sourceSlideNumber:requested})).output,null);
});

test('changed font or converter context requires a separate build before any request output is written',async t=>{
  const f=await setup(t),requested=f.prepared.selection.slides.find(row=>row.disposition==='candidate').sourceSlideNumber;
  await requestSlides(f,[requested]);const before=await ledger(f.workRoot,f.prepared.buildId),conversion=exporter();
  await assert.rejects(preparePendingLocalMockupRequests({sourcePath:f.sourcePath,workRoot:f.workRoot,
    buildId:f.prepared.buildId},dependencies(conversion.run,runtime('different-font'))),/ENVIRONMENT_CHANGED_NEW_BUILD_REQUIRED/);
  const after=await ledger(f.workRoot,f.prepared.buildId);
  assert.equal(conversion.calls.length,0);assert.equal(after.build.revision,before.build.revision);
  assert.equal(after.build.selectionFingerprint,before.build.selectionFingerprint);assert.deepEqual(after.stateBytes,before.stateBytes);
});
