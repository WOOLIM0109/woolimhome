import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,writeFile,readFile,mkdir,rm} from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import sharp from 'sharp';
import {pptxFixture} from './fixtures.test-support.mjs';
import {prepareLocalPptx} from './pipeline.ts';
import {sha256} from './pptx-inspection.ts';
const runtime=(font='initial')=>({available:true,powerPointVersion:'mock-only',registeredClass:'stub',fontInventory:{families:[{english:'Arial',korean:null}],fingerprint:sha256(font)}});
async function setup(t,options={}) {
  const root=await mkdtemp(path.join(os.tmpdir(),'woolim-preparation-test-'));
  t.after(()=>rm(root,{recursive:true,force:true}));
  const sourcePath=path.join(root,'input','source.pptx'),workRoot=path.join(root,'private-work');
  await mkdir(path.dirname(sourcePath));
  await writeFile(sourcePath,await pptxFixture(options));
  return {sourcePath,workRoot,root};
}
function exporter({ratio=[16,9],failAfter=Infinity,mutate}={}) {
  const calls=[];let done=0;
  return {calls,run:async(input,{onSlide})=>{
    calls.push({edge:input.longEdge,numbers:[...input.slideNumbers]});
    const width=Math.round(input.longEdge*Math.min(1,ratio[0]/ratio[1])),height=Math.round(input.longEdge*Math.min(1,ratio[1]/ratio[0]));
    await mkdir(input.outputDirectory,{recursive:true});
    const slides=[];
    for(const n of input.slideNumbers) {
      if(done++>=failAfter)throw new Error('SIMULATED_INTERRUPTION');
      const file=path.join(input.outputDirectory,`slide-${n}.png`);
      const png=await sharp(Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}"><rect width="100%" height="100%" fill="white"/><rect x="${n*7}" y="20" width="${50+n*3}" height="120" fill="#123456"/></svg>`)).png().toBuffer();
      await writeFile(file,png);if(mutate)await mutate();
      const slide={sourceSlideNumber:n,path:file,width,height};slides.push(slide);await onSlide(slide);
    }
    return {sourceHash:input.sourceHash,slides,slideWidth:720*ratio[0]/ratio[1],slideHeight:720};
  }};
}
test('local two-pass pipeline exports all previews but highres only selected+real reserves; no API',async(t)=>{
  const f=await setup(t,{count:20,hidden:[18],empty:[19],fonts:{20:'Missing font'}}),e=exporter();
  const old=globalThis.fetch;globalThis.fetch=()=>{throw new Error('NETWORK_FORBIDDEN');};t.after(()=>globalThis.fetch=old);
  const r=await prepareLocalPptx(f,{runtime:async()=>runtime(),exportSlides:e.run});
  assert.equal(r.status,'ready_for_local_review');assert.equal(r.counts.total,20);
  assert.equal(r.counts.previews+r.counts.explicitlyExcluded,20);
  assert.equal(e.calls[0].edge,800);assert.equal(e.calls[1].edge,2400);
  assert.deepEqual(e.calls[1].numbers,[...r.selection.selected,...r.selection.reserves]);
  assert.ok(!e.calls[1].numbers.includes(20));assert.equal(r.counts.highResolution,16);
  const again=exporter(),second=await prepareLocalPptx(f,{runtime:async()=>runtime(),exportSlides:again.run});
  assert.equal(second.buildId,r.buildId);assert.equal(again.calls.length,0);
});
test('interruption after three pages survives disk reload and resumes remaining pages only',async(t)=>{
  const f=await setup(t),first=exporter({failAfter:3});
  await assert.rejects(prepareLocalPptx(f,{runtime:async()=>runtime(),exportSlides:first.run}),/SIMULATED_INTERRUPTION/);
  const resumed=exporter(),r=await prepareLocalPptx(f,{runtime:async()=>runtime(),exportSlides:resumed.run});
  assert.equal(r.resumed,true);assert.deepEqual(resumed.calls[0].numbers.slice(0,3),[4,5,6]);
  const ledger=JSON.parse(await readFile(path.join(f.workRoot,'builds',r.buildId,'record.json'),'utf8'));
  assert.ok(ledger.stages.high_resolution_conversion);assert.ok(ledger.artifacts['preview:1']);
});
test('selection change reuses all previews/highres; changed font fingerprint creates new build',async(t)=>{
  const f=await setup(t,{count:22}),e=exporter();
  const first=await prepareLocalPptx(f,{runtime:async()=>runtime(),exportSlides:e.run});
  const override=exporter();
  const next=await prepareLocalPptx({...f,selectedSlideNumbers:[1,2,3,4,5,6,7,22]},{runtime:async()=>runtime(),exportSlides:override.run});
  assert.equal(first.buildId,next.buildId);assert.ok(override.calls.every(c=>c.edge===2400));assert.ok(override.calls.flatMap(c=>c.numbers).includes(22));
  const changed=exporter();const newest=await prepareLocalPptx(f,{runtime:async()=>runtime('font-changed'),exportSlides:changed.run});
  assert.notEqual(newest.buildId,first.buildId);assert.equal(changed.calls[0].numbers[0],1);
});
test('original changes during export prevent completion and unsafe source types fail',async(t)=>{
  const f=await setup(t),e=exporter({mutate:async()=>writeFile(f.sourcePath,'changed')});
  await assert.rejects(prepareLocalPptx(f,{runtime:async()=>runtime(),exportSlides:e.run}),/SOURCE_CHANGED/);
  await assert.rejects(prepareLocalPptx({...f,sourcePath:'unsafe.pptm'}),/PPTX_REQUIRED/);
});
test('unsupported 4:3 records a hold without starting PowerPoint exports',async(t)=>{
  const f=await setup(t,{ratio:[4,3]}),e=exporter({ratio:[4,3]});
  const r=await prepareLocalPptx(f,{runtime:async()=>runtime(),exportSlides:e.run});
  assert.equal(r.status,'held');assert.equal(e.calls.length,0);
});
test('changed converter implementation starts a new build rather than reusing old PNGs',async(t)=>{
  const f=await setup(t,{count:8}),first=exporter();
  const a=await prepareLocalPptx(f,{runtime:async()=>runtime(),converterFingerprint:async()=>sha256('converter-A'),exportSlides:first.run});
  const second=exporter();
  const b=await prepareLocalPptx(f,{runtime:async()=>runtime(),converterFingerprint:async()=>sha256('converter-B'),exportSlides:second.run});
  assert.notEqual(a.buildId,b.buildId);assert.equal(second.calls[0].numbers.length,8);
});
test('missing highres artifact alone is rebuilt; original bytes and previous files stay intact',async(t)=>{
  const f=await setup(t,{count:8}),e=exporter();
  const sourceBefore=await readFile(f.sourcePath);
  const r=await prepareLocalPptx(f,{runtime:async()=>runtime(),exportSlides:e.run});
  const record=JSON.parse(await readFile(path.join(f.workRoot,'builds',r.buildId,'record.json'),'utf8'));
  const damaged=path.join(f.workRoot,'builds',r.buildId,'artifacts',record.artifacts['highres:2'].relativePath);
  await writeFile(damaged,'synthetic corruption');
  const again=exporter();
  await prepareLocalPptx(f,{runtime:async()=>runtime(),exportSlides:again.run});
  assert.deepEqual(again.calls,[{edge:2400,numbers:[2]}]);
  assert.deepEqual(await readFile(f.sourcePath),sourceBefore);
});
test('three approved ratios validate long-edge conversion and insufficient decks hold without highres',async(t)=>{
  for(const ratio of [[297,210],[210,297]]) {
    const f=await setup(t,{ratio,count:9}),e=exporter({ratio});
    assert.equal((await prepareLocalPptx(f,{runtime:async()=>runtime(),exportSlides:e.run})).status,'ready_for_local_review');
  }
  const f=await setup(t,{count:3}),e=exporter();
  const r=await prepareLocalPptx(f,{runtime:async()=>runtime(),exportSlides:e.run});
  assert.equal(r.status,'held');assert.equal(e.calls.length,1);
});

