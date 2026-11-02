import assert from 'node:assert/strict';
import test from 'node:test';
import {createHash,randomUUID} from 'node:crypto';
import {readFile} from 'node:fs/promises';
import {getRegisteredApprovedMockupSuite,approvedMockupSuiteTemplates} from './approved-mockup-suites.ts';
import {resolveApprovedMockupSlots} from './approved-16x9-templates.ts';
import {createStyleRevisionStamp,shouldRewritePendingStyleItem} from '../content-ops/style-revision-rules.ts';
import {activatePortfolioImageSet,restorePortfolioImageSet,preparePortfolioImageSetCommit,portfolioImageSetManifestHash,
  portfolioImageSetAssetUrl,validatePortfolioImageSet,activePortfolioImageSetId,resolvePortfolioImageSet,swapImageSetBodySources} from './image-set.ts';
const hash=v=>createHash('sha256').update(v).digest('hex');
const now='2026-09-07T12:00:00.000Z';
const oldUrls=Array.from({length:4},(_,i)=>`/api/admin/assets?bucket=portfolio-rendered&path=old%2F${i}.png`);
function snapshot(){
  const generated={title:'바꾸면 안 되는 원고 제목',summary:'원고 요약',bodyHtml:'<p>원본 머리말.</p><img src="/untouched/logo.png">'
    +oldUrls.map((url,i)=>`<h2>소제목 ${i}</h2><p>문장 ${i}. 그대로!</p><figure class="kept"><img src="${url.replaceAll('&','&amp;')}" alt="원래 설명"><figcaption>캡션 ${i}</figcaption></figure>`).join(''),
    faq:[{question:'이것도 보존?',answer:'네, 그대로.'}],tags:['기존'],sourceUrls:['https://example.invalid/source']};
  return {id:randomUUID(),format:'portfolio',channel:'naver_design',status:'scheduled',title:'등록 제목',summary:'등록 요약',
    published_url:'https://blog.naver.com/example/123',published_url_normalized:'https://blog.naver.com/example/123',published_at:now,
    published_account:'example',scheduled_at:now,review_note:'기존 검토 메모',updated_at:'2026-09-07T10:00:00.000Z',
    metadata:{generated,portfolioAssets:oldUrls.map(url=>({kind:'body_image',url})),partnerHandoff:{completedAt:now,forceApprovalMemo:'기존 주소 메모'},
      styleRevision:createStyleRevisionStamp(generated,{styleComplete:true,appliedBy:'editor',appliedAt:now}),unknown:{keep:['all',1]}}};
}
function imageSet(item,aspect='16:9'){
  const setId=randomUUID(),suite=getRegisteredApprovedMockupSuite(aspect);
  const set={version:1,setId,workItemId:item.id,localWorkId:randomUUID(),buildId:randomUUID(),sourceHash:hash('source'),assignmentHash:hash('assignment'),
    suiteId:suite.suiteId,templateVersion:suite.version,aspectClass:aspect,
    assets:approvedMockupSuiteTemplates(suite).map((t,i)=>{const path=`verified-local/${item.id}/${setId}/${i}.png`;return {
      kind:i===0?'thumbnail':'body_image',name:i===0?'thumbnail.png':`body-${i}.png`,bucket:'portfolio-rendered',path,url:portfolioImageSetAssetUrl(path),
      sha256:hash(`${setId}:${i}`),width:t.canvas.width,height:t.canvas.height,caption:`목업 ${i}`,slideIndexes:resolveApprovedMockupSlots(t).map((_,j)=>j),
      slideAspectRatio:t.slideAspectRatio,mockupMode:'short_psd',aspectClass:aspect,mockupTemplateId:t.id,mockupTemplateVersion:t.version};})};
  return {...set,approval:{approvedBy:'authenticated-reviewer',approvedAt:now,outputInspected:true,manifestHash:portfolioImageSetManifestHash(set),visualReview:'not_performed'}};
}
function memoryStore(item){
  let current=structuredClone(item),rows=[{id:'old-asset',asset_type:'article_preview',public_url:'/old-preview'}],sets=new Map(),history=[],failure=null;
  return {
    snapshot:()=>structuredClone({current,rows,sets:[...sets],history}),
    failAt:stage=>failure=stage,
    edit:fn=>{fn(current);current.updated_at='2026-09-07T14:00:00.000Z';},
    readWorkItem:async id=>id===current.id?structuredClone(current):null,
    readImageSet:async (id,setId)=>sets.get(setId)?.workItemId===id?structuredClone(sets.get(setId)):null,
    async commit(input){
      if(input.expectedUpdatedAt!==current.updated_at||JSON.stringify(input.expectedMetadata)!==JSON.stringify(current.metadata)
        ||input.expectedActiveSetId!==activePortfolioImageSetId(current.metadata))throw Error('IMAGE_SET_REVISION_CONFLICT');
      const nextSets=new Map(sets),nextHistory=structuredClone(history),nextRows=rows.filter(r=>r.asset_type==='article_preview');
      if(nextSets.has(input.set.setId)&&JSON.stringify(nextSets.get(input.set.setId))!==JSON.stringify(input.set))throw Error('IMAGE_SET_ID_REUSED');
      nextSets.set(input.set.setId,structuredClone(input.set));if(failure==='set')throw Error('INJECTED_SET_FAILURE');
      nextHistory.push({setId:input.set.setId,previous:structuredClone(current),rows:structuredClone(rows)});
      nextRows.push(...input.set.assets.map((a,i)=>({id:`${input.set.setId}-${i}`,asset_type:a.kind,public_url:a.url,image_set_id:input.set.setId})));
      if(failure==='assets')throw Error('INJECTED_ASSET_FAILURE');
      const next={...current,metadata:structuredClone(input.nextMetadata),updated_at:input.activatedAt};if(failure==='metadata')throw Error('INJECTED_METADATA_FAILURE');
      current=next;rows=nextRows;sets=nextSets;history=nextHistory;
      return {workItemId:current.id,activeSetId:input.set.setId,updatedAt:current.updated_at};
    },
  };
}
const activate=(store,item,set)=>activatePortfolioImageSet({workItemId:item.id,set,expectedUpdatedAt:item.updated_at,expectedActiveSetId:activePortfolioImageSetId(item.metadata),actor:'admin',imageInputsVerified:true},
  {store,now:()=>new Date(now)});

