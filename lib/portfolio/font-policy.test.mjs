import assert from 'node:assert/strict';
import test from 'node:test';
import JSZip from 'jszip';
import { portfolioFontExclusion, canRetryCandidateFonts, isTestFontName, unownedPaidFonts } from './font-policy.ts';
import { readPptxSourceFonts } from './source-fonts.ts';
import { inspectPortfolioDuplicates } from './project-dedupe.ts';
import { portfolioDisplayState } from './display-state.ts';

test('unowned paid families remain excluded across style, accent and test names', () => {
  for (const font of ['Söhne', 'Sohne Buch', 'TestSöhne-Buch', 'SÖHNE Kraftig']) {
    assert.deepEqual(unownedPaidFonts([font]), ['Söhne']);
    assert.equal(portfolioFontExclusion({missing_fonts:[font]}), '유료 글꼴 미보유: Söhne');
  }
  assert.deepEqual(unownedPaidFonts(['Work Sans SemiBold', 'Malgun Gothic']), []);
  assert.equal(isTestFontName('AzoSansTest-Regular'), true);
  assert.equal(isTestFontName('Work Sans'), false);
});

test('inventory changes and forced retries cannot revive paid-font exclusions', () => {
  for (const candidate of [
    {missing_fonts:['Söhne']},
    {metadata:{sourceFonts:['Test Söhne']}},
    {exclusion_reasons:['유료 글꼴 미보유: Söhne'],missing_fonts:[]},
    {metadata:{fontExclusionReason:'유료 글꼴 미보유: Söhne'}},
  ]) for (const force of [false,true]) assert.equal(canRetryCandidateFonts(candidate,'new-inventory',force),false);
  assert.equal(canRetryCandidateFonts({missing_fonts:['Arial'],font_retry_fingerprint:'old'},'new'),true);
  assert.equal(canRetryCandidateFonts({missing_fonts:['Arial'],font_retry_fingerprint:'same'},'same'),false);
});

test('paid source is excluded before queue selection and does not displace a licensed alternative', () => {
  const row=(id,fonts)=>({id,project_name:'드림윙즈 제안서',project_key:id,status:'candidate',quality_score:90,
    metadata:{sourceFonts:fonts,representativeHashes:['aaaaaaaaaaaaaaaa']},
    naver_works_drive_files:{id,file_name:'드림윙즈.pptx',file_path:'PPT',file_size:100,root_id:'r',file_extension:'pptx'}});
  const inspection=inspectPortfolioDuplicates([row('a',['Söhne']),row('b',['Arial'])],[],4);
  assert.deepEqual(inspection.accepted.map(row=>row.id),['b']);
  assert.equal(inspection.decisions[0].reason,'유료 글꼴 미보유: Söhne');
  assert.deepEqual(portfolioDisplayState({status:'on_hold',review_note:inspection.decisions[0].reason}),
    {label:'제외',detail:'유료 글꼴 미보유: Söhne'});
});

test('source font inspection decodes names and includes theme declarations without converting', async () => {
  const zip=new JSZip();
  zip.file('ppt/slides/slide1.xml','<root><font typeface="Work Sans"/></root>');
  zip.file('ppt/theme/theme1.xml','<root><font typeface="S&#246;hne"/></root>');
  const loaded=await JSZip.loadAsync(await zip.generateAsync({type:'nodebuffer'}));
  assert.deepEqual(await readPptxSourceFonts(loaded),['Söhne','Work Sans']);
  assert.equal(portfolioFontExclusion({metadata:{sourceFonts:await readPptxSourceFonts(loaded)}}),'유료 글꼴 미보유: Söhne');
  zip.file('ppt/slides/slide1.xml','<!DOCTYPE root [<!ENTITY font SYSTEM "file:///private">]><root/>');
  await assert.rejects(readPptxSourceFonts(await JSZip.loadAsync(await zip.generateAsync({type:'nodebuffer'}))),/SOURCE_FONT_INSPECTION_REQUIRED/);
});