test('custom portrait requires an explicit original-hash choice; it keeps raw inspection and starts a bound build',async(t)=>{
  const ratio=[612.25,858.8750393700788],f=await setup(t,{ratio,count:9}),e=exporter({ratio});
  const deps={runtime:async()=>runtime(),exportSlides:e.run};
  const held=await prepareLocalPptx(f,deps);
  assert.equal(held.status,'held');assert.equal(e.calls.length,0);
  const sourceFormatChoice={kind:'custom_portrait_to_a4',aspectClass:'a4_portrait',sourceHash:sha256(await readFile(f.sourcePath)),reviewedBy:'local-reviewer',reason:'실제 세로 원본 비율을 유지하여 A4 슬롯 적용'};
  const ready=await prepareLocalPptx({...f,sourceFormatChoice},deps);
  assert.equal(ready.status,'ready_for_local_review');assert.equal(ready.inspection.aspect,'unknown');
  assert.notEqual(ready.buildId,held.buildId);assert.ok(ready.counts.highResolution>0);
  const record=JSON.parse(await readFile(path.join(f.workRoot,'builds',ready.buildId,'record.json'),'utf8'));
  assert.ok(record.stages.source_inspection.artifactKeys.includes('source-format-choice'));
  assert.equal(record.stages.source_inspection.data.aspect,'unknown');
  const again=exporter({ratio}),resumed=await prepareLocalPptx({...f,sourceFormatChoice},{...deps,exportSlides:again.run});
  assert.equal(resumed.buildId,ready.buildId);assert.equal(again.calls.length,0);
  await assert.rejects(prepareLocalPptx({...f,sourceFormatChoice:{...sourceFormatChoice,sourceHash:'a'.repeat(64)}},deps),/SOURCE_FORMAT_SOURCE_MISMATCH/);
  const changed=await prepareLocalPptx({...f,sourceFormatChoice:{...sourceFormatChoice,reason:'다시 검토한 규격 선택 사유'}},deps);
  assert.notEqual(changed.buildId,ready.buildId);
});

