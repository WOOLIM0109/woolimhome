import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID,createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import sharp from 'sharp';
import {
  createVerifiedPortfolioThumbnailVersion,validatePortfolioThumbnailVersion,portfolioThumbnailPointer,
  portfolioThumbnailBaseFingerprint,portfolioThumbnailManifestHash,preparePortfolioThumbnailCommit,
  activatePortfolioThumbnailVersion,restorePortfolioThumbnailVersion,
} from './thumbnail-version.ts';
import {createSupabasePortfolioThumbnailVersionStore} from './thumbnail-version-supabase.ts';

const hash = value => createHash('sha256').update(value).digest('hex');
const clone = value => structuredClone(value);
const now = '2026-09-07T18:00:00.000Z';
const actor = 'authenticated-admin';
const renderIdentity = { localWorkId:randomUUID(),buildId:randomUUID(),sourceHash:hash('PPT'),baseFingerprint:hash('slots+blur+suite'),overlayFingerprint:hash('title-renderer') };
function item() {
  return { id:randomUUID(),format:'portfolio',channel:'naver_design',title:'게시글 제목 원본',summary:'요약 원본',
    status:'published',published_at:now,published_url:'https://blog.naver.com/example/123',scheduled_at:now,
    published_url_normalized:'https://blog.naver.com/example/123',updated_at:'2026-09-07T17:00:00.000Z',
    metadata:{ generated:{ title:'원고 제목',bodyHtml:'<h2>원래 제목</h2><p>원고.\n\n그대로!</p>'+Array.from({length:4},(_,i)=>`<figure><img src="/body-${i}.png"><figcaption>설명 ${i}</figcaption></figure>`).join(''),
      faq:[{question:'보존?',answer:'보존!'}],tags:['기존'],sourceUrls:['https://example.invalid'] },
      portfolioAssets:[{kind:'thumbnail',url:'/legacy-thumb.png',name:'original.png',caption:'기존 표지',width:1080,height:1080},
        ...Array.from({length:4},(_,i)=>({kind:'body_image',url:`/body-${i}.png`,caption:`설명 ${i}`,sha256:hash(`body${i}`)}))],
      portfolioMockup:{suite:'approved-layout'},styleRevision:{fingerprint:hash('style'),styleComplete:true},
      partnerHandoff:{forceApprovalMemo:'기존 주소 메모',publishedUrl:'이전 주소'},unknown:{keep:'all'} } };
}
const protectedFields = snapshot => {
  const copy=clone(snapshot); delete copy.updated_at;
  copy.metadata.portfolioAssets=copy.metadata.portfolioAssets.filter(a=>a.kind!=='thumbnail');
  delete copy.metadata.portfolioThumbnailVersion; return copy;
};
async function version(snapshot,title='행사 제안서',color='#547b86') {
  const png=await sharp({create:{width:1080,height:1080,channels:3,background:color}}).png().toBuffer();
  const render={...renderIdentity,inputFingerprint:hash(title),titleSpec:{main:title,sub:'',showSub:false,style:'bold'}};
  return createVerifiedPortfolioThumbnailVersion(snapshot,{versionId:randomUUID(),render,png,expectedImageHash:hash(png),actor,approvedAt:now,outputInspected:true});
}
function memoryStore(initial) {
  let current=clone(initial),versions=new Map(),legacy=new Map(),history=[],failure=null;
  let rows=initial.metadata.portfolioAssets.map((asset,i)=>({id:`original-row-${i}`,asset_type:asset.kind,public_url:asset.url,sort_order:i,approved:false}));
  return {
    snapshot:()=>clone({current,versions:[...versions],legacy:[...legacy],history,rows}),
    failAt:point=>{failure=point;},
    edit:fn=>{fn(current);current.updated_at='2026-09-07T19:00:00.000Z';},
    readWorkItem:async id=>id===current.id?clone(current):null,
    readVersion:async (workId,id)=>versions.get(id)?.workItemId===workId?clone(versions.get(id)):null,
    readLegacyThumbnail:async (workId,id)=>workId===current.id?clone(legacy.get(id)??null):null,
    async commit(input) {
      if(input.expectedUpdatedAt!==current.updated_at||JSON.stringify(input.expectedMetadata)!==JSON.stringify(current.metadata)
        ||input.expectedActiveVersionId!==(portfolioThumbnailPointer(current.metadata)?.activeVersionId??null)
        ||input.expectedActiveSetId!==(current.metadata.portfolioImageSet?.activeSetId??null)) throw Error('THUMBNAIL_REVISION_CONFLICT');
      const nextVersions=new Map(versions),nextLegacy=new Map(legacy),nextHistory=clone(history);
      if(input.version){
        if(nextVersions.has(input.version.versionId)&&JSON.stringify(nextVersions.get(input.version.versionId))!==JSON.stringify(input.version))throw Error('THUMBNAIL_VERSION_ID_REUSED');
        nextVersions.set(input.version.versionId,clone(input.version));
      }
      if(!portfolioThumbnailPointer(current.metadata)&&!nextLegacy.has(input.baselineId))nextLegacy.set(input.baselineId,clone(current.metadata.portfolioAssets.find(a=>a.kind==='thumbnail')));
      if(failure==='version')throw Error('INJECTED_VERSION_FAILURE');
      nextHistory.push(clone({baselineId:input.baselineId,operation:input.operation,previousThumbnail:current.metadata.portfolioAssets.find(a=>a.kind==='thumbnail')}));
      const nextRows=rows.map(row=>row.asset_type==='thumbnail'?{...row,public_url:input.nextThumbnail.url,approved:true}:clone(row));
      if(failure==='thumbnail_row')throw Error('INJECTED_THUMBNAIL_FAILURE');
      const nextCurrent={...current,metadata:clone(input.nextMetadata),updated_at:input.activatedAt};
      if(failure==='metadata')throw Error('INJECTED_METADATA_FAILURE');
      current=nextCurrent;versions=nextVersions;legacy=nextLegacy;history=nextHistory;rows=nextRows;
      return {workItemId:current.id,activeVersionId:input.version?.versionId??null,updatedAt:current.updated_at};
    },
  };
}
function activation(snapshot,value) { return {workItemId:snapshot.id,version:value,expectedUpdatedAt:snapshot.updated_at,
  expectedActiveVersionId:portfolioThumbnailPointer(snapshot.metadata)?.activeVersionId??null,
  expectedActiveSetId:snapshot.metadata.portfolioImageSet?.activeSetId??null,
  expectedProof:{render:clone(value.render),sha256:value.asset.sha256},actor}; }
