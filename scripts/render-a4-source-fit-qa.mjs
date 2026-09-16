/** Synthetic only: no PowerPoint/production/credentials/customer images/network. */
import {mkdir,writeFile} from 'node:fs/promises';
import path from 'node:path';
import sharp from 'sharp';
import {createMockupFixture} from '../lib/pc-worker/preparation/mockup-fixture.mjs';
import {readSafeRedactedSlide} from '../lib/pc-worker/preparation/redaction-service.ts';
import {initializeLocalMockups,renderLocalMockups,readLocalMockupImage} from '../lib/pc-worker/preparation/mockup-service.ts';
import {getRegisteredApprovedMockupSuite,approvedMockupSuiteTemplates} from '../lib/portfolio/approved-mockup-suites.ts';
import {resolveApprovedMockupSlots} from '../lib/portfolio/approved-16x9-templates.ts';
import {renderAssignedApprovedBoard,compareApprovedBoardDraftAndFinal} from '../lib/portfolio/approved-assigned-board-renderer.ts';

globalThis.fetch=()=>{throw new Error('NO_NETWORK_IN_A4_FIT_QA');};
sharp.concurrency(2);
const output=path.resolve('.codex-tmp/a4-source-fit-qa');
await mkdir(output,{recursive:true});
const fixtures=[],records=[];
try {
  const landscape=await createMockupFixture({aspect:'a4_landscape',powerpointA4:true,count:7,highres:true});fixtures.push(landscape);
  let review=await initializeLocalMockups({...landscape,title:'PowerPoint A4 · 비율 검사용'});
  review=await renderLocalMockups({...landscape,expectedRevision:review.revision,scale:.5});
  review=await renderLocalMockups({...landscape,expectedRevision:review.revision,scale:1});
  for(const [i,board] of review.boards.entries()) {
    const bytes=await readLocalMockupImage({...landscape,templateId:board.templateId,scale:1});
    const debug=await readLocalMockupImage({...landscape,templateId:board.templateId,scale:1,debug:true});
    await writeFile(path.join(output,`landscape-${i}.png`),bytes);
    await writeFile(path.join(output,`landscape-${i}-guides.png`),debug);
    records.push({mode:'synthetic-approved-service-test',aspect:'a4_landscape',templateId:board.templateId,output:`landscape-${i}.png`,activeSetUnchanged:review.activeSetUnchanged});
  }

  // Build a synthetic PNG with the SAME measured ratio as the user's custom page.
  // These pixels are a QA fixture, never the user's PPT. Custom acceptance is NOT
  // written to the preparation state, catalog, approval, upload, or active set.
  const portrait=await createMockupFixture({aspect:'a4_portrait',count:7,highres:true});fixtures.push(portrait);
  const expectedRatio=612.25/858.8750393700788;
  const sources=[];
  for(let n=1;n<=7;n++) {
    const source=await readSafeRedactedSlide({...portrait,sourceSlideNumber:n});
    const {width,height}=await sharp(source).metadata();
    const extra=Math.round(height*expectedRatio)-width;
    if(extra<0)throw new Error('SYNTHETIC_SOURCE_MUST_EXTEND_ONLY');
    sources.push({index:n-1,buffer:await sharp(source).extend({top:0,bottom:0,left:Math.floor(extra/2),right:extra-Math.floor(extra/2),background:'#fff'}).png().toBuffer()});
  }
  const fit={sourceWidth:612.25,sourceHeight:858.8750393700788,aspectClass:'a4_portrait',sourceKind:'custom_preview'};
  for(const [i,template] of approvedMockupSuiteTemplates(getRegisteredApprovedMockupSuite('a4_portrait')).entries()) {
    const count=resolveApprovedMockupSlots(template).length;
    const slides=Array.from({length:count},(_,j)=>sources[(j+i)%sources.length]);
    const draft=await renderAssignedApprovedBoard({aspectClass:'a4_portrait',templateId:template.id,slides,scale:.5,title:'사용자 지정 세로 · 검사용',a4SourceFit:fit});
    const final=await renderAssignedApprovedBoard({aspectClass:'a4_portrait',templateId:template.id,slides,scale:1,title:'사용자 지정 세로 · 검사용',a4SourceFit:fit});
    const comparison=compareApprovedBoardDraftAndFinal(draft.manifest,final.manifest);
    if(!comparison.passed)throw new Error(JSON.stringify(comparison));
    await writeFile(path.join(output,`portrait-${i}.png`),final.bytes);
    await writeFile(path.join(output,`portrait-${i}-guides.png`),final.debugBytes);
    records.push({mode:'synthetic-custom-preview-not-approved',aspect:'a4_portrait',templateId:template.id,output:`portrait-${i}.png`,fit:final.manifest.slots[0].sourceFit,comparison});
  }
  const fontfile=path.resolve('public/fonts/Paperlogy-7Bold.ttf');
  const label=async(text,width)=>sharp({text:{text,font:'Paperlogy 7Bold 30',fontfile,width,rgba:true}}).png().toBuffer();
  const left=await sharp(path.join(output,'landscape-3.png')).resize({width:780}).png().toBuffer();
  const right=await sharp(path.join(output,'portrait-4.png')).resize({width:780}).png().toBuffer();
  const sheet=await sharp({create:{width:1640,height:550,channels:3,background:'#f1f3f5'}}).composite([
    {input:await label('PowerPoint A4 가로 · 합성 검사용',780),left:30,top:18},
    {input:await label('사용자 지정 세로 · 합성 검사용',780),left:830,top:18},
    {input:left,left:30,top:76},{input:right,left:830,top:76},
  ]).png().toBuffer();
  await writeFile(path.join(output,'fit-comparison.png'),sheet);
  await writeFile(path.join(output,'results.json'),JSON.stringify({syntheticOnly:true,customerPowerPointConverted:false,records},null,2));
  console.log(JSON.stringify({output,templates:records.length,syntheticOnly:true,customerPowerPointConverted:false}));
} finally { for(const f of fixtures)await f.cleanup(); }
