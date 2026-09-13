import {test} from 'node:test';
import assert from 'node:assert/strict';
import JSZip from 'jszip';
import {pptxFixture} from './fixtures.test-support.mjs';
import {inspectPptx,classifyPreparationAspect,classifyPreparationPageSize,extractPptxRedactionPrimitives} from './pptx-inspection.ts';
import {selectPreparedSlides,validatePreparedPng} from './slide-preparation.ts';
import sharp from 'sharp';

test('three approved formats use 0.5% tolerance and never stretch unknown/4:3',()=>{
  assert.equal(classifyPreparationAspect(1920,1080),'16:9');
  assert.equal(classifyPreparationAspect(297,210),'a4_landscape');
  assert.equal(classifyPreparationAspect(210,297),'a4_portrait');
  assert.equal(classifyPreparationAspect(4,3),'4:3');
  assert.equal(classifyPreparationAspect(1.76,1),'unknown');
});
test('PowerPoint A4 landscape preset requires the exact raw size and A4 type',()=>{
  assert.deepEqual(classifyPreparationPageSize(9906000,6858000,'A4'),{
    aspect:'a4_landscape',pageSizeVariant:'powerpoint_a4_preset_landscape',
  });
  assert.equal(classifyPreparationAspect(9906000,6858000),'unknown');
  assert.equal(classifyPreparationAspect(9906000,6858000,'a4'),'unknown');
  assert.equal(classifyPreparationAspect(9906001,6858000,'A4'),'unknown');
  assert.equal(classifyPreparationAspect(9906000,6858001,'A4'),'unknown');
});
test('inspection records page-size provenance while unapproved custom portrait remains held',async()=>{
  async function inspectSize(cx,cy,type) {
    const zip=await JSZip.loadAsync(await pptxFixture({count:1}));
    const name='ppt/presentation.xml';
    const original=await zip.file(name).async('string');
    const typeAttribute=type===undefined?'':` type="${type}"`;
    zip.file(name,original.replace(/<p:sldSz\b[^>]*\/>/,`<p:sldSz cx="${cx}" cy="${cy}"${typeAttribute}/>`));
    return inspectPptx(await zip.generateAsync({type:'nodebuffer'}),{installedFonts:['Arial']});
  }
  const preset=await inspectSize(9906000,6858000,'A4');
  assert.equal(preset.aspect,'a4_landscape');
  assert.equal(preset.pageSizeVariant,'powerpoint_a4_preset_landscape');
  assert.equal(preset.slideSizeType,'A4');
  assert.ok(!preset.issues.some(issue=>issue.code==='NO_APPROVED_SUITE'));

  const customPortrait=await inspectSize(7775575,10907713,undefined);
  assert.equal(customPortrait.aspect,'unknown');
  assert.equal(customPortrait.pageSizeVariant,'custom');
  assert.equal(customPortrait.slideSizeType,undefined);
  assert.ok(customPortrait.issues.some(issue=>issue.code==='NO_APPROVED_SUITE'));

  const forgedType=await inspectSize(9906001,6858000,'A4');
  assert.equal(forgedType.aspect,'unknown');
  assert.equal(forgedType.pageSizeVariant,'custom');
  assert.ok(forgedType.issues.some(issue=>issue.code==='NO_APPROVED_SUITE'));
});
test('full inventory retains original numbering and per-slide faults; body omitted',async()=>{
  const buffer=await pptxFixture({count:6,fonts:{2:'Uninstalled QA Font'},hidden:[3],empty:[4],broken:[5]});
  const r=await inspectPptx(buffer,{installedFonts:['Arial']});
  assert.equal(r.totalSlides,6); assert.deepEqual(r.slides.map(s=>s.sourceSlideNumber),[1,2,3,4,5,6]);
  assert.deepEqual(r.slides[1].missingFonts,['Uninstalled QA Font']);
  assert.equal(r.slides[2].hidden,true);
  assert.ok(r.slides[3].issues.some(i=>i.code==='EMPTY_OR_DECORATION_ONLY'));
  assert.ok(r.slides[4].issues.some(i=>i.code==='CORRUPT_SLIDE'));
  assert.ok(!JSON.stringify(r).includes('no customer data'));
  assert.equal(r.sourceHash.length,64);
});

