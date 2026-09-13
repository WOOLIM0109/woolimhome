import {test} from 'node:test';
import assert from 'node:assert/strict';
import JSZip from 'jszip';
import {pptxFixture} from './fixtures.test-support.mjs';
import {detectPptxRedactionCandidates} from './redaction-detection.ts';

async function editParts(source,edits) {
  const zip=await JSZip.loadAsync(source);
  for(const [name,edit] of Object.entries(edits)) zip.file(name,edit(await zip.file(name).async('string')));
  return zip.generateAsync({type:'nodebuffer',compression:'DEFLATE'});
}
const inherited={slideNumbers:[1],themeLatin:'Arial',themeEastAsian:'Arial'};
const footer=(type='ftr',text='footer.person@example.test')=>`<p:sp><p:nvSpPr><p:cNvPr id="88" name="Footer"/><p:cNvSpPr/><p:nvPr><p:ph type="${type}"/></p:nvPr></p:nvSpPr><p:spPr><a:xfrm><a:off x="100000" y="8500000"/><a:ext cx="4000000" cy="400000"/></a:xfrm></p:spPr><p:txBody><a:bodyPr/><a:lstStyle/><a:p><a:r><a:t>${text}</a:t></a:r></a:p></p:txBody></p:sp>`;

test('ordinary autofit/overflow/rotated text does not become a global geometry failure',async()=>{
  const base=await pptxFixture({count:1,texts:{1:'서비스 특징과 추진 전략'},inheritance:inherited});
  const source=await editParts(base,{'ppt/slides/slide1.xml':xml=>xml
    .replaceAll('<a:bodyPr/>','<a:bodyPr wrap="none" vertOverflow="overflow"><a:spAutoFit/></a:bodyPr>')
    .replaceAll('<a:xfrm>','<a:xfrm rot="5400000" flipH="0" flipV="false">')});
  const [result]=await detectPptxRedactionCandidates(source,[1]);
  assert.equal(result.candidates.length,0);
  assert.equal(result.uncertainties,undefined);
  assert.ok(!result.warnings.some(warning=>/UNRESOLVED/.test(warning)));
  assert.ok(result.warnings.includes('PIXEL_CONTENT_REQUIRES_HIGH_RESOLUTION_LOCAL_REVIEW'));
  assert.ok(!result.warnings.includes('FLIPPED_GEOMETRY_REVIEW'));
});

test('each mandatory autofit pattern remains a candidate with a bound uncertainty',async()=>{
  const samples=['person@example.test','010-9876-5432','주민등록번호','계좌 111-22-333333','비밀번호','주소 : 테스트'];
  const base=await pptxFixture({count:samples.length,texts:Object.fromEntries(samples.map((text,i)=>[i+1,text]))});
  const source=await editParts(base,Object.fromEntries(samples.map((_,i)=>[
    `ppt/slides/slide${i+1}.xml`,xml=>xml.replaceAll('<a:bodyPr/>','<a:bodyPr><a:spAutoFit/></a:bodyPr>'),
  ])));
  const results=await detectPptxRedactionCandidates(source,samples.map((_,i)=>i+1));
  for(const result of results) {
    const required=result.candidates.filter(candidate=>candidate.required);
    assert.ok(required.length>0);
    for(const candidate of required) {
      const uncertainty=result.uncertainties.find(item=>item.candidateId===candidate.id);
      assert.equal(uncertainty?.code,'TEXT_RENDER_BOUNDS_UNRESOLVED');
      assert.deepEqual(uncertainty.rect,candidate.rect);
    }
  }
  const serialized=JSON.stringify(results);
  for(const sample of samples) assert.ok(!serialized.includes(sample));
});

test('explicit disabled inherited footer fields are omitted but local slide text is always scanned',async()=>{
  for(const value of ['0','false']) {
    const base=await pptxFixture({count:1,texts:{1:'local.person@example.test'},inheritance:inherited});
    const source=await editParts(base,{
      'ppt/slideMasters/slideMaster1.xml':xml=>xml.replace('</p:spTree>',footer()+'</p:spTree>')
        .replace('</p:sldMaster>',`<p:hf ftr="${value}"/></p:sldMaster>`),
    });
    const [result]=await detectPptxRedactionCandidates(source,[1]);
    assert.equal(result.candidates.filter(candidate=>candidate.category==='email').length,1);
    assert.ok(!result.warnings.includes('INHERITED_PLACEHOLDER_VISIBILITY_REQUIRES_LOCAL_REVIEW'));
    assert.equal(result.uncertainties,undefined);
  }
});

