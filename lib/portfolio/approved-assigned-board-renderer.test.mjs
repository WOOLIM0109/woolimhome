import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import test from "node:test";
import sharp from "sharp";

import {
  approvedBoardRendererFingerprint,
  compareApprovedBoardDraftAndFinal,
  renderApprovedBoardDebugOverlay,
  renderAssignedApprovedBoard,
} from "./approved-assigned-board-renderer.ts";
import { renderApprovedMockup } from "./approved-16x9-renderer.ts";
import { resolveApprovedMockupSlots } from "./approved-16x9-templates.ts";
import {
  APPROVED_MOCKUP_SUITES,
  approvedMockupSuiteTemplates,
} from "./approved-mockup-suites.ts";

const SOURCE_SIZES = {
  "16:9": [320, 180],
  a4_landscape: [297, 210],
  a4_portrait: [210, 297],
};

const hash=(value)=>createHash("sha256").update(value).digest("hex");

async function sampleSlide(aspectClass,index,variant=0) {
  const [width,height]=SOURCE_SIZES[aspectClass];
  return {index,buffer:await sharp({create:{width,height,channels:3,background:{
    r:(31+index*43+variant*17)%256,
    g:(79+index*61+variant*29)%256,
    b:(137+index*37+variant*47)%256,
  }}}).composite([{input:Buffer.from(`<svg width="${width}" height="${height}" xmlns="http://www.w3.org/2000/svg"><rect x="${8+index}" y="${10+index}" width="${Math.max(12,width/3)}" height="${Math.max(12,height/4)}" fill="#ffffff"/><circle cx="${width-20}" cy="${height-18}" r="9" fill="#111827"/></svg>`)}]).png().toBuffer()};
}

async function assignedSlides(aspectClass,count,variantAt=-1) {
  return Promise.all(Array.from({length:count},(_,index)=>sampleSlide(
    aspectClass,index,index===variantAt?11:0,
  )));
}

test("legacy renderer default remains byte-identical to explicit full-size JPEG",async()=>{
  const suite=APPROVED_MOCKUP_SUITES.find(candidate=>candidate.aspectClass==="16:9");
  const template=suite.bodyTemplates[2];
  const slides=await assignedSlides(suite.aspectClass,resolveApprovedMockupSlots(template).length);
  const legacy=await renderApprovedMockup({template,slides});
  const explicit=await renderApprovedMockup({template,slides,scale:1,outputFormat:"jpeg"});
  assert.deepEqual(legacy,explicit);
  const metadata=await sharp(legacy.bytes).metadata();
  assert.equal(metadata.format,"jpeg");
  assert.deepEqual([legacy.width,legacy.height],[template.canvas.width,template.canvas.height]);
});

