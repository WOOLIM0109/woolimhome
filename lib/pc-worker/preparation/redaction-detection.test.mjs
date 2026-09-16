import {test} from 'node:test';
import assert from 'node:assert/strict';
import JSZip from 'jszip';
import {pptxFixture} from './fixtures.test-support.mjs';
import {inspectPptx} from './pptx-inspection.ts';
import {detectPptxRedactionCandidates} from './redaction-detection.ts';

async function editParts(source,edits) {
  const zip=await JSZip.loadAsync(source);
  for(const [name,edit] of Object.entries(edits)) {
    const file=zip.file(name);
    assert.ok(file,`missing fixture part ${name}`);
    zip.file(name,edit(await file.async('string')));
  }
  return zip.generateAsync({type:'nodebuffer',compression:'DEFLATE'});
}

test('mandatory opaque patterns and semantic review categories never expose source text',async()=>{
  const secrets={email:'private.person@example.test',phone:'010-1234-5678',id:'900101-1234567',account:'계좌 123-456-789012',auth:'OTP 987654'};
  const source=await pptxFixture({count:2,texts:{
    1:Object.values(secrets).join(' / '),
    2:'담당자 이름 / 주소 / 예산 12,000만원 / 대외비 계약 상세',
  }});
  const detections=await detectPptxRedactionCandidates(source,[2,1]);
  assert.deepEqual(detections.map(result=>result.sourceSlideNumber),[2,1]);
  const review=new Map(detections[0].candidates.map(candidate=>[candidate.category,candidate]));
  assert.equal(review.get('address')?.required,true,'address');
  for(const category of ['name','amount','internal_detail']) assert.equal(review.get(category)?.required,false,category);
  const mandatory=new Map(detections[1].candidates.map(candidate=>[candidate.category,candidate]));
  for(const category of ['email','contact','identifier','account','authentication']) assert.equal(mandatory.get(category)?.required,true,category);
  const serialized=JSON.stringify(detections);
  for(const secret of Object.values(secrets)) assert.ok(!serialized.includes(secret));
  assert.ok(detections.every(result=>result.candidates.every(candidate=>candidate.rect.x>=0&&candidate.rect.y>=0
    &&candidate.rect.x+candidate.rect.width<=1&&candidate.rect.y+candidate.rect.height<=1)));

  const inspection=await inspectPptx(source,{installedFonts:['Arial']});
  assert.equal(detections[1].sourceHash,inspection.sourceHash);
  assert.equal(detections[1].slideContentHash,inspection.slides[0].contentHash);
});

test('nested group, table and visible master text all produce true local candidate boxes',async()=>{
  const base=await pptxFixture({count:1,nestedGroupFonts:{1:'Arial'},tableFonts:{1:'Arial'},inheritance:{
    masterFont:'Arial',themeLatin:'Arial',themeEastAsian:'Arial',slideNumbers:[],
  }});
  const source=await editParts(base,{
    'ppt/slides/slide1.xml':text=>text.replace('Nested group evidence','010-2222-3333')
      .replace('Table font evidence','계좌 111-222-333333'),
    'ppt/slideMasters/slideMaster1.xml':text=>text.replace('Nested group evidence','master@example.test'),
  });
  const [result]=await detectPptxRedactionCandidates(source,[1]);
  for(const category of ['contact','account','email']) assert.ok(result.candidates.some(candidate=>candidate.category===category),category);
  assert.ok(result.candidates.filter(candidate=>['contact','account','email'].includes(candidate.category))
    .every(candidate=>candidate.rect.width<.5&&candidate.rect.height<.5));
  assert.ok(!result.warnings.includes('GEOMETRY_UNRESOLVED'));
});

test('a slide placeholder without geometry uses its exact layout placeholder geometry',async()=>{
  const base=await pptxFixture({count:1,texts:{1:'layout.person@example.test'},inheritance:{
    slideNumbers:[1],themeLatin:'Arial',themeEastAsian:'Arial',
  }});
  const source=await editParts(base,{
    'ppt/slides/slide1.xml':text=>text.replace('<a:xfrm><a:off x="600000" y="3000000"/><a:ext cx="6000000" cy="1800000"/></a:xfrm>',''),
    'ppt/slideLayouts/slideLayout1.xml':text=>text.replace('<p:spPr/>','<p:spPr><a:xfrm><a:off x="2000000" y="2500000"/><a:ext cx="4000000" cy="1000000"/></a:xfrm></p:spPr>'),
  });
  const [result]=await detectPptxRedactionCandidates(source,[1]);
  const candidate=result.candidates.find(entry=>entry.category==='email');
  assert.ok(candidate);
  assert.ok(candidate.rect.width>.2&&candidate.rect.width<.3);
  assert.ok(candidate.rect.height>.09&&candidate.rect.height<.13);
  assert.ok(!result.warnings.includes('CANDIDATE_GEOMETRY_REQUIRES_LOCAL_REVIEW'));
});