function restoration(snapshot,baselineId,restoreVersionId=null) { return {workItemId:snapshot.id,restoreVersionId,baselineId,
  expectedUpdatedAt:snapshot.updated_at,expectedActiveVersionId:portfolioThumbnailPointer(snapshot.metadata)?.activeVersionId??null,
  expectedActiveSetId:snapshot.metadata.portfolioImageSet?.activeSetId??null,expectedRenderIdentity:renderIdentity,actor,activatedAt:now}; }

test('actual PNG receipt binds immutable path/hash, exact title and renderer identity',async()=>{
  const initial=item(),v=await version(initial);
  assert.deepEqual(validatePortfolioThumbnailVersion(v),v);
  assert.equal(v.asset.path,`verified-thumbnail/${initial.id}/${v.versionId}.png`);
  assert.equal(v.baseFingerprint,portfolioThumbnailBaseFingerprint(initial,renderIdentity));
  assert.equal(v.baselineId,v.versionId);
  for(const change of [v=>v.asset.width=800,v=>v.asset.path='../../raw.png',v=>v.asset.url='https://example.invalid',v=>v.render.sourcePath='private.pptx',
    v=>v.approval.outputInspected=false,v=>v.approval.approvedBy='',v=>v.render.titleSpec.html='<script/>',v=>v.render.titleSpec.main='바꾼 제목']){
    const altered=clone(v);change(altered);assert.throws(()=>validatePortfolioThumbnailVersion(altered));
  }
  const small=await sharp({create:{width:540,height:540,channels:3,background:'#fff'}}).png().toBuffer();
  const input={versionId:randomUUID(),render:v.render,png:small,expectedImageHash:hash(small),actor,approvedAt:now,outputInspected:true};
  await assert.rejects(createVerifiedPortfolioThumbnailVersion(initial,input),/DIMENSIONS_INVALID/);
  await assert.rejects(createVerifiedPortfolioThumbnailVersion(initial,{...input,expectedImageHash:hash('wrong')}),/BYTES_MISMATCH/);
});

