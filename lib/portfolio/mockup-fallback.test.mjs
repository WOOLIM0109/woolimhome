import assert from 'node:assert/strict';
import test from 'node:test';
import {readFileSync} from 'node:fs';
import {webcrypto} from 'node:crypto';
import vm from 'node:vm';
import ts from 'typescript';
import * as selection from './slide-selection.ts';
import * as routes from './mockup-route.ts';
import {resolveApprovedMockupSlots,APPROVED_16X9_TEMPLATE_VERSION} from './approved-16x9-templates.ts';

// The real orchestration, selection and route policy execute. Redacted loading,
// image renderers and storage are isolated boundaries; no network or sharp work.
function harness({count=24,aspect='16:9',failAt=0,coverBlocked=false,invalidProof=false,selectionBlocked=false}={}){
  const ratio={'16:9':16/9,a4_landscape:297/210,a4_portrait:210/297,'4:3':4/3,unknown:1.1}[aspect];
  const calls={approved:0,legacyBody:0,legacyThumbnail:0,uploads:[],warnings:[],events:[]};
  const failure=new Error('APPROVED_SERVER_RENDER_FAILED customer-private-title');
  function approvedCall(){calls.approved++;calls.events.push(`approved-${calls.approved}`);if(calls.approved===failAt)throw failure;}
  function bodyBoards(input,legacy){
    const suite=routes.autoApprovedSuite(input.aspectClass);
    return Array.from({length:4},(_,index)=>{
      if(!legacy)approvedCall();
      const template=suite?.bodyTemplates[index];
      const indexes=input.slides.slice(0,legacy?1:resolveApprovedMockupSlots(template).length).map(slide=>slide.index);
      return {kind:'body_image',name:`short-${index}.jpg`,bytes:Buffer.from(legacy?'legacy':'approved'),caption:'body',slideIndexes:indexes,
        slideAspectRatio:ratio,width:1600,height:900,mockupTemplateId:legacy?`legacy-${aspect}-${index}`:template.id,
        mockupTemplateVersion:legacy?APPROVED_16X9_TEMPLATE_VERSION:suite.version,
        slotAssignments:indexes.map((slideIndex,i)=>({slotId:`slot-${i}`,slideIndex}))};
    });
  }
  const modules={sharp:()=>{throw Error('Unexpected sharp boundary');},'node:path':{join:(...parts)=>parts.join('/')},'node:crypto':{},'node:fs/promises':{},
    '@/lib/content-ops/data':{contentAdmin:()=>({storage:{from:()=>({async upload(path,bytes){calls.events.push('upload');calls.uploads.push({path,bytes:bytes.toString()});return {error:null};}})}})},
    './slide-selection':selection,'./mockup-route.ts':routes,
    './short-mockup':{
      async renderShortDocumentMockups(input){if(input.forceLegacyLayout)calls.legacyBody++;return {boards:bodyBoards(input,Boolean(input.forceLegacyLayout))};},
      async renderApprovedTemplateBodyMockups(input){return {boards:bodyBoards(input,false)};},
    },
    './approved-16x9-templates.ts':{resolveApprovedMockupSlots,APPROVED_16X9_TEMPLATE_VERSION},
    './production-approved-renderer.ts':{async renderProductionApprovedMockup(input){approvedCall();return {bytes:Buffer.from('approved'),templateId:input.template.id,templateVersion:input.template.version,width:1600,height:900,slotAssignments:input.slides.map((slide,index)=>({slotId:`slot-${index}`,sourceSlideIndex:slide.index}))};}},
    './grid-layout':{},'./image-fingerprint':{findDuplicatePortfolioImage:()=>null},
    './redaction-proof':{localRedactionRegions:()=>[],isPortfolioSlideRedactionProofForManifest:()=>!invalidProof},
    '../pc-worker/redaction-manifest':{automaticDesignEligibleSlideIndexes:manifest=>manifest.slides.slice(0,selectionBlocked?4:count).map(slide=>slide.slideIndex)},
    './cover-title':{normalizeCoverTitle:value=>value,suggestCoverTitles:()=>['safe']},
    './cover-slide':{resolveCoverSlide:()=>coverBlocked?{blockedReason:'redaction_excluded'}:{coverIndex:0},coverSlideBlockedMessage:()=>'coverSlideBlockedMessage'},
    './photo-heavy':{excludePhotoHeavySlides:input=>({keptSlideIndexes:input.eligibleSlideIndexes,excludedSlideIndexes:[]})},
    './photo-detect':{},'./image-role.ts':{},'./redaction-summary.ts':{},
  };
  const exports={};
  const source=ts.transpileModule(readFileSync('lib/portfolio/mockup.ts','utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022,esModuleInterop:true}}).outputText;
  vm.runInNewContext(source+`
    loadSlides = async input => input.indexes.map(index=>({index,buffer:Buffer.from(String(index)),aspectRatio:__ratio,contentHash:'content-'+index,visualHash:'visual-'+index,redactionSummary:[],redactionProof:{slideIndex:index}}));
    multiPageBoard = async () => { __calls.legacyBody++; return Buffer.from('legacy'); };
    thumbnail = async () => { __calls.legacyThumbnail++; return Buffer.from('legacy'); };
  `,{exports,require:name=>{if(!(name in modules))throw Error(`Unexpected import: ${name}`);return modules[name];},Buffer,Date,Error,crypto:webcrypto,
    process:{cwd:()=>'.'},console:{info(){},warn:message=>calls.warnings.push(message)},__ratio:ratio,__calls:calls});
  const input={candidateId:'test',bucket:'portfolio-rendered',slidePaths:Array.from({length:count},(_,index)=>`slide-${index}`),review:{},coverTitle:'safe title',
    localRedactionManifest:{sourceSlideCount:count,slides:Array.from({length:count},(_,slideIndex)=>({slideIndex}))}};
  return {calls,failure,run:()=>exports.createPortfolioMockups(input)};
}

test('every newly opened route falls back atomically if any approved body or thumbnail fails',async()=>{
  for(const [aspect,count] of [['16:9',24],['a4_portrait',10],['a4_portrait',24]])for(const failAt of [1,2,3,4,5]){
    const h=harness({aspect,count,failAt}),assets=await h.run();
    assert.equal(h.calls.approved,failAt);assert.equal(h.calls.warnings.length,1);
    assert.equal(h.calls.warnings[0],'[portfolio-mockup] approved long/portrait render failed, legacy used code=APPROVED_SERVER_RENDER_FAILED');
    assert.ok(h.calls.uploads.every(upload=>upload.bytes==='legacy'));
    assert.equal(h.calls.legacyThumbnail,1);assert.ok(h.calls.legacyBody>0);
    assert.ok(assets.every(asset=>asset.mockupMode===(count<20?'short_psd':'six_grid')));
    assert.ok(assets.every(asset=>!asset.mockupTemplateId||asset.mockupTemplateId.startsWith('legacy-')));
    assert.equal(assets.length,count<20?5:1+h.calls.legacyBody);
  }
});

test('established short widescreen and both landscape routes still throw approved renderer errors',async()=>{
  for(const [aspect,count] of [['16:9',10],['a4_landscape',10],['a4_landscape',24]])for(const failAt of [1,5]){
    const h=harness({aspect,count,failAt});await assert.rejects(h.run(),error=>error===h.failure);
    assert.equal(h.calls.legacyBody,0);assert.equal(h.calls.legacyThumbnail,0);assert.equal(h.calls.uploads.length,0);assert.equal(h.calls.warnings.length,0);
  }
});

test('approved assets upload only after all five renders complete and retain one suite',async()=>{
  for(const [aspect,count] of [['16:9',24],['a4_portrait',10],['a4_portrait',24]]){
    const h=harness({aspect,count}),assets=await h.run();
    assert.equal(assets.length,5);assert.ok(assets.every(asset=>asset.mockupMode==='short_psd'));
    assert.ok(assets.every(asset=>asset.mockupTemplateVersion===routes.autoApprovedSuite(aspect).version));
    assert.deepEqual(h.calls.events.slice(0,5),['approved-1','approved-2','approved-3','approved-4','approved-5']);
    assert.ok(h.calls.events.slice(5).every(event=>event==='upload'));assert.equal(h.calls.legacyBody,0);assert.equal(h.calls.warnings.length,0);
  }
});

test('redaction, cover and minimum-slide errors bypass render recovery and uploads',async()=>{
  for(const options of [{count:4},{count:24,selectionBlocked:true},{count:24,invalidProof:true},{count:24,coverBlocked:true}]){
    const h=harness({...options,aspect:'a4_portrait',failAt:1});
    await assert.rejects(h.run(),options.count===4?/최소 5장/:options.selectionBlocked?/사용 가능한 장표/:options.invalidProof?/기밀 블러/:/coverSlideBlockedMessage/);
    assert.equal(h.calls.approved,0);assert.equal(h.calls.warnings.length,0);assert.equal(h.calls.uploads.length,0);assert.equal(h.calls.legacyBody,0);
  }
});

test('unknown short decks stop before rendering; unknown long and 4:3 decks preserve legacy routes',async()=>{
  const short=harness({aspect:'unknown',count:10});await assert.rejects(short.run(),/PPT 규격/);assert.equal(short.calls.uploads.length,0);assert.equal(short.calls.warnings.length,0);
  for(const [aspect,count] of [['unknown',24],['4:3',10],['4:3',24]]){
    const h=harness({aspect,count}),assets=await h.run();
    assert.equal(h.calls.approved,0);assert.equal(h.calls.warnings.length,0);assert.ok(h.calls.uploads.every(upload=>upload.bytes==='legacy'));
    assert.ok(assets.every(asset=>asset.mockupMode===(count<20?'short_psd':'six_grid')));
  }
});
