import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash,randomUUID} from 'node:crypto';
import {readFile} from 'node:fs/promises';
import {getRegisteredApprovedMockupSuite,approvedMockupSuiteTemplates} from './approved-mockup-suites.ts';
import {resolveApprovedMockupSlots} from './approved-16x9-templates.ts';
import {portfolioImageSetAssetUrl,portfolioImageSetManifestHash} from './image-set.ts';
import {portfolioThumbnailBaseFingerprint,portfolioThumbnailManifestHash,preparePortfolioThumbnailCommit} from './thumbnail-version.ts';
import {hasProductionPortfolioImageSelection,assertLegacyPortfolioImageWriteAllowed,loadProductionImageManifests,projectProductionPortfolioImages,productionImageProjectionErrorCode} from './production-image-projection.ts';
import {partnerAssetUrl,replaceAdminAssetUrls} from '../partner-portal.ts';
import {createPortfolioSourceFingerprint,PORTFOLIO_RULE_VERSION,validatePortfolioPublicationMetadata,validatePortfolioSourceState} from '../content-ops/portfolio-rules.ts';
import {localRedactionManifestHash} from './redaction-proof.ts';

const hash=v=>createHash('sha256').update(v).digest('hex');
const now='2026-09-07T12:00:00.000Z';
function fixture(aspect='16:9') {
  const id=randomUUID(),setId=randomUUID(),suite=getRegisteredApprovedMockupSuite(aspect);
  const manifest={version:1,setId,workItemId:id,localWorkId:randomUUID(),buildId:randomUUID(),sourceHash:hash('source'),assignmentHash:hash('assignment'),
    suiteId:suite.suiteId,templateVersion:suite.version,aspectClass:aspect,
    assets:approvedMockupSuiteTemplates(suite).map((t,i)=>{const path=`verified-local/${id}/${setId}/${i}.png`;return {
      kind:i===0?'thumbnail':'body_image',name:i===0?'thumbnail.png':`body-${i}.png`,bucket:'portfolio-rendered',path,url:portfolioImageSetAssetUrl(path),
      sha256:hash(`${id}/${i}`),width:t.canvas.width,height:t.canvas.height,caption:`승인 이미지 ${i}`,slideIndexes:resolveApprovedMockupSlots(t).map((_,j)=>j),
      slideAspectRatio:t.slideAspectRatio,mockupMode:'short_psd',aspectClass:aspect,mockupTemplateId:t.id,mockupTemplateVersion:t.version};})};
  const set={...manifest,approval:{approvedBy:'admin',approvedAt:now,outputInspected:true,manifestHash:portfolioImageSetManifestHash(manifest),visualReview:'not_performed'}};
  const attachment={id:randomUUID(),asset_type:'article_preview',public_url:'/attached-preview',sort_order:6};
  const item={id,format:'portfolio',title:'현대실업 생활폐기물 입찰제안서',status:'published',updated_at:now,published_url:'https://blog.naver.com/example/1',
    metadata:{generated:{title:'원고 제목',bodyHtml:set.assets.slice(1).map(a=>`<figure><img src="${a.url.replaceAll('&','&amp;')}"><figcaption>원래 설명</figcaption></figure>`).join(''),
      faq:[{question:'원래 질문',answer:'원래 답변'}],tags:['보존']},portfolioAssets:[...structuredClone(set.assets),{kind:'document',url:'/attachment.pdf',caption:'비이미지 첨부'}],
      portfolioImageSet:{version:1,activeSetId:setId,manifestHash:set.approval.manifestHash},portfolioMockup:{imageSetId:setId,suiteId:suite.suiteId},unrelated:{keep:true}},
    content_review_assets:[...set.assets.map((a,i)=>({id:randomUUID(),work_item_id:id,asset_type:a.kind,public_url:a.url,sort_order:i,approved:true})),attachment]};
  return {item,set};
}
function titleVersion(item,set) {
  const versionId=randomUUID(),render={localWorkId:set.localWorkId,buildId:set.buildId,sourceHash:set.sourceHash,baseFingerprint:hash('titleless base'),overlayFingerprint:hash('overlay'),
    inputFingerprint:hash('new title'),titleSpec:{main:'행사 대행 제안서',sub:'',showSub:false,style:'bold'}};
  const manifest={version:1,versionId,workItemId:item.id,baselineId:versionId,baseSetId:set.setId,
    baseFingerprint:portfolioThumbnailBaseFingerprint(item,render),render,asset:{kind:'thumbnail',name:'thumbnail.png',bucket:'portfolio-rendered',
      path:`verified-thumbnail/${item.id}/${versionId}.png`,url:portfolioImageSetAssetUrl(`verified-thumbnail/${item.id}/${versionId}.png`),sha256:hash('new thumbnail'),width:1080,height:1080,caption:'확인한 제목'}};
  const version={...manifest,approval:{approvedBy:'admin',approvedAt:now,outputInspected:true,manifestHash:portfolioThumbnailManifestHash(manifest)}};
  const commit=preparePortfolioThumbnailCommit(item,{version,expectedUpdatedAt:now,expectedActiveVersionId:null,expectedActiveSetId:set.setId,
    expectedProof:{render,sha256:version.asset.sha256},actor:'admin',activatedAt:now});
  item.metadata=commit.nextMetadata;
  item.content_review_assets[0].public_url=version.asset.url;
  return version;
}
const project=(item,set,versions=[])=>projectProductionPortfolioImages([item],{imageSets:set?[set]:[],thumbnailVersions:versions})[0];