test('only thumbnail element and independent pointer change; BODY URLs, HTML bytes, FAQ and publication all remain identical',async()=>{
  const initial=item(),store=memoryStore(initial),before=store.snapshot(),v=await version(initial);
  const commit=preparePortfolioThumbnailCommit(initial,{...activation(initial,v),activatedAt:now});
  assert.equal(commit.nextMetadata.generated.bodyHtml,initial.metadata.generated.bodyHtml);
  assert.deepEqual(commit.nextMetadata.generated,initial.metadata.generated);
  await activatePortfolioThumbnailVersion(activation(initial,v),{store,now:()=>new Date(now)});
  const after=store.snapshot();assert.deepEqual(protectedFields(after.current),protectedFields(initial));
  assert.deepEqual(after.rows.filter(r=>r.asset_type==='body_image'),before.rows.filter(r=>r.asset_type==='body_image'));
  assert.equal(after.current.metadata.portfolioThumbnailVersion.activeVersionId,v.versionId);
  assert.deepEqual(after.current.metadata.styleRevision,initial.metadata.styleRevision);
});

test('stale image/title/base source/slots/blur proofs cannot be committed',async()=>{
  const initial=item(),v=await version(initial),input=activation(initial,v);
  for(const mutate of [x=>x.expectedProof.sha256=hash('wrong'),x=>x.expectedProof.render.titleSpec.main='다른 제목',
    x=>x.expectedProof.render.baseFingerprint=hash('changed blur'),x=>x.expectedProof.render.buildId=randomUUID(),
    x=>x.expectedProof.render.overlayFingerprint=hash('changed renderer')]){
    const changed=clone(input);mutate(changed);assert.throws(()=>preparePortfolioThumbnailCommit(initial,{...changed,activatedAt:now}),/REVIEW_STALE/);
  }
  const changed=clone(initial);changed.metadata.portfolioAssets[1].url='/new-body.png';
  assert.throws(()=>preparePortfolioThumbnailCommit(changed,{...input,activatedAt:now}),/BASE_CHANGED/);
  const newSet=clone(initial);newSet.metadata.portfolioImageSet={activeSetId:randomUUID()};
  assert.throws(()=>preparePortfolioThumbnailCommit(newSet,{...input,activatedAt:now}),/REVISION_CONFLICT/);
  assert.throws(()=>preparePortfolioThumbnailCommit(initial,{...input,actor:'client-forged-admin',activatedAt:now}),/APPROVAL_ACTOR_MISMATCH/);
});

test('each transactional failure leaves previous thumbnail, BODY rows, metadata and version history unchanged',async()=>{
  for(const point of ['version','thumbnail_row','metadata']){
    const initial=item(),store=memoryStore(initial),v=await version(initial),before=store.snapshot();store.failAt(point);
    await assert.rejects(activatePortfolioThumbnailVersion(activation(initial,v),{store}),/INJECTED_/);
    assert.deepEqual(store.snapshot(),before);
  }
});

test('concurrent activations use CAS and only one can win',async()=>{
  const initial=item(),store=memoryStore(initial),a=await version(initial,'제목 가'),b=await version(initial,'제목 나');
  const results=await Promise.allSettled([activatePortfolioThumbnailVersion(activation(initial,a),{store}),activatePortfolioThumbnailVersion(activation(initial,b),{store})]);
  assert.equal(results.filter(r=>r.status==='fulfilled').length,1);
  assert.equal(results.filter(r=>r.status==='rejected').length,1);
  assert.equal(store.snapshot().history.length,1);
});