test('artwork evidence artifacts store only validated projected fields, never extra local JSON content',async(t)=>{
  const f=await setup(t,{count:9,backgroundPictureKinds:{1:'photo'}}),initial=exporter();
  const deps={runtime:async()=>runtime(),exportSlides:initial.run};
  const first=await prepareLocalPptx(f,deps);
  assert.notEqual(first.selection.cover,1);
  const firstRecord=JSON.parse(await readFile(path.join(f.workRoot,'builds',first.buildId,'record.json'),'utf8'));
  const expected={sourceHash:first.inspection.sourceHash,slideContentHash:first.inspection.slides[0].contentHash,
    previewHash:firstRecord.artifacts['preview:1'].sha256,sourceSlideNumber:1,classification:'abstract_graphic',
    reviewedBy:'Synthetic reviewer',reason:'Synthetic explicit classification review, not customer content',inspectedAtFullResolution:true};
  const input={...expected,reviewedBy:` ${expected.reviewedBy} `,reason:` ${expected.reason} `,
    sourcePath:'private-source-location',extractedText:'private source text',extra:{nested:'not evidence'}};
  const again=exporter();
  const reviewed=await prepareLocalPptx({...f,artworkReviews:[input]},{...deps,exportSlides:again.run});
  assert.equal(reviewed.buildId,first.buildId);assert.equal(reviewed.status,'ready_for_local_review');
  assert.equal(reviewed.selection.cover,1);assert.ok(again.calls.every(call=>call.edge===2400));
  const record=JSON.parse(await readFile(path.join(f.workRoot,'builds',reviewed.buildId,'record.json'),'utf8'));
  const artifactPath=path.join(f.workRoot,'builds',reviewed.buildId,'artifacts',record.artifacts['artwork-reviews'].relativePath);
  const saved=await readFile(artifactPath,'utf8');
  assert.deepEqual(JSON.parse(saved),[expected]);
  assert.deepEqual(record.stages.slide_selection.data.artworkReviews,[expected]);
  assert.doesNotMatch(saved,/sourcePath|extractedText|nested|private-source|private source/);
});