test('PowerPoint section slide references are not counted as source slides or redaction targets',async()=>{
  const z=await JSZip.loadAsync(await pptxFixture({count:2,texts:{1:'First source',2:'Second source'}}));
  const name='ppt/presentation.xml';
  const original=await z.file(name).async('string');
  const extension='<p:extLst><p:ext uri="section-fixture"><p14:sectionLst xmlns:p14="http://schemas.microsoft.com/office/powerpoint/2010/main"><p14:section name="Section" id="fixture"><p14:sldIdLst><p14:sldId id="256"/><p14:sldId id="257"/></p14:sldIdLst></p14:section></p14:sectionLst></p:ext></p:extLst>';
  z.file(name,original.replace('</p:presentation>',extension+'</p:presentation>'));
  const bytes=await z.generateAsync({type:'nodebuffer'});
  const result=await inspectPptx(bytes,{installedFonts:['Arial']});
  assert.equal(result.totalSlides,2);
  assert.deepEqual(result.slides.map(s=>s.sourceSlideNumber),[1,2]);
  assert.ok(result.slides.every(s=>!s.issues.some(i=>i.code==='CORRUPT_SLIDE')));
  const extracted=await extractPptxRedactionPrimitives(bytes,[2]);
  assert.equal(extracted.slides.length,1);
  assert.equal(extracted.slides[0].sourceSlideNumber,2);
  assert.ok(extracted.slides[0].primitives.some(p=>p.text.includes('Second source')));
  await assert.rejects(extractPptxRedactionPrimitives(bytes,[3]),/INVALID_REDACTION_SLIDE_NUMBERS/);
});