test('strict image-only swap preserves placement, captions, unrelated images and every other manuscript field',()=>{
  const item=snapshot(),set=imageSet(item),before=structuredClone(item);
  const next=preparePortfolioImageSetCommit(item,{set,expectedUpdatedAt:item.updated_at,expectedActiveSetId:null,actor:'admin',activatedAt:now});
  const body=next.nextMetadata.generated.bodyHtml;
  let restored=body;set.assets.slice(1).forEach((a,i)=>restored=restored.replace(a.url.replaceAll('&','&amp;'),oldUrls[i].replaceAll('&','&amp;')));
  assert.equal(restored,item.metadata.generated.bodyHtml);
  assert.deepEqual({...next.nextMetadata.generated,bodyHtml:item.metadata.generated.bodyHtml},item.metadata.generated);
  assert.deepEqual(item,before);assert.deepEqual(next.nextMetadata.partnerHandoff,item.metadata.partnerHandoff);
  assert.deepEqual(next.nextMetadata.unknown,item.metadata.unknown);assert.equal(next.nextMetadata.manualMockupOverride.kind,'verified_image_set');
  assert.equal(shouldRewritePendingStyleItem({status:'approved',metadata:next.nextMetadata}),false);
});
test('all three suites require five current approved outputs and exact immutable path/hash/geometry binding',()=>{
  for(const aspect of ['16:9','a4_landscape','a4_portrait']){const item=snapshot(),set=imageSet(item,aspect);assert.deepEqual(validatePortfolioImageSet(set),set);}
  for(const mutate of [s=>s.assets.pop(),s=>s.assets[1].sha256='raw',s=>s.assets[1].width=800,s=>s.assets[1].url='/raw.png',
    s=>s.assets[1].path='../raw.png',s=>s.assets[1].slideIndexes=[1,1],s=>s.sourcePath='private-original.pptx',s=>s.assets[1].rawPng='private',
    s=>s.approval.outputInspected=false,s=>s.approval.manifestHash=hash('stale')]){
    const set=imageSet(snapshot());mutate(set);assert.throws(()=>validatePortfolioImageSet(set),/IMAGE_SET_/);
  }
});
test('ambiguous/missing legacy placements never trigger reflow, whole-text regeneration or a partial update',()=>{
  const item=snapshot();assert.throws(()=>swapImageSetBodySources(item.metadata.generated.bodyHtml,oldUrls.slice(0,3),['a','b','c']),/MAPPING_REQUIRED/);
  assert.throws(()=>swapImageSetBodySources('<p>본문만 있음.</p>',oldUrls,['a','b','c','d']),/MAPPING_REQUIRED/);
  assert.throws(()=>swapImageSetBodySources(item.metadata.generated.bodyHtml.replace('alt="원래 설명"','srcset="old.png 2x"'),oldUrls,['a','b','c','d']),/AMBIGUOUS/);
  assert.throws(()=>swapImageSetBodySources(item.metadata.generated.bodyHtml+`<img src="${oldUrls[0]}">`,oldUrls,['a','b','c','d']),/MAPPING_REQUIRED/);
});
test('atomic adapter failure at each checkpoint leaves complete prior metadata and review assets unchanged',async()=>{
  for(const point of ['set','assets','metadata']){const item=snapshot(),store=memoryStore(item),before=store.snapshot();store.failAt(point);
    await assert.rejects(activate(store,item,imageSet(item)),/INJECTED_/);assert.deepEqual(store.snapshot(),before);}
});
test('activation preserves current status/URL and text; rollback switches only image sources',async()=>{
  const item=snapshot();const store=memoryStore(item),first=imageSet(item),second=imageSet(item);
  const oldFetch=globalThis.fetch;globalThis.fetch=()=>{throw Error('NETWORK_FORBIDDEN');};
  try{
    await activate(store,item,first);let current=await store.readWorkItem(item.id);
    assert.equal(current.status,item.status);assert.equal(current.published_url,item.published_url);assert.equal(current.title,item.title);
    await activate(store,current,second);
    store.edit(value=>{value.metadata.generated.bodyHtml=value.metadata.generated.bodyHtml.replace('원본 머리말.','사용자가 이후에 수정한 머리말.');value.metadata.generated.faq[0].answer='이후 편집 FAQ';});
    current=await store.readWorkItem(item.id);
    await restorePortfolioImageSet({workItemId:item.id,restoreSetId:first.setId,expectedUpdatedAt:current.updated_at,expectedActiveSetId:second.setId,actor:'admin'},
      {store,now:()=>new Date('2026-09-07T15:00:00.000Z')});
    const restored=await store.readWorkItem(item.id);
    assert.ok(restored.metadata.generated.bodyHtml.includes('사용자가 이후에 수정한 머리말.'));assert.equal(restored.metadata.generated.faq[0].answer,'이후 편집 FAQ');
    assert.equal(restored.published_url,item.published_url);assert.equal(restored.status,item.status);
    assert.ok(first.assets.slice(1).every(a=>restored.metadata.generated.bodyHtml.includes(a.url.replaceAll('&','&amp;'))));
    const state=store.snapshot();assert.equal(state.sets.length,2);assert.equal(state.rows.filter(r=>r.image_set_id===first.setId).length,5);
    assert.equal(state.rows.find(r=>r.id==='old-asset').asset_type,'article_preview');
  }finally{globalThis.fetch=oldFetch;}
});
test('a rewritten manuscript reuses the five approved images and maps all four sources onto the latest text',async()=>{
  const item=snapshot(),store=memoryStore(item),set=imageSet(item);
  store.edit(value=>{
    value.status='review_required';value.metadata.generated.title='다시 쓴 제목';
    value.metadata.generated.bodyHtml=value.metadata.generated.bodyHtml.replace('원본 머리말.','다시 쓴 머리말.');
    value.metadata.generated.faq[0].answer='다시 쓴 답변';
  });
  const latest=await store.readWorkItem(item.id);
  const commit=preparePortfolioImageSetCommit(latest,{set,expectedUpdatedAt:item.updated_at,expectedActiveSetId:null,actor:'admin',activatedAt:now,imageInputsVerified:true});
  assert.equal(commit.expectedUpdatedAt,latest.updated_at);assert.deepEqual(commit.expectedMetadata,latest.metadata);
  await activate(store,item,set);
  const current=await store.readWorkItem(item.id),body=current.metadata.generated.bodyHtml;
  assert.equal(current.status,'review_required');assert.equal(current.metadata.generated.title,'다시 쓴 제목');
  assert.equal(current.metadata.generated.faq[0].answer,'다시 쓴 답변');assert.ok(body.includes('다시 쓴 머리말.'));
  assert.ok(set.assets.slice(1).every(asset=>body.includes(asset.url.replaceAll('&','&amp;'))));
  assert.ok(oldUrls.every(url=>!body.includes(url.replaceAll('&','&amp;'))));
  assert.ok(body.includes('/untouched/logo.png'));assert.equal(store.snapshot().history.length,1);
});
test('rebinding cannot replace a different active set or write over a newer manuscript read',async()=>{
  const item=snapshot(),store=memoryStore(item),set=imageSet(item),other=imageSet(item);
  store.edit(value=>value.metadata.generated.summary='교체 전 편집');
  const latest=await store.readWorkItem(item.id),commit=preparePortfolioImageSetCommit(latest,{set,expectedUpdatedAt:item.updated_at,expectedActiveSetId:null,actor:'admin',activatedAt:now,imageInputsVerified:true});
  store.edit(value=>value.metadata.generated.summary='교체 도중 편집');
  const before=store.snapshot();await assert.rejects(store.commit(commit),/IMAGE_SET_REVISION_CONFLICT/);assert.deepEqual(store.snapshot(),before);
  await activate(store,item,other);const activated=store.snapshot();
  await assert.rejects(activate(store,item,set),/IMAGE_SET_REVISION_CONFLICT/);assert.deepEqual(store.snapshot(),activated);
});
test('a rewrite without four known image placements leaves the manuscript and manual assets intact',async()=>{
  const item=snapshot(),store=memoryStore(item),set=imageSet(item);
  store.edit(value=>value.metadata.generated.bodyHtml='<p>그림 자리 없이 다시 쓴 글.</p><img src="/manual-upload.png">');
  const before=store.snapshot();await assert.rejects(activate(store,item,set),/IMAGE_SET_BODY_MAPPING_REQUIRED/);assert.deepEqual(store.snapshot(),before);
});
test('import callers without server-verified image inputs retain their generation-time revision gate',()=>{
  const item=snapshot(),set=imageSet(item),oldRevision=item.updated_at;item.updated_at=now;
  assert.throws(()=>preparePortfolioImageSetCommit(item,{set,expectedUpdatedAt:oldRevision,expectedActiveSetId:null,actor:'admin',activatedAt:now}),/IMAGE_SET_REVISION_CONFLICT/);
});
test('published work cannot activate or restore a different image set',async()=>{
  const item=snapshot(),store=memoryStore(item),set=imageSet(item);await activate(store,item,set);
  await activate(store,await store.readWorkItem(item.id),imageSet(item));
  store.edit(value=>value.status='published');const before=store.snapshot(),latest=await store.readWorkItem(item.id);
  await assert.rejects(activate(store,latest,imageSet(item)),/IMAGE_SET_PUBLISHED_LOCKED/);
  await assert.rejects(restorePortfolioImageSet({workItemId:item.id,restoreSetId:set.setId,expectedUpdatedAt:latest.updated_at,expectedActiveSetId:activePortfolioImageSetId(latest.metadata),actor:'admin'},
    {store}),/IMAGE_SET_PUBLISHED_LOCKED/);
  assert.deepEqual(store.snapshot(),before);
});
test('concurrent activation CAS has one winner; cross-work restore and stale approvals fail closed',async()=>{
  const item=snapshot(),store=memoryStore(item),a=imageSet(item),b=imageSet(item);
  const results=await Promise.allSettled([activate(store,item,a),activate(store,item,b)]);
  assert.equal(results.filter(r=>r.status==='fulfilled').length,1);assert.equal(results.filter(r=>r.status==='rejected').length,1);
  await assert.rejects(restorePortfolioImageSet({workItemId:item.id,restoreSetId:randomUUID(),expectedUpdatedAt:now,expectedActiveSetId:a.setId,actor:'admin'},{store}),/RESTORE_NOT_FOUND/);
  const other=imageSet(snapshot());await assert.rejects(activate(store,item,other),/WRONG_WORK_ITEM/);
});
test('a retry after lost success is idempotent and does not undo a newer manuscript edit',async()=>{
  const item=snapshot(),store=memoryStore(item),set=imageSet(item);await activate(store,item,set);
  store.edit(value=>{value.metadata.generated.faq[0].answer='첫 활성화 이후 수정';});
  const before=store.snapshot();await activate(store,item,set);assert.deepEqual(store.snapshot(),before);
  assert.equal(store.snapshot().history.length,1);
});
test('resolver never falls back to old image lists when an active set is absent or mismatched',()=>{
  const item=snapshot(),set=imageSet(item);
  assert.equal(resolvePortfolioImageSet(item.metadata,[]),null);
  const next=preparePortfolioImageSetCommit(item,{set,expectedUpdatedAt:item.updated_at,expectedActiveSetId:null,actor:'admin',activatedAt:now});
  assert.deepEqual(resolvePortfolioImageSet(next.nextMetadata,[set]),set);
  assert.throws(()=>resolvePortfolioImageSet(next.nextMetadata,[]),/ACTIVE_SET_MISSING/);
});
test('image replacement does not certify stale/incomplete style review and RPC never updates publication/job columns',async()=>{
  const item=snapshot();item.metadata.styleRevision.fingerprint=hash('old');item.metadata.styleRevision.styleComplete=false;
  const next=preparePortfolioImageSetCommit(item,{set:imageSet(item),expectedUpdatedAt:item.updated_at,expectedActiveSetId:null,actor:'admin',activatedAt:now});
  assert.deepEqual(next.nextMetadata.styleRevision,item.metadata.styleRevision);
  const sql=await readFile(new URL('../../supabase/migrations/202609070001_portfolio_image_sets.sql',import.meta.url),'utf8');
  assert.match(sql,/for update/i);assert.match(sql,/IMAGE_SET_REVISION_CONFLICT/);assert.match(sql,/from public, anon, authenticated/);
  assert.doesNotMatch(sql,/(?:update|insert into|delete from)\s+(?:public\.)?content_jobs/i);
  assert.match(sql,/update public\.content_work_items set metadata=p_next_metadata, updated_at=next_timestamp/);
});