test('replay after lost success is a no-op and does not undo later article edits',async()=>{
  const initial=item(),store=memoryStore(initial),v=await version(initial),input=activation(initial,v);
  await activatePortfolioThumbnailVersion(input,{store});
  store.edit(current=>{current.metadata.generated.bodyHtml+='\n<p>나중 편집.</p>';current.metadata.generated.faq[0].answer='나중 답변';});
  const before=store.snapshot();await activatePortfolioThumbnailVersion(input,{store});assert.deepEqual(store.snapshot(),before);
  const reused=clone(v);reused.asset.sha256=hash('different image');reused.approval.manifestHash=portfolioThumbnailManifestHash(reused);
  await assert.rejects(activatePortfolioThumbnailVersion({...input,version:reused,expectedProof:{render:reused.render,sha256:reused.asset.sha256}},{store}),/VERSION_ID_REUSED/);
});

test('rollback switches only thumbnail; legacy baseline restoration preserves current manuscript and BODY IDs',async()=>{
  const initial=item(),store=memoryStore(initial),a=await version(initial);
  await activatePortfolioThumbnailVersion(activation(initial,a),{store});
  let current=await store.readWorkItem(initial.id);const b=await version(current,'수정 제목');
  assert.equal(b.baselineId,a.versionId);
  await activatePortfolioThumbnailVersion(activation(current,b),{store});
  store.edit(value=>{value.metadata.generated.bodyHtml+='\n<p>최신 본문 유지.</p>';value.metadata.generated.faq[0].answer='최신 FAQ';});
  current=await store.readWorkItem(initial.id);const protectedBefore=protectedFields(current),bodyRows=store.snapshot().rows.filter(r=>r.asset_type==='body_image');
  await restorePortfolioThumbnailVersion(restoration(current,a.baselineId,a.versionId),{store});
  current=await store.readWorkItem(initial.id);assert.equal(current.metadata.portfolioAssets[0].url,a.asset.url);
  assert.deepEqual(protectedFields(current),protectedBefore);
  const legacyInput=restoration(current,a.baselineId);
  await restorePortfolioThumbnailVersion(legacyInput,{store});
  current=await store.readWorkItem(initial.id);
  assert.deepEqual(current.metadata.portfolioAssets[0],initial.metadata.portfolioAssets[0]);
  assert.equal(portfolioThumbnailPointer(current.metadata),null);
  assert.deepEqual(protectedFields(current),protectedBefore);
  assert.deepEqual(store.snapshot().rows.filter(r=>r.asset_type==='body_image'),bodyRows);
  const before=store.snapshot();await restorePortfolioThumbnailVersion(legacyInput,{store});assert.deepEqual(store.snapshot(),before);
});

test('rollback refuses other work/baseline or changed source/body identity',async()=>{
  const initial=item(),store=memoryStore(initial),v=await version(initial);await activatePortfolioThumbnailVersion(activation(initial,v),{store});
  let current=await store.readWorkItem(initial.id);
  await assert.rejects(restorePortfolioThumbnailVersion(restoration(current,randomUUID()),{store}),/BASE_CHANGED/);
  await assert.rejects(restorePortfolioThumbnailVersion({...restoration(current,v.baselineId),expectedRenderIdentity:{...renderIdentity,sourceHash:hash('new PPT')}},{store}),/BASE_CHANGED/);
  store.edit(value=>{value.metadata.portfolioAssets[1].url='/different-body.png';});current=await store.readWorkItem(initial.id);
  await assert.rejects(restorePortfolioThumbnailVersion(restoration(current,v.baselineId),{store}),/BASE_CHANGED/);
});

