import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,mkdir,readFile,rm,writeFile} from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import sharp from 'sharp';
import {pptxFixture} from './fixtures.test-support.mjs';
import {inspectPptx,sha256} from './pptx-inspection.ts';
import {prepareLocalPptx} from './pipeline.ts';
import {openPreparationWorkStore} from './work-store.ts';
import {
  approveLocalRedactionSlide,
  getLocalRedactionSlide,
  initializePptxRedactions,
  renderLocalRedactionSlide,
  saveLocalRedactionSlide,
  uploadVerifiedRedactedSlide,
} from './redaction-service.ts';
import {assertFlatRedactionPng,redactionHash} from './redaction-renderer.ts';

const runtime={available:true,powerPointVersion:'synthetic-mock-only',registeredClass:'stub',
  fontInventory:{families:[{english:'Arial',korean:null}],fingerprint:sha256('synthetic-fonts')}};

function mockExporter() {
  const calls=[];
  return {calls,run:async(input,{onSlide})=>{
    calls.push({longEdge:input.longEdge,slideNumbers:[...input.slideNumbers]});
    const width=input.longEdge,height=Math.round(input.longEdge*9/16);
    await mkdir(input.outputDirectory,{recursive:true});
    const slides=[];
    for(const sourceSlideNumber of input.slideNumbers) {
      const file=path.join(input.outputDirectory,`synthetic-${input.longEdge}-${sourceSlideNumber}.png`);
      const png=await sharp(Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}"><rect width="100%" height="100%" fill="#f8fafc"/><rect x="${40+sourceSlideNumber*9}" y="${30+sourceSlideNumber*5}" width="420" height="190" fill="#315a8a"/><circle cx="${width-90}" cy="${height-70}" r="28" fill="#ef8354"/></svg>`)).png().toBuffer();
      await writeFile(file,png);
      const slide={sourceSlideNumber,path:file,width,height};
      slides.push(slide);
      await onSlide(slide);
    }
    return {sourceHash:input.sourceHash,slides,slideWidth:1280,slideHeight:720};
  }};
}

test('synthetic PPTX stays source-bound through local preparation, redaction approval and stub upload',async t=>{
  const sandbox=await mkdtemp(path.join(os.tmpdir(),'woolim-redaction-pipeline-'));
  t.after(()=>rm(sandbox,{recursive:true,force:true}));
  const inheritance={slideNumbers:[],themeLatin:'Arial',themeEastAsian:'Arial'};
  const source=await pptxFixture({count:8,texts:{1:'contact.person@example.test'},inheritance});
  const sourcePath=path.join(sandbox,'input','synthetic.pptx');
  const workRoot=path.join(sandbox,'private-work');
  await mkdir(path.dirname(sourcePath),{recursive:true});
  await writeFile(sourcePath,source);

  const oldFetch=globalThis.fetch;
  globalThis.fetch=()=>{throw new Error('NETWORK_FORBIDDEN');};
  t.after(()=>{globalThis.fetch=oldFetch;});

  const inspected=await inspectPptx(source,{installedFonts:['Arial']});
  const converter=mockExporter();
  const prepared=await prepareLocalPptx({sourcePath,workRoot},{
    runtime:async()=>runtime,
    converterFingerprint:async()=>sha256('synthetic-converter'),
    exportSlides:converter.run,
  });
  assert.equal(prepared.status,'ready_for_local_review');
  assert.deepEqual(converter.calls.map(call=>call.longEdge),[800,2400]);
  assert.equal(prepared.inspection.sourceHash,inspected.sourceHash);
  assert.equal(prepared.inspection.slides[0].contentHash,inspected.slides[0].contentHash);

  const [initialized]=await initializePptxRedactions({root:workRoot,buildId:prepared.buildId,
    source,slideNumbers:[1]});
  const identity={root:workRoot,buildId:prepared.buildId,sourceSlideNumber:1};
  assert.equal(initialized.sourceHash,inspected.sourceHash);
  assert.equal(initialized.slideContentHash,inspected.slides[0].contentHash);
  assert.equal(initialized.candidates.find(candidate=>candidate.category==='email')?.required,true);
  assert.ok(initialized.regions.some(region=>region.mode==='opaque'&&region.candidateId));

  // A different, still-valid PPTX cannot initialize against this prepared
  // build even if it requests the same slide number.
  const changedSource=await pptxFixture({count:8,texts:{1:'changed.person@example.test'},inheritance});
  await assert.rejects(initializePptxRedactions({root:workRoot,buildId:prepared.buildId,
    source:changedSource,slideNumbers:[1]}),/REDACTION_DETECTION_SOURCE_MISMATCH/);
  assert.equal((await getLocalRedactionSlide(identity)).sourceHash,inspected.sourceHash);

  let state=await getLocalRedactionSlide(identity);
  state=await saveLocalRedactionSlide({...identity,expectedRevision:state.revision,
    regions:[...state.regions,{id:'manual-layout-review',rect:{x:.72,y:.72,width:.08,height:.08},mode:'blur'}],
    exceptions:[],review:{reviewer:'합성 로컬 검수자',originalInspected:true,layoutAcceptable:true}});
  state=await renderLocalRedactionSlide({...identity,expectedRevision:state.revision});
  assert.equal(state.status,'rendered');
  state=await approveLocalRedactionSlide({...identity,expectedRevision:state.revision,
    outputHash:state.output.sha256,reviewer:'합성 출력 검수자',outputInspected:true});
  assert.equal(state.status,'verified');

  const store=await openPreparationWorkStore({root:workRoot});
  const highresArtifact=await store.getReusableArtifact(prepared.buildId,'highres:1');
  await store.release();
  assert.ok(highresArtifact);
  const highres=await readFile(highresArtifact.absolutePath);
  let uploads=0;
  const result=await uploadVerifiedRedactedSlide(identity,async(packet,signal)=>{
    uploads++;
    assert.equal(signal.aborted,false);
    assert.deepEqual(Object.keys(packet).sort(),[
      'kind','workId','buildId','sourceSlideNumber','imageHash','ruleVersion','redactionFingerprint','png',
    ].sort());
    for(const forbidden of ['sourceHash','slideContentHash','sourcePath','candidates','warnings']) {
      assert.equal(Object.hasOwn(packet,forbidden),false);
    }
    assert.notDeepEqual(packet.png,highres);
    assertFlatRedactionPng(packet.png);
    assert.equal(packet.imageHash,redactionHash(packet.png));
    return {sha256:packet.imageHash};
  });
  assert.equal(result.cached,false);
  assert.equal(result.imageHash,state.output.sha256);
  assert.equal(uploads,1);
});