test("all 15 approved boards render draft and final directly from one geometry",{
  timeout:180_000,
},async()=>{
  let renderedCount=0;
  let clippedCount=0;
  for(const suite of APPROVED_MOCKUP_SUITES) {
    for(const template of approvedMockupSuiteTemplates(suite)) {
      const slots=resolveApprovedMockupSlots(template);
      const slides=await assignedSlides(suite.aspectClass,slots.length);
      const draft=await renderAssignedApprovedBoard({aspectClass:suite.aspectClass,
        templateId:template.id,slides,title:"합성 목업 기하 검증",scale:.5});
      const final=await renderAssignedApprovedBoard({aspectClass:suite.aspectClass,
        templateId:template.id,slides,title:"합성 목업 기하 검증",scale:1});
      renderedCount++;

      for(const result of [draft,final]) {
        const metadata=await sharp(result.bytes).metadata();
        const debugMetadata=await sharp(result.debugBytes).metadata();
        assert.equal(result.format,"png");
        assert.equal(result.manifest.schemaVersion,2);
        assert.equal(result.manifest.format,"png");
        assert.equal(result.manifest.rasterization,"direct");
        assert.match(result.outputName,/\.png$/);
        assert.equal(metadata.format,"png");
        assert.equal(debugMetadata.format,"png");
        assert.deepEqual([metadata.width,metadata.height],[result.width,result.height]);
        assert.deepEqual([debugMetadata.width,debugMetadata.height],[result.width,result.height]);
        assert.notDeepEqual(result.bytes,result.debugBytes);
        assert.equal(result.manifest.slots.length,slots.length);
        assert.deepEqual(result.manifest.slots.map(slot=>slot.slotId),slots.map(slot=>slot.id));
        assert.deepEqual(result.manifest.slots.map(slot=>slot.slotIndex),slots.map((_,index)=>index));
        assert.deepEqual(result.manifest.slots.map(slot=>slot.sourceSlideIndex),slides.map(slide=>slide.index));
        assert.deepEqual(result.manifest.slots.map(slot=>slot.z),slots.map(slot=>slot.z));
        assert.deepEqual(result.manifest.slots.map(slot=>slot.allowCanvasClip),slots.map(slot=>slot.allowCanvasClip));
        assert.deepEqual(result.manifest.layerOrder,[...template.layerOrder]);
        assert.equal(result.manifest.geometryHash,result.geometryHash);
        assert.equal(result.manifest.rendererFingerprint,result.rendererFingerprint);
        assert.ok(result.manifest.slots.every(slot=>slot.transformedCorners.length===4));
        assert.ok(result.manifest.slots.every(slot=>slot.sourceFit===undefined));
        assert.ok(result.manifest.slots.every(slot=>slot.contentHash===slot.renderInputHash));
        assert.deepEqual(result.manifest.slots.map(({slotId,rasterPlacement})=>({slotId,rasterPlacement})),
          result.slotAssignments.map(({slotId,rasterPlacement})=>({slotId,rasterPlacement})));
        for(const slot of result.manifest.slots) {
          const placement=slot.rasterPlacement;
          for(const value of Object.values(placement).filter(value=>typeof value==="number")) {
            assert.equal(Number.isInteger(value),true);
          }
          assert.ok(placement.visibleWidth>0);
          assert.ok(placement.visibleHeight>0);
          assert.ok(placement.sourceLeft>=0);
          assert.ok(placement.sourceTop>=0);
          assert.ok(placement.destinationLeft>=0);
          assert.ok(placement.destinationTop>=0);
          assert.ok(placement.sourceLeft+placement.visibleWidth<=placement.rotatedWidth);
          assert.ok(placement.sourceTop+placement.visibleHeight<=placement.rotatedHeight);
          assert.ok(placement.destinationLeft+placement.visibleWidth<=result.width);
          assert.ok(placement.destinationTop+placement.visibleHeight<=result.height);
          const actuallyClipped=placement.sourceLeft!==0||placement.sourceTop!==0
            ||placement.visibleWidth!==placement.rotatedWidth
            ||placement.visibleHeight!==placement.rotatedHeight;
          assert.equal(placement.clipped,actuallyClipped);
          if(placement.clipped) {
            clippedCount++;
            assert.equal(slot.allowCanvasClip,true);
          }
        }
      }
      assert.deepEqual([draft.width,draft.height],
        [Math.round(template.canvas.width*.5),Math.round(template.canvas.height*.5)]);
      assert.deepEqual([final.width,final.height],[template.canvas.width,template.canvas.height]);
      const comparison=compareApprovedBoardDraftAndFinal(draft.manifest,final.manifest);
      assert.equal(comparison.passed,true,`${template.id}: ${comparison.errors.join("; ")}`);
      assert.ok(comparison.maxDeviationPx<=1);
      assert.deepEqual(final.slotAssignments.map(({x,y,width,height})=>({x,y,width,height})),
        draft.slotAssignments.map(({x,y,width,height})=>({x:x*2,y:y*2,width:width*2,height:height*2})));
      for(const [slotIndex,draftSlot] of draft.manifest.slots.entries()) {
        const finalSlot=final.manifest.slots[slotIndex];
        for(const [layerIndex,draftLayer] of draftSlot.shadow.layers.entries()) {
          const finalLayer=finalSlot.shadow.layers[layerIndex];
          assert.equal(draftLayer.dx*2,finalLayer.dx);
          assert.equal(draftLayer.dy*2,finalLayer.dy);
          assert.equal(draftLayer.blur*2,finalLayer.blur);
          assert.equal(draftLayer.opacity,finalLayer.opacity);
        }
      }
    }
  }
  assert.equal(renderedCount,15);
  assert.ok(clippedCount>0,"at least one approved canvas crop must be exercised");
});

