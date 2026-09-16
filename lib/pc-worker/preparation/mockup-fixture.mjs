// Synthetic-only fixture shared by local service/browser QA. No PPTX, accounts,
// environment loading, network transport, or approval of customer material.
import {mkdtemp, writeFile, rm} from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import sharp from 'sharp';
import {openPreparationWorkStore} from './work-store.ts';
import {redactionHash} from './redaction-renderer.ts';
import {validateSourceFormatChoice} from './source-format-choice.ts';
import {initializeLocalRedactions,getLocalRedactionSlide,saveLocalRedactionSlide,renderLocalRedactionSlide,approveLocalRedactionSlide} from './redaction-service.ts';

export async function createMockupFixture({root,aspect='16:9',count=10,approveCount=count,highres=false,powerpointA4=false,customPortrait=false}={}) {
  root ??= await mkdtemp(path.join(os.tmpdir(),'woolim-mockup-'));
  if(powerpointA4 && aspect!=='a4_landscape')throw new Error('SYNTHETIC_PRESET_REQUIRES_A4_LANDSCAPE');
  if(customPortrait && (aspect!=='a4_portrait'||powerpointA4))throw new Error('SYNTHETIC_CUSTOM_REQUIRES_A4_PORTRAIT');
  const ratio=customPortrait?612.25/858.8750393700788:powerpointA4?780/540:aspect==='16:9'?16/9:aspect==='a4_landscape'?297/210:210/297;
  const width=Math.round((highres?2400:640)*Math.min(1,ratio)),height=Math.round(width/ratio);
  const store=await openPreparationWorkStore({root});
  const sourceHash=redactionHash(`SYNTHETIC MOCKUP ${aspect}`);
  const {build:initial}=await store.beginOrResumeBuild({expectedWorkRevision:null,fingerprint:{source:{sha256:sourceHash,bytes:24},conversionSettingsFingerprint:'mockup-fixture-1',fontFingerprint:'synthetic'}});
  let build=initial;const buildId=build.buildId;
  const slides=Array.from({length:count+1},(_,i)=>({sourceSlideNumber:i+1,contentHash:redactionHash(`slide${i+1}`),title:`합성 장표 ${i+1}`,hidden:false}));
  const inspection={aspect:customPortrait?'unknown':aspect,sourceHash,totalSlides:count+1,slides,issues:customPortrait?[{code:'NO_APPROVED_SUITE',detail:'custom source'}]:[],
    ...(customPortrait?{width:612.25,height:858.8750393700788,pageSizeVariant:'custom'}:{}),
    ...(powerpointA4?{width:780,height:540,pageSizeVariant:'powerpoint_a4_preset_landscape',slideSizeType:'A4'}:{})};
  if(customPortrait) {
    const receipt=validateSourceFormatChoice(inspection,{kind:'custom_portrait_to_a4',aspectClass:'a4_portrait',sourceHash,reviewedBy:'synthetic reviewer',reason:'Synthetic custom source local fit test'});
    const relativePath='source-format-choice.json';
    await writeFile(await store.prepareArtifactPath(buildId,relativePath),JSON.stringify(receipt));
    build=await store.recordArtifact({buildId,key:'source-format-choice',relativePath,expectedRevision:build.revision});
  }
  build=await store.completeStage({buildId,stage:'source_inspection',expectedRevision:build.revision,inputFingerprint:'inspection',artifactKeys:customPortrait?['source-format-choice']:[],data:inspection});
  build=await store.completeStage({buildId,stage:'preview_generation',expectedRevision:build.revision,inputFingerprint:'preview'});
  build=await store.recordSelection({buildId,expectedRevision:build.revision,expectedSelectionRevision:0,selectionFingerprint:'selection',data:{selected:slides.slice(0,count-1).map(s=>s.sourceSlideNumber),reserves:[count],cover:1,status:'ready_for_local_review'}});
  const colors=['#123c54','#0e6a68','#4966a7','#54477a','#78673a','#ad664c','#276a51','#5c728a','#82415c','#2d627c'];
  for(let n=1;n<=count;n++) {
    const c=colors[(n-1)%colors.length];
    const svg=`<svg width="${width}" height="${height}" viewBox="0 0 960 ${960/ratio}" xmlns="http://www.w3.org/2000/svg">
      <rect width="100%" height="100%" fill="#fff"/><rect width="28" height="100%" fill="${c}"/>
      <text x="70" y="66" font-size="18" font-family="Arial" fill="${c}">WOOLIM / SYNTHETIC DESIGN ${String(n).padStart(2,'0')}</text>
      <text x="70" y="128" font-size="40" font-family="Arial" font-weight="bold" fill="#162b3c">${['PROJECT OVERVIEW','DESIGN PRINCIPLES','SERVICE STRUCTURE','WORK PROCESS','RESULTS &amp; IMPACT'][n%5]}</text>
      <text x="70" y="166" font-size="17" font-family="Arial" fill="#687e8c">Fixed geometry. Carefully selected slides. A consistent visual system.</text>
      <rect x="70" y="205" width="820" height="${Math.max(230,960/ratio-335)}" rx="9" fill="${n%2?'#eef4f5':'#f0f2f8'}"/>
      ${[0,1,2].map((j)=>`<rect x="${105+j*265}" y="265" width="220" height="${95+(n+j)%3*35}" rx="5" fill="${c}" opacity="${.5+j*.22}"/><text x="${130+j*265}" y="305" font-size="27" font-family="Arial" fill="#fff">${['PLAN','BUILD','REVIEW'][j]}</text>`).join('')}
      <text x="75" y="${960/ratio-35}" font-size="18" font-family="Arial" fill="#63778b">SYNTHETIC QA ONLY · NOT CUSTOMER CONTENT</text>
      <text x="845" y="${960/ratio-35}" font-size="22" font-family="Arial" fill="${c}">${String(n).padStart(2,'0')}</text>
      <text x="75" y="${960/ratio-75}" font-size="14" font-family="Arial">fake@example.invalid</text>
    </svg>`;
    const png=await sharp(Buffer.from(svg)).flatten({background:'#fff'}).png().toBuffer();
    for(const [key,bytes] of [[`highres:${n}`,png],[`preview:${n}`,await sharp(png).resize({width:Math.round(800*Math.min(1,ratio))}).png().toBuffer()]]) {
      const relativePath=`fixture/${key.replace(':','-')}.png`;
      await writeFile(await store.prepareArtifactPath(buildId,relativePath),bytes);
      build=await store.recordArtifact({buildId,key,relativePath,expectedRevision:build.revision});
    }
  }
  build=await store.completeStage({buildId,stage:'high_resolution_conversion',expectedRevision:build.revision,inputFingerprint:'highres',artifactKeys:Array.from({length:count},(_,i)=>`highres:${i+1}`)});
  const work=await store.readWork();
  await store.setActiveSetRef({expectedRevision:work.revision,activeSetRef:{setId:'existing-live-set-synthetic',buildId:null}});
  await store.release();
  await initializeLocalRedactions({root,buildId,detections:slides.slice(0,count).map(s=>({sourceSlideNumber:s.sourceSlideNumber,sourceHash,slideContentHash:s.contentHash,
    candidates:[{id:'fake-email',rect:{x:.07,y:1-95/(960/ratio),width:.35,height:28/(960/ratio)},category:'email',required:true,reason:'CONTACT_TEXT'}],warnings:['PIXEL_CONTENT_REQUIRES_HIGH_RESOLUTION_LOCAL_REVIEW']}))});
  for(let n=1;n<=approveCount;n++) {
    const identity={root,buildId,sourceSlideNumber:n};let s=await getLocalRedactionSlide(identity);
    s=await saveLocalRedactionSlide({...identity,expectedRevision:s.revision,regions:s.regions,exceptions:[],review:{reviewer:'합성 시험 대역',originalInspected:true,layoutAcceptable:true}});
    s=await renderLocalRedactionSlide({...identity,expectedRevision:s.revision});
    await approveLocalRedactionSlide({...identity,expectedRevision:s.revision,outputHash:s.output.sha256,reviewer:'합성 시험 대역',outputInspected:true});
  }
  return {root,buildId,sourceHash,aspect,width,height,cleanup:()=>rm(root,{recursive:true,force:true})};
}