test('layout header/footer override wins and an absent setting does not silently drop inherited sensitive text',async()=>{
  const base=await pptxFixture({count:1,inheritance:inherited});
  for(const enabled of ['1','true','default',null]) {
    const source=await editParts(base,{
      'ppt/slideMasters/slideMaster1.xml':xml=>xml.replace('</p:spTree>',footer()+'</p:spTree>')
        .replace('</p:sldMaster>',enabled===null?'</p:sldMaster>':'<p:hf ftr="0"/></p:sldMaster>'),
      'ppt/slideLayouts/slideLayout1.xml':xml=>enabled===null?xml:xml.replace('</p:sldLayout>',
        enabled==='default'?'<p:hf dt="0"/></p:sldLayout>':`<p:hf ftr="${enabled}"/></p:sldLayout>`),
    });
    const [result]=await detectPptxRedactionCandidates(source,[1]);
    const candidate=result.candidates.find(candidate=>candidate.category==='email');
    assert.equal(candidate?.required,true);
    assert.ok(result.uncertainties.some(item=>item.candidateId===candidate.id));
  }
});

test('boolean true/false transformation flags are handled semantically and hidden false is still scanned',async()=>{
  const base=await pptxFixture({count:1,texts:{1:'visible.person@example.test'}});
  for(const flip of ['0','false','1','true']) {
    const source=await editParts(base,{'ppt/slides/slide1.xml':xml=>xml
      .replace('name="Evidence 3"','name="Evidence 3" hidden="false"')
      .replaceAll('<a:xfrm>',`<a:xfrm flipH="${flip}">`)});
    const [result]=await detectPptxRedactionCandidates(source,[1]);
    const candidate=result.candidates.find(candidate=>candidate.category==='email');
    assert.equal(candidate?.required,true);
    assert.equal(result.warnings.includes('FLIPPED_GEOMETRY_REVIEW'),['1','true'].includes(flip));
    assert.equal(Boolean(result.uncertainties?.some(item=>item.candidateId===candidate.id)),['1','true'].includes(flip));
  }
});

test('missing bounds and truncated scanning remain fatal and are not replaceable by a located review',async()=>{
  const base=await pptxFixture({count:1,texts:{1:'missing.person@example.test'}});
  const source=await editParts(base,{'ppt/slides/slide1.xml':xml=>xml.replace(
    '<a:xfrm><a:off x="600000" y="3000000"/><a:ext cx="6000000" cy="1800000"/></a:xfrm>','')});
  const [result]=await detectPptxRedactionCandidates(source,[1]);
  assert.ok(result.warnings.includes('REQUIRED_CANDIDATE_GEOMETRY_UNRESOLVED_MANUAL_RECT_REQUIRED'));
  assert.equal(result.uncertainties,undefined);
  const longSource=await pptxFixture({count:1,texts:{1:'일반 문장 '.repeat(40_000)+'late.person@example.test'}});
  const [truncated]=await detectPptxRedactionCandidates(longSource,[1]);
  assert.ok(truncated.warnings.includes('TEXT_SCAN_TRUNCATED_REQUIRES_LOCAL_REVIEW'));
});

test('duplicate category/rect consolidation never loses a later geometry uncertainty',async()=>{
  const base=await pptxFixture({count:1,texts:{1:'same.person@example.test'}});
  const source=await editParts(base,{'ppt/slides/slide1.xml':xml=>{
    const body=xml.match(/<p:sp><p:nvSpPr><p:cNvPr id="3"[\s\S]*?<\/p:sp>/)[0];
    return xml.replace('</p:spTree>',body.replace('id="3"','id="99"')
      .replace('<a:bodyPr/>','<a:bodyPr><a:spAutoFit/></a:bodyPr>')+'</p:spTree>');
  }});
  const [result]=await detectPptxRedactionCandidates(source,[1]);
  const candidates=result.candidates.filter(candidate=>candidate.category==='email');
  assert.equal(candidates.length,1);
  assert.equal(result.uncertainties.length,1);
  assert.equal(result.uncertainties[0].candidateId,candidates[0].id);
});

