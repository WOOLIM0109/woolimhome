import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash,randomUUID} from 'node:crypto';
import {readFile} from 'node:fs/promises';
import {getRegisteredApprovedMockupSuite,approvedMockupSuiteTemplates} from './approved-mockup-suites.ts';
import {resolveApprovedMockupSlots} from './approved-16x9-templates.ts';
import {productionTemplateFingerprint} from './production-template-fingerprint.ts';
import {productionSetManifest} from './production-descriptor.ts';
import {preparePortfolioImageSetCommit,portfolioImageSetAssetUrl} from './image-set.ts';
import {portfolioThumbnailBaseFingerprint,portfolioThumbnailManifestHash,preparePortfolioThumbnailCommit} from './thumbnail-version.ts';
import {createMockupSessionBinding,MOCKUP_BRIDGE_VERSION} from './production-session.ts';
import {validateVerifiedProductionPublication,readVerifiedProductionPublicationIssues} from './production-publication.ts';
import {productionSnapshotHash} from '../pc-worker/preparation/production-snapshot-hash.ts';

const hash=value=>createHash('sha256').update(value).digest('hex');
const now='2026-09-07T12:00:00.000Z';
function fixture(aspect='16:9') {
  const id=randomUUID(),setId=randomUUID(),candidateId=randomUUID(),suite=getRegisteredApprovedMockupSuite(aspect);
  const source={originalFileName:'synthetic.pptx',bucket:'portfolio-sources',storagePath:`sources/${candidateId}.pptx`};
  const descriptor={version:'verified-production-mockup-snapshot-v1',mode:'full',localWorkId:randomUUID(),buildId:randomUUID(),
    sourceHash:hash('PPT source bytes'),aspectClass:aspect,suiteId:suite.suiteId,templateVersion:suite.version,sourceFormatFingerprint:null,
    assignmentHash:hash('assignments'),localRevision:2,titleRevision:null,remoteApproval:'required',localConfirmation:'technical_candidate_only',
    boards:approvedMockupSuiteTemplates(suite).map((template,index)=>{const slots=resolveApprovedMockupSlots(template);return {
      templateId:template.id,templateVersion:template.version,kind:index===0?'thumbnail':'body_image',imageHash:hash(`board${index}`),width:template.canvas.width,height:template.canvas.height,
      slideAspectRatio:template.slideAspectRatio,sourceSlideNumbers:slots.map((_,i)=>i+1),geometryHash:productionTemplateFingerprint(template),
      rendererFingerprint:hash('current worker renderer'),assignmentFingerprint:hash(`assignment${index}`),
      redactions:slots.map((slot,i)=>({slotId:slot.id,sourceSlideNumber:i+1,imageHash:hash(`redacted${i}`),redactionFingerprint:hash(`blur proof${i}`),ruleVersion:'local-redaction-2',approvedAt:now}))};})};
  descriptor.thumbnail={templateId:descriptor.boards[0].templateId,baseImageHash:hash('titleless base'),baseFingerprint:hash('titleless proof'),
    overlayFingerprint:null,titleSpec:null,titleImageHash:descriptor.boards[0].imageHash,localConfirmed:false};
  const oldUrls=Array.from({length:4},(_,i)=>`/old-${i}.png`);
  const initial={id,format:'portfolio',title:'기존 원고 제목',status:'review_required',updated_at:now,published_url:'기록 URL',
    metadata:{candidateId,generated:{title:'원래 제목',bodyHtml:oldUrls.map(url=>`<h2>기존 소제목</h2><p>기존 설명 문단입니다.</p><figure><img src="${url}"><figcaption>기존 설명</figcaption></figure>`).join(''),
      faq:[{question:'원래 질문',answer:'원래 답변'}]},portfolioAssets:[{kind:'thumbnail',url:'/old-thumb.png'},...oldUrls.map(url=>({kind:'body_image',url}))],unknown:{keep:true}}};
  const set=productionSetManifest(descriptor,id,setId,'authenticated-admin',now);
  const commit=preparePortfolioImageSetCommit(initial,{set,expectedUpdatedAt:now,expectedActiveSetId:null,actor:'authenticated-admin',activatedAt:now});
  const item={...initial,metadata:commit.nextMetadata,content_review_assets:set.assets.map((asset,index)=>({id:randomUUID(),work_item_id:id,asset_type:asset.kind,public_url:asset.url,sort_order:index}))};
  const session={id:setId,work_item_id:id,candidate_id:candidateId,status:'activated',source_hash:descriptor.sourceHash,descriptor_hash:productionSnapshotHash(descriptor),descriptor,manifest:set,
    binding:{...createMockupSessionBinding(initial,candidateId,source),version:MOCKUP_BRIDGE_VERSION}};
  return {item,set,descriptor,session,source,manifests:{imageSets:[set],thumbnailVersions:[]}};
}
const verify=f=>validateVerifiedProductionPublication(f.item,f.manifests,{session:f.session,currentSource:f.source});
function replaceTitle(f) {
  const versionId=randomUUID(),render={localWorkId:f.set.localWorkId,buildId:f.set.buildId,sourceHash:f.set.sourceHash,
    baseFingerprint:f.descriptor.thumbnail.baseFingerprint,overlayFingerprint:hash('titleoverlay'),inputFingerprint:hash('input'),
    titleSpec:{main:'행사 대행 제안서',sub:'',showSub:false,style:'bold'}};
  const manifest={version:1,versionId,workItemId:f.item.id,baselineId:versionId,baseSetId:f.set.setId,
    baseFingerprint:portfolioThumbnailBaseFingerprint(f.item,render),render,
    asset:{kind:'thumbnail',name:'thumbnail.png',bucket:'portfolio-rendered',path:`verified-thumbnail/${f.item.id}/${versionId}.png`,
      url:portfolioImageSetAssetUrl(`verified-thumbnail/${f.item.id}/${versionId}.png`),sha256:hash('final title'),width:1080,height:1080,caption:'확정 제목'}};
  const version={...manifest,approval:{approvedBy:'authenticated-admin',approvedAt:now,outputInspected:true,manifestHash:portfolioThumbnailManifestHash(manifest)}};
  const commit=preparePortfolioThumbnailCommit(f.item,{version,expectedUpdatedAt:now,expectedActiveVersionId:null,expectedActiveSetId:f.set.setId,
    expectedProof:{render,sha256:version.asset.sha256},actor:'authenticated-admin',activatedAt:now});
  f.item.metadata=commit.nextMetadata;f.item.content_review_assets[0].public_url=version.asset.url;f.manifests.thumbnailVersions=[version];
}

