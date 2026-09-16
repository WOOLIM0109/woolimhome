import {createHash,randomUUID} from 'node:crypto';
import {approvedMockupSuiteTemplates,getRegisteredApprovedMockupSuite} from './approved-mockup-suites.ts';
import {resolveApprovedMockupSlots} from './approved-16x9-templates.ts';
import {productionTemplateFingerprint} from './production-template-fingerprint.ts';
import {createMockupSessionBinding,MOCKUP_BRIDGE_VERSION} from './production-session.ts';
import {productionSnapshotHash} from '../pc-worker/preparation/production-snapshot-hash.ts';

/** Synthetic values only. No storage, source document, credentials or runtime rendering. */
export function productionDescriptorFixture(aspect='16:9') {
  const hash=value=>createHash('sha256').update(value).digest('hex');
  const id=randomUUID(),sessionId=randomUUID(),candidateId=randomUUID(),now='2026-09-07T12:00:00.000Z';
  const suite=getRegisteredApprovedMockupSuite(aspect);
  const descriptor={version:'verified-production-mockup-snapshot-v1',mode:'full',localWorkId:randomUUID(),buildId:randomUUID(),
    sourceHash:hash('synthetic source bytes'),aspectClass:aspect,suiteId:suite.suiteId,templateVersion:suite.version,sourceFormatFingerprint:null,
    assignmentHash:hash('synthetic assignments'),localRevision:3,titleRevision:2,remoteApproval:'required',localConfirmation:'technical_candidate_only',
    boards:approvedMockupSuiteTemplates(suite).map((template,index)=>{const slots=resolveApprovedMockupSlots(template);return {
      templateId:template.id,templateVersion:template.version,kind:index===0?'thumbnail':'body_image',imageHash:hash(`board ${index}`),width:template.canvas.width,height:template.canvas.height,
      slideAspectRatio:template.slideAspectRatio,sourceSlideNumbers:slots.map((_,i)=>i+1),geometryHash:productionTemplateFingerprint(template),
      rendererFingerprint:hash('synthetic renderer'),assignmentFingerprint:hash(`assignment ${index}`),
      redactions:slots.map((slot,i)=>({slotId:slot.id,sourceSlideNumber:i+1,imageHash:hash(`redacted ${i}`),redactionFingerprint:hash(`redaction ${i}`),ruleVersion:'local-redaction-2',approvedAt:now}))};})};
  descriptor.thumbnail={templateId:descriptor.boards[0].templateId,baseImageHash:hash('titleless synthetic base'),baseFingerprint:hash('synthetic base proof'),
    overlayFingerprint:hash('synthetic title overlay'),titleSpec:{main:'행사 대행 제안서',sub:'합성 부제',showSub:true,style:'bold'},
    titleImageHash:descriptor.boards[0].imageHash,localConfirmed:true};
  const initial={id,format:'portfolio',title:'기존 제목 보존',summary:'기존 요약 보존',status:'review_required',updated_at:now,
    published_url:'https://example.invalid/published',metadata:{candidateId,generated:{title:'원고 제목 보존',
      bodyHtml:Array.from({length:4},(_,i)=>`<h2>소제목 ${i}</h2><p>기존 설명 문단입니다.</p><figure><img src="/legacy-${i}.png"><figcaption>원래 설명 ${i}</figcaption></figure>`).join(''),
      faq:[{question:'기존 질문',answer:'기존 답변'}]},portfolioAssets:[{kind:'thumbnail',url:'/legacy-thumb.png'},
        ...Array.from({length:4},(_,i)=>({kind:'body_image',url:`/legacy-${i}.png`}))],untouched:{nested:['원고',42,true]}}};
  const source={originalFileName:'synthetic.pptx',bucket:'portfolio-sources',storagePath:`sources/${candidateId}.pptx`};
  const session={id:sessionId,work_item_id:id,candidate_id:candidateId,status:'uploading',source_hash:descriptor.sourceHash,
    descriptor_hash:productionSnapshotHash(descriptor),descriptor,binding:{...createMockupSessionBinding(initial,candidateId,source),version:MOCKUP_BRIDGE_VERSION}};
  return {id,sessionId,candidateId,now,descriptor,initial,source,session};
}

/** Reproduce JSONB's object-key order for portable regression tests. Actual
 * PostgreSQL/PGlite round-trip QA additionally verifies this behavior. */
export function jsonbOrder(value) {
  if(Array.isArray(value))return value.map(jsonbOrder);
  if(value&&typeof value==='object')return Object.fromEntries(Object.keys(value).sort((a,b)=>Buffer.byteLength(a)-Buffer.byteLength(b)||Buffer.compare(Buffer.from(a),Buffer.from(b))).map(key=>[key,jsonbOrder(value[key])]));
  return value;
}