test('unresolved required geometry creates a manual-rectangle hold, not a fabricated full-slide mask',async()=>{
  const base=await pptxFixture({count:1,texts:{1:'missing.geometry@example.test'}});
  const source=await editParts(base,{
    'ppt/slides/slide1.xml':text=>text.replace('<a:xfrm><a:off x="600000" y="3000000"/><a:ext cx="6000000" cy="1800000"/></a:xfrm>',''),
  });
  const [result]=await detectPptxRedactionCandidates(source,[1]);
  assert.ok(!result.candidates.some(candidate=>candidate.category==='email'));
  assert.ok(result.warnings.includes('REQUIRED_CANDIDATE_GEOMETRY_UNRESOLVED_MANUAL_RECT_REQUIRED'));
  assert.ok(!result.candidates.some(candidate=>candidate.rect.x===0&&candidate.rect.y===0
    &&candidate.rect.width===1&&candidate.rect.height===1));
});

test('generic illustrations remain optional review; QR metadata is mandatory without pixel-safety claims',async()=>{
  const base=await pptxFixture({count:2,pictureKinds:{1:'illustration',2:'illustration'}});
  const source=await editParts(base,{
    'ppt/slides/slide1.xml':text=>text.replace('Synthetic fixture image','QR code synthetic fixture'),
  });
  const [qr,illustration]=await detectPptxRedactionCandidates(source,[1,2]);
  assert.equal(qr.candidates.find(candidate=>candidate.category==='qr')?.required,true);
  assert.ok(!qr.candidates.some(candidate=>candidate.category==='image_review'));
  assert.equal(illustration.candidates.find(candidate=>candidate.category==='image_review')?.required,false);
  assert.ok(illustration.warnings.includes('IMAGE_CONTENT_REQUIRES_LOCAL_REVIEW'));
});

test('rotated groups use a conservative outer box and require local geometry review',async()=>{
  const base=await pptxFixture({count:1,nestedGroupFonts:{1:'Arial'}});
  const source=await editParts(base,{
    'ppt/slides/slide1.xml':text=>text.replace('Nested group evidence','010-9999-8888')
      .replace('<a:xfrm><a:off x="900000" y="900000"/>','<a:xfrm rot="2700000"><a:off x="900000" y="900000"/>'),
  });
  const [result]=await detectPptxRedactionCandidates(source,[1]);
  const candidate=result.candidates.find(entry=>entry.category==='contact');
  assert.ok(candidate);
  assert.ok(candidate.rect.width>0&&candidate.rect.width<1&&candidate.rect.height>0&&candidate.rect.height<1);
  assert.ok(result.warnings.includes('ROTATED_GEOMETRY_REVIEW'));
  assert.ok(result.warnings.includes('CANDIDATE_GEOMETRY_REQUIRES_LOCAL_REVIEW'));
});

test('large required coverage recommends replacing the slide instead of silently over-redacting',async()=>{
  const base=await pptxFixture({count:1,texts:{1:'wide@example.test'}});
  const source=await editParts(base,{
    'ppt/slides/slide1.xml':text=>text.replace(
      '<a:xfrm><a:off x="600000" y="3000000"/><a:ext cx="6000000" cy="1800000"/></a:xfrm>',
      '<a:xfrm><a:off x="0" y="0"/><a:ext cx="16256000" cy="9144000"/></a:xfrm>',
    ),
  });
  const [result]=await detectPptxRedactionCandidates(source,[1]);
  assert.ok(result.warnings.includes('HIGH_REQUIRED_REDACTION_COVERAGE_REPLACEMENT_REVIEW'));
});

test('normal title and diagram text are untouched and invalid slide requests fail closed',async()=>{
  const source=await pptxFixture({count:2,texts:{1:'일반 사업 소개와 추진 전략',2:'서비스 구성도와 기대 효과'}});
  const results=await detectPptxRedactionCandidates(source,[1,2]);
  assert.ok(results.every(result=>result.candidates.length===0));
  await assert.rejects(detectPptxRedactionCandidates(source,[1,1]),/INVALID_REDACTION_SLIDE_NUMBERS/);
  await assert.rejects(detectPptxRedactionCandidates(source,[3]),/INVALID_REDACTION_SLIDE_NUMBERS/);
  await assert.rejects(detectPptxRedactionCandidates(source,[]),/INVALID_REDACTION_SLIDE_NUMBERS/);
});

test('adjacent styled runs and invisible format controls cannot split a mandatory email',async()=>{
  const base=await pptxFixture({count:1,texts:{1:'pri\u200Bvate@example\u00ad.test'}});
  const source=await editParts(base,{
    'ppt/slides/slide1.xml':text=>text.replace(
      '<a:t>pri\u200Bvate@example\u00ad.test</a:t>',
      '<a:t>pri\u200Bvate@</a:t></a:r><a:r><a:rPr lang="ko-KR" sz="2800"><a:latin typeface="Arial"/><a:ea typeface="Arial"/></a:rPr><a:t>example\u00ad.test</a:t>',
    ),
  });
  const [result]=await detectPptxRedactionCandidates(source,[1]);
  assert.equal(result.candidates.find(candidate=>candidate.category==='email')?.required,true);
});