test("explicit PowerPoint A4 source-fit preserves approved hashes and records deterministic white padding",{
  timeout:60_000,
},async()=>{
  const suite=APPROVED_MOCKUP_SUITES.find(candidate=>candidate.aspectClass==="a4_landscape");
  const template=suite.bodyTemplates[0];
  const capacity=resolveApprovedMockupSlots(template).length;
  const slides=await Promise.all(Array.from({length:capacity},async(_,index)=>({
    index,
    buffer:await sharp({create:{width:260,height:180,channels:3,background:{
      r:40+index*35,g:95+index*27,b:150+index*19,
    }}}).composite([{input:Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="260" height="180"><rect x="${18+index*7}" y="24" width="80" height="54" fill="#ffffff"/></svg>`)}]).png().toBuffer(),
  })));
  const base={aspectClass:suite.aspectClass,templateId:template.id,slides,scale:.5,
    a4SourceFit:{sourceWidth:780,sourceHeight:540,aspectClass:"a4_landscape",sourceKind:"powerpoint_a4_preset"}};
  await assert.rejects(renderAssignedApprovedBoard({...base,a4SourceFit:undefined}),/비율이 a4_landscape 템플릿과 다릅니다/);
  const draft=await renderAssignedApprovedBoard(base);
  const final=await renderAssignedApprovedBoard({...base,scale:1});
  assert.equal(compareApprovedBoardDraftAndFinal(draft.manifest,final.manifest).passed,true);
  for(const [index,slot] of final.manifest.slots.entries()) {
    assert.equal(slot.contentHash,hash(slides[index].buffer));
    assert.notEqual(slot.renderInputHash,slot.contentHash);
    assert.equal(slot.renderInputHash,slot.sourceFit.resultHash);
    assert.equal(slot.sourceFit.sourceHash,slot.contentHash);
    assert.equal(slot.sourceFit.targetAspectClass,"a4_landscape");
    assert.deepEqual([slot.sourceFit.sourcePixelWidth,slot.sourceFit.sourcePixelHeight],[260,180]);
    assert.deepEqual([slot.sourceFit.targetWidth,slot.sourceFit.targetHeight],[260,184]);
    assert.deepEqual(slot.sourceFit.padding,{top:2,right:0,bottom:2,left:0});
    assert.equal(slot.sourceFit.crop,false);
    assert.equal(slot.sourceFit.scale,1);
  }
  assert.deepEqual(draft.manifest.slots.map(slot=>slot.sourceFit),final.manifest.slots.map(slot=>slot.sourceFit));
});

test("A4 source-fit rejects suite mismatch plus duplicate raw or derived inputs",async()=>{
  const suite=APPROVED_MOCKUP_SUITES.find(candidate=>candidate.aspectClass==="a4_landscape");
  const template=suite.bodyTemplates[0];
  const capacity=resolveApprovedMockupSlots(template).length;
  const visual=sharp({create:{width:260,height:180,channels:3,background:"#7288a8"}});
  const [lowCompression,highCompression]=await Promise.all([
    visual.clone().png({compressionLevel:0}).toBuffer(),
    visual.clone().png({compressionLevel:9}).toBuffer(),
  ]);
  assert.notEqual(hash(lowCompression),hash(highCompression));
  const slides=await Promise.all(Array.from({length:capacity},async(_,index)=>({index,buffer:index===0?lowCompression:index===1?highCompression:
    await sharp({create:{width:260,height:180,channels:3,background:{r:40+index*70,g:70,b:100}}}).png().toBuffer()})));
  const fit={sourceWidth:780,sourceHeight:540,aspectClass:"a4_landscape",sourceKind:"powerpoint_a4_preset"};
  await assert.rejects(renderAssignedApprovedBoard({aspectClass:suite.aspectClass,templateId:template.id,
    slides,scale:.5,a4SourceFit:fit}),/목업 입력 PNG 해시가 중복됐습니다/);
  await assert.rejects(renderAssignedApprovedBoard({aspectClass:suite.aspectClass,templateId:template.id,
    slides:await assignedSlides(suite.aspectClass,capacity),scale:.5,
    a4SourceFit:{...fit,aspectClass:"a4_portrait"}}),/원본 맞춤 규격과 승인 목업 세트 규격이 다릅니다/);
  const wideSuite=APPROVED_MOCKUP_SUITES.find(candidate=>candidate.aspectClass==="16:9");
  const wideTemplate=wideSuite.thumbnail;
  await assert.rejects(renderAssignedApprovedBoard({aspectClass:wideSuite.aspectClass,templateId:wideTemplate.id,
    slides:await assignedSlides("16:9",resolveApprovedMockupSlots(wideTemplate).length),scale:.5,a4SourceFit:fit}),/승인된 A4 가로형 또는 세로형 세트/);
});

test("the strict PNG renderer and debug proof are deterministic",{timeout:60_000},async()=>{
  const suite=APPROVED_MOCKUP_SUITES.find(candidate=>candidate.aspectClass==="a4_portrait");
  const template=suite.bodyTemplates[3];
  const slides=await assignedSlides(suite.aspectClass,resolveApprovedMockupSlots(template).length);
  const options={aspectClass:suite.aspectClass,templateId:template.id,slides,title:"결정적 출력",scale:.5};
  const first=await renderAssignedApprovedBoard(options);
  const second=await renderAssignedApprovedBoard(options);
  assert.deepEqual(first.bytes,second.bytes);
  assert.deepEqual(first.debugBytes,second.debugBytes);
  assert.deepEqual(first.manifest,second.manifest);
  assert.equal(first.rendererFingerprint,await approvedBoardRendererFingerprint(suite.aspectClass,template.id));
  assert.match(first.rendererFingerprint,/^[a-f0-9]{64}$/);
});

test("explicit assignment rejects missing, extra, duplicate or wrong-aspect slides",async()=>{
  const suite=APPROVED_MOCKUP_SUITES.find(candidate=>candidate.aspectClass==="16:9");
  const template=suite.thumbnail;
  const capacity=resolveApprovedMockupSlots(template).length;
  const slides=await assignedSlides(suite.aspectClass,capacity+1);
  const base={aspectClass:suite.aspectClass,templateId:template.id,title:"입력 검증",scale:.5};
  await assert.rejects(renderAssignedApprovedBoard({...base,slides:slides.slice(0,capacity-1)}),/정확히 .*개/);
  await assert.rejects(renderAssignedApprovedBoard({...base,slides}),/정확히 .*개/);
  await assert.rejects(renderAssignedApprovedBoard({...base,slides:slides.slice(0,capacity).map((slide,index)=>index===1?{...slide,index:slides[0].index}:slide)}),/중복됐습니다/);
  await assert.rejects(renderAssignedApprovedBoard({...base,slides:slides.slice(0,capacity).map((slide,index)=>index===1?{...slide,buffer:slides[0].buffer}:slide)}),/PNG 해시가 중복됐습니다/);
  const wrongAspect=[...slides.slice(0,capacity)];
  wrongAspect[0]=await sampleSlide("a4_portrait",99);
  await assert.rejects(renderAssignedApprovedBoard({...base,slides:wrongAspect}),/비율이 16:9 템플릿과 다릅니다/);
  await assert.rejects(renderAssignedApprovedBoard({...base,templateId:"not-approved",slides:slides.slice(0,capacity)}),/승인된 목업 템플릿이 없습니다/);
  await assert.rejects(renderAssignedApprovedBoard({...base,aspectClass:"4:3",slides:[]}),/승인된 목업 세트가 없는 규격/);
  await assert.rejects(renderAssignedApprovedBoard({...base,slides:slides.slice(0,capacity),scale:.75}),/배율은 0.5 또는 1/);
  await assert.rejects(renderApprovedMockup({template,slides:slides.slice(0,capacity),outputFormat:"webp"}),/출력 형식은 jpeg 또는 png/);

  const rendered=await renderAssignedApprovedBoard({...base,slides:slides.slice(0,capacity)});
  const wrongSize=await sharp({create:{width:rendered.width+1,height:rendered.height,
    channels:4,background:"#ffffff"}}).png().toBuffer();
  await assert.rejects(renderApprovedBoardDebugOverlay(wrongSize,rendered.manifest),/디버그 원본은 .* PNG/);
  const wrongFormat=await sharp(rendered.bytes).jpeg().toBuffer();
  await assert.rejects(renderApprovedBoardDebugOverlay(wrongFormat,rendered.manifest),/디버그 원본은 .* PNG/);
});

test("changing one assigned slide changes pixels and content hash, never frozen geometry",{timeout:60_000},async()=>{
  const suite=APPROVED_MOCKUP_SUITES.find(candidate=>candidate.aspectClass==="a4_landscape");
  const template=suite.bodyTemplates[0];
  const capacity=resolveApprovedMockupSlots(template).length;
  const slides=await assignedSlides(suite.aspectClass,capacity);
  const changed=[...slides];
  changed[1]=await sampleSlide(suite.aspectClass,slides[1].index,13);
  const before=await renderAssignedApprovedBoard({aspectClass:suite.aspectClass,templateId:template.id,slides,scale:.5});
  const after=await renderAssignedApprovedBoard({aspectClass:suite.aspectClass,templateId:template.id,slides:changed,scale:.5});
  assert.notDeepEqual(before.bytes,after.bytes);
  assert.equal(before.geometryHash,after.geometryHash);
  assert.equal(before.rendererFingerprint,after.rendererFingerprint);
  assert.deepEqual(before.manifest.slots.map(slot=>({slotId:slot.slotId,base:slot.baseGeometry,corners:slot.transformedCorners})),
    after.manifest.slots.map(slot=>({slotId:slot.slotId,base:slot.baseGeometry,corners:slot.transformedCorners})));
  assert.notEqual(before.manifest.slots[1].contentHash,after.manifest.slots[1].contentHash);
});