test('verified activated full sets in all three formats have independent source proof with no legacy COM/jobs fabricated',()=>{
  for(const aspect of ['16:9','a4_landscape','a4_portrait']) {
    const f=fixture(aspect),before=structuredClone(f);
    assert.deepEqual(verify(f),[]);assert.deepEqual(f,before);
    assert.equal(f.item.metadata.redactionProof,undefined);assert.equal(f.item.metadata.portfolioGenerationId,undefined);
  }
});
test('title-only replacement uses approved base provenance while retaining all BODY, manuscript, FAQ and publication fields',()=>{
  const f=fixture(),before=structuredClone(f.item);replaceTitle(f);
  assert.deepEqual(verify(f),[]);
  assert.equal(f.item.metadata.portfolioAssets[0].slideIndexes,undefined);
  assert.deepEqual(f.item.metadata.generated,before.metadata.generated);assert.deepEqual(f.item.content_review_assets.slice(1),before.content_review_assets.slice(1));
  assert.equal(f.item.title,before.title);assert.equal(f.item.published_url,before.published_url);
  f.item.metadata.generated.faq[0].answer='나중에 편집한 답';
  f.item.metadata.generated.bodyHtml=f.item.metadata.generated.bodyHtml.replace('기존 설명 문단입니다.','이후 바꾼 설명 문단입니다.');
  assert.deepEqual(verify(f),[]); // later writing edits do not invalidate source/image proof
});
test('active pointer/manifest alone, staged or wrong-work/session/source binding cannot bypass approval',()=>{
  for(const mutate of [f=>f.session=null,f=>f.session.status='staged',f=>f.session.id=randomUUID(),f=>f.session.work_item_id=randomUUID(),
    f=>f.session.source_hash=hash('different'),f=>f.session.manifest={...f.set,sourceHash:hash('different')},f=>f.session.candidate_id=randomUUID(),
    f=>f.item.metadata.candidateId=randomUUID(),f=>f.session.binding.version='old',f=>f.session.binding.sourceBindingHash=hash('bad')]) {
    const f=fixture();mutate(f);assert.throws(()=>verify(f),/MOCKUP_/);
  }
  const f=fixture();assert.throws(()=>validateVerifiedProductionPublication(f.item,f.manifests,{session:{},currentSource:f.source}),/PROOF_INVALID/);
});
test('current source changes or missing source evidence fail closed even when the prior activated manifest remains intact',()=>{
  for(const source of [null,{}, {originalFileName:'changed.pptx',storagePath:'another-source.pptx'}]) {
    const f=fixture();f.source=source;assert.throws(()=>verify(f),/MOCKUP_PUBLICATION_SOURCE_CHANGED/);
  }
});
test('descriptor hash, geometry, source/assignment, individual redaction receipts and old privacy rules are all binding',()=>{
  for(const mutate of [d=>d.sourceHash=hash('other'),d=>d.assignmentHash=hash('other'),d=>d.boards[1].geometryHash=hash('other'),
    d=>d.boards[2].redactions.pop(),d=>d.boards[0].redactions[0].sourceSlideNumber=99,d=>d.boards[1].redactions[0].ruleVersion='old-redaction-rule']) {
    const f=fixture();mutate(f.descriptor);f.session.descriptor_hash=productionSnapshotHash(f.descriptor);
    assert.throws(()=>verify(f),/MOCKUP_|IMAGE_SET_/);
  }
  const f=fixture();f.session.descriptor_hash=hash('tamper');assert.throws(()=>verify(f),/MOCKUP_DESCRIPTOR_INVALID/);
});
test('approved geometry and exact current metadata BODY list remain required',()=>{
  for(const mutate of [m=>m.portfolioMockup.bodyBoardCount=3,m=>m.portfolioMockup.redactionStatus='pending',m=>m.portfolioMockup.templateVersion='old',
    m=>m.portfolioMockup.selectedSlideIndexes.push(999),m=>m.portfolioAssets[1].url='/old.png']) {
    const f=fixture();mutate(f.item.metadata);assert.throws(()=>verify(f),/MOCKUP_|IMAGE_SET_/);
  }
});
test('thumbnail render identity must use the titleless base approved in the active session, not another self-consistent base proof',()=>{
  const f=fixture();replaceTitle(f);const version=f.manifests.thumbnailVersions[0];
  version.render.baseFingerprint=hash('different titleless base');
  version.baseFingerprint=portfolioThumbnailBaseFingerprint(f.item,version.render);
  version.approval.manifestHash=portfolioThumbnailManifestHash(version);
  Object.assign(f.item.metadata.portfolioThumbnailVersion,{baseFingerprint:version.baseFingerprint,manifestHash:version.approval.manifestHash});
  assert.throws(()=>verify(f),/MOCKUP_THUMBNAIL_BASE_PROOF_MISMATCH/);
});
test('BODY/figure count, placement, captions, exact URLs and ambiguous sources are never waived by new image approval',()=>{
  for(const change of [html=>html.replace(/<figure[\s\S]*?<\/figure>/,''),html=>html.replace(/<h2>[\s\S]*?<\/h2>|<p>[\s\S]*?<\/p>/g,''),
    html=>html.replace(/<figcaption>[\s\S]*?<\/figcaption>/,''),html=>html.replace('src=','srcset="alternative.png 2x" src='),
    html=>html.replace('<img src="','<img src="/wrong.png" data-original="'),html=>html+'<img src="/unapproved.png">']) {
    const f=fixture();f.item.metadata.generated.bodyHtml=change(f.item.metadata.generated.bodyHtml);assert.ok(verify(f).length>0);
  }
});
test('read boundary performs only injected selects and sends latest source proof to the pure verifier',async()=>{
  const f=fixture(),calls=[];
  const admin={from(table){const call={table,filters:[]};calls.push(call);const query={
    select(columns){call.columns=columns;return query;},in(column,ids){call.filters.push([column,ids]);return query;},
    eq(column,value){call.filters.push([column,value]);return query;},order(column,options){call.order=[column,options];return query;},limit(n){call.limit=n;return query;},
    maybeSingle(){call.single=true;return query;},then(resolve){const data=table==='portfolio_image_sets'?[{id:f.set.setId,work_item_id:f.item.id,manifest:f.set}]
      :table==='portfolio_mockup_sessions'?f.session:table==='content_jobs'?[{result:f.source}]:[];return Promise.resolve({data,error:null}).then(resolve);}
  };return query;}};
  assert.deepEqual(await readVerifiedProductionPublicationIssues(f.item,admin),[]);
  assert.deepEqual(calls.map(c=>c.table).sort(),['content_jobs','portfolio_image_sets','portfolio_mockup_sessions'].sort());
  const download=calls.find(c=>c.table==='content_jobs');assert.equal(download.limit,1);assert.deepEqual(download.order,['created_at',{ascending:false}]);
});
test('missing source row never falls back to legacy proof; approval keeps editorial validation and metadata CAS',async()=>{
  const f=fixture();
  const admin={from(table){const query={select(){return query;},in(){return query;},eq(){return query;},order(){return query;},limit(){return query;},maybeSingle(){return query;},
    then(resolve){return Promise.resolve({data:table==='portfolio_mockup_sessions'?f.session:table==='portfolio_image_sets'?[{id:f.set.setId,work_item_id:f.item.id,manifest:f.set}]:[],error:null}).then(resolve);}};return query;}};
  await assert.rejects(readVerifiedProductionPublicationIssues(f.item,admin),/SOURCE_EVIDENCE_MISSING/);
  const source=await readFile(new URL('../../app/api/admin/content/[id]/route.ts',import.meta.url),'utf8');
  assert.match(source,/issues = await readVerifiedProductionPublicationIssues\(current, admin\)/);
  assert.match(source,/const editorialIssues = editorialPublicationIssues\(/);
  assert.match(source,/if \(expectedUpdatedAt\) updateQuery = updateQuery.eq\("updated_at", expectedUpdatedAt\)/);
  assert.match(source,/validatePortfolioSourceState\(/); // legacy branch unchanged
});