test('a potentially rendered inherited footer is scanned and held for located manual review',async()=>{
  const base=await pptxFixture({count:1,inheritance:{slideNumbers:[1],themeLatin:'Arial',themeEastAsian:'Arial'}});
  const footer='<p:sp><p:nvSpPr><p:cNvPr id="88" name="Footer"/><p:cNvSpPr/><p:nvPr><p:ph type="ftr"/></p:nvPr></p:nvSpPr><p:spPr><a:xfrm><a:off x="100000" y="8500000"/><a:ext cx="4000000" cy="400000"/></a:xfrm></p:spPr><p:txBody><a:bodyPr/><a:lstStyle/><a:p><a:r><a:t>footer.person@example.test</a:t></a:r></a:p></p:txBody></p:sp>';
  const source=await editParts(base,{
    'ppt/slideMasters/slideMaster1.xml':text=>text.replace('</p:spTree>',`${footer}</p:spTree>`),
  });
  const [result]=await detectPptxRedactionCandidates(source,[1]);
  assert.equal(result.candidates.find(candidate=>candidate.category==='email')?.required,true);
  assert.ok(result.warnings.includes('INHERITED_PLACEHOLDER_VISIBILITY_REQUIRES_LOCAL_REVIEW'));
  assert.ok(result.uncertainties.some(item=>item.code==='TEXT_GEOMETRY_UNRESOLVED'
    &&item.candidateId===result.candidates.find(candidate=>candidate.category==='email').id));
});

test('OLE attached to an ordinary shape emits a required object candidate, not only a warning',async()=>{
  const base=await pptxFixture({count:1});
  const source=await editParts(base,{
    'ppt/slides/slide1.xml':text=>text.replace(
      '<p:nvPr></p:nvPr></p:nvSpPr>',
      '<p:nvPr><p:oleObj/></p:nvPr></p:nvSpPr>',
    ),
  });
  const [result]=await detectPptxRedactionCandidates(source,[1]);
  assert.equal(result.candidates.find(candidate=>candidate.category==='object_review')?.required,true);
  assert.ok(result.warnings.includes('UNINSPECTABLE_OBJECT_REVIEW'));
});

test('a rotated child under nonuniform group scale uses the conservative group outer box',async()=>{
  const base=await pptxFixture({count:1,nestedGroupFonts:{1:'Arial'}});
  const source=await editParts(base,{
    'ppt/slides/slide1.xml':text=>text.replace('Nested group evidence','010-3333-4444')
      .replace('<a:ext cx="2500000" cy="1200000"/><a:chOff','<a:ext cx="5000000" cy="1200000"/><a:chOff')
      .replace('<a:xfrm><a:off x="100000" y="100000"/><a:ext cx="1800000" cy="700000"/></a:xfrm>',
        '<a:xfrm rot="2700000"><a:off x="100000" y="100000"/><a:ext cx="1800000" cy="700000"/></a:xfrm>'),
  });
  const [result]=await detectPptxRedactionCandidates(source,[1]);
  const candidate=result.candidates.find(entry=>entry.category==='contact');
  assert.ok(candidate);
  assert.ok(Math.abs(candidate.rect.x-900000/16256000)<1e-8);
  assert.ok(Math.abs(candidate.rect.y-900000/9144000)<1e-8);
  assert.ok(Math.abs(candidate.rect.width-5000000/16256000)<1e-8);
  assert.ok(Math.abs(candidate.rect.height-1200000/9144000)<1e-8);
  assert.ok(result.warnings.includes('GROUP_TRANSFORM_REQUIRES_LOCAL_REVIEW'));
  assert.ok(result.uncertainties.some(item=>item.candidateId===candidate.id
    &&item.code==='TEXT_GEOMETRY_UNRESOLVED'));
});

test('explicit text overflow or shape-autofit cannot be approved as exact shape geometry',async()=>{
  const base=await pptxFixture({count:1,texts:{1:'overflow.person@example.test'}});
  const source=await editParts(base,{
    'ppt/slides/slide1.xml':text=>text.replaceAll('<a:bodyPr/>','<a:bodyPr vertOverflow="overflow"><a:spAutoFit/></a:bodyPr>'),
  });
  const [result]=await detectPptxRedactionCandidates(source,[1]);
  assert.equal(result.candidates.find(candidate=>candidate.category==='email')?.required,true);
  assert.ok(!result.warnings.includes('TEXT_RENDER_BOUNDS_UNRESOLVED_REQUIRES_LOCAL_REVIEW'));
  assert.ok(result.uncertainties.some(item=>item.code==='TEXT_RENDER_BOUNDS_UNRESOLVED'
    &&item.candidateId===result.candidates.find(candidate=>candidate.category==='email').id));
  assert.ok(result.warnings.includes('CANDIDATE_GEOMETRY_REQUIRES_LOCAL_REVIEW'));
});