test('missing or ambiguous legacy thumbnail is blocked rather than replacing arbitrary assets',async()=>{
  const initial=item();initial.metadata.portfolioAssets=initial.metadata.portfolioAssets.filter(a=>a.kind!=='thumbnail');
  assert.throws(()=>portfolioThumbnailBaseFingerprint(initial,renderIdentity),/LEGACY_MAPPING_REQUIRED/);
  initial.metadata.portfolioAssets.push({kind:'thumbnail',url:'/a'},{kind:'thumbnail',url:'/b'});
  assert.throws(()=>portfolioThumbnailBaseFingerprint(initial,renderIdentity),/LEGACY_MAPPING_REQUIRED/);
});

test('separate SQL has locked metadata CAS, exact non-thumbnail preservation and service-role-only RPC',async()=>{
  const sql=await readFile(new URL('../../supabase/migrations/202609070002_portfolio_thumbnail_versions.sql',import.meta.url),'utf8');
  assert.match(sql,/for update/i);assert.match(sql,/item\.metadata is distinct from p_expected_metadata/);
  assert.match(sql,/old_assets->i is distinct from next_assets->i/);
  assert.match(sql,/delete from public\.content_review_assets where id=previous_review\.id and asset_type='thumbnail'/);
  assert.doesNotMatch(sql,/(?:insert into|delete from|update)\s+(?:public\.)?content_jobs/i);
  assert.match(sql,/update public\.content_work_items set metadata=p_next_metadata,updated_at=new_timestamp/);
  assert.match(sql,/previous_review_thumbnail/);assert.match(sql,/from public,anon,authenticated/);
  const source=await readFile(new URL('./thumbnail-version.ts',import.meta.url),'utf8');
  assert.doesNotMatch(source,/process\.env|fetch\(|createAdminClient|swapImageSetBodySources|\.from\(/);
});

test('Supabase adapter is explicitly injected and reads version/history under the work-item boundary',async()=>{
  const calls=[];const admin={from(table){calls.push(['from',table]);const query={};
    for(const method of ['select','eq','is','order','limit'])query[method]=(...args)=>{calls.push([method,...args]);return query;};
    query.maybeSingle=async()=>({data:null,error:null});return query;}};
  const store=createSupabasePortfolioThumbnailVersionStore(admin);
  assert.equal(calls.length,0);
  const workId=randomUUID(),versionId=randomUUID();
  assert.equal(await store.readVersion(workId,versionId),null);
  assert.ok(calls.some(c=>c[0]==='eq'&&c[1]==='work_item_id'&&c[2]===workId));
  calls.length=0;await store.readLegacyThumbnail(workId,versionId);
  assert.ok(calls.some(c=>c[0]==='eq'&&c[1]==='baseline_id'&&c[2]===versionId));
  assert.ok(calls.some(c=>c[0]==='is'&&c[1]==='previous_version_id'&&c[2]===null));
});

test('Supabase adapter sends one atomic RPC and rejects ambiguous completion receipts',async()=>{
  const initial=item(),v=await version(initial);const commit=preparePortfolioThumbnailCommit(initial,{...activation(initial,v),activatedAt:now});
  const calls=[];let response={data:{workItemId:initial.id,activeVersionId:v.versionId,updatedAt:now},error:null};
  const store=createSupabasePortfolioThumbnailVersionStore({rpc:async(name,args)=>{calls.push({name,args});return response;}});
  const result=await store.commit(commit);assert.equal(result.activeVersionId,v.versionId);
  assert.equal(calls.length,1);assert.equal(calls[0].name,'activate_portfolio_thumbnail_version');
  assert.deepEqual(calls[0].args.p_expected_metadata,initial.metadata);
  response={data:{...result,activeVersionId:randomUUID()},error:null};
  await assert.rejects(store.commit(commit),/COMMIT_RECEIPT_INVALID/);
  response={data:null,error:{message:'details THUMBNAIL_REVISION_CONFLICT private internal path'}};
  await assert.rejects(store.commit(commit),/^Error: THUMBNAIL_REVISION_CONFLICT$/);
});