test('explicit hidden shapes and false master rendering flags skip only their own rendered scope',async()=>{
  for(const value of ['1','true']) {
    const base=await pptxFixture({count:1,texts:{1:'hidden.person@example.test'},inheritance:{...inherited,masterFont:'Arial'}});
    const source=await editParts(base,{
      'ppt/slides/slide1.xml':xml=>xml.replace('name="Evidence 3"',`name="Evidence 3" hidden="${value}"`)
        .replace('<p:sld ','<p:sld showMasterSp="false" '),
      'ppt/slideMasters/slideMaster1.xml':xml=>xml.replace('Nested group evidence','master.person@example.test'),
      'ppt/slideLayouts/slideLayout1.xml':xml=>xml.replace('</p:spTree>',footer('ftr','layout.person@example.test')+'</p:spTree>'),
    });
    const [result]=await detectPptxRedactionCandidates(source,[1]);
    assert.equal(result.candidates.filter(candidate=>candidate.category==='email').length,1,
      'visible layout footer is retained even though a local shape and master are hidden');
  }
});

test('overflow in a later table cell is not missed by scanning only the first bodyPr',async()=>{
  const base=await pptxFixture({count:1,tableFonts:{1:'Arial'}});
  const source=await editParts(base,{'ppt/slides/slide1.xml':xml=>{
    const cell=xml.match(/<a:tc>[\s\S]*?<\/a:tc>/)[0];
    return xml.replace('</a:tr>',cell.replace('Table font evidence','table.person@example.test')
      .replace('<a:bodyPr/>','<a:bodyPr horzOverflow="overflow"/>')+'</a:tr>')
      .replace('</a:tblGrid>','<a:gridCol w="2600000"/></a:tblGrid>');
  }});
  const [result]=await detectPptxRedactionCandidates(source,[1]);
  const candidate=result.candidates.find(candidate=>candidate.category==='email');
  assert.equal(candidate?.required,true);
  assert.ok(result.uncertainties.some(item=>item.candidateId===candidate.id
    &&item.code==='TEXT_RENDER_BOUNDS_UNRESOLVED'));
});

test('stamp matching does not mistake employment headcount or embedded letter/number fragments for a seal',async()=>{
  const samples=['현재 재직인원 현황','재직인원수','재직인원(대표 제외)','직인원','3직인','직인123','A직인B'];
  const source=await pptxFixture({count:samples.length,texts:Object.fromEntries(samples.map((text,i)=>[i+1,text]))});
  const results=await detectPptxRedactionCandidates(source,samples.map((_,i)=>i+1));
  for(const [index,result] of results.entries()) {
    assert.ok(!result.candidates.some(candidate=>candidate.category==='signature'),`benign fixture ${index+1}`);
  }
});

test('standalone stamps, explicit stamp compounds, joined signing phrases and styled runs remain mandatory',async()=>{
  const samples=['직인','(직인)','회사직인','법인직인란','대표자직인을 첨부','전자직인 이미지',
    '직인날인','직인서명','대표자서명란','날인된 문서','서명완료','SIGNATURE','직인원본 확인'];
  const base=await pptxFixture({count:samples.length,texts:Object.fromEntries(samples.map((text,i)=>[i+1,text]))});
  const source=await editParts(base,{'ppt/slides/slide1.xml':xml=>xml.replace('<a:t>직인</a:t>',
    '<a:t>직</a:t></a:r><a:r><a:t>인</a:t>')});
  const results=await detectPptxRedactionCandidates(source,samples.map((_,i)=>i+1));
  for(const [index,result] of results.entries()) {
    const matches=result.candidates.filter(candidate=>candidate.category==='signature');
    assert.equal(matches.length,1,`mandatory fixture ${index+1}`);
    assert.equal(matches[0].required,true,`mandatory fixture ${index+1}`);
  }
});
