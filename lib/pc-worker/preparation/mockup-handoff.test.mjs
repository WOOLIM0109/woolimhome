import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { createMockupFixture } from './mockup-fixture.mjs';
import { initializeLocalMockups, renderLocalMockups, getLocalMockupReview, saveLocalMockupAssignments } from './mockup-service.ts';
import { previewLocalMockupHandoff, handoffLocalMockupSet } from './mockup-handoff.ts';
import { openPreparationWorkStore } from './work-store.ts';
import { getLocalRedactionSlide, saveLocalRedactionSlide } from './redaction-service.ts';
import { assertFlatRedactionPng } from './redaction-renderer.ts';
import { createStyleRevisionStamp, shouldRewritePendingStyleItem } from '../../content-ops/style-revision-rules.ts';

const time='2026-09-07T12:00:00.000Z';
function memory() {
  const urls=Array.from({length:4},(_,i)=>`/old/body-${i}.png`);
  const generated={title:'기존 원고 제목',bodyHtml:urls.map((url,i)=>`<h2>기존 소제목 ${i}</h2><p>기존 본문 ${i}. 그대로!</p><figure><img src="${url}" alt="기존 설명"><figcaption>기존 캡션</figcaption></figure>`).join(''),
    faq:[{question:'원래 질문?',answer:'원래 답변.'}],tags:['보존']};
  const initial={id:randomUUID(),format:'portfolio',status:'published',title:'등록 제목',summary:'기존 요약',
    published_url:'https://blog.naver.com/example/12345',published_url_normalized:'https://blog.naver.com/example/12345',published_account:'example',published_at:time,scheduled_at:time,review_note:'기존 검토',updated_at:time,
    metadata:{generated,portfolioAssets:urls.map(url=>({kind:'body_image',url})),unknown:{keep:true},
      styleRevision:createStyleRevisionStamp(generated,{styleComplete:true,appliedBy:'synthetic-reviewer',appliedAt:time})}};
  let current=structuredClone(initial),commits=0,puts=0,failPut=-1,failCommit=false;
  const files=new Map();
  return {initial,files,get current(){return current;},get commits(){return commits;},get puts(){return puts;},
    set failPut(n){failPut=n;},set failCommit(v){failCommit=v;},
    storage:{get:async (_bucket,key)=>files.get(key)??null,putImmutable:async (_bucket,key,png)=>{
      puts++;if(puts===failPut)throw Error('INJECTED_UPLOAD_FAILURE');assert.ok(!files.has(key));files.set(key,Buffer.from(png));}},
    store:{readWorkItem:async id=>id===current.id?structuredClone(current):null,readImageSet:async()=>null,
      commit:async input=>{
        assert.equal(input.expectedUpdatedAt,current.updated_at);assert.deepEqual(input.expectedMetadata,current.metadata);
        if(failCommit)throw Error('INJECTED_ATOMIC_COMMIT_FAILURE');
        commits++;current={...current,metadata:structuredClone(input.nextMetadata),updated_at:input.activatedAt};
        return {workItemId:current.id,activeSetId:input.set.setId,updatedAt:current.updated_at};}},
  };
}
const destination=m=>({workItemId:m.initial.id,setId:randomUUID()});
const argumentsFor=(fixture,target,preview,m)=>({...fixture,...target,expectedApprovalHash:preview.approvalHash,
  approvedBy:'SYNTHETIC OUTPUT REVIEW',outputInspected:true,expectedUpdatedAt:m.initial.updated_at,expectedActiveSetId:null});
const deps=m=>({storage:m.storage,store:m.store,now:()=>new Date('2026-09-07T13:00:00.000Z')});