test('all approved suites project current five real review rows and preserve every non-image/editorial field',()=>{
  for(const aspect of ['16:9','a4_landscape','a4_portrait']) {
    const {item,set}=fixture(aspect),before=structuredClone(item);
    item.content_review_assets.push({id:randomUUID(),asset_type:'body_image',public_url:'/legacy-stale.png'});
    const projected=project(item,set);
    assert.deepEqual(projected.metadata,before.metadata);
    assert.deepEqual(projected.content_review_assets,before.content_review_assets);
    const {content_review_assets:_a,...rest}=projected;const {content_review_assets:_b,...previous}=before;
    void _a;void _b;
    assert.deepEqual(rest,previous);
    assert.equal(item.content_review_assets.length,7); // read projection never mutates input
  }
});
test('active title version overrides exactly one thumbnail; BODY IDs/URLs and HTML/FAQ/publication stay identical',()=>{
  const {item,set}=fixture(),before=structuredClone(item),version=titleVersion(item,set),projected=project(item,set,[version]);
  assert.equal(projected.content_review_assets[0].public_url,version.asset.url);
  assert.equal(projected.content_review_assets[0].id,before.content_review_assets[0].id);
  assert.deepEqual(projected.content_review_assets.slice(1),before.content_review_assets.slice(1));
  assert.deepEqual(projected.metadata.generated,before.metadata.generated);
  assert.equal(projected.title,before.title);assert.equal(projected.published_url,before.published_url);
  const html=replaceAdminAssetUrls(projected.metadata.generated.bodyHtml,projected.content_review_assets);
  assert.ok(!html.includes('/api/admin/assets'));
  for(const asset of projected.content_review_assets.slice(1,5))assert.ok(html.includes(partnerAssetUrl(asset.id)));
});
test('missing, malformed or cross-work-item full pointers fail closed rather than exposing legacy fallbacks',()=>{
  for(const value of [null,{},false,{activeSetId:null},{activeSetId:'wrong'}]) {
    const {item}=fixture();item.metadata.portfolioImageSet=value;
    assert.equal(hasProductionPortfolioImageSelection(item.metadata),true);
    assert.throws(()=>project(item,null),/IMAGE_SET_/);
  }
  const {item,set}=fixture();assert.throws(()=>project(item,null),/ACTIVE_SET_MISSING/);
  set.workItemId=randomUUID();assert.throws(()=>project(item,set),/IMAGE_SET_/);
});
test('metadata exact binding rejects a changed BODY caption, URL, missing image, duplicate image or swapped order',()=>{
  for(const change of [a=>a[1].caption='changed',a=>a[1].url='/old.png',a=>a.splice(1,1),a=>a.push(a[1]),a=>[a[1],a[2]]=[a[2],a[1]]]) {
    const {item,set}=fixture();change(item.metadata.portfolioAssets);assert.throws(()=>project(item,set),/METADATA_ASSETS_MISMATCH/);
  }
});
test('corrupt manifest approval/path/hash never enters either projection',()=>{
  for(const change of [s=>s.assets[0].path='../raw.png',s=>s.approval.manifestHash=hash('bad'),s=>s.assets[2].sha256='bad',s=>s.approval.outputInspected=false]) {
    const {item,set}=fixture();change(set);assert.throws(()=>project(item,set),/IMAGE_SET_/);
  }
});
test('thumbnail missing/hash/base-set/source/render binding and current metadata drift fail closed',()=>{
  const {item,set}=fixture(),version=titleVersion(item,set);
  assert.throws(()=>project(item,set),/THUMBNAIL_ACTIVE_VERSION_MISSING/);
  for(const change of [i=>i.metadata.portfolioThumbnailVersion.manifestHash=hash('stale'),i=>i.metadata.portfolioThumbnailVersion.baseSetId=randomUUID(),
    i=>i.metadata.portfolioMockup.imageSetId=randomUUID(),i=>i.metadata.portfolioAssets[0].url='/old-thumbnail.png']) {
    const changed=structuredClone(item);change(changed);assert.throws(()=>project(changed,set,[version]),/THUMBNAIL_|IMAGE_SET_/);
  }
  const changed=structuredClone(version);changed.render.sourceHash=hash('another source');changed.approval.manifestHash=portfolioThumbnailManifestHash(changed);
  const changedItem=structuredClone(item);changedItem.metadata.portfolioThumbnailVersion.manifestHash=changed.approval.manifestHash;
  assert.throws(()=>project(changedItem,set,[changed]),/THUMBNAIL_BASE_CHANGED/);
});
test('actual review rows are required; missing/duplicated/wrong-work-item rows cannot yield synthetic partner URLs',()=>{
  for(const change of [rows=>rows.shift(),rows=>rows.push(rows[0]),rows=>rows[0].work_item_id=randomUUID(),rows=>rows[0].id='']) {
    const {item,set}=fixture();change(item.content_review_assets);assert.throws(()=>project(item,set),/IMAGE_SET_REVIEW_ASSET_/);
  }
});
test('legacy-only pages keep original references and query no new manifest tables',async()=>{
  const item={id:'old',metadata:{portfolioAssets:[{kind:'body_image',url:'/legacy.png'}]}};
  const rows=await loadProductionImageManifests([item],{from(){throw Error('NO_QUERY_ALLOWED');}});
  assert.deepEqual(rows,{imageSets:[],thumbnailVersions:[]});
  assert.equal(projectProductionPortfolioImages([item],rows)[0],item);
  assert.equal(hasProductionPortfolioImageSelection(item.metadata),false);
});
test('a mixed page fetches unique set/version IDs in two bulk reads, never one query per item',async()=>{
  const f=fixture(),g=fixture(),v=titleVersion(f.item,f.set),calls=[];
  const admin={from(table){return {select(columns){assert.equal(columns,'id,work_item_id,manifest');return {in(column,ids){calls.push({table,column,ids});
    return Promise.resolve({data:(table==='portfolio_image_sets'?[f.set,g.set]:[v]).map(manifest=>({id:manifest.setId??manifest.versionId,work_item_id:manifest.workItemId,manifest})),error:null});}};}};}};
  const rows=await loadProductionImageManifests([f.item,g.item,f.item],admin);
  assert.equal(calls.length,2);assert.equal(calls[0].ids.length,2);assert.equal(calls[1].ids.length,1);
  assert.equal(projectProductionPortfolioImages([f.item,g.item],rows).length,2);
});
test('bulk row envelope mismatch and backend failure return controlled codes without private diagnostics',async()=>{
  const {item,set}=fixture();
  const adapter=response=>({from(){return {select(){return {in(){return Promise.resolve(response);}};}};}});
  await assert.rejects(loadProductionImageManifests([item],adapter({data:[{id:randomUUID(),work_item_id:item.id,manifest:set}],error:null})),/MANIFEST_ROW_MISMATCH/);
  await assert.rejects(loadProductionImageManifests([item],adapter({data:null,error:{message:'secret private database diagnostic'}})),/MANIFEST_READ_FAILED/);
  assert.equal(productionImageProjectionErrorCode(Error('secret value')),'IMAGE_SET_PROJECTION_INVALID');
});
test('admin/review and partner GET use shared bulk projection before presentation; partner keeps existing authenticated URL helper',async()=>{
  const admin=await readFile(new URL('../../app/api/admin/content/route.ts',import.meta.url),'utf8');
  const partner=await readFile(new URL('../../app/api/partner/content/route.ts',import.meta.url),'utf8');
  for(const source of [admin,partner]) {
    assert.match(source,/loadProductionImageManifests\(/);assert.match(source,/projectProductionPortfolioImages\(/);
    assert.match(source,/productionImageProjectionErrorCode\(projectionError\)/);
  }
  assert.match(admin,/hasProductionPortfolioImageSelection\(rawItem.metadata\) \? rawItem : applyHyundaiManualMockups/);
  assert.match(partner,/previewUrl: partnerAssetUrl\(asset.id\)/);assert.match(partner,/replaceAdminAssetUrls\(originalBodyHtml, storedAssets\)/);
});

test('legacy writer guard uses key presence including false/null/undefined; no discard option can bypass it',()=>{
  for(const key of ['portfolioImageSet','portfolioThumbnailVersion'])for(const value of [undefined,null,false,{},'',{activeSetId:'bad'}]) {
    const metadata={[key]:value,discardManualAssets:true};let effects=0;
    assert.throws(()=>{assertLegacyPortfolioImageWriteAllowed(metadata);effects++;},/IMAGE_SET_LEGACY_WRITE_BLOCKED/);
    assert.equal(effects,0);
    const {item}=fixture();item.metadata={[key]:value,portfolioAssets:[]};
    assert.throws(()=>project(item,null),/IMAGE_SET_|THUMBNAIL_/);
  }
  for(const metadata of [undefined,null,{}, {manualMockupOverride:{kind:'admin_uploaded'}}])assert.doesNotThrow(()=>assertLegacyPortfolioImageWriteAllowed(metadata));
});

test('manual upload and hardcoded correction stop before reading upload bytes/deleting rows; normal text editing is not globally blocked',async()=>{
  const upload=await readFile(new URL('../../app/api/admin/content/[id]/mockup-images/route.ts',import.meta.url),'utf8');
  const guard=upload.indexOf('hasProductionPortfolioImageSelection(item.metadata)');
  for(const write of ['request.formData()', '.upload(objectPath', '.delete()'])assert.ok(upload.indexOf(write)>guard);
  assert.match(upload.slice(guard,upload.indexOf('request.formData()')),/status: 409/);
  const editor=await readFile(new URL('../../app/api/admin/content/[id]/route.ts',import.meta.url),'utf8');
  const correction=editor.indexOf('if (body.action === "correct_hyundai_content")');
  const correctionGuard=editor.indexOf('hasProductionPortfolioImageSelection(current.metadata)',correction);
  assert.ok(correctionGuard>correction);assert.ok(editor.indexOf('const correctedMetadata',correction)>correctionGuard);
  assert.match(editor,/if \(hasProductionPortfolioImageSelection\(current.metadata\)\) \{\s*try \{\s*issues = await readVerifiedProductionPublicationIssues/);
  assert.ok(editor.indexOf('hasProductionPortfolioImageSelection(current.metadata)')>correction);
});

test('queued legacy image/draft workers and restore/retry/rebuild entrypoints guard before render, conversion or queue reset',async()=>{
  const source=await readFile(new URL('./job-runner.ts',import.meta.url),'utf8');
  const part=(start,end)=>source.slice(source.indexOf(start),end?source.indexOf(end,source.indexOf(start)+start.length):undefined);
  const mockup=part('export async function processNextPortfolioMockup(', 'export async function processNextPortfolioDraft(');
  assert.ok(mockup.indexOf('assertLegacyPortfolioImageWriteAllowed(protectedWorkItem.metadata)')<mockup.indexOf('const recoverableJsonFailure'));
  assert.ok(mockup.indexOf('assertLegacyPortfolioImageWriteAllowed(coverWorkItem.metadata)')<mockup.indexOf('assets = await createPortfolioMockups('));
  assert.ok(mockup.indexOf('assertLegacyPortfolioImageWriteAllowed(workItemMetadata)')<mockup.indexOf('const { data: completedJob'));
  const draft=part('export async function processNextPortfolioDraft(', 'function recoverablePortfolioDraft(');
  assert.ok(draft.indexOf('assertLegacyPortfolioImageWriteAllowed(protectedWorkItem.metadata)')<draft.indexOf('let pendingResult'));
  assert.ok(draft.indexOf('assertLegacyPortfolioImageWriteAllowed(workItem.metadata)')<draft.indexOf('const { data: completedJob'));
  for(const [start,end,firstWrite] of [
    ['export async function restorePortfolioDraft(', 'export async function reflowPortfolioDraftImages(', 'const { data: updatedWorkItem'],
    ['export async function retryPortfolioDraft(', 'export async function rebuildPortfolioMockupsOnly(', 'const { data: resetJob'],
    ['export async function retryPortfolioConversion(', 'async function rebuildPortfolioMockupsOnlyClaimed(', 'const { data: conversions'],
    ['async function rebuildPortfolioMockupsOnlyClaimed(', 'export class PortfolioManualAssetsPresent', 'let candidateId'],
    ['export async function rebuildPortfolioDraft(', null, 'const manualApprovedAt'],
  ]) {
    const body=part(start,end),guard=body.indexOf('assertLegacyPortfolioImageWriteAllowed(workItem.metadata)');
    assert.ok(guard>=0,start);assert.ok(guard<body.indexOf(firstWrite),start);
  }
  const reflow=part('export async function reflowPortfolioDraftImages(', 'export async function retryPortfolioDraft(');
  assert.doesNotMatch(reflow,/assertLegacyPortfolioImageWriteAllowed/);
});

test('compatibility audit: new approved set cannot satisfy old COM proof checks just by its pointer; title-only asset loses legacy slide-index fields',()=>{
  const {item,set}=fixture();
  item.metadata.generated.bodyHtml=set.assets.slice(1).map(a=>`<p>기존 설명 문단입니다.</p><figure><img src="${a.url.replaceAll('&','&amp;')}"><figcaption>설명</figcaption></figure>`).join('');
  const renderedIndexes=[...new Set(set.assets.flatMap(a=>a.slideIndexes))].sort((a,b)=>a-b);
  const selectedIndexes=[...new Set(set.assets.slice(1).flatMap(a=>a.slideIndexes))].sort((a,b)=>a-b);
  const slideCount=Math.max(...renderedIndexes)+1;
  const manifest={version:2,method:'powerpoint_com_shapes_v2',sourceSlideCount:slideCount,slideCount,
    slides:Array.from({length:slideCount},(_,slideIndex)=>({slideIndex,sourceSlideNumber:slideIndex+1,inspectionStatus:'verified',
      regions:[{slideIndex,type:'client_identifier',label:'local_identifier',x:0.1,y:0.1,width:0.5,height:0.2}]}))};
  const conversion={status:'completed',result:{bucket:'slides',slidePaths:Array.from({length:slideCount},(_,i)=>`${i}.png`),localRedactionManifest:manifest},updated_at:now};
  const fingerprint=createPortfolioSourceFingerprint({bucket:'slides',slidePaths:conversion.result.slidePaths,conversionUpdatedAt:now});
  const proof={version:2,method:'powerpoint_com_shapes_v2',verified:true,sourceFingerprint:fingerprint,manifestHash:localRedactionManifestHash(manifest),
    slides:renderedIndexes.map(slideIndex=>({slideIndex,sourceHash:hash(`raw${slideIndex}`),redactedHash:hash(`blur${slideIndex}`),regionCount:1,changedPixelRatio:0.1}))};
  item.metadata.portfolioMockup={...item.metadata.portfolioMockup,mode:'short_psd',bodyBoardCount:4,selectedSlideIndexes:selectedIndexes,redactionStatus:'verified',
    aspectClass:set.aspectClass,templateSetId:set.suiteId,templateVersion:set.templateVersion};
  // A verified new set alone does not fabricate legacy worker jobs/proof.
  assert.ok(validatePortfolioPublicationMetadata(item.metadata).some(issue=>issue.includes('proof v2')));
  assert.ok(validatePortfolioSourceState(item.metadata,null,null,null).some(issue=>issue.includes('목업 작업')));
  Object.assign(item.metadata,{portfolioSourceFingerprint:fingerprint,portfolioRuleVersion:PORTFOLIO_RULE_VERSION,portfolioGenerationId:'old-generation',redactionProof:proof});
  const job={status:'completed',result:{sourceFingerprint:fingerprint,portfolioRuleVersion:PORTFOLIO_RULE_VERSION,portfolioGenerationId:'old-generation',redactionProof:proof}};
  assert.deepEqual(validatePortfolioPublicationMetadata(item.metadata),[]);
  assert.deepEqual(validatePortfolioSourceState(item.metadata,job,conversion,job),[]);
  const version=titleVersion(item,set);assert.ok(project(item,set,[version]));
  const issues=validatePortfolioPublicationMetadata(item.metadata);
  assert.ok(issues.some(issue=>issue.includes('고유 장표 인덱스')),JSON.stringify(issues));
  // This is an explicit compatibility blocker, NOT a bypass of the old checks.
});