test('ambiguous direct slide lists fail closed instead of silently taking the first',async()=>{
  const z=await JSZip.loadAsync(await pptxFixture({count:1}));
  const name='ppt/presentation.xml';
  z.file(name,(await z.file(name).async('string')).replace('</p:presentation>','<p:sldIdLst/></p:presentation>'));
  await assert.rejects(inspectPptx(await z.generateAsync({type:'nodebuffer'}),{installedFonts:['Arial']}),/INVALID_PRESENTATION_SLDIDLST/);
});
test('unsafe zip, XML, macros and external image relationships stop before COM',async()=>{
  await assert.rejects(inspectPptx(Buffer.from('bad'),{installedFonts:[]}),/INVALID_PPTX_ZIP/);
  for(const [name,body,expected] of [
    ['ppt/vbaProject.bin','x',/MACROS_NOT_ALLOWED/],
    ['ppt/presentation.xml','<!DOCTYPE foo><foo/>',/UNSAFE_XML/],
    ['ppt/slides/_rels/slide1.xml.rels','<Relationships><Relationship Id="x" Type="x/image" Target="https://invalid.test/a" TargetMode="External"/></Relationships>',/EXTERNAL_CONTENT_NOT_ALLOWED/],
  ]) {
    const z=await JSZip.loadAsync(await pptxFixture());z.file(name,body);
    await assert.rejects(inspectPptx(await z.generateAsync({type:'nodebuffer'}),{installedFonts:[]}),expected);
  }
});
test('OPC package-root targets and ordinary parent-relative targets resolve without filesystem semantics',async()=>{
  for(const absoluteRelationships of [false,true]) {
    const buffer=await pptxFixture({count:2,absoluteRelationships,inheritance:{
      slideNumbers:[1],themeLatin:'Theme Latin',themeEastAsian:'Theme Korean',
    }});
    const report=await inspectPptx(buffer,{installedFonts:['Arial','Theme Latin','Theme Korean']});
    assert.equal(report.totalSlides,2);
    assert.ok(report.slides.every(slide=>!slide.issues.some(entry=>entry.code==='CORRUPT_SLIDE')));
  }
  const zip=await JSZip.loadAsync(await pptxFixture({count:1}));
  const relName='ppt/_rels/presentation.xml.rels';
  zip.file(relName,(await zip.file(relName).async('string')).replace('slides/slide1.xml','../../../escape.xml'));
  await assert.rejects(inspectPptx(await zip.generateAsync({type:'nodebuffer'}),{installedFonts:['Arial']}),/UNSAFE_PPTX_RELATIONSHIP/);
});
test('root officeDocument and renamed VBA relationship cannot make Office open an unchecked package',async()=>{
  const source=await pptxFixture({count:1});
  const custom=await JSZip.loadAsync(source);
  custom.file('ppt/custom.xml',await custom.file('ppt/presentation.xml').async('string'));
  custom.file('ppt/_rels/custom.xml.rels',await custom.file('ppt/_rels/presentation.xml.rels').async('string'));
  custom.remove('ppt/presentation.xml');custom.remove('ppt/_rels/presentation.xml.rels');
  custom.file('_rels/.rels',(await custom.file('_rels/.rels').async('string')).replace('ppt/presentation.xml','/ppt/custom.xml'));
  custom.file('[Content_Types].xml',(await custom.file('[Content_Types].xml').async('string')).replace('/ppt/presentation.xml','/ppt/custom.xml'));
  assert.equal((await inspectPptx(await custom.generateAsync({type:'nodebuffer'}),{installedFonts:['Arial']})).totalSlides,1);

  const macro=await JSZip.loadAsync(source);
  const relName='ppt/_rels/presentation.xml.rels';
  macro.file(relName,(await macro.file(relName).async('string')).replace('</Relationships>',`<Relationship Id="macro" Type="http://schemas.microsoft.com/office/2006/relationships/vbaProject" Target="payload.bin"/></Relationships>`));
  macro.file('ppt/payload.bin','fixture');
  await assert.rejects(inspectPptx(await macro.generateAsync({type:'nodebuffer'}),{installedFonts:['Arial']}),/MACROS_NOT_ALLOWED/);
});
test('nested groups, tables, master text and theme inheritance report the effective fonts',async()=>{
  const report=await inspectPptx(await pptxFixture({count:1,texts:{1:'Latin 한글'},
    nestedGroupFonts:{1:'Nested QA Font'},tableFonts:{1:'Table QA Font'},inheritance:{
      slideNumbers:[1],themeLatin:'Theme Latin QA',themeEastAsian:'Theme Korean QA',masterFont:'Master QA Font',
    }}),{installedFonts:['Arial','Nested QA Font','Table QA Font','Theme Latin QA','Theme Korean QA','Master QA Font']});
  const slide=report.slides[0];
  for(const font of ['Nested QA Font','Table QA Font','Theme Latin QA','Theme Korean QA','Master QA Font']) {
    assert.ok(slide.fonts.includes(font),font);
  }
  assert.deepEqual(slide.missingFonts,[]);
  assert.ok(!slide.issues.some(entry=>entry.code==='FONT_UNRESOLVED'));
  assert.equal(slide.metrics.tables,1);
});
test('an unresolved font chain is held instead of silently borrowing an unrelated face',async()=>{
  const report=await inspectPptx(await pptxFixture({count:8,unresolvedFontSlides:[1]}),{installedFonts:['Arial']});
  assert.ok(report.slides[0].issues.some(entry=>entry.code==='FONT_UNRESOLVED'));
  const previews=report.slides.map(slide=>({sourceSlideNumber:slide.sourceSlideNumber,visualHash:`v${slide.sourceSlideNumber}`,blank:false}));
  const selection=selectPreparedSlides(report,previews,{selectedSlideNumbers:[1]});
  assert.equal(selection.status,'held');
  assert.ok(selection.holds.some(message=>message.includes('1번')));
});
test('large flat illustrations survive while photo, dense table and uninspectable media are held',async()=>{
  const report=await inspectPptx(await pptxFixture({count:4,pictureKinds:{1:'illustration',2:'photo',3:'broken'},
    tableFonts:{4:'Arial'},denseTables:[4],uninspectableSlides:[3]}),{installedFonts:['Arial']});
  assert.equal(report.slides[0].metrics.pictures,1);
  assert.equal(report.slides[0].metrics.photoCount,0);
  assert.ok(!report.slides[0].issues.some(entry=>entry.code==='PHOTO_DENSE'));
  assert.ok(report.slides[1].issues.some(entry=>entry.code==='PHOTO_DENSE'));
  assert.ok(report.slides[2].issues.some(entry=>entry.code==='MEDIA_CLASSIFICATION_REVIEW'));
  assert.ok(report.slides[2].issues.some(entry=>entry.code==='UNINSPECTABLE_OBJECT'));
  assert.ok(report.slides[3].issues.some(entry=>entry.code==='TABLE_DENSE'));
  const previews=report.slides.map(slide=>({sourceSlideNumber:slide.sourceSlideNumber,visualHash:`v${slide.sourceSlideNumber}`,blank:false}));
  const selected=selectPreparedSlides(report,previews);
  assert.equal(selected.slides[0].disposition,'selected');
  assert.ok(selected.slides.slice(1).every(row=>row.disposition==='excluded'));
});
test('a background-only illustration is content, while a photographic background remains photo-dense',async()=>{
  const report=await inspectPptx(await pptxFixture({count:2,empty:[1,2],
    backgroundPictureKinds:{1:'illustration',2:'photo'}}),{installedFonts:[]});
  assert.ok(!report.slides[0].issues.some(entry=>entry.code==='EMPTY_OR_DECORATION_ONLY'));
  assert.ok(!report.slides[0].issues.some(entry=>entry.code==='PHOTO_DENSE'));
  assert.ok(report.slides[1].issues.some(entry=>entry.code==='PHOTO_DENSE'));
});
test('content hashes distinguish equal wording with different geometry or image bytes',async()=>{
  const report=await inspectPptx(await pptxFixture({count:3,texts:{1:'Same content',2:'Same content',3:'Same content'},
    titles:{1:'Same title',2:'Same title',3:'Same title'},layoutOffsets:{2:250000},
    pictureKinds:{1:'illustration',2:'illustration',3:'illustration'},pictureVariants:{1:1,2:1,3:2}}),{installedFonts:['Arial']});
  assert.notEqual(report.slides[0].contentHash,report.slides[1].contentHash);
  assert.notEqual(report.slides[0].contentHash,report.slides[2].contentHash);
  assert.notEqual(report.slides[0].metrics.layoutSignature,report.slides[1].metrics.layoutSignature);
  assert.equal(report.slides[0].metrics.layoutSignature,report.slides[2].metrics.layoutSignature);
});
test('content hashes use structural framing so delimiter-like text cannot alias another run sequence',async()=>{
  const report=await inspectPptx(await pptxFixture({count:2,
    titles:{1:'A',2:'A|B'},texts:{1:'B|C',2:'C'}}),{installedFonts:['Arial']});
  assert.equal(report.slides[0].metrics.layoutSignature,report.slides[1].metrics.layoutSignature);
  assert.notEqual(report.slides[0].contentHash,report.slides[1].contentHash);
});
test('declared ZIP bounds, local/central disagreement, descriptors and comments are rejected before inflate',async()=>{
  const source=await pptxFixture({count:1});
  const oversized=Buffer.from(source), eocd=oversized.length-22;
  const centralOffset=oversized.readUInt32LE(eocd+16), localOffset=oversized.readUInt32LE(centralOffset+42);
  oversized.writeUInt32LE(65*1024*1024,centralOffset+24);
  oversized.writeUInt32LE(65*1024*1024,localOffset+22);
  await assert.rejects(inspectPptx(oversized,{installedFonts:[]}),/UNSUPPORTED_PPTX_SIZE_OR_ENCRYPTION/);

  const inconsistent=Buffer.from(source);
  inconsistent.writeUInt32LE(inconsistent.readUInt32LE(centralOffset+24)+1,centralOffset+24);
  await assert.rejects(inspectPptx(inconsistent,{installedFonts:[]}),/INVALID_PPTX_LOCAL_HEADER/);

  await assert.rejects(inspectPptx(await pptxFixture({count:1,zipComment:'ambiguous'}),{installedFonts:[]}),/UNSUPPORTED_PPTX_ZIP_COMMENT/);
  const descriptor=Buffer.from(await pptxFixture({count:1,streamFiles:true}));
  const descriptorEocd=descriptor.length-22, descriptorCentral=descriptor.readUInt32LE(descriptorEocd+16);
  const descriptorLocal=descriptor.readUInt32LE(descriptorCentral+42);
  assert.ok(descriptor.readUInt16LE(descriptorCentral+8)&8);
  const nameLength=descriptor.readUInt16LE(descriptorLocal+26), extraLength=descriptor.readUInt16LE(descriptorLocal+28);
  const dataOffset=descriptorLocal+30+nameLength+extraLength;
  const dataEnd=dataOffset+descriptor.readUInt32LE(descriptorCentral+20);
  const crcOffset=descriptor.readUInt32LE(dataEnd)===0x08074b50?dataEnd+4:dataEnd;
  descriptor.writeUInt32LE((descriptor.readUInt32LE(crcOffset)+1)>>>0,crcOffset);
  await assert.rejects(inspectPptx(descriptor,{installedFonts:[]}),/INVALID_PPTX_DATA_DESCRIPTOR/);
});
test('selection explains omissions, exact duplicates, missing-font fallback and reserves',async()=>{
  const r=await inspectPptx(await pptxFixture({count:20,fonts:{3:'Missing'},duplicate:true}),{installedFonts:['Arial']});
  const checks=r.slides.map(s=>({sourceSlideNumber:s.sourceSlideNumber,visualHash:String(s.sourceSlideNumber),blank:false}));
  const selection=selectPreparedSlides(r,checks);
  assert.equal(selection.status,'ready_for_local_review');assert.equal(selection.minimum,8);
  assert.equal(selection.selected.length,14);assert.equal(selection.reserves.length,2);
  assert.equal(selection.cover,1);assert.ok(!selection.selected.includes(3));
  assert.equal(r.slides[0].contentHash,r.slides[19].contentHash);
  assert.ok(selection.slides[19].reasons.includes('DUPLICATE_SLIDE'));
  assert.equal(new Set([...selection.selected,...selection.reserves]).size,16);
  const override=selectPreparedSlides(r,checks,{selectedSlideNumbers:[1,3]});
  assert.equal(override.status,'held');assert.ok(override.holds.length>0);
});
test('duplicate or unknown preview numbering is an explicit hold, never silently overwritten',async()=>{
  const report=await inspectPptx(await pptxFixture({count:8}),{installedFonts:['Arial']});
  const previews=report.slides.map(slide=>({sourceSlideNumber:slide.sourceSlideNumber,visualHash:`v${slide.sourceSlideNumber}`,blank:false}));
  previews.push({...previews[0],visualHash:'different-bytes'}, {sourceSlideNumber:99,visualHash:'unknown',blank:false});
  const selection=selectPreparedSlides(report,previews);
  assert.equal(selection.status,'held');
  assert.ok(selection.holds.some(message=>message.includes('중복')));
  assert.ok(selection.holds.some(message=>message.includes('99')));
  assert.ok(selection.slides[0].reasons.includes('PREVIEW_DUPLICATE'));
});
test('insufficient/unsupported suite holds, per-suite minimum follows frozen contract',async()=>{
  for(const [ratio,minimum] of [[[16,9],8],[[297,210],7],[[210,297],7]]) {
    const r=await inspectPptx(await pptxFixture({ratio,count:6}),{installedFonts:['Arial']});
    const s=selectPreparedSlides(r,r.slides.map(s=>({sourceSlideNumber:s.sourceSlideNumber,visualHash:String(s.sourceSlideNumber),blank:false})));
    assert.equal(s.minimum,minimum);assert.equal(s.status,'held');
  }
});
test('PNG must decode at exact long edge and aspect; uniform render is not accepted',async()=>{
  const bytes=await sharp({create:{width:800,height:450,channels:3,background:'#fff'}}).png().toBuffer();
  assert.equal((await validatePreparedPng(bytes,{sourceSlideNumber:1,slideWidth:16,slideHeight:9,longEdge:800})).blank,true);
  await assert.rejects(validatePreparedPng(bytes,{sourceSlideNumber:1,slideWidth:210,slideHeight:297,longEdge:800}),/SIZE_MISMATCH/);
});