test('verified local final-set handoff is explicit, bounded to final PNGs and atomic with manuscript preservation',async t=>{
  const fixture=await createMockupFixture({count:8});t.after(()=>fixture.cleanup());
  const oldFetch=globalThis.fetch;globalThis.fetch=()=>{throw Error('NETWORK_FORBIDDEN');};t.after(()=>{globalThis.fetch=oldFetch;});
  let review=await initializeLocalMockups({...fixture,title:'합성 검수 작업'});
  await t.test('no final set or fabricated approval cannot start storage/DB writes',async()=>{
    const m=memory(),target=destination(m);
    await assert.rejects(previewLocalMockupHandoff({...fixture,...target}),/HANDOFF_INCOMPLETE/);
    await assert.rejects(handoffLocalMockupSet({...fixture,...target,outputInspected:false},deps(m)),/EXPLICIT_OUTPUT_REVIEW_REQUIRED/);
    assert.equal(m.puts,0);assert.equal(m.commits,0);
  });
  review=await renderLocalMockups({...fixture,expectedRevision:review.revision,scale:.5});
  await renderLocalMockups({...fixture,expectedRevision:review.revision,scale:1});
  await t.test('preview is read-only and outputs no raw paths, source text, debug PNG or privacy exception',async()=>{
    const store=await openPreparationWorkStore(fixture);const before=await store.readBuild(fixture.buildId);await store.release();
    const m=memory(),preview=await previewLocalMockupHandoff({...fixture,...destination(m)});
    assert.equal(preview.manifest.assets.length,5);assert.equal(preview.visualReview,'not_performed');
    assert.doesNotMatch(JSON.stringify(preview),/fake@example|redaction-state|absolutePath|\.png.*debug|originalInspected|exceptions/);
    const afterStore=await openPreparationWorkStore(fixture);assert.deepEqual(await afterStore.readBuild(fixture.buildId),before);await afterStore.release();
  });
  await t.test('success verifies five immutable PNGs and changes no text/FAQ/title/publication field',async()=>{
    const m=memory(),target=destination(m),preview=await previewLocalMockupHandoff({...fixture,...target});
    const result=await handoffLocalMockupSet(argumentsFor(fixture,target,preview,m),deps(m));
    assert.equal(result.images,5);assert.equal(m.puts,5);assert.equal(m.commits,1);
    assert.equal(result.visualReview,'not_performed');
    for(const [key,png] of m.files){assert.match(key,/^verified-local\//);assertFlatRedactionPng(png);}
    for(const key of Object.keys(m.initial).filter(k=>!['metadata','updated_at'].includes(k)))assert.deepEqual(m.current[key],m.initial[key]);
    const expected=structuredClone(m.initial.metadata.generated);
    expected.bodyHtml=m.current.metadata.generated.bodyHtml;
    assert.deepEqual(m.current.metadata.generated,expected);
    const restored=m.current.metadata.generated.bodyHtml.replace(/src="[^"]*"/g,'src="IMAGE"');
    assert.equal(restored,m.initial.metadata.generated.bodyHtml.replace(/src="[^"]*"/g,'src="IMAGE"'));
    assert.deepEqual(m.current.metadata.unknown,m.initial.metadata.unknown);
    assert.equal(shouldRewritePendingStyleItem({status:'approved',metadata:m.current.metadata}),false);
    const local=await openPreparationWorkStore(fixture);assert.equal((await local.readWork()).activeSetRef.setId,'existing-live-set-synthetic');await local.release();
  });
  await t.test('upload failure retains old complete set; explicit retry reuses only verified staged files',async()=>{
    const m=memory(),target=destination(m),preview=await previewLocalMockupHandoff({...fixture,...target}),args=argumentsFor(fixture,target,preview,m);
    m.failPut=3;await assert.rejects(handoffLocalMockupSet(args,deps(m)),/INJECTED_UPLOAD_FAILURE/);
    assert.deepEqual(m.current,m.initial);assert.equal(m.commits,0);assert.equal(m.files.size,2);
    m.failPut=-1;const result=await handoffLocalMockupSet(args,deps(m));assert.equal(result.reused,2);assert.equal(m.commits,1);
  });
  await t.test('corrupted staged object and final transaction failure never activate a partial set',async()=>{
    const m=memory(),target=destination(m),preview=await previewLocalMockupHandoff({...fixture,...target}),args=argumentsFor(fixture,target,preview,m);
    m.files.set(preview.manifest.assets[0].path,Buffer.from('corrupt'));
    await assert.rejects(handoffLocalMockupSet(args,deps(m)),/STORED_HASH_MISMATCH/);assert.equal(m.commits,0);assert.equal(m.puts,0);
    m.files.clear();m.failCommit=true;
    await assert.rejects(handoffLocalMockupSet(args,deps(m)),/INJECTED_ATOMIC_COMMIT_FAILURE/);
    assert.deepEqual(m.current,m.initial);assert.equal(m.files.size,5);assert.equal(m.commits,0);
  });
  await t.test('work lock spans transport so source approvals cannot race final activation',async()=>{
    const m=memory(),target=destination(m),preview=await previewLocalMockupHandoff({...fixture,...target});
    const get=m.storage.get;
    m.storage.get=async(...args)=>{await assert.rejects(openPreparationWorkStore(fixture),{name:'PreparationWorkLockedError'});return get(...args);};
    await handoffLocalMockupSet(argumentsFor(fixture,target,preview,m),deps(m));
  });
  await t.test('stale output confirmation and changed redaction are rejected before any transport',async()=>{
    const m=memory(),target=destination(m),preview=await previewLocalMockupHandoff({...fixture,...target});
    await assert.rejects(handoffLocalMockupSet({...argumentsFor(fixture,target,preview,m),expectedApprovalHash:'0'.repeat(64)},deps(m)),/APPROVAL_STALE/);
    const r=await getLocalMockupReview(fixture),board=r.boards[3];
    const next=await saveLocalMockupAssignments({...fixture,expectedRevision:r.revision,title:r.title,
      boards:r.boards.map(b=>({templateId:b.templateId,slots:b.slots.map((s,j)=>({slotId:s.slotId,sourceSlideNumber:b===board&&j===0?null:s.sourceSlideNumber}))}))});
    assert.equal(next.boards[3].final,null);
    await assert.rejects(handoffLocalMockupSet(argumentsFor(fixture,target,preview,m),deps(m)),/HANDOFF_REDACTION_STALE|HANDOFF_INCOMPLETE/);
    const redaction=await getLocalRedactionSlide({...fixture,sourceSlideNumber:1});
    await saveLocalRedactionSlide({...fixture,sourceSlideNumber:1,expectedRevision:redaction.revision,regions:redaction.regions,exceptions:[],review:{...redaction.review,originalInspected:false}});
    await assert.rejects(previewLocalMockupHandoff({...fixture,...target}),/HANDOFF_REDACTION_STALE/);
    assert.equal(m.puts,0);assert.equal(m.commits,0);
  });
});
